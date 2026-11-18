import { describe, it, expect } from "vitest";
import { diffRows } from "../../src/obsidian/modals/plan-preview-modal";
import type { MailCommandPlan } from "../../src/core/commands/types";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

function plan(diff: MailCommandPlan["diff"]): MailCommandPlan {
  return { commandId: "mail.rerender", mailId: "a@x", summary: "s", summaryKey: "k", summaryArgs: [], diff, notes: [] };
}

describe("diffRows", () => {
  it("fuellt fehlende Vorher-/Nachher-Werte mit einem Gedankenstrich", () => {
    expect(diffRows(plan([{ field: "cc", after: "a@x" }]))).toEqual([{ field: "cc", before: "—", after: "a@x" }]);
  });
  it("reicht vorhandene Werte durch", () => {
    expect(diffRows(plan([{ field: "subject", before: "alt", after: "neu" }]))).toEqual([{ field: "subject", before: "alt", after: "neu" }]);
  });
  it("uebersetzt den Grund einer uebersprungenen .eml und den Feldnamen trash/skipped (A6)", () => {
    const rows = diffRows(plan([{ field: "trash", before: "Mail/_eml/a.eml" }, { field: "skipped", before: "Mail/_eml/b.eml", after: "mismatch" }, { field: "skipped", before: "Mail/_eml/c.eml", after: "unreadable" }]));
    expect(rows[0]).toEqual({ field: "Papierkorb", before: "Mail/_eml/a.eml", after: "—" });
    expect(rows[1]).toEqual({ field: "Nicht angefasst", before: "Mail/_eml/b.eml", after: "gehört zu einer anderen Mail" });
    expect(rows[2]?.after).toBe("nicht lesbar");
  });
  it("liefert eine leere Liste, wenn es nichts zu zeigen gibt", () => {
    expect(diffRows(plan([]))).toEqual([]);
  });
});
