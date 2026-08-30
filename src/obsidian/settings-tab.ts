import {
  PluginSettingTab,
  getLanguage,
  type App,
  type Plugin,
  type Setting,
  type SettingDefinitionItem,
  type SettingDefinitionList,
  type SettingGroupItem,
} from "obsidian";
import { t } from "../vendor/code-kit/i18n";
import { confirmAction } from "../vendor/kit-obsidian/confirm";
import { initI18n } from "../i18n/strings";
import { newAccount, uniqueAccountId, type Account, type MailstoneSettings } from "../core/settings";
import type { SecretStore } from "../core/send/secrets";
import type { SocketTransport } from "../core/net/types";
import { AccountModal } from "./modals/account-modal";

/** Was der Tab vom Plugin braucht — als Interface, damit Tests eine Attrappe geben können
 *  (Muster aus calendar-notes/src/obsidian/settings-tab.ts, dortiges `SettingsHost`). */
export interface SettingsHost {
  settings: MailstoneSettings;
  saveSettings(): Promise<void>;
  secrets: SecretStore;
  /** Fabrik statt Instanz: der Verbindungstest im Konto-Editor bekommt einen frischen Transport. */
  transport(): SocketTransport;
}

/** M1: Ordner, Jahr-Unterordner, Dateiname-Template, Sprache. M2: Konten (Accounts-Liste +
 *  `AccountModal`). Deklarativ (`getSettingDefinitions()`, `minAppVersion` 1.13.0) — kein
 *  `display()`-Fallback, s. calendar-notes/src/obsidian/settings-tab.ts (Kopfkommentar dort): ein
 *  zusaetzliches `display()` neben `getSettingDefinitions()` waere selbst eine Scanner-Warnung
 *  (`obsidianmd/settings-tab/no-deprecated-display`). Der Ordner-Wert nutzt den nativen
 *  `folder`-Control-Typ (eigener Vault-Ordner-Suggester, seit 1.13.0) statt der vendorten
 *  `FolderSuggest` — die deklarative API bringt die Autocomplete-Fähigkeit bereits mit.
 *
 *  Die Konten-Liste selbst bleibt bewusst schlank (Label/Host/Identitaeten-Zahl + Bearbeiten/
 *  Entfernen) — alle Detailfelder (IMAP/SMTP, Identitaeten, Ordner, Sync, Passwort, SMTP-Test)
 *  leben im `AccountModal` (imperativ; die `settings-tab/prefer-setting-definitions`-Regel des
 *  Store-Scanners betrifft nur diesen Tab, nicht Modals). */
