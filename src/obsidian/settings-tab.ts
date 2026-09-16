import {
  Notice,
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
import { confirmAction, applyDestructive } from "../vendor/kit-obsidian/confirm";
import { initI18n } from "../i18n/strings";
import { newAccount, uniqueAccountId, type Account, type MailstoneSettings } from "../core/settings";
import type { SecretStore } from "../vendor/kit/secrets";
import type { SocketTransport } from "../core/net/types";
import { transportAccounts } from "../core/send/imip";
import type { TrustedSender } from "../core/api/types";
import { AccountModal } from "./modals/account-modal";
import { pluginName } from "./plugin-api";

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
      // SettingDefinitionList kennt keinen eigenen `desc` (nur `heading`) — die Erklaerung
      // steht deshalb als eigene Info-Zeile direkt davor, die Liste selbst bleibt ohne Heading.
      { name: t("settings.taskPreset"), desc: t("settings.taskPreset.desc") },
      this.taskPresetGroup(),
      { name: t("settings.onCreateAllowedValues"), desc: t("settings.onCreateAllowedValues.desc") },
      this.onCreateAllowedValuesGroup(),
      {
        name: t("settings.openViewOnStartup"),
        desc: t("settings.openViewOnStartup.desc"),
        control: { type: "toggle", key: "openViewOnStartup" },
      },
      {
        name: t("settings.debugLog"),
        desc: t("settings.debugLog.desc"),
        control: { type: "toggle", key: "debugLog" },
      },
      // SettingDefinitionList kennt keinen eigenen `desc` — dieselbe Loesung wie beim
      // taskPreset direkt darueber: die Erklaerung steht als eigene Info-Zeile davor.
      { name: t("settings.trusted"), desc: t("settings.trusted.desc") },
      this.trustedSendersGroup(),
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
      // best-effort: der Schluesselbund-Eintrag darf ein entferntes Konto nicht ueberdauern,
      // ein Fehlschlag beim Aufraeumen darf das Entfernen selbst aber nicht verhindern.
      try {
        this.host.secrets.delete(account.secretId);
      } catch {
        /* best effort */
      }
      await this.host.saveSettings();
      this.update();
    })();
  }

  // ── Vertrauensliste (Versand-API) ───────────────────────────────────────
  // Widerruf einzeln je Eintrag (kein Add-Knopf hier: neue Eintraege entstehen nur ueber das
  // Zustimmungs-Modal beim ersten Sendeversuch eines Fremdplugins, nie von Hand in den
  // Einstellungen).
  private trustedSendersGroup(): SettingDefinitionList {
    const liste = this.host.settings.trustedSenders;
    // Die rohe transportId ("privat/mail") sind zwei interne Ids und sagen dem Nutzer nicht,
    // WORUEBER das fremde Plugin senden darf. Aufgeloest wird die Absenderadresse gezeigt.
    // Faellt die Aufloesung ins Leere (verwaister Eintrag, weil die Identitaet geloescht
    // wurde), bleibt die rohe Id stehen: eine Zeile, die man widerrufen koennen muss, darf
    // nicht verschwinden, nur weil ihr Ziel nicht mehr existiert.
    const moeglich = transportAccounts(this.host.settings.accounts);
    const items: SettingGroupItem[] = liste.map((eintrag) => ({
      name: pluginName(this.app, eintrag.pluginId),
      desc: moeglich.find((i) => i.id === eintrag.transportId)?.address ?? eintrag.transportId,
      render: (setting: Setting) => this.renderTrustedSenderRow(setting, eintrag),
    }));
    return {
      type: "list",
      items,
      emptyState: t("settings.trusted.empty"),
    };
  }

  private renderTrustedSenderRow(setting: Setting, eintrag: TrustedSender): void {
    setting.addButton((b) =>
      applyDestructive(
        b.setButtonText(t("settings.trusted.revoke")).onClick(async () => {
          this.host.settings.trustedSenders = this.host.settings.trustedSenders.filter(
            (e) => e.pluginId !== eintrag.pluginId,
          );
          await this.host.saveSettings();
          this.update();
        }),
      ),
    );
  }

  // ── taskPreset (M5 § 5, "der Weg ohne TaskNotes") ───────────────────────
  // Schlichter Schluessel/Wert-Editor statt eines Kit-Bausteins: der einzige verbindliche
  // Katalog-Eintrag dafuer (`buildEndpointList`, UI-STANDARD § 8) ist auf Provider-Endpunkte
  // zugeschnitten (URL + Schluessel + Modell-Dropdown + Probe + Presets) und in mailstone nicht
  // einmal vendort — ihn fuer zwei Textfelder zu importieren waere semantisch falsch (kein
  // Endpunkt) und zoege unbenutzten Ballast (Modell-Cache, Erreichbarkeitsprobe) mit. Die
  // Konten-Liste (`accountsGroup`) daneben ist naeher an der Form, delegiert Detailfelder aber
  // an ein `Modal` — hier reicht die Zeile selbst, ein Modal waere fuer zwei Textfelder
  // Overhead. Struktur ist trotzdem dieselbe native `SettingDefinitionList` (Add/Delete,
  // `emptyState`) wie bei den Konten, nicht neu erfunden.
  //
  // taskPreset bleibt selbst ein `Record<string, string | number>` (core/settings.ts; kein
  // `boolean` — toFm() in merge.ts stringifiziert Booleans ohnehin, sie landen nie als YAML-Bool)
  // — die UI verwaltet nur Zeichenketten. Zahl-Werte sind weiterhin gueltig (z. B. per Hand in
  // data.json gesetzt) und werden beim Rendern als Text angezeigt/ueberschrieben; das deckt den
  // Anwendungsfall aus der Spec (`{status: "open"}`) vollstaendig ab, ohne einen Typ-Umschalter
  // pro Zeile zu brauchen.
  private taskPresetEntries(): [string, string][] {
    return Object.entries(this.host.settings.taskPreset).map(([k, v]) => [k, String(v)]);
  }

  private taskPresetGroup(): SettingDefinitionList {
    const items: SettingGroupItem[] = this.taskPresetEntries().map(([key], index) => ({
      name: key,
      render: (setting: Setting) => this.renderTaskPresetRow(setting, index),
    }));
    return {
      type: "list",
      items,
      emptyState: t("settings.taskPreset.empty"),
      onDelete: (index) => { void this.removeTaskPresetEntry(index); },
      addItem: { name: t("settings.taskPreset.add"), action: () => { void this.addTaskPresetEntry(); } },
    };
  }

  private renderTaskPresetRow(setting: Setting, index: number): void {
    const [key, value] = this.taskPresetEntries()[index] ?? ["", ""];
    setting.addText((tx) => {
      tx.setPlaceholder(t("settings.taskPreset.key.placeholder")).setValue(key);
      tx.inputEl.setAttribute("aria-label", t("settings.taskPreset.key.aria"));
      tx.inputEl.addEventListener("blur", () => { void this.renameTaskPresetKey(index, tx.getValue()); });
    });
    setting.addText((tx) => {
      tx.setPlaceholder(t("settings.taskPreset.value.placeholder")).setValue(value);
      tx.inputEl.setAttribute("aria-label", t("settings.taskPreset.value.aria"));
      tx.inputEl.addEventListener("blur", () => { void this.setTaskPresetValue(index, tx.getValue()); });
    });
  }

  /** Ersetzt den ganzen Record aus der Zeilen-Liste — leere Schluessel fallen dabei weg (eine
   *  Zeile mit leerem Namen darf kein Frontmatter-Feld "" erzeugen). Kollisionen zwischen zwei
   *  Zeilen sind an dieser Stelle NICHT mehr moeglich: `addTaskPresetEntry` vergibt einen
   *  kollisionsfreien Schluessel, `renameTaskPresetKey` lehnt eine Umbenennung auf einen
   *  bestehenden Schluessel explizit ab (Fix-Runde 1, Important 2 — vorher gewann hier still
   *  der letzte Eintrag per Object.fromEntries, ohne Notice, mit Datenverlust). */
  private applyTaskPreset(entries: readonly [string, string][]): void {
    this.host.settings.taskPreset = Object.fromEntries(entries.filter(([k]) => k.trim().length > 0));
  }

  private async renameTaskPresetKey(index: number, newKeyRaw: string): Promise<void> {
    const entries = this.taskPresetEntries();
    const current = entries[index];
    if (!current) return;
    const newKey = newKeyRaw.trim();
    if (newKey === current[0]) return;
    if (!newKey) { await this.removeTaskPresetEntry(index); return; }
    // Dieselbe Kollisionsvermeidung wie beim Hinzufuegen (addTaskPresetEntry): eine Umbenennung
    // auf einen bereits vorhandenen Schluessel wird abgelehnt, statt den Zielwert per
    // Object.fromEntries still zu ueberschreiben oder die Umbenennung spurlos verschwinden zu
    // lassen. this.update() rendert die Zeile mit dem alten Schluessel neu — sonst zeigte das
    // Eingabefeld weiter den abgelehnten (nicht uebernommenen) Wert.
    if (entries.some((e, i) => i !== index && e[0] === newKey)) {
      new Notice(t("settings.taskPreset.key.duplicate", newKey));
      this.update();
      return;
    }
    this.applyTaskPreset(entries.map((e, i) => (i === index ? [newKey, e[1]] : e)));
    await this.host.saveSettings();
    this.update(); // Zeilen-Beschriftung (name = key) muss den neuen Namen zeigen
  }

  private async setTaskPresetValue(index: number, value: string): Promise<void> {
    const entries = this.taskPresetEntries();
    const current = entries[index];
    if (!current || current[1] === value) return;
    this.applyTaskPreset(entries.map((e, i) => (i === index ? [e[0], value] : e)));
    await this.host.saveSettings();
    // Kein update() noetig: der Wert traegt keine Zeilen-Beschriftung.
  }

  private async removeTaskPresetEntry(index: number): Promise<void> {
    this.applyTaskPreset(this.taskPresetEntries().filter((_, i) => i !== index));
    await this.host.saveSettings();
    this.update();
  }

  private async addTaskPresetEntry(): Promise<void> {
    const existing = this.taskPresetEntries().map(([k]) => k);
    let key = "field";
    for (let n = 2; existing.includes(key); n += 1) key = `field-${n}`;
    this.applyTaskPreset([...this.taskPresetEntries(), [key, ""]]);
    await this.host.saveSettings();
    this.update();
  }

  // ── onCreateAllowedValues (Welle 2, Punkt 3: "der Weg ohne _types/mail.md") ─────────────
  // Eine Zeile je erlaubtem Wert (kein Schluessel/Wert-Paar wie bei taskPreset) — Struktur
  // ist trotzdem dieselbe native `SettingDefinitionList`. `loadSettings` (core/settings.ts)
  // prueft das geladene `profile.onCreate` gegen genau diese Liste und faellt bei einem
  // fremden Wert auf den Default zurueck; main.ts zeigt dafuer eine Notice (core bleibt frei
  // von Obsidian-Importen).
  private onCreateAllowedValuesGroup(): SettingDefinitionList {
    const werte = this.host.settings.onCreateAllowedValues;
    const items: SettingGroupItem[] = werte.map((wert, index) => ({
      name: wert,
      render: (setting: Setting) => this.renderOnCreateAllowedValueRow(setting, index),
    }));
    return {
      type: "list",
      items,
      emptyState: t("settings.onCreateAllowedValues.empty"),
      onDelete: (index) => { void this.removeOnCreateAllowedValue(index); },
      addItem: { name: t("settings.onCreateAllowedValues.add"), action: () => { void this.addOnCreateAllowedValue(); } },
    };
  }

  private renderOnCreateAllowedValueRow(setting: Setting, index: number): void {
    const wert = this.host.settings.onCreateAllowedValues[index] ?? "";
    setting.addText((tx) => {
      tx.setPlaceholder(t("settings.onCreateAllowedValues.placeholder")).setValue(wert);
      tx.inputEl.setAttribute("aria-label", t("settings.onCreateAllowedValues.aria"));
      tx.inputEl.addEventListener("blur", () => { void this.renameOnCreateAllowedValue(index, tx.getValue()); });
    });
  }

  /** Dieselbe Kollisionsvermeidung wie bei taskPreset (renameTaskPresetKey): eine Umbenennung
   *  auf einen bereits vorhandenen Wert wird abgelehnt statt ihn per Set stillschweigend zu
   *  deduplizieren — sonst verschwindet der Zielwert der Umbenennung spurlos. Ein leerer Wert
   *  entfernt die Zeile (wie ein leerer taskPreset-Schluessel). */
  private async renameOnCreateAllowedValue(index: number, neuRoh: string): Promise<void> {
    const werte = this.host.settings.onCreateAllowedValues;
    if (index < 0 || index >= werte.length) return;
    const neu = neuRoh.trim();
    if (neu === werte[index]) return;
    if (!neu) { await this.removeOnCreateAllowedValue(index); return; }
    if (werte.some((w, i) => i !== index && w === neu)) {
      new Notice(t("settings.onCreateAllowedValues.duplicate", neu));
      this.update();
      return;
    }
    this.host.settings.onCreateAllowedValues = werte.map((w, i) => (i === index ? neu : w));
    await this.host.saveSettings();
    this.update();
  }

  private async removeOnCreateAllowedValue(index: number): Promise<void> {
    this.host.settings.onCreateAllowedValues = this.host.settings.onCreateAllowedValues.filter((_, i) => i !== index);
    await this.host.saveSettings();
    this.update();
  }

  private async addOnCreateAllowedValue(): Promise<void> {
    this.host.settings.onCreateAllowedValues = [...this.host.settings.onCreateAllowedValues, ""];
    await this.host.saveSettings();
    this.update();
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
      openViewOnStartup: {
        get: () => s.openViewOnStartup,
        set: (value) => { s.openViewOnStartup = Boolean(value); },
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
