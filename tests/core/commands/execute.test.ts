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
    createTask: vi.fn(async () => ({ ok: true as const, path: "TaskNotes/Tasks/x.md" })),
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

  it("meldet openedUrl im Ergebnis, wenn eine URL geoeffnet wurde", async () => {
    const d = deps({ notes: { execute: vi.fn(async () => ({ created: 0, updated: 0, skipped: [], stateChanged: 0, errors: [] })) } });
    const r = await executeCommandPlan(plan({ notes: [], openUrl: "mailto:a@example.net" }), d);
    expect(r).toMatchObject({ ok: true, openedUrl: true });
  });

  it("hat kein openedUrl, wenn der Plan keine URL oeffnet", async () => {
    const r = await executeCommandPlan(plan(), deps());
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.openedUrl).toBeUndefined();
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

describe("createTask im Plan", () => {
  const createTaskReq = { title: "Angebot pruefen", due: "2026-12-24", noteLink: "Mail/2026/x" };

  it("ruft den Port mit den Plandaten", async () => {
    const createTask = vi.fn(async () => ({ ok: true as const, path: "TaskNotes/Tasks/x.md" }));
    const d = deps({ createTask, notes: { execute: vi.fn(async () => ({ created: 0, updated: 0, skipped: [], stateChanged: 0, errors: [] })) } });
    const r = await executeCommandPlan(plan({ notes: [], createTask: createTaskReq }), d);
    expect(createTask).toHaveBeenCalledWith(createTaskReq);
    expect(r).toMatchObject({ ok: true, taskPath: "TaskNotes/Tasks/x.md" });
  });

  // Fix-Runde 2, Important 1: TaskNotes kann ohne `path`-Feld antworten (Bruecke liefert dann
  // "" statt undefined) — der leere String muss trotzdem als taskPath durchgereicht werden,
  // sonst kann main.ts nicht zwischen "keine Aufgabe angelegt" und "Aufgabe angelegt, aber
  // ohne bekannten Pfad" unterscheiden.
  it("reicht einen leeren Pfad als taskPath durch, wenn die Bruecke keinen Pfad kennt", async () => {
    const createTask = vi.fn(async () => ({ ok: true as const, path: "" }));
    const d = deps({ createTask, notes: { execute: vi.fn(async () => ({ created: 0, updated: 0, skipped: [], stateChanged: 0, errors: [] })) } });
    const r = await executeCommandPlan(plan({ notes: [], createTask: createTaskReq }), d);
    expect(r).toMatchObject({ ok: true, taskPath: "" });
  });

  it("meldet task-create-failed, wenn der Port ablehnt", async () => {
    const d = deps({
      createTask: vi.fn(async () => ({ ok: false as const, code: "task-create-failed" as const })),
      notes: { execute: vi.fn(async () => ({ created: 0, updated: 0, skipped: [], stateChanged: 0, errors: [] })) },
    });
    const r = await executeCommandPlan(plan({ notes: [], createTask: createTaskReq }), d);
    expect(r).toEqual({ ok: false, code: "task-create-failed" });
  });

  it("meldet write-failed, wenn der Port wirft — Fehler sind Werte, nicht Ausnahmen", async () => {
    const d = deps({
      createTask: vi.fn(async () => { throw new Error("kaputt"); }),
      notes: { execute: vi.fn(async () => ({ created: 0, updated: 0, skipped: [], stateChanged: 0, errors: [] })) },
    });
    const r = await executeCommandPlan(plan({ notes: [], createTask: createTaskReq }), d);
    expect(r).toEqual({ ok: false, code: "write-failed" });
  });

  it("gibt den Busy-Guard auch dann frei, wenn der Port wirft", async () => {
    const busy = createBusyGuard();
    const d = deps({
      busy,
      createTask: vi.fn(async () => { throw new Error("kaputt"); }),
      notes: { execute: vi.fn(async () => ({ created: 0, updated: 0, skipped: [], stateChanged: 0, errors: [] })) },
    });
    await executeCommandPlan(plan({ notes: [], createTask: createTaskReq }), d);
    expect(busy.isBusy()).toBe(false);
  });

  it("oeffnet KEINE URL mehr, wenn createTask ablehnt", async () => {
    const openExternal = vi.fn();
    const d = deps({
      openExternal,
      createTask: vi.fn(async () => ({ ok: false as const, code: "task-create-failed" as const })),
      notes: { execute: vi.fn(async () => ({ created: 0, updated: 0, skipped: [], stateChanged: 0, errors: [] })) },
    });
    const r = await executeCommandPlan(plan({ notes: [], createTask: createTaskReq, openUrl: "mailto:a@example.net" }), d);
    expect(r).toEqual({ ok: false, code: "task-create-failed" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("ruft createTask GAR NICHT auf, wenn die Notizen schon mit einem Fehler scheitern", async () => {
    const createTask = vi.fn(async () => ({ ok: true as const, path: "TaskNotes/Tasks/x.md" }));
    const d = deps({
      createTask,
      notes: { execute: vi.fn(async () => ({ created: 0, updated: 0, skipped: [], stateChanged: 0, errors: [{ plan: update, message: "kaputt" }] })) },
    });
    const r = await executeCommandPlan(plan({ createTask: createTaskReq }), d);
    expect(r).toEqual({ ok: false, code: "write-failed" });
    expect(createTask).not.toHaveBeenCalled();
  });
});