export class MailstoneSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly host: SettingsHost,
  ) {
    super(app, plugin);
  }

  // ── Die eine Wahrheit ────────────────────────────────────────────────────
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: t("settings.language"),
        control: {
          type: "dropdown",
          key: "language",
          options: { auto: t("settings.language.auto"), en: "English", de: "Deutsch" },
        },
      },
      {
        name: t("settings.folder"),
        desc: t("settings.folder.desc"),
        control: { type: "folder", key: "profile.folder", includeRoot: true },
      },
      {
        name: t("settings.yearSubfolder"),
        control: { type: "toggle", key: "profile.yearSubfolder" },
      },
      {
        name: t("settings.filename"),
        desc: t("settings.filename.desc"),
        control: { type: "text", key: "profile.filename" },
      },
      this.accountsGroup(),
      {
        name: t("settings.debugLog"),
        desc: t("settings.debugLog.desc"),
        control: { type: "toggle", key: "debugLog" },
      },
    ];
  }

  // ── Konten ───────────────────────────────────────────────────────────────
  private accountsGroup(): SettingDefinitionList {
    const accounts = this.host.settings.accounts;
    const items: SettingGroupItem[] = accounts.map((acc) => {
      const base = t("settings.accounts.desc", acc.imap.host || acc.smtp.host || "–", acc.identities.length);
      // SecretStore.has() lag seit M2 ungenutzt herum — die Kontenzeile ist die einzige Stelle,
      // an der ein fehlendes Passwort sichtbar wird, bevor ein Sync-Lauf mit "no-secret" scheitert.
      const missing = !this.host.secrets.has(acc.secretId);
      return {
        name: acc.label || acc.id,
        desc: missing ? `${base} · ${t("settings.account.noSecret")}` : base,
        render: (setting: Setting) => this.renderAccountRow(setting, acc),
      };
    });
    return {
      type: "list",
      heading: t("settings.accounts"),
      items,
      emptyState: t("settings.accounts.empty"),
      onDelete: (index) => { const acc = accounts[index]; if (acc) this.confirmRemoveAccount(acc); },
      addItem: { name: t("settings.accounts.add"), action: () => this.addAccount() },
    };
  }

  private renderAccountRow(setting: Setting, account: Account): void {
    setting.addButton((b) => b.setButtonText(t("settings.account.edit")).onClick(() => this.openEditModal(account)));
  }

  private openEditModal(account: Account): void {
    new AccountModal(this.app, account, { secrets: this.host.secrets, transport: () => this.host.transport() }, (updated) => {
      this.host.settings.accounts = this.host.settings.accounts.map((a) => (a.id === updated.id ? updated : a));
      void this.host.saveSettings();
      this.update();
    }).open();
  }

  // Der Entwurf steckt bewusst noch NICHT in this.host.settings.accounts — ein abgebrochenes
  // Modal (Cancel/Escape) darf keine leere Konto-Zeile hinterlassen (Review-Fund). Die id
  // (kollisionssicher, "-2" bei Kollision) wird schon hier vergeben, DAMIT das im Modal via
  // SecretComponent gesetzte Passwort (secretId = secretIdFor(id)) beim Save nicht verwaist —
  // erst der Array-Push selbst (und damit das Sichtbarwerden des Kontos) wartet auf Save.
  //
  // Die id wird bewusst NICHT aus dem lokalisierten Button-Text ("Add account"/"Konto
  // hinzufuegen") geslugt (Review-Fund) — zwei neu angelegte Konten haetten sonst denselben
  // Slug-Stamm und kollidierten deterministisch ueber "-2", "-3", … statt sich am tatsaechlichen
  // Label zu orientieren. "account" ist der Fallback-Slug fuer ein leeres Label (s.
  // slugifyAccountId) — das Label selbst bleibt leer, das Modal zeigt nur den Platzhalter; Zeilen
  // in der Liste fallen bei leerem Label auf die id zurueck (s. accountsGroup()).
  private addAccount(): void {
    const id = uniqueAccountId("", this.host.settings.accounts.map((a) => a.id));
    const draft = newAccount(id);
    draft.label = "";
    new AccountModal(this.app, draft, { secrets: this.host.secrets, transport: () => this.host.transport() }, (saved) => {
      this.host.settings.accounts = [...this.host.settings.accounts, saved];
      void this.host.saveSettings();
      this.update();
    }).open();
  }

  private confirmRemoveAccount(account: Account): void {
    void (async () => {
      const ok = await confirmAction(this.app, {
        message: t("settings.account.remove.confirm"),
        confirmLabel: t("settings.account.remove"),
        cancelLabel: t("form.cancel"),
      });
      if (!ok) {
        // Der Renderer entfernt die Zeile optimistisch beim Klick auf den Papierkorb — solange
        // die Einstellungen unveraendert bleiben, stellt der naechste update() sie wieder her.
        this.update();
        return;
      }
      this.host.settings.accounts = this.host.settings.accounts.filter((a) => a.id !== account.id);
      // SecretStore kennt keine echte "delete"-Operation (nur get/set/has) — best-effort mit
      // leerem Wert ueberschreiben, statt so zu tun, als waere das Secret entfernt worden.
      try {
        this.host.secrets.set(account.secretId, "");
      } catch {
        /* best effort */
      }
      await this.host.saveSettings();
      this.update();
    })();
  }

  // ── Kontroll-Werte für den nativen 1.13-Renderer ────────────────────────
  // Lookup-Tabelle statt if/else-Kette (Nachlese-Punkt aus der Task-Review): jeder Key traegt
  // seinen eigenen get/set, neu aufgebaut je Aufruf (billig, `s` bleibt dieselbe Objektreferenz
  // ueber die Plugin-Laufzeit — s. Kommentar am Konstruktor-Aufrufer in main.ts).
  private controls(): Record<string, { get: () => unknown; set: (value: unknown) => void }> {
    const s = this.host.settings;
    return {
      language: {
        get: () => s.language,
        set: (value) => {
          s.language = value as MailstoneSettings["language"];
          // Sofort umschalten statt erst beim naechsten Start: Notices und UI-Texte greifen ab
          // jetzt die neue Sprache. Ausgenommen sind Kommando-Namen (`this.addCommand({name})`) —
          // Obsidian liest die nur einmal beim Registrieren im onload(); die bleiben bis zum
          // naechsten Neustart/Reload auf der alten Sprache stehen, egal was hier passiert.
          initI18n(s.language === "auto" ? getLanguage() : s.language);
        },
      },
      "profile.folder": {
        get: () => s.profile.folder,
        set: (value) => { s.profile.folder = typeof value === "string" ? value.trim() || "Mail" : "Mail"; },
      },
      "profile.yearSubfolder": {
        get: () => s.profile.yearSubfolder,
        set: (value) => { s.profile.yearSubfolder = Boolean(value); },
      },
      "profile.filename": {
        get: () => s.profile.filename,
        set: (value) => {
          s.profile.filename = typeof value === "string" ? value.trim() || "{date}-{time}-{slug}" : "{date}-{time}-{slug}";
        },
      },
      debugLog: {
        get: () => s.debugLog,
        set: (value) => { s.debugLog = Boolean(value); },
      },
    };
  }

  getControlValue(key: string): unknown {
    return this.controls()[key]?.get();
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const entry = this.controls()[key];
    if (!entry) return;
    entry.set(value);
    await this.host.saveSettings();
  }
}
