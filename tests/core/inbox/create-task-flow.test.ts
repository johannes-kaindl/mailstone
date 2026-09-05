import { describe, it, expect, vi } from "vitest";
import { createTaskFromInbox, type CreateTaskFlowDeps } from "../../../src/core/inbox/create-task-flow";
import { createBusyGuard } from "../../../src/core/sync/busy";
import type { ImapWriteSession } from "../../../src/core/imap/client";

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

const req = { uid: 7, sourceFolder: "INBOX", targetFolder: "Vault", accountId: "acc-1", mailId: "msg-1@example.com" };

/** `pollUntil`, das seine Bedingung sofort einmal prueft — kein echtes Warten, damit die
 *  Tests nicht auf eine Uhr angewiesen sind. */
function immediatePoll(): CreateTaskFlowDeps["pollUntil"] {
  return async (pruefen) => pruefen();
}

/** `pollUntil`, das nie eintrifft — simuliert eine gerissene Frist ohne echte Zeit. */
function timeoutPoll(): CreateTaskFlowDeps["pollUntil"] {
  return async () => false;
}

function deps(over: Partial<CreateTaskFlowDeps> = {}): CreateTaskFlowDeps {
  return {
    connect: async () => ({ ok: true, session: fakeSession() }),
    busy: createBusyGuard(),
    syncAccount: vi.fn(async () => undefined),
    notePathFor: () => null,
    pollUntil: immediatePoll(),
    ...over,
  };
}

describe("createTaskFromInbox", () => {
  it("uebernimmt, synct gezielt und meldet erst dann die Notiz", async () => {
    // Fix-Runde 1, Minor 7: der vorherige Test belegte die Reihenfolge NICHT — `notePathFor`
    // lieferte unabhaengig davon, ob `syncAccount` schon lief, ein Treffer waere also auch bei
    // vertauschter Reihenfolge gruen geblieben. Ein `reihenfolge`-Protokoll (Muster aus
    // tests/obsidian/inbox-host.test.ts) macht die Behauptung "synct, dann meldet" ueberpruefbar.
    const reihenfolge: string[] = [];
    const syncAccount = vi.fn(async () => {
      reihenfolge.push("sync-start");
      await Promise.resolve();
      reihenfolge.push("sync-ende");
    });
    const pollUntil: CreateTaskFlowDeps["pollUntil"] = async (pruefen) => {
      reihenfolge.push("poll");
      return pruefen();
    };
    const d = deps({
      syncAccount,
      pollUntil,
      notePathFor: (mailId) => (mailId === req.mailId ? "Mail/note.md" : null),
    });
    const r = await createTaskFromInbox(d, req);
    expect(r).toEqual({ ok: true, notePath: "Mail/note.md" });
    expect(syncAccount).toHaveBeenCalledWith("acc-1");
    expect(reihenfolge).toEqual(["sync-start", "sync-ende", "poll"]);
  });

  it("bricht ab, wenn das Uebernehmen scheitert — ohne zu synchronisieren", async () => {
    const syncAccount = vi.fn(async () => undefined);
    const d = deps({
      connect: async () => ({ ok: false, code: "auth" as const, detail: "535" }),
      syncAccount,
    });
    const r = await createTaskFromInbox(d, req);
    expect(r).toEqual({ ok: false, code: "auth", detail: "535", adopted: false });
    expect(syncAccount).not.toHaveBeenCalled();
  });

  it("meldet sync-timeout, wenn die Notiz binnen der Frist nicht erscheint", async () => {
    const d = deps({ pollUntil: timeoutPoll(), notePathFor: () => null });
    const r = await createTaskFromInbox(d, req);
    expect(r).toMatchObject({ ok: false, code: "sync-timeout" });
  });

  it("meldet, dass die Uebernahme BESTEHEN BLEIBT, wenn die Frist reisst", async () => {
    const d = deps({ pollUntil: timeoutPoll(), notePathFor: () => null });
    const r = await createTaskFromInbox(d, req);
    // Der zentrale Vertrag: die Uebernahme ist auf dem Server passiert und nicht rueckgaengig
    // zu machen — ein `adopted: false` hier wuerde zu einem zweiten, ins Leere greifenden
    // Uebernehmen verleiten.
    expect(r).toMatchObject({ adopted: true });
  });

  it("stoesst den Sync gezielt fuer das Konto an, nicht syncAll", async () => {
    const syncAccount = vi.fn(async () => undefined);
    const d = deps({ syncAccount, notePathFor: () => "Mail/note.md" });
    await createTaskFromInbox(d, req);
    expect(syncAccount).toHaveBeenCalledTimes(1);
    expect(syncAccount).toHaveBeenCalledWith(req.accountId);
  });
});
