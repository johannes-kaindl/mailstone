import { describe, it, expect, vi } from "vitest";
import { adoptMessage, archiveMessage, type InboxActionDeps } from "../../../src/core/inbox/actions";
import { createBusyGuard } from "../../../src/core/sync/busy";
import type { ImapWriteSession } from "../../../src/core/imap/client";
import { NetError } from "../../../src/core/net/types";

function fakeSession(over: Partial<ImapWriteSession> = {}): ImapWriteSession {
  return {
    capabilities: ["MOVE", "UIDPLUS"],
    select: vi.fn(async () => ({ ok: true as const, uidValidity: 1, exists: 1 })),
    uidMove: vi.fn(async () => ({ ok: true as const })),
    logout: vi.fn(async () => undefined),
    examine: vi.fn(), uidSearchAll: vi.fn(), uidFetchMessageIds: vi.fn(),
    uidFetchHeaders: vi.fn(), uidFetchBody: vi.fn(), append: vi.fn(),
    ...over,
  } as unknown as ImapWriteSession;
}

function deps(session: ImapWriteSession, busy = createBusyGuard()): InboxActionDeps {
  return { connect: async () => ({ ok: true, session }), busy };
}

const req = { uid: 7, sourceFolder: "INBOX", targetFolder: "Vault" };

describe("adoptMessage", () => {
  it("selektiert die Quelle, verschiebt ins Ziel und meldet Erfolg", async () => {
    const s = fakeSession();
    expect(await adoptMessage(deps(s), req)).toEqual({ ok: true });
    expect(s.select).toHaveBeenCalledWith("INBOX");
    expect(s.uidMove).toHaveBeenCalledWith(7, "Vault");
    expect(s.logout).toHaveBeenCalled();
  });

  it("gibt den Busy-Guard auch bei Erfolg wieder frei", async () => {
    const busy = createBusyGuard();
    await adoptMessage(deps(fakeSession(), busy), req);
    expect(busy.isBusy()).toBe(false);
  });

  it("gibt den Busy-Guard auch frei, wenn uidMove scheitert", async () => {
    const busy = createBusyGuard();
    const s = fakeSession({ uidMove: vi.fn(async () => ({ ok: false as const, code: "gone" as const, detail: "weg" })) });
    expect(await adoptMessage(deps(s, busy), req)).toMatchObject({ ok: false, code: "gone" });
    expect(busy.isBusy()).toBe(false);
  });

  it("bricht mit 'busy' ab, wenn der Guard belegt ist — ohne zu verbinden", async () => {
    const busy = createBusyGuard();
    busy.tryAcquire();
    const connect = vi.fn();
    expect(await adoptMessage({ connect, busy }, req)).toMatchObject({ ok: false, code: "busy" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("bricht mit 'no-target-folder' ab, wenn kein Ziel gesetzt ist — ohne zu verbinden", async () => {
    const connect = vi.fn();
    const r = await adoptMessage({ connect, busy: createBusyGuard() }, { ...req, targetFolder: "" });
    expect(r).toMatchObject({ ok: false, code: "no-target-folder" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("reicht einen SELECT-Fehler durch und verschiebt nicht", async () => {
    const s = fakeSession({ select: vi.fn(async () => ({ ok: false as const, code: "folder-missing" as const, detail: "weg" })) });
    expect(await adoptMessage(deps(s), req)).toMatchObject({ ok: false, code: "folder-missing" });
    expect(s.uidMove).not.toHaveBeenCalled();
    expect(s.logout).toHaveBeenCalled();
  });

  it("reicht einen Verbindungsfehler durch", async () => {
    const r = await adoptMessage({ connect: async () => ({ ok: false, code: "auth", detail: "535" }), busy: createBusyGuard() }, req);
    expect(r).toMatchObject({ ok: false, code: "auth" });
  });

  it("I4: faengt einen NetError aus select/uidMove ab statt ihn als unbehandelte Rejection zu werfen", async () => {
    const s = fakeSession({ select: vi.fn(async () => { throw new NetError("timeout", "keine Antwort"); }) });
    const r = await adoptMessage(deps(s), req);
    expect(r).toMatchObject({ ok: false, code: "timeout" });
    expect(s.logout).toHaveBeenCalled();
  });

  it("I4: gibt den Busy-Guard auch nach einem NetError wieder frei", async () => {
    const busy = createBusyGuard();
    const s = fakeSession({ uidMove: vi.fn(async () => { throw new NetError("closed", "weg"); }) });
    await adoptMessage(deps(s, busy), req);
    expect(busy.isBusy()).toBe(false);
  });
});

describe("archiveMessage", () => {
  it("verschiebt in den uebergebenen Archivordner", async () => {
    const s = fakeSession();
    expect(await archiveMessage(deps(s), { ...req, targetFolder: "Archive" })).toEqual({ ok: true });
    expect(s.uidMove).toHaveBeenCalledWith(7, "Archive");
  });
});
