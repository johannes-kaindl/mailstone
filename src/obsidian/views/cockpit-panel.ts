import { setIcon } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import type { Account } from "../../core/settings";
import type { Unsubscribe } from "../../core/sync/events";
import type { RunState } from "../../core/sync/run-state";
import { buildCockpitViewModel, type CockpitRow, type CockpitState } from "../../core/view/cockpit-vm";

/** Schmaler Vertrag zum Plugin (UI-STANDARD §4): lesend oder `void`, kein Rueckkanal.
 *  Vorbild ist `PanelHost` in vault-crews/src/obsidian/panel.ts. */
export interface CockpitHost {
  accounts(): readonly Account[];
  runState(): RunState;
  nextDueAt(accountId: string): number | null;
  isBusy(): boolean;
  /** Ohne Argument: alle aktivierten Konten. */
  syncNow(accountId?: string): void;
  openSettings(): void;
  onChange(cb: () => void): Unsubscribe;
}

/** Icon-Vokabel des §8-Bausteins. `never` fehlt bewusst — dafuer gibt es keinen Zustand,
 *  `checking` fehlt, weil es kein Zeilenzustand ist (s. CockpitState). */
const ICONS: Record<Exclude<CockpitState, "never">, string> = {
  ok: "circle-check",
  error: "circle-x",
  warning: "alert-triangle",
};

const ARIA: Record<Exclude<CockpitState, "never">, string> = {
  ok: "cockpit.aria.ok",
  error: "cockpit.aria.error",
  warning: "cockpit.aria.warning",
};

/** Die vollstaendige Vokabel des §8-Indikators: die drei Zeilenzustaende plus `checking`, das
 *  nur die Kopfzeile kennt. Geschlossen getippt, damit hier keine vierte Schreibweise entsteht. */
type IndikatorZustand = Exclude<CockpitState, "never"> | "checking";

/** Zeichnet einen Status-Indikator: Klasse UND Icon UND aria-label, nie eines ohne die anderen.
 *  `checking` gehoert genau einmal auf die Seite und in die Kopfzeile — der BusyGuard ist global,
 *  ein Spinner je Zeile behauptete ein Konto-genaues „laeuft gerade", das es nicht gibt (Spec,
 *  Bekannte Grenze). */
function statusSpan(parent: HTMLElement, zustand: IndikatorZustand, icon: string, ariaKey: string): void {
  const el = parent.createSpan({
    cls: `mailstone-cockpit-status is-${zustand}`,
    attr: { "aria-label": t(ariaKey) },
  });
  setIcon(el, icon);
}

function uhrzeit(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

export class CockpitPanel {
  readonly id = "cockpit";
  readonly icon = "mail";
  private root: HTMLElement | null = null;
  private unsub: Unsubscribe | null = null;

  constructor(private readonly host: CockpitHost) {}

  get label(): string {
    return t("cockpit.title");
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

  /** Voll-Neuaufbau aus dem ViewModel (UI-STANDARD §4, Muster ViewModel-Re-Render):
   *  das Panel haelt keinen langlebigen internen Zustand, also ist der DOM eine reine
   *  Funktion des gehaltenen Zustands. */
  private render(): void {
    const root = this.root;
    if (!root) return;
    root.empty();
    root.addClass("mailstone-cockpit");

    const vm = buildCockpitViewModel({
      accounts: this.host.accounts(),
      runState: this.host.runState(),
      nextDue: (id) => this.host.nextDueAt(id),
      busy: this.host.isBusy(),
    });

    // Kopfzeile im INHALT, nicht per addAction(): Obsidians app.css blendet den View-Kopf
    // in jeder Seitenleiste aus (`.mod-right-split .view-header { display: none }`), eine
    // Kopf-Aktion waere dort null Pixel hoch. Siehe REGISTRY §UI.
    const kopf = root.createDiv({ cls: "mailstone-cockpit-head" });
    // Der EINE is-checking-Indikator der Ansicht — in der Kopfzeile, nicht in den Zeilen.
    if (vm.busy) statusSpan(kopf, "checking", "loader", "cockpit.aria.checking");
    kopf.createEl("h3", { text: t("cockpit.title") });
    const alle = kopf.createEl("button", { cls: "mailstone-cockpit-sync-all", text: t("cockpit.syncAll") });
    // Auch im Empty-State gesperrt: ohne Konto kann der Knopf nichts tun, und ein Knopf, der
    // nichts tun kann, darf nicht bedienbar aussehen.
    alle.disabled = vm.busy || vm.empty;
    alle.addEventListener("click", () => this.host.syncNow(undefined));

    if (vm.empty) {
      const leer = root.createDiv({ cls: "mailstone-cockpit-empty" });
      leer.createEl("p", { text: t("cockpit.empty") });
      const cta = leer.createEl("button", { cls: "mod-cta", text: t("cockpit.empty.cta") });
      cta.addEventListener("click", () => this.host.openSettings());
      return;
    }

    for (const row of vm.rows) this.renderRow(root, row, vm.busy);
  }

  private renderRow(root: HTMLElement, row: CockpitRow, busy: boolean): void {
    const zeile = root.createDiv({ cls: "mailstone-cockpit-row" });
    const kopf = zeile.createDiv({ cls: "mailstone-cockpit-row-head" });

    if (row.state !== "never") statusSpan(kopf, row.state, ICONS[row.state], ARIA[row.state]);
    kopf.createSpan({ cls: "mailstone-cockpit-label", text: row.label });

    const knopf = kopf.createEl("button", { cls: "mailstone-cockpit-sync", text: t("cockpit.syncOne") });
    knopf.disabled = busy;
    knopf.addEventListener("click", () => this.host.syncNow(row.accountId));

    const meta = zeile.createDiv({ cls: "mailstone-cockpit-meta" });
    meta.createDiv({ text: row.lastRunAt === null ? t("cockpit.never") : t("cockpit.lastRun", uhrzeit(row.lastRunAt)) });
    meta.createDiv({
      text: row.disabled ? t("cockpit.nextRun.off")
        : row.nextRunAt === null ? "" : t("cockpit.nextRun", uhrzeit(row.nextRunAt)),
    });
    if (row.errorKey) meta.createDiv({ cls: "mailstone-cockpit-error", text: t(row.errorKey) });
    else if (row.countsKey) {
      const teile = row.countsKey.split(" ").map((k, i) => t(k, row.countsArgs[i] ?? 0));
      meta.createDiv({ cls: "mailstone-cockpit-counts", text: teile.join(" · ") });
    }
  }
}
