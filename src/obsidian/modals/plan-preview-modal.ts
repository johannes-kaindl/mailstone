// uebernommen (Muster) aus calendar-notes/src/obsidian/plan-preview-modal.ts, 2026-08-30
import { ButtonComponent, Modal, type App } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import type { MailCommandPlan } from "../../core/commands/types";
import { fieldLabel, trPlan } from "../command-i18n";

/** Zeilen der Vorschau-Tabelle; "—" statt undefined, damit die Spalte nicht leer wirkt.
 *  Pure, ohne DOM testbar. */
export function diffRows(plan: MailCommandPlan): { field: string; before: string; after: string }[] {
  return plan.diff.map((d) => ({ field: fieldLabel(d.field), before: d.before ?? "—", after: d.after ?? "—" }));
}

/**
 * Zeigt einen Plan, bevor er ausgefuehrt wird: Zusammenfassung, Diff-Tabelle, Knoepfe nach
 * der Confirm-Grammatik aus UI-STANDARD § 8 (Abbrechen links, Ausfuehren rechts mit
 * `setCta()`). `confirm()` liefert true, wenn der Nutzer ausfuehren will.
 */
export class PlanPreviewModal extends Modal {
  private settled = false;
  private resolveFn: (v: boolean) => void = () => undefined;

  constructor(app: App, private readonly plan: MailCommandPlan) {
    super(app);
  }

  confirm(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveFn = resolve;
      this.open();
    });
  }

  onOpen(): void {
    this.titleEl.setText(t("plan.heading"));
    this.contentEl.createEl("p", { text: trPlan(this.plan) });

    const rows = diffRows(this.plan);
    if (rows.length > 0) {
      const table = this.contentEl.createEl("table", { cls: "mailstone-diff-table" });
      const head = table.createEl("thead").createEl("tr");
      for (const h of [t("plan.col.field"), t("plan.col.before"), t("plan.col.after")]) head.createEl("th", { text: h });
      const body = table.createEl("tbody");
      for (const row of rows) {
        const tr = body.createEl("tr");
        tr.createEl("td", { text: row.field });
        tr.createEl("td", { text: row.before });
        tr.createEl("td", { text: row.after });
      }
    }

    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("plan.cancel")).onClick(() => { this.close(); });
    new ButtonComponent(btns).setButtonText(t("plan.execute")).setCta().onClick(() => {
      this.settle(true);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.settle(false);
  }

  private settle(v: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveFn(v);
  }
}
