import { describe, it, expect } from "vitest";
import { diffRows } from "../../src/obsidian/modals/plan-preview-modal";
import type { MailCommandPlan } from "../../src/core/commands/types";

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
  it("liefert eine leere Liste, wenn es nichts zu zeigen gibt", () => {
    expect(diffRows(plan([]))).toEqual([]);
  });
});
