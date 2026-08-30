import { Notice, Plugin, SuggestModal, getLanguage, type App } from "obsidian";
import { loadSettings, type MailstoneSettings } from "./core/settings";
import { initI18n } from "./i18n/strings";
import { t } from "./vendor/code-kit/i18n";
import { MailstoneSettingTab } from "./obsidian/settings-tab";
import { importEmlFolder } from "./obsidian/import-eml";
import { noticeNotifier, type Notifier } from "./obsidian/notifier";
import { FolderPromptModal } from "./obsidian/modals/folder-prompt";
import { obsidianSecretStore } from "./obsidian/secrets";
import { nodeSocketTransport } from "./obsidian/tls-transport";
import { createSendService, resolveSender, type SendService } from "./core/send/service";
import { transportAccounts, splitTransportId } from "./core/send/imip";
import { buildMailTransport, createCalendarNotesBridge, type CalendarNotesBridge } from "./obsidian/calendar-notes-bridge";
import { createSyncService, type SyncService, type SyncRunResult } from "./core/sync/service";
import { createBusyGuard } from "./core/sync/busy";
import { createEmitter, type SyncEmitter } from "./core/sync/events";
import { createUidCache, type UidCacheStore, type UidCacheData } from "./core/sync/uid-cache";
import { mailIndex, vaultPlanExecutor } from "./obsidian/vault-notes";

interface PersistedState { settings: MailstoneSettings; zoneHashes: Record<string, string>; uidCache: UidCacheData }

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

/** Text fuer die Statusleiste, wenn ein Sync-Lauf zuende ist, aber KEIN Konto erfolgreich war.
 *  Das `"synced"`-Event (das den Status im Normalfall auf `status.sync.idle` zurueckstellt)
 *  feuert nur auf dem Erfolgspfad eines Kontos (s. core/sync/service.ts) — ohne diesen Zweig
 *  bliebe die Anzeige bei "synchronisiert…" haengen, obwohl der Lauf laengst vorbei ist (Fund
 *  Fix-Runde 1: besonders sichtbar bei "no-secret", das der Passwort-Hinweis in der Kontenzeile
 *  jetzt haeufiger provoziert). `null`, wenn mindestens ein Konto erfolgreich war (das Event hat
 *  den Status dann schon aktuell gesetzt) oder `results` leer ist (keine aktivierten Konten).
 *  Reine Funktion (kein Obsidian-Zugriff) — direkt ohne Mock testbar. */
export function syncFailureStatus(results: readonly SyncRunResult[]): string | null {
  if (results.length === 0 || results.some((r) => r.ok)) return null;
  const failed = results.find((r): r is Extract<SyncRunResult, { ok: false }> => !r.ok);
  return failed ? `Mailstone: ${t(`error.sync.${failed.code}`)}` : null;
}

