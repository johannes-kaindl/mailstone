import { Notice, Plugin, SuggestModal, getLanguage, type App } from "obsidian";
import { loadSettings, type MailstoneSettings } from "./core/settings";
import { initI18n } from "./i18n/strings";
import { t } from "./vendor/code-kit/i18n";
import { MailstoneSettingTab } from "./obsidian/settings-tab";
import { importEmlFolder } from "./obsidian/import-eml";
import { noticeNotifier } from "./obsidian/notifier";
import { FolderPromptModal } from "./obsidian/modals/folder-prompt";
import { obsidianSecretStore } from "./obsidian/secrets";
import { nodeSocketTransport } from "./obsidian/tls-transport";
import { createSendService, resolveSender, type SendService } from "./core/send/service";
import { transportAccounts, splitTransportId } from "./core/send/imip";
import { buildMailTransport, createCalendarNotesBridge, type CalendarNotesBridge } from "./obsidian/calendar-notes-bridge";

interface PersistedState { settings: MailstoneSettings; zoneHashes: Record<string, string> }

interface TransportRow { id: string; address: string; label: string }

/** Waehlt Konto+Identitaet fuer "Test-Mail an mich": Suchfeld ueber alle
 *  `transportAccounts()`-Zeilen (Konto x Identitaet), abgebrochen (Escape/Klick daneben)
 *  liefert `null` statt eine Ausnahme zu werfen. */
class TransportPickerModal extends SuggestModal<TransportRow> {
  private settled = false;
  private resolveFn: (row: TransportRow | null) => void = () => undefined;

  constructor(
    app: App,
    private readonly rows: TransportRow[],
  ) {
    super(app);
  }

  getSuggestions(query: string): TransportRow[] {
    const q = query.toLowerCase();
    return this.rows.filter((r) => r.label.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));
  }

  renderSuggestion(row: TransportRow, el: HTMLElement): void {
    el.setText(row.label);
  }

  onChooseSuggestion(row: TransportRow): void {
    this.settle(row);
  }

  onClose(): void {
    this.settle(null);
  }

  private settle(row: TransportRow | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveFn(row);
  }

  pick(): Promise<TransportRow | null> {
    return new Promise((resolve) => {
      this.resolveFn = resolve;
      this.open();
    });
  }
}

export default class MailstonePlugin extends Plugin {
  settings: MailstoneSettings = loadSettings(undefined);
  zoneHashes: Record<string, string> = {};
  sendService!: SendService;
  bridge!: CalendarNotesBridge;

  async onload(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PersistedState> | null;
    this.settings = loadSettings(raw?.settings ?? raw);
    this.zoneHashes = raw?.zoneHashes ?? {};
    initI18n(this.settings.language === "auto" ? getLanguage() : this.settings.language);
    const secrets = obsidianSecretStore(this.app);
    // Objektreferenz statt Kopie: this.settings wird nach dieser Stelle im onload() nicht mehr
    // neu zugewiesen (nur Felder darin mutiert), der Tab sieht also stets den aktuellen Stand.
    this.addSettingTab(
      new MailstoneSettingTab(this.app, this, {
        settings: this.settings,
        saveSettings: () => this.saveSettings(),
        secrets,
        transport: () => nodeSocketTransport(),
      }),
    );
    const notify = noticeNotifier();

    this.sendService = createSendService({
      accounts: () => this.settings.accounts,
      secret: (id) => secrets.get(id),
      transport: () => nodeSocketTransport(),
      now: () => new Date(),
      randomId: () => crypto.randomUUID(),
      ...(this.settings.debugLog ? { log: (l: string) => console.debug("[mailstone smtp]", l) } : {}),
    });

    this.bridge = createCalendarNotesBridge(
      this.app,
      buildMailTransport({ accounts: () => this.settings.accounts, sendService: this.sendService, label: "Mailstone" }),
    );
    // calendar-notes kann vor oder nach mailstone geladen werden (und zur Laufzeit entladen
    // werden) — deshalb hier, in onLayoutReady UND bei jedem "layout-change" versuchen, solange
    // noch nicht registriert (tryRegister() ist idempotent).
    this.bridge.tryRegister();
    this.app.workspace.onLayoutReady(() => {
      this.bridge.tryRegister();
    });
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        if (!this.bridge.registered) this.bridge.tryRegister();
      }),
    );

    this.addCommand({
      id: "import-eml-folder",
      name: t("cmd.importEml.name"),
      callback: async () => {
        const folder = await new FolderPromptModal(this.app, t("import.prompt.folder")).prompt();
        if (!folder) return;
        // finally: die Zone-Hashes der bereits geschriebenen Notizen muessen auch dann
        // persistiert werden, wenn der Lauf unterwegs wirft — sonst gilt beim naechsten Lauf
        // jede davon als fremd editiert (zone-edited) und wird nie wieder aktualisiert.
        try {
          const r = await importEmlFolder(
            {
              app: this.app,
              profile: this.settings.profile,
              hashes: { get: (k) => this.zoneHashes[k] ?? null, set: (k, v) => { this.zoneHashes[k] = v; } },
              now: () => new Date(),
            },
            folder,
          );
          notify.info("import.done", r.created, r.updated, r.skipped.length, r.errors.length);
          if (r.errors.length > 0) notify.error("import.errors", r.errors.length);
        } finally {
          await this.saveSettings();
        }
      },
    });

    this.addCommand({
      id: "send-test-mail",
      name: t("cmd.sendTest.name"),
      callback: () => void this.sendTestMail(notify),
    });
  }

  onunload(): void {
    this.bridge?.unregister();
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ settings: this.settings, zoneHashes: this.zoneHashes } satisfies PersistedState);
  }

  private async sendTestMail(notify: { info(key: string, ...a: (string | number)[]): void; error(key: string, ...a: (string | number)[]): void }): Promise<void> {
    const withIdentities = this.settings.accounts.filter((a) => a.identities.length > 0);
    if (withIdentities.length === 0) {
      new Notice(t("error.send.no-accounts"));
      return;
    }

    let accountId: string;
    let identityId: string;
    if (withIdentities.length === 1) {
      const acc = withIdentities[0];
      if (!acc) return; // unreachable (Laenge oben geprueft), macht noUncheckedIndexedAccess still.
      const identity = acc.identities.find((i) => i.id === acc.defaultIdentityId) ?? acc.identities[0];
      if (!identity) return; // unreachable: withIdentities filtert identities.length > 0.
      accountId = acc.id;
      identityId = identity.id;
    } else {
      const rows = transportAccounts(withIdentities);
      const picked = await new TransportPickerModal(this.app, rows).pick();
      if (!picked) return;
      const split = splitTransportId(picked.id);
      if (!split) return;
      accountId = split.accountId;
      identityId = split.identityId;
    }

    const resolved = resolveSender(this.settings.accounts, accountId, identityId);
    if (!resolved.ok) {
      notify.error(`error.send.${resolved.code}`);
      return;
    }

    const result = await this.sendService.send(accountId, {
      from: identityId,
      to: [resolved.identity.address],
      subject: "Mailstone test",
      text: `Mailstone test ${new Date().toISOString()}`,
    });
    if (result.ok) notify.info("notice.sendTest.ok", result.messageId);
    else notify.error(`error.send.${result.code}`);
  }
}
