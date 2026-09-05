import { setIcon } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import type { Account } from "../../core/settings";
import type { Unsubscribe } from "../../core/sync/events";
import type { InboxAktionenGrund, InboxRow, InboxViewModel } from "../../core/view/inbox-vm";

/** Schmaler Vertrag zum Plugin (UI-STANDARD §4): lesend oder `void`, kein Rueckkanal —
 *  wie `CockpitHost`. Die Aktionen melden ihr Ergebnis ueber `onChange`, nicht als Rueckgabe. */
export interface InboxHost {
  accounts(): readonly Account[];
  selectedAccountId(): string;
  selectAccount(id: string): void;
  viewModel(): InboxViewModel;
  refresh(): void;
  /** Loest beim ERSTEN Sichtbarwerden des Tabs einen Ladevorgang aus, jeden weiteren Aufruf
   *  ignoriert der Host (I2) — `onShow()` feuert bei buildHubInto bei jeder Tab-Aktivierung,
   *  nicht nur beim ersten Mal. */
  ensureLoaded(): void;
  adopt(uid: number): void;
  archive(uid: number): void;
  /** Ob die dritte Aktion ("Aufgabe erstellen") angeboten wird — nur wenn TaskNotes erreichbar
   *  ist. Kein Ausgrauen: fehlt sie, fehlt der Knopf (Spec § 4, dieselbe Pruefstelle-1-Logik
   *  wie beim Kommando in main.ts). */
  canCreateTask(): boolean;
  createTask(uid: number): void;
  openSettings(): void;
  onChange(cb: () => void): Unsubscribe;
  /** Meldet den Host von seiner `synced`/`changed`-Registrierung ab (I2-Nachtrag): der Host
   *  haengt sich fuer seine gesamte Lebensdauer an einen plugin-lebenslangen Emitter — ohne
   *  diesen Aufruf beim Schliessen der Ansicht bleibt der Listener aktiv und kann nach dem
   *  Schliessen noch IMAP-Verbindungen ausloesen. Aufrufer: `MailstoneView.onClose()`. */
  destroy(): void;
}

/** Fehlercode -> i18n-Key, deckungsgleich mit `InboxActionCode` (13 Werte). Vollstaendig
 *  gehalten statt mit einem Fallback: ein Fallback auf einen plausiblen Text (z. B. "busy")
 *  waere eine STILLE FALSCHAUSSAGE — schlimmer als ein sichtbarer Rohschluessel, weil sie
 *  niemand meldet (Befund I3). Faellt ein Code hier durch, wirft `t()` bei fehlendem Schluessel
 *  keinen Fehler, sondern zeigt den rohen Schluessel — ein sichtbarer statt ein stiller Defekt. */
const FEHLER_KEYS: Record<string, string> = {
  unsupported: "inbox.error.unsupported",
  gone: "inbox.error.gone",
  busy: "inbox.error.busy",
  "no-target-folder": "inbox.error.no-target-folder",
  "no-secret": "inbox.error.no-secret",
  "folder-missing": "inbox.error.folder-missing",
  connect: "inbox.error.connect",
  tls: "inbox.error.tls",
  "tls-required": "inbox.error.tls-required",
  auth: "inbox.error.auth",
  protocol: "inbox.error.protocol",
  timeout: "inbox.error.timeout",
  closed: "inbox.error.closed",
};

