import { App, ButtonComponent, DropdownComponent, Modal } from "obsidian";
import { applyDestructive } from "../vendor/kit-obsidian/confirm";
import type { ApiSendRequest } from "../core/api/types";
import { t } from "../vendor/code-kit/i18n";
import { withTimeout } from "../vendor/code-kit/timeout";

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
  /** Frist in Millisekunden — PFLICHTFELD, absichtlich ohne Default. Der Wert gehoert laut
   *  Spec § 7 zum Vertrag und steht deshalb genau einmal, als `CONSENT_TIMEOUT_MS` im
   *  Adapter. Ein Default hier waere eine zweite Stelle, an der die 60 s gepflegt werden
   *  muessten — und die stille Zweitfassung faellt erst auf, wenn beide auseinanderlaufen. */
  timeoutMs: number;
  /** Anzahl vergessener Platzhalter in Betreff und Text, die so hinausgehen (A5, Spec 8.7: „nach einem Hinweis im Dialog“). Fehlt es oder ist es 0, steht kein Hinweis da. */
  forgotten?: number;
}

interface Timers { setTimeout: (fn: () => void, ms: number) => number; clearTimeout: (id: number) => void }

/** Offene Zustimmungs-Modals. Ein Modal haengt an keinem Plugin-Lifecycle: wird mailstone
 *  waehrend der bis zu 60 s deaktiviert, stuende der Dialog weiter da und ein Klick auf
 *  „Senden und immer erlauben" liefe in die tote Instanz. `onunload` schliesst sie deshalb
 *  hierueber. Ein Set statt einer einzelnen Referenz, obwohl der Adapter nur eines zur Zeit
 *  zulaesst (`busy`): der Guard ist eine Zusage des Adapters, kein Zwang dieser Datei. */
const offeneModals = new Set<{ close: () => void }>();

/** Schliesst jedes offene Zustimmungs-Modal. Jedes davon loest sein wartendes Promise
 *  ueber `onClose` als `declined` auf — es haengt also keines zurueck. */
export function closeOpenSendConsent(): void {
  // Ueber eine Kopie iterieren: `close()` nimmt den Eintrag im `finally` von
  // `askSendConsent` wieder aus dem Set.
  for (const m of [...offeneModals]) m.close();
}

class SendConsentModal extends Modal {
  private entschieden: ((o: ConsentOutcome) => void) | null = null;
  private geschlossen = false;
  private gewaehlt: string;

  constructor(app: App, private opts: SendConsentOptions) {
    super(app);
    this.gewaehlt = opts.preselectId;
  }

  warten(): Promise<ConsentOutcome> {
    return new Promise((resolve) => { this.entschieden = resolve; this.open(); });
  }

  /** Der `geschlossen`-Riegel ist load-bearing: `close()` loest `onClose()` aus, das wieder
   *  hier landet — ohne ihn ruft sich die Methode endlos selbst auf. (Im echten Obsidian
   *  federt `close()` einen zweiten Aufruf ab, im Mock nicht; verlassen sollte man sich auf
   *  keines von beiden.) */
  private schliessenMit(o: ConsentOutcome): void {
    if (this.geschlossen) return;
    this.geschlossen = true;
    const r = this.entschieden;
    this.entschieden = null;
    this.close();
    r?.(o);
  }

  onOpen(): void {
    const { contentEl, opts } = this;
    // titleEl statt eines eigenen <h3> im contentEl: das ist die native Titelzeile, die
    // Obsidian selbst typografiert — genau die Form des Kit-Bausteins
    // (`src/vendor/kit-obsidian/confirm.ts`). Ein eigenes <h3> braeuchte eine
    // Groessenregel in styles.css, die es nie hatte.
    this.titleEl.setText(t("api.consent.title"));
    contentEl.createEl("p", { text: t("api.consent.caller", opts.callerLabel), cls: "mailstone-consent-caller" });
    contentEl.createEl("p", { text: t("api.consent.to", opts.req.to.join(", ")) });
    contentEl.createEl("p", { text: t("api.consent.subject", opts.req.subject) });
    if (opts.forgotten) contentEl.createEl("p", { text: t("api.consent.forgotten", String(opts.forgotten)), cls: "mod-warning" });

    const auswahl = contentEl.createDiv({ cls: "mailstone-consent-from" });
    auswahl.createSpan({ text: t("api.consent.from") });
    const dd = new DropdownComponent(auswahl);
    for (const i of opts.identities) dd.addOption(i.id, i.label);
    dd.setValue(this.gewaehlt);
    dd.onChange((v) => { this.gewaehlt = v; });

    // Der vollstaendige Klartext — nur weil v1 auf Klartext beschraenkt ist, kann das Modal
    // wirklich zeigen, was rausgeht.
    contentEl.createEl("pre", { text: opts.req.body, cls: "mailstone-consent-body" });

    // Die Farben folgen der TRAGWEITE, nicht der Position: `applyDestructive` sitzt auf
    // „Senden und immer erlauben" — der einzige Knopf, der eine dauerhafte Freigabe in die
    // Settings schreibt. Abbrechen ist folgenlos und bleibt neutral; „Einmal senden" ist die
    // erwartete Antwort und traegt den CTA. Vorher stand das Rot auf Abbrechen und die
    // Farben sagten damit das Gegenteil der Tragweite.
    const knoepfe = contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(knoepfe).setButtonText(t("api.consent.cancel"))
      .onClick(() => this.schliessenMit({ kind: "declined" }));
    new ButtonComponent(knoepfe).setButtonText(t("api.consent.send")).setCta()
      .onClick(() => this.schliessenMit({ kind: "send", transportId: this.gewaehlt, remember: false }));
    applyDestructive(new ButtonComponent(knoepfe).setButtonText(t("api.consent.remember"))
      .onClick(() => this.schliessenMit({ kind: "send", transportId: this.gewaehlt, remember: true })));
  }

  onClose(): void {
    this.contentEl.empty();
    // Schliessen ueber Escape oder den Hintergrund ist eine Ablehnung, kein Haenger.
    this.schliessenMit({ kind: "declined" });
  }
}

export async function askSendConsent(app: App, opts: SendConsentOptions, timers: Timers): Promise<ConsentOutcome> {
  const modal = new SendConsentModal(app, opts);
  offeneModals.add(modal);
  try {
    // `withTimeout` (code-kit) raeumt seinen Timer im `finally`, auch wenn der Nutzer vorher klickt: ein nie geloeschter Timer haelt den Prozess.
    const r = await withTimeout(modal.warten(), opts.timeoutMs, timers);
    if (!r.timedOut) return r.value;
    modal.close();
    return { kind: "timeout" };
  } finally {
    // Ein nie entfernter Eintrag liesse `closeOpenSendConsent` auf einer Leiche arbeiten.
    offeneModals.delete(modal);
  }
}
