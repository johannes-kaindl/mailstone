import { describe, it, expect, vi } from "vitest";
import { fetchInbox, INBOX_LIMIT, type InboxFetchDeps } from "../../../src/core/inbox/fetch";
import { createBusyGuard } from "../../../src/core/sync/busy";
import type { ImapReadSession } from "../../../src/core/imap/client";

function header(felder: string): Uint8Array {
  return new TextEncoder().encode(`${felder}\r\n\r\n`);
}

function fakeSession(over: Partial<ImapReadSession> = {}, caps: string[] = ["MOVE"]): ImapReadSession {
  return {
    capabilities: caps,
    examine: vi.fn(async () => ({ ok: true as const, uidValidity: 1, exists: 2 })),
    uidSearchAll: vi.fn(async () => [1, 2]),
    uidFetchHeaders: vi.fn(async (uids: readonly number[]) =>
      new Map(uids.map((u) => [u, { uid: u, flags: [], header: header(`Subject: Nr ${u}\r\nMessage-ID: <m${u}@x.invalid>`) }])),
    ),
    uidFetchMessageIds: vi.fn(), uidFetchBody: vi.fn(), append: vi.fn(),
    logout: vi.fn(async () => undefined),
    ...over,
  } as unknown as ImapReadSession;
}

function deps(session: ImapReadSession, bekannt = new Set<string>()): InboxFetchDeps {
  return { connect: async () => ({ ok: true, session }), busy: createBusyGuard(), bekannteIds: () => bekannt };
}

describe("fetchInbox", () => {
  it("oeffnet mit EXAMINE, liest UIDs und liefert Zeilen", async () => {
    const s = fakeSession();
    const r = await fetchInbox(deps(s), { folder: "INBOX" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]?.subject).toBe("Nr 2");
    expect(s.examine).toHaveBeenCalledWith("INBOX");
    expect(s.logout).toHaveBeenCalled();
  });

  it("sortiert absteigend — die neueste UID steht oben", async () => {
    const s = fakeSession({ uidSearchAll: vi.fn(async () => [3, 1, 2]) });
    const r = await fetchInbox(deps(s), { folder: "INBOX" });
    if (!r.ok) throw new Error("unreachable");
    expect(r.rows.map((z) => z.uid)).toEqual([3, 2, 1]);
  });

  it("holt hoechstens die letzten INBOX_LIMIT UIDs", async () => {
    const viele = Array.from({ length: 250 }, (_, i) => i + 1);
    const s = fakeSession({ uidSearchAll: vi.fn(async () => viele) });
    const r = await fetchInbox(deps(s), { folder: "INBOX" });
    if (!r.ok) throw new Error("unreachable");
    expect(r.rows).toHaveLength(INBOX_LIMIT);
    expect(r.rows[0]?.uid).toBe(250);
    const geholt = (s.uidFetchHeaders as unknown as { mock: { calls: number[][][] } }).mock.calls[0]?.[0];
    expect(geholt).toHaveLength(INBOX_LIMIT);
  });

  it("meldet kannVerschieben anhand der MOVE-Capability", async () => {
    const mit = await fetchInbox(deps(fakeSession({}, ["MOVE"])), { folder: "INBOX" });
    const ohne = await fetchInbox(deps(fakeSession({}, ["IMAP4rev1"])), { folder: "INBOX" });
    expect(mit).toMatchObject({ ok: true, kannVerschieben: true });
    expect(ohne).toMatchObject({ ok: true, kannVerschieben: false });
  });

  it("setzt imVault fuer bekannte Message-IDs", async () => {
    const r = await fetchInbox(deps(fakeSession(), new Set(["m2@x.invalid"])), { folder: "INBOX" });
    if (!r.ok) throw new Error("unreachable");
    expect(r.rows.find((z) => z.uid === 2)?.imVault).toBe(true);
    expect(r.rows.find((z) => z.uid === 1)?.imVault).toBe(false);
  });

  it("liefert eine leere Liste statt eines Fehlers, wenn der Ordner leer ist", async () => {
    const s = fakeSession({ uidSearchAll: vi.fn(async () => []) });
    const r = await fetchInbox(deps(s), { folder: "INBOX" });
    expect(r).toMatchObject({ ok: true, rows: [] });
    expect(s.uidFetchHeaders).not.toHaveBeenCalled();
  });

  it("reicht einen EXAMINE-Fehler durch", async () => {
    const s = fakeSession({ examine: vi.fn(async () => ({ ok: false as const, code: "folder-missing" as const, detail: "weg" })) });
    expect(await fetchInbox(deps(s), { folder: "Fehlt" })).toMatchObject({ ok: false, code: "folder-missing" });
  });

  it("bricht mit 'busy' ab, ohne zu verbinden", async () => {
    const busy = createBusyGuard();
    busy.tryAcquire();
    const connect = vi.fn();
    const r = await fetchInbox({ connect, busy, bekannteIds: () => new Set() }, { folder: "INBOX" });
    expect(r).toMatchObject({ ok: false, code: "busy" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("gibt den Busy-Guard auch im Fehlerfall frei", async () => {
    const busy = createBusyGuard();
    const s = fakeSession({ examine: vi.fn(async () => ({ ok: false as const, code: "protocol" as const, detail: "x" })) });
    await fetchInbox({ connect: async () => ({ ok: true, session: s }), busy, bekannteIds: () => new Set() }, { folder: "INBOX" });
    expect(busy.isBusy()).toBe(false);
  });
});