function datum(iso: string): string {
  if (iso.length === 0) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

export class InboxPanel {
  readonly id = "inbox";
  readonly icon = "inbox";
  private root: HTMLElement | null = null;
  private unsub: Unsubscribe | null = null;

  constructor(private readonly host: InboxHost) {}

  get label(): string {
    return t("inbox.title");
  }

  mount(container: HTMLElement): void {
    this.root = container;
    this.unsub = this.host.onChange(() => this.render());
    this.render();
  }

  onShow(): void {
    // I2: der Tab soll sich beim Oeffnen von selbst fuellen (Spec § 8), statt "Keine
    // Nachrichten" ueber ein Postfach zu behaupten, das nie abgefragt wurde. `ensureLoaded()`
    // laedt nur beim ersten Aufruf; das Re-Render danach zeigt sofort den aktuellen Stand
    // (bei jedem weiteren Tab-Wechsel den unveraenderten).
    this.host.ensureLoaded();
    this.render();
  }

  destroy(): void {
    this.unsub?.();
    this.unsub = null;
    this.root = null;
  }

  /** Voll-Neuaufbau aus dem ViewModel (UI-STANDARD §4, Muster ViewModel-Re-Render). */
  private render(): void {
    const root = this.root;
    if (!root) return;
    root.empty();
    root.addClass("mailstone-inbox");

    const vm = this.host.viewModel();

    // Kopfzeile im INHALT, nicht per addAction(): Obsidian blendet den View-Kopf in jeder
    // Seitenleiste aus, eine Kopf-Aktion waere dort null Pixel hoch (REGISTRY §UI).
    const kopf = root.createDiv({ cls: "mailstone-inbox-head" });
    if (vm.state === "laedt") {
      const el = kopf.createSpan({ cls: "mailstone-inbox-status is-checking", attr: { "aria-label": t("inbox.loading") } });
      setIcon(el, "loader");
    }
    kopf.createEl("h3", { text: t("inbox.title") });

    const konten = this.host.accounts();
    // Ein Auswahlfeld mit genau einer Wahl ist keine Wahl — dann gehoert es weg.
    if (konten.length > 1) {
      const wahl = kopf.createEl("select", { cls: "mailstone-inbox-account" });
      wahl.setAttribute("aria-label", t("inbox.account"));
      for (const k of konten) {
        const opt = wahl.createEl("option", { text: k.label, value: k.id });
        if (k.id === this.host.selectedAccountId()) opt.selected = true;
      }
      wahl.addEventListener("change", () => this.host.selectAccount(wahl.value));
    }

    const laden = kopf.createEl("button", { cls: "mailstone-inbox-refresh", text: t("inbox.refresh") });
    laden.disabled = vm.state === "laedt";
    laden.addEventListener("click", () => this.host.refresh());

    if (vm.state === "fehler") {
      const zeile = root.createDiv({ cls: "mailstone-inbox-error" });
      const el = zeile.createSpan({ cls: "mailstone-inbox-status is-error", attr: { "aria-label": t("inbox.aria.error") } });
      setIcon(el, "circle-x");
      // Kein Fallback mehr auf einen plausiblen Text (I3): fehlt ein Schluessel hier, zeigt
      // `t()` den rohen `inbox.error.*`-Key an — ein sichtbarer Defekt statt einer stillen Luege.
      zeile.createSpan({ text: t(FEHLER_KEYS[vm.fehlerCode ?? ""] ?? `inbox.error.${vm.fehlerCode ?? "unknown"}`) });
      return;
    }

    if (vm.state === "leer") {
      const leer = root.createDiv({ cls: "mailstone-inbox-empty" });
      leer.createEl("p", { text: t("inbox.empty") });
      const cta = leer.createEl("button", { cls: "mod-cta", text: t("inbox.empty.cta") });
      cta.addEventListener("click", () => this.host.openSettings());
      return;
    }

    for (const row of vm.rows) this.renderRow(root, row, vm.aktionenGrund);
  }

  private renderRow(root: HTMLElement, row: InboxRow, aktionenGrund: InboxAktionenGrund): void {
    const zeile = root.createDiv({ cls: `mailstone-inbox-row${row.ungelesen ? " is-unread" : ""}` });

    const kopf = zeile.createDiv({ cls: "mailstone-inbox-row-head" });
    kopf.createSpan({ cls: "mailstone-inbox-subject", text: row.subject });
    if (row.imVault) {
      const badge = kopf.createSpan({ cls: "mailstone-inbox-badge", attr: { "aria-label": t("inbox.inVault") } });
      setIcon(badge, "circle-check");
    }

    const meta = zeile.createDiv({ cls: "mailstone-inbox-meta" });
    meta.createSpan({ text: row.from });
    meta.createSpan({ text: datum(row.date) });

    // I6: die Knoepfe bleiben IMMER da (Spec § 3d "nicht anklickbar, Grund als Tooltip") —
    // ein fehlendes MOVE oder ein laufender Sync sperrt sie statt sie zu entfernen. Wortlos
    // verschwundene Knoepfe erklaeren dem Nutzer nichts; ein `disabled`-Button mit `title`
    // schon. Zugleich behaelt die Zeile damit ihre Hoehe waehrend eines Sync-Laufs, statt bei
    // jedem Busy-Wechsel zu springen (zweiter Teil desselben Befunds).
    const knoepfe = zeile.createDiv({ cls: "mailstone-inbox-actions" });
    const grund = aktionenGrund === null ? null : t(`inbox.actions.${aktionenGrund}`);
    const uebernehmen = knoepfe.createEl("button", { cls: "mailstone-inbox-action", text: t("inbox.adopt") });
    const archivieren = knoepfe.createEl("button", { cls: "mailstone-inbox-action", text: t("inbox.archive") });
    const knoepfeAlle = [uebernehmen, archivieren];
    // Dritte Aktion NUR wenn TaskNotes erreichbar ist — kein Ausgrauen, sie fehlt sonst ganz
    // (Task 6, Spec § 4).
    if (this.host.canCreateTask()) {
      const aufgabe = knoepfe.createEl("button", { cls: "mailstone-inbox-action", text: t("inbox.createTask") });
      aufgabe.addEventListener("click", () => this.host.createTask(row.uid));
      knoepfeAlle.push(aufgabe);
    }
    for (const btn of knoepfeAlle) {
      btn.disabled = grund !== null;
      if (grund !== null) {
        btn.setAttribute("title", grund);
        btn.setAttribute("aria-disabled", "true");
      }
    }
    uebernehmen.addEventListener("click", () => this.host.adopt(row.uid));
    archivieren.addEventListener("click", () => this.host.archive(row.uid));
  }
}
