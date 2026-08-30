import { describe, it, expect, vi } from "vitest";
import { executeCommandPlan, type CommandExecuteDeps } from "../../../src/core/commands/execute";
import { createBusyGuard } from "../../../src/core/sync/busy";
import type { MailCommandPlan } from "../../../src/core/commands/types";
import type { NotePlan } from "../../../src/core/mirror/plan";

const update: NotePlan = { kind: "update", path: "Mail/2026/x.md", content: "neu", mailId: "a@x", zoneHash: "h" };

function plan(over: Partial<MailCommandPlan> = {}): MailCommandPlan {
  return {
    commandId: "mail.rerender", mailId: "a@x",
    summary: "Note re-rendered", summaryKey: "plan.mail.rerender.summary", summaryArgs: [],
    diff: [], notes: [update], ...over,
  };
}

function deps(over: Partial<CommandExecuteDeps> = {}): CommandExecuteDeps {
  return {
    busy: createBusyGuard(),
    notes: { execute: vi.fn(async () => ({ created: 0, updated: 1, skipped: [], stateChanged: 0, errors: [] })) },
    writeAttachment: vi.fn(async () => undefined),
    openExternal: vi.fn(),
    ...over,
  };
}

describe("executeCommandPlan", () => {
  it("fuehrt die Notiz-Plaene ueber den PlanExecutor aus", async () => {
    const d = deps();
    const r = await executeCommandPlan(plan(), d);
    expect(r).toMatchObject({ ok: true, updated: 1 });
    expect(d.notes.execute).toHaveBeenCalledWith([update]);
  });

  it("bricht ab, wenn der Busy-Guard belegt ist — und schreibt nichts", async () => {
    const busy = createBusyGuard();
    busy.tryAcquire();
    const d = deps({ busy });
    expect(await executeCommandPlan(plan(), d)).toEqual({ ok: false, code: "busy" });
    expect(d.notes.execute).not.toHaveBeenCalled();
  });

  it("gibt den Guard auch frei, wenn der Executor wirft", async () => {
    const busy = createBusyGuard();
    const d = deps({ busy, notes: { execute: vi.fn(async () => { throw new Error("kaputt"); }) } });
    expect(await executeCommandPlan(plan(), d)).toEqual({ ok: false, code: "write-failed" });
    expect(busy.isBusy()).toBe(false);
  });

  it("schreibt den Anhang VOR den Notizen", async () => {
    const order: string[] = [];
    const d = deps({
      writeAttachment: vi.fn(async () => { order.push("attachment"); }),
      notes: { execute: vi.fn(async () => { order.push("notes"); return { created: 0, updated: 1, skipped: [], stateChanged: 0, errors: [] }; }) },
    });
    const r = await executeCommandPlan(plan({ attachment: { path: "Anhaenge/a.pdf", data: new Uint8Array([1]) } }), d);
    expect(order).toEqual(["attachment", "notes"]);
    expect(r).toMatchObject({ ok: true, attachmentPath: "Anhaenge/a.pdf" });
  });

  it("laesst die Notizen unberuehrt, wenn der Anhang nicht geschrieben werden kann", async () => {
    const d = deps({ writeAttachment: vi.fn(async () => { throw new Error("voll"); }) });
    expect(await executeCommandPlan(plan({ attachment: { path: "Anhaenge/a.pdf", data: new Uint8Array([1]) } }), d)).toEqual({ ok: false, code: "write-failed" });
    expect(d.notes.execute).not.toHaveBeenCalled();
  });

  it("oeffnet die URL erst nach den Schreibvorgaengen", async () => {
    const order: string[] = [];
    const d = deps({
      openExternal: vi.fn(() => { order.push("open"); }),
      notes: { execute: vi.fn(async () => { order.push("notes"); return { created: 0, updated: 0, skipped: [], stateChanged: 0, errors: [] }; }) },
    });
    await executeCommandPlan(plan({ notes: [], openUrl: "mailto:a@example.net" }), d);
    expect(order).toEqual(["notes", "open"]);
  });

  it("meldet einen Fehler aus dem PlanExecutor als write-failed", async () => {
    const d = deps({ notes: { execute: vi.fn(async () => ({ created: 0, updated: 0, skipped: [], stateChanged: 0, errors: [{ plan: update, message: "kaputt" }] })) } });
    expect(await executeCommandPlan(plan(), d)).toEqual({ ok: false, code: "write-failed" });
  });

  it("reicht uebersprungene Plaene durch, statt sie als Fehler zu melden", async () => {
    const skipped: NotePlan = { kind: "skip", path: "Mail/2026/x.md", mailId: "a@x", reason: "zone-edited" };
    const d = deps({ notes: { execute: vi.fn(async () => ({ created: 0, updated: 0, skipped: [skipped], stateChanged: 0, errors: [] })) } });
    const r = await executeCommandPlan(plan(), d);
    expect(r).toMatchObject({ ok: true, skipped: [skipped] });
  });
});
