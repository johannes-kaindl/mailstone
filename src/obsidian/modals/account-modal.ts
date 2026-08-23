// Konto-Editor: feste Felder statt Schema-Formular (Muster fuer das Layout, nicht fuer die
// Deklarativitaet: `SchemaFormModal` aus calendar-notes) — ein imperatives Modal ist hier zulaessig,
// die `settings-tab/prefer-setting-definitions`-Regel des Store-Scanners betrifft nur den Settings-
// TAB (getSettingDefinitions), nicht Modals.
import { ButtonComponent, Modal, Notice, SecretComponent, Setting, type App } from "obsidian";
import type { Account, Identity } from "../../core/settings";
import type { SecretStore } from "../../core/send/secrets";
import { isAddress } from "../../core/send/outgoing";
import { smtpProbe, type SmtpProbeOptions } from "../../core/smtp/client";
import { isLoopback } from "../../core/send/service";
import type { SocketTransport, TlsMode } from "../../core/net/types";
import { t } from "../../vendor/code-kit/i18n";

// Als Funktion statt Modul-Konstante: `t()` liest das aktuell geladene Sprachwoerterbuch, das
// erst beim Plugin-`onload()` (initI18n) gesetzt wird — zum Zeitpunkt des Modul-Imports waere
// das Dict noch leer und der Wert wuerde beim Sprachwechsel nicht mehr nachziehen.
function tlsOptions(): Record<"implicit" | "starttls", string> {
  return { implicit: t("settings.account.tls.implicit"), starttls: t("settings.account.tls.starttls") };
}

export interface AccountModalDeps {
  secrets: SecretStore;
  /** Fabrik statt Instanz: der Verbindungstest bekommt einen frischen Transport. */
  transport: () => SocketTransport;
  /** uuid-artig — Eindeutigkeit reicht, kein bestimmtes Format vorausgesetzt. Default: crypto.randomUUID. */
  randomId?: () => string;
}

/** Bearbeitet eine LOKALE Kopie des Kontos; committet erst bei "Save" ueber `onSave`. Das
 *  Passwort landet nie in dieser Kopie (und damit nie in `data.json`) — `SecretComponent`
 *  schreibt direkt in den SecretStore, unabhaengig vom Save/Cancel-Ausgang der uebrigen Felder
 *  (dasselbe Verhalten wie beim Konto-Passwortfeld in calendar-notes). */
export class AccountModal extends Modal {
  private readonly draft: Account;
  private readonly randomId: () => string;

