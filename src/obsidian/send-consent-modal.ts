import { App, ButtonComponent, DropdownComponent, Modal } from "obsidian";
import { applyDestructive } from "../vendor/kit-obsidian/confirm";
import type { ApiSendRequest } from "../core/api/types";
import { t } from "../vendor/code-kit/i18n";

export type ConsentOutcome =
  | { kind: "send"; transportId: string; remember: boolean }
  | { kind: "declined" }
  | { kind: "timeout" };

export interface SendConsentOptions {
  /** Anzeigename des Aufrufers, aufgeloest ueber app.plugins.manifests — faellt auf die
   *  rohe callerId zurueck, wenn kein Plugin dieses Namens installiert ist. */
  callerLabel: string;
  identities: { id: string; label: string }[];
  preselectId: string;
  req: ApiSendRequest;
  timeoutMs?: number;
}

interface Timers { setTimeout: (fn: () => void, ms: number) => number; clearTimeout: (id: number) => void }

/** Eigenes Promise mit `cancel`, damit der Timer nicht weiterlaeuft, wenn der Nutzer
 *  vorher klickt. Ein nie geloeschter Timer haelt den Prozess und feuert spaeter ins Leere —
 *  derselbe Defekt, der in `Cdp.send` als Dach-Task liegt. */
export function consentTimeout(ms: number, timers: Timers): Promise<ConsentOutcome> & { cancel: () => void } {
  let id = 0;
  const p = new Promise<ConsentOutcome>((resolve) => {
    id = timers.setTimeout(() => resolve({ kind: "timeout" }), ms);
  }) as Promise<ConsentOutcome> & { cancel: () => void };
  p.cancel = () => timers.clearTimeout(id);
  return p;
}

class SendConsentModal extends Modal {
  private entschieden: ((o: ConsentOutcome) => void) | null = null;
  private gewaehlt: string;

  constructor(app: App, private opts: SendConsentOptions) {
    super(app);
    this.gewaehlt = opts.preselectId;
  }

  warten(): Promise<ConsentOutcome> {
    return new Promise((resolve) => { this.entschieden = resolve; this.open(); });
  }

  private schliessenMit(o: ConsentOutcome): void {
    const r = this.entschieden;
    this.entschieden = null;
    this.close();
    r?.(o);
  }

  onOpen(): void {
    const { contentEl, opts } = this;
    contentEl.createEl("h3", { text: t("api.consent.title") });
    contentEl.createEl("p", { text: t("api.consent.caller", opts.callerLabel), cls: "mailstone-consent-caller" });
    contentEl.createEl("p", { text: t("api.consent.to", opts.req.to.join(", ")) });
    contentEl.createEl("p", { text: t("api.consent.subject", opts.req.subject) });

    const auswahl = contentEl.createDiv({ cls: "mailstone-consent-from" });
    auswahl.createSpan({ text: t("api.consent.from") });
    const dd = new DropdownComponent(auswahl);
    for (const i of opts.identities) dd.addOption(i.id, i.label);
    dd.setValue(this.gewaehlt);
    dd.onChange((v) => { this.gewaehlt = v; });

    // Der vollstaendige Klartext — nur weil v1 auf Klartext beschraenkt ist, kann das Modal
    // wirklich zeigen, was rausgeht.
    contentEl.createEl("pre", { text: opts.req.body, cls: "mailstone-consent-body" });

    const knoepfe = contentEl.createDiv({ cls: "modal-button-container" });
    applyDestructive(new ButtonComponent(knoepfe).setButtonText(t("api.consent.cancel"))
      .onClick(() => this.schliessenMit({ kind: "declined" })));
    new ButtonComponent(knoepfe).setButtonText(t("api.consent.send"))
      .onClick(() => this.schliessenMit({ kind: "send", transportId: this.gewaehlt, remember: false }));
    new ButtonComponent(knoepfe).setButtonText(t("api.consent.remember")).setCta()
      .onClick(() => this.schliessenMit({ kind: "send", transportId: this.gewaehlt, remember: true }));
  }

  onClose(): void {
    this.contentEl.empty();
    // Schliessen ueber Escape oder den Hintergrund ist eine Ablehnung, kein Haenger.
    this.schliessenMit({ kind: "declined" });
  }
}

export async function askSendConsent(app: App, opts: SendConsentOptions, timers: Timers): Promise<ConsentOutcome> {
  const modal = new SendConsentModal(app, opts);
  const frist = consentTimeout(opts.timeoutMs ?? 60_000, timers);
  const ergebnis = await Promise.race([modal.warten(), frist]);
  frist.cancel();
  if (ergebnis.kind === "timeout") modal.close();
  return ergebnis;
}