export default class MailstonePlugin extends Plugin {
  settings: MailstoneSettings = loadSettings(undefined);
  zoneHashes: Record<string, string> = {};
  sendService!: SendService;
  bridge!: CalendarNotesBridge;
  syncService!: SyncService;
  uidCache!: UidCacheStore;
  status!: HTMLElement;
  readonly busy = createBusyGuard();
  readonly syncEvents: SyncEmitter = createEmitter();

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
      // Zweite Fabrik fuer die Ablage im Sent-Ordner: der SMTP-Transport ist nach dem Versand
      // verbraucht, die Kopie braucht eine eigene Verbindung.
      imapTransport: () => nodeSocketTransport(),
      timers: window,
      now: () => new Date(),
      randomId: () => crypto.randomUUID(),
      ...(this.settings.debugLog ? { log: (l: string) => console.debug("[mailstone smtp]", l) } : {}),
    });

    this.uidCache = createUidCache(raw?.uidCache);
    const hashes = { get: (k: string) => this.zoneHashes[k] ?? null, set: (k: string, v: string) => { this.zoneHashes[k] = v; } };
    this.syncService = createSyncService({
      accounts: () => this.settings.accounts,
      profile: () => this.settings.profile,
      secret: (id) => secrets.get(id),
      transport: () => nodeSocketTransport(),
      index: () => mailIndex(this.app, this.settings.profile),
      takenPaths: () => new Set(this.app.vault.getFiles().map((f) => f.path)),
      executor: () => vaultPlanExecutor(this.app, hashes),
      uidCache: this.uidCache,
      busy: this.busy,
      events: this.syncEvents,
      // window statt nacktem setTimeout: `obsidianmd/prefer-window-timers` verlangt es, und
      // core/ darf `window` nicht selbst kennen (check:pure) — deshalb hier injiziert.
      timers: window,
      now: () => new Date(),
      ...(this.settings.debugLog ? { log: (l: string) => { console.debug("[mailstone imap]", l); } } : {}),
    });

    this.status = this.addStatusBarItem();
    this.syncEvents.on("synced", ({ counts }) => {
      this.status.setText(t("status.sync.idle", String(counts.created + counts.reattached), new Date().toLocaleTimeString()));
    });

    this.addCommand({ id: "sync-mailbox", name: t("cmd.sync.name"), callback: () => void this.runSync(notify) });
    this.addRibbonIcon("mail", t("ribbon.sync"), () => void this.runSync(notify));

    // registerInterval statt setInterval: Obsidian raeumt den Timer beim Entladen selbst ab.
    const everyMs = Math.max(1, Math.min(...this.settings.accounts.map((a) => a.sync.intervalMin), 60)) * 60_000;
    this.registerInterval(window.setInterval(() => { void this.runSync(notify, true); }, everyMs));

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
    // uidCache.data() liefert die interne Referenz, keine Kopie — hier nur lesen, nie
    // hineinschreiben, sonst umgeht man die Verwerfungslogik des Caches bei UIDVALIDITY-Wechsel.
    await this.saveData({ settings: this.settings, zoneHashes: this.zoneHashes, uidCache: this.uidCache.data() } satisfies PersistedState);
  }

  /** `silent` = Intervall-Lauf: kein Notice bei Erfolg, nur bei Fehlern — sonst poppt alle
   *  fuenf Minuten eine Meldung auf. Der Nutzer sieht das Ergebnis in der Statusleiste. */
  private async runSync(notify: Notifier, silent = false): Promise<void> {
    const enabled = this.settings.accounts.filter((a) => a.sync.enabled);
    if (enabled.length === 0) { if (!silent) notify.info("notice.sync.noAccounts"); return; }
    this.status.setText(t("status.sync.running"));
    try {
      const results = await this.syncService.syncAll();
      for (const r of results) if (!r.ok && !(silent && r.code === "busy")) notify.error(`error.sync.${r.code}`);
      const ok = results.filter((r): r is Extract<SyncRunResult, { ok: true }> => r.ok);
      // Scheitern ALLE aktivierten Konten, feuert kein "synced"-Event — die Statusleiste
      // bliebe sonst dauerhaft bei "synchronisiert…" stehen (Fund Fix-Runde 1).
      const failureStatus = syncFailureStatus(results);
      if (failureStatus) this.status.setText(failureStatus);
      if (!silent && ok.length > 0) {
        const sum = ok.reduce((acc, r) => ({
          created: acc.created + r.counts.created,
          reattached: acc.reattached + r.counts.reattached,
          detached: acc.detached + r.counts.detached,
          detachSkipped: acc.detachSkipped + r.counts.detachSkipped,
          errors: acc.errors + r.counts.errors,
        }), { created: 0, reattached: 0, detached: 0, detachSkipped: 0, errors: 0 });
        notify.info("notice.sync.done", sum.created, sum.reattached, sum.detached, sum.errors);
        // Ausgelassene Ablösungen bekommen eine eigene Meldung statt einer weiteren Zahl in der
        // Zeile oben: sie sind kein Zaehler des Normalfalls, sondern der Hinweis, dass der
        // Detach-Zweig dieses Laufs stillgelegt war (sonst ununterscheidbar von "nichts zu tun").
        if (sum.detachSkipped > 0) notify.info("notice.sync.detachSkipped", sum.detachSkipped);
      }
    } finally {
      // Zone-Hashes und UID-Cache muessen auch nach einem Abbruch persistiert sein — sonst
      // gilt jede geschriebene Notiz beim naechsten Lauf als fremd editiert (dieselbe
      // Begruendung wie beim Import-Kommando aus M1).
      await this.saveSettings();
    }
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