  constructor(
    app: App,
    account: Account,
    private readonly deps: AccountModalDeps,
    private readonly onSave: (account: Account) => void,
  ) {
    super(app);
    this.draft = structuredClone(account);
    this.randomId = deps.randomId ?? (() => crypto.randomUUID());
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    this.titleEl.setText(this.draft.label || t("settings.accounts.add"));

    new Setting(this.contentEl).setName(t("settings.account.label")).addText((c) =>
      c.setValue(this.draft.label).onChange((v) => { this.draft.label = v; }),
    );

    this.renderHeading(t("settings.account.imap"));
    this.renderHostPortTls(this.draft.imap);
    this.renderHeading(t("settings.account.smtp"));
    this.renderHostPortTls(this.draft.smtp);

    new Setting(this.contentEl).setName(t("settings.account.username")).addText((c) =>
      c.setValue(this.draft.username).onChange((v) => { this.draft.username = v; }),
    );

    const secretSetting = new Setting(this.contentEl).setName(t("settings.account.secret")).setDesc(t("settings.account.secret.desc"));
    new SecretComponent(this.app, secretSetting.controlEl).setValue(this.draft.secretId).onChange((v) => {
      try {
        this.deps.secrets.set(this.draft.secretId, v);
      } catch {
        new Notice(t("settings.account.secret.failed"));
      }
    });

    this.renderIdentities();
    this.renderFolders();

    new Setting(this.contentEl).setName(t("settings.account.sync")).addToggle((c) =>
      c.setValue(this.draft.sync.enabled).onChange((v) => { this.draft.sync.enabled = v; }),
    );
    new Setting(this.contentEl).setName(t("settings.account.sync.interval")).addText((c) =>
      c.setValue(String(this.draft.sync.intervalMin)).onChange((v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) this.draft.sync.intervalMin = n;
      }),
    );

    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("form.cancel")).onClick(() => this.close());
    new ButtonComponent(btns).setButtonText(t("settings.account.test")).onClick(() => void this.testConnection());
    new ButtonComponent(btns)
      .setButtonText(t("form.submit"))
      .setCta()
      .onClick(() => { this.onSave(this.draft); this.close(); });
  }

  private renderHeading(name: string): void {
    new Setting(this.contentEl).setName(name).setHeading();
  }

  private renderHostPortTls(target: { host: string; port: number; tls: TlsMode }): void {
    new Setting(this.contentEl).setName(t("settings.account.host")).addText((c) =>
      c.setValue(target.host).onChange((v) => { target.host = v; }),
    );
    new Setting(this.contentEl).setName(t("settings.account.port")).addText((c) =>
      c.setValue(String(target.port)).onChange((v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) target.port = n;
      }),
    );
    new Setting(this.contentEl).setName(t("settings.account.tls")).addDropdown((c) => {
      c.addOptions(tlsOptions());
      // "none" (nur data.json, lokaler Fake-Server — s. core/send/service.ts isLoopback) bietet
      // die UI bewusst nie an; ein bestehendes "none" bleibt beim Speichern unberuehrt, solange
      // dieses Dropdown nicht angefasst wird (kein Re-Render der Optionsliste noetig).
      c.setValue(target.tls === "starttls" ? "starttls" : "implicit").onChange((v) => {
        target.tls = v === "starttls" ? "starttls" : "implicit";
      });
    });
  }

  private renderIdentities(): void {
    this.renderHeading(t("settings.account.identities"));
    new Setting(this.contentEl).setDesc(t("settings.account.identities.hint"));
    for (const identity of this.draft.identities) this.renderIdentityRow(identity);
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText(t("settings.account.identities.add")).onClick(() => {
        const identity: Identity = { id: this.randomId(), address: "", name: "" };
        this.draft.identities.push(identity);
        if (!this.draft.defaultIdentityId) this.draft.defaultIdentityId = identity.id;
        this.render();
      }),
    );
  }

  private renderIdentityRow(identity: Identity): void {
    const row = new Setting(this.contentEl);
    row.addText((c) =>
      c.setPlaceholder(t("settings.account.identity.name")).setValue(identity.name).onChange((v) => { identity.name = v; }),
    );
    row.addText((c) => {
      c.setPlaceholder(t("settings.account.identity.address")).setValue(identity.address).onChange((v) => {
        identity.address = v;
        if (v && !isAddress(v)) new Notice(t("settings.account.identity.address.invalid"));
      });
    });
    row.addToggle((c) =>
      c
        .setTooltip(t("settings.account.identity.default"))
        .setValue(this.draft.defaultIdentityId === identity.id)
        .onChange((v) => { if (v) this.draft.defaultIdentityId = identity.id; this.render(); }),
    );
    row.addExtraButton((b) =>
      b.setIcon("trash").setTooltip(t("settings.account.identity.remove")).onClick(() => {
        this.draft.identities = this.draft.identities.filter((i) => i.id !== identity.id);
        if (this.draft.defaultIdentityId === identity.id) this.draft.defaultIdentityId = this.draft.identities[0]?.id ?? "";
        this.render();
      }),
    );
  }

  private renderFolders(): void {
    this.renderHeading(t("settings.account.folders"));
    new Setting(this.contentEl).setDesc(t("settings.account.folders.desc"));
    new Setting(this.contentEl).setName(t("settings.account.folders.inbox")).addText((c) =>
      c.setValue(this.draft.folders.inbox).onChange((v) => { this.draft.folders.inbox = v; }),
    );
    new Setting(this.contentEl).setName(t("settings.account.folders.allowlist")).addText((c) =>
      c.setValue(this.draft.folders.allowlist).onChange((v) => { this.draft.folders.allowlist = v; }),
    );
    new Setting(this.contentEl).setName(t("settings.account.folders.archive")).addText((c) =>
      c.setValue(this.draft.folders.archive).onChange((v) => { this.draft.folders.archive = v; }),
    );
    new Setting(this.contentEl).setName(t("settings.account.folders.sent")).addText((c) =>
      c.setValue(this.draft.folders.sent ?? "").onChange((v) => { this.draft.folders.sent = v || undefined; }),
    );
  }

  private async testConnection(): Promise<void> {
    const password = this.deps.secrets.get(this.draft.secretId);
    if (!password) {
      new Notice(t("settings.account.test.noSecret"));
      return;
    }
    const opts: SmtpProbeOptions = {
      host: this.draft.smtp.host,
      port: this.draft.smtp.port,
      tls: this.draft.smtp.tls,
      username: this.draft.username,
      password,
      // Nur fuer den lokalen Fake-SMTP-Server erreichbar (settings.account.tls Dropdown bietet
      // "none" nie an) — s. Doc-Kommentar an SmtpSendOptions.allowInsecureAuth.
      ...(this.draft.smtp.tls === "none" && isLoopback(this.draft.smtp.host) ? { allowInsecureAuth: true } : {}),
    };
    const result = await smtpProbe(this.deps.transport(), opts);
    if (result.ok) new Notice(t("settings.account.test.ok", result.capabilities.length));
    else new Notice(t("settings.account.test.fail", t(`error.send.${result.code}`)));
  }
}
