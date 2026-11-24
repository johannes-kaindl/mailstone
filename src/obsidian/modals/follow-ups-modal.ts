import { Modal, setIcon, type App } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import type { FollowRunProblem, FollowRunResult } from "../../core/thread/follow-run";
import { FOLLOW_WINDOW_DAYS } from "../../core/thread/follow";
import { groupFollowUps, type FollowGroup } from "../../core/view/follow-vm";
import type { VaultFollowContext } from "../follow-context";

export type FollowUpsState =
  | { kind: "loading" }
  | { kind: "busy" }
  | { kind: "error"; message: string }
  | {
      kind: "done";
      groups: FollowGroup[];
      problems: readonly FollowRunProblem[];
      /** Pfad der Notiz zu einer Mail-ID, `null` ohne Notiz. */
      pathOf(mailId: string): string | null;
      open(path: string): void;
      windowDays: number;
    };

function datum(iso: string): string {
  if (iso.length === 0) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

/** Der Text zu einem Netz-/IMAP-Code. Die Verbindungs- und Anmeldetexte kommen von den Sync-Fehlern; ein fehlender Ordner
 *  hat einen eigenen Text (der Sync-Text spricht vom Allowlist-Ordner); ein unbekannter Code steht als er selbst da. */
function problemReason(code: string): string {
  if (code === "folder-missing") return t("followUps.error.folder-missing");
  const key = `error.sync.${code}`;
  const text = t(key);
  return text === key ? code : text;
}

function problemText(p: FollowRunProblem): string {
  const reason = problemReason(p.code);
  return p.folder === "" ? t("followUps.problem", p.accountLabel, reason) : t("followUps.problem.folder", p.accountLabel, p.folder, reason);
}

/** Zeichnet den Dialog neu. Rein darstellend: Listen-Zeile und Empty-State nach UI-STANDARD § 8, Status nie nur ueber Farbe
 *  (Symbol und Text). Liest und schreibt nichts. */
export function renderFollowUps(root: HTMLElement, state: FollowUpsState): void {
  root.empty();
  if (state.kind === "loading") {
    const zeile = root.createDiv({ cls: "mailstone-follow-status" });
    const el = zeile.createSpan({ cls: "mailstone-inbox-status is-checking", attr: { "aria-label": t("followUps.loading") } });
    setIcon(el, "loader");
    zeile.createSpan({ text: t("followUps.loading") });
    return;
  }
  if (state.kind === "busy") {
    root.createEl("p", { cls: "mailstone-follow-note", text: t("followUps.busy") });
    return;
  }

  if (state.kind === "error") {
    const zeile = root.createDiv({ cls: "mailstone-follow-problem" });
    const el = zeile.createSpan({ cls: "mailstone-inbox-status is-error", attr: { "aria-label": t("followUps.aria.error") } });
    setIcon(el, "circle-x");
    zeile.createSpan({ text: t("followUps.failed", state.message) });
    return;
  }

  const total = state.groups.reduce((n, g) => n + g.items.length, 0);
  if (total === 0 && state.problems.length === 0) {
    const leer = root.createDiv({ cls: "mailstone-follow-empty" });
    leer.createEl("p", { text: t("followUps.empty") });
    leer.createEl("p", { cls: "mailstone-follow-hint", text: t("followUps.emptyHint", state.windowDays) });
    return;
  }

  if (total > 0) root.createEl("p", { cls: "mailstone-follow-hint", text: t("followUps.summary", total, state.groups.length, state.windowDays) });

  for (const group of state.groups) {
    const block = root.createDiv({ cls: "mailstone-follow-group" });
    const path = state.pathOf(group.root);
    if (path === null) {
      block.createEl("h4", { cls: "mailstone-follow-title", text: group.root });
    } else {
      const kopf = block.createEl("h4", { cls: "mailstone-follow-title" });
      const link = kopf.createEl("a", {
        cls: "mailstone-follow-thread",
        text: path.replace(/^.*\//, "").replace(/\.md$/, ""),
        attr: { href: "#", "aria-label": t("followUps.openThread") },
      });
      link.addEventListener("click", (e) => { e.preventDefault(); state.open(path); });
    }
    for (const item of group.items) {
      const zeile = block.createDiv({ cls: "mailstone-follow-row" });
      zeile.createDiv({ cls: "mailstone-follow-subject", text: item.subject });
      const meta = zeile.createDiv({ cls: "mailstone-follow-meta" });
      meta.createSpan({ text: `${item.accountLabel} · ${item.folder}` });
      meta.createSpan({ text: datum(item.date) });
    }
  }

  for (const p of state.problems) {
    const zeile = root.createDiv({ cls: "mailstone-follow-problem" });
    const el = zeile.createSpan({ cls: "mailstone-inbox-status is-error", attr: { "aria-label": t("followUps.aria.error") } });
    setIcon(el, "circle-x");
    zeile.createSpan({ text: problemText(p) });
  }
}

export interface FollowUpsDeps {
  /** Der Vault-Stand, einmal je Oeffnen gelesen: derselbe fuer den Lauf und fuer die Links auf die Wurzel-Notizen. */
  context(): VaultFollowContext;
  /** Faehrt den lesenden Lauf; der Dialog ist dann schon offen und zeigt den Lade-Status. */
  run(ctx: VaultFollowContext): Promise<FollowRunResult>;
  openNote(path: string): void;
}

/** „Folge-Mails anzeigen“: zeigt, was ein lesender Lauf ueber INBOX und Gesendet findet. Aendert nichts. */
export class FollowUpsModal extends Modal {
  constructor(app: App, private readonly deps: FollowUpsDeps) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t("followUps.title"));
    renderFollowUps(this.contentEl, { kind: "loading" });
    void this.load();
  }

  private async load(): Promise<void> {
    // Eine Ausnahme (Kontext lesen oder Lauf) darf den Dialog nicht auf „Laedt“ stehen lassen: sie wird ein sichtbarer Fehlerzustand.
    let ctx: VaultFollowContext;
    let result: FollowRunResult;
    try {
      ctx = this.deps.context();
      result = await this.deps.run(ctx);
    } catch (e) {
      renderFollowUps(this.contentEl, { kind: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (!result.ok) { renderFollowUps(this.contentEl, { kind: "busy" }); return; }
    renderFollowUps(this.contentEl, {
      kind: "done",
      groups: groupFollowUps(result.items),
      problems: result.problems,
      pathOf: (id) => ctx.pathOf(id),
      open: (path) => { this.close(); this.deps.openNote(path); },
      windowDays: FOLLOW_WINDOW_DAYS,
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
