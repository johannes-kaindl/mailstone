import { setIcon } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import type { Account } from "../../core/settings";
import type { Unsubscribe } from "../../core/sync/events";
import type { InboxRow, InboxViewModel } from "../../core/view/inbox-vm";

/** Schmaler Vertrag zum Plugin (UI-STANDARD §4): lesend oder `void`, kein Rueckkanal —
 *  wie `CockpitHost`. Die Aktionen melden ihr Ergebnis ueber `onChange`, nicht als Rueckgabe. */
export interface InboxHost {
  accounts(): readonly Account[];
  selectedAccountId(): string;
  selectAccount(id: string): void;
  viewModel(): InboxViewModel;
  refresh(): void;
  adopt(uid: number): void;
  archive(uid: number): void;
  openSettings(): void;
  onChange(cb: () => void): Unsubscribe;
}

/** Fehlercode -> i18n-Key. Geschlossen gehalten, damit kein Code stumm durchfaellt:
 *  ein unbekannter landet auf einer allgemeinen Zeile statt auf einer leeren. */
const FEHLER_KEYS: Record<string, string> = {
  unsupported: "inbox.error.unsupported",
  gone: "inbox.error.gone",
  busy: "inbox.error.busy",
  "no-target-folder": "inbox.error.no-target-folder",
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
      const el = zeile.createSpan({ cls: "mailstone-inbox-status is-error", attr: { "aria-label": t("inbox.title") } });
      setIcon(el, "circle-x");
      zeile.createSpan({ text: t(FEHLER_KEYS[vm.fehlerCode ?? ""] ?? "inbox.error.busy") });
      return;
    }

    if (vm.state === "leer") {
      const leer = root.createDiv({ cls: "mailstone-inbox-empty" });
      leer.createEl("p", { text: t("inbox.empty") });
      const cta = leer.createEl("button", { cls: "mod-cta", text: t("inbox.empty.cta") });
      cta.addEventListener("click", () => this.host.openSettings());
      return;
    }

    for (const row of vm.rows) this.renderRow(root, row, vm.aktionenAktiv);
  }

  private renderRow(root: HTMLElement, row: InboxRow, aktionenAktiv: boolean): void {
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

    if (!aktionenAktiv) return;
    const knoepfe = zeile.createDiv({ cls: "mailstone-inbox-actions" });
    const uebernehmen = knoepfe.createEl("button", { cls: "mailstone-inbox-action", text: t("inbox.adopt") });
    uebernehmen.addEventListener("click", () => this.host.adopt(row.uid));
    const archivieren = knoepfe.createEl("button", { cls: "mailstone-inbox-action", text: t("inbox.archive") });
    archivieren.addEventListener("click", () => this.host.archive(row.uid));
  }
}
