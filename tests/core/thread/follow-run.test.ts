import { describe, it, expect, vi } from "vitest";
import { runFollowUps, type FollowAccount, type FollowRunDeps } from "../../../src/core/thread/follow-run";
import type { FollowSession } from "../../../src/core/thread/follow";
import { groupThreads } from "../../../src/core/thread/group";
import { createBusyGuard } from "../../../src/vendor/code-kit/busy-guard";
import { NetError } from "../../../src/core/net/types";

const enc = new TextEncoder();
const head = (id: string, replyTo: string) => enc.encode(`From: x@example.org\r\nSubject: S ${id}\r\nDate: Tue, 10 Nov 2026 10:00:00 +0000\r\nMessage-ID: <${id}>\r\nIn-Reply-To: <${replyTo}>\r\n\r\n`);

function session(folders: Record<string, [number, string][]>, opts: { throwOn?: string } = {}) {
  const examined: string[] = [];
  let open = "";
  const logout = vi.fn(() => Promise.resolve());
  const s: FollowSession & { logout: () => Promise<void> } = {
    examine: (name) => {
      examined.push(name);
      if (opts.throwOn === name) throw new NetError("timeout", "zu langsam");
      open = name;
      return Promise.resolve({ ok: true as const, uidValidity: 1, exists: 0 });
    },
    uidSearchSince: () => Promise.resolve((folders[open] ?? []).map(([uid]) => uid)),
    uidFetchThreadHeaders: (uids) => Promise.resolve(new Map((folders[open] ?? []).filter(([uid]) => uids.includes(uid)).map(([uid, id]) => [uid, head(id, "wurzel@example.org")] as const))),
    logout,
  };
  return { s, examined, logout };
}

const konto = (id: string, inbox = "INBOX", sent = "Sent"): FollowAccount => ({ id, label: `Konto ${id}`, folders: { inbox, sent } });
const index = groupThreads([{ mailId: "wurzel@example.org", path: "Mail/wurzel", date: "2026-11-01", time: "10:00", inReplyTo: [], references: [] }]);

function deps(over: Partial<FollowRunDeps> & { sessions: Record<string, ReturnType<typeof session>> }): FollowRunDeps {
  const { sessions, ...rest } = over;
  return {
    accounts: () => [konto("a")],
    connect: (a) => Promise.resolve({ ok: true, session: sessions[a.id]!.s as never }),
    busy: createBusyGuard(),
    context: () => ({ index, stopped: new Set<string>() }),
    now: () => new Date(Date.UTC(2026, 10, 18)),
    ...rest,
  };
}

describe("runFollowUps", () => {
  it("liest inbox und sent jedes Kontos und taggt die Treffer mit dem Konto", async () => {
    const a = session({ INBOX: [[1, "x@example.org"]], Sent: [[2, "y@example.org"]] });
    const b = session({ Foo: [[3, "z@example.org"]] });
    const r = await runFollowUps(deps({ accounts: () => [konto("a"), konto("b", "Foo", "")], sessions: { a, b } }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.items.map((i) => [i.accountId, i.folder, i.mailId]).sort()).toEqual([["a", "INBOX", "x@example.org"], ["a", "Sent", "y@example.org"], ["b", "Foo", "z@example.org"]]);
    expect(r.items[0]?.accountLabel).toMatch(/^Konto /);
    expect(a.examined).toEqual(["INBOX", "Sent"]);
    expect(b.examined).toEqual(["Foo"]); // leerer sent-Ordner uebersprungen
    expect(a.logout).toHaveBeenCalledTimes(1);
    expect(b.logout).toHaveBeenCalledTimes(1);
  });

  it("belegt den Busy-Guard und gibt ihn wieder frei; ist er belegt, kommt busy ohne Verbindung", async () => {
    const guard = createBusyGuard();
    const connect = vi.fn();
    guard.tryAcquire();
    expect(await runFollowUps(deps({ busy: guard, connect, sessions: {} }))).toMatchObject({ ok: false, code: "busy" });
    expect(connect).not.toHaveBeenCalled();
    guard.release();
    await runFollowUps(deps({ busy: guard, sessions: { a: session({}) } }));
    expect(guard.isBusy()).toBe(false);
  });

  it("meldet eine misslungene Verbindung als Problem des Kontos und liest die uebrigen weiter", async () => {
    const b = session({ INBOX: [[1, "x@example.org"]] });
    const r = await runFollowUps(deps({
      accounts: () => [konto("a"), konto("b")],
      connect: (acc) => Promise.resolve(acc.id === "a" ? { ok: false as const, code: "auth" as const, detail: "nope" } : { ok: true as const, session: b.s as never }),
      sessions: {},
    }));
    if (!r.ok) throw new Error("unreachable");
    expect(r.problems).toEqual([{ accountId: "a", accountLabel: "Konto a", folder: "", code: "auth", detail: "nope" }]);
    expect(r.items).toHaveLength(1);
  });

  it("faengt einen Netzfehler mitten im Lauf als Problem ab, schliesst die Sitzung und gibt den Guard frei", async () => {
    const guard = createBusyGuard();
    const a = session({ INBOX: [] }, { throwOn: "INBOX" });
    const r = await runFollowUps(deps({ busy: guard, sessions: { a } }));
    if (!r.ok) throw new Error("unreachable");
    expect(r.problems).toEqual([{ accountId: "a", accountLabel: "Konto a", folder: "", code: "timeout", detail: "zu langsam" }]);
    expect(a.logout).toHaveBeenCalled();
    expect(guard.isBusy()).toBe(false);
  });

  it("reicht Ordnerprobleme (fehlender Ordner) mit Konto durch", async () => {
    const a = session({});
    a.s.examine = () => Promise.resolve({ ok: false as const, code: "folder-missing" as const, detail: "weg" });
    const r = await runFollowUps(deps({ sessions: { a } }));
    if (!r.ok) throw new Error("unreachable");
    expect(r.problems.map((p) => [p.accountId, p.folder, p.code])).toEqual([["a", "INBOX", "folder-missing"], ["a", "Sent", "folder-missing"]]);
  });

  it("laedt den Vault-Kontext erst, wenn der Guard belegt ist", async () => {
    const guard = createBusyGuard();
    guard.tryAcquire();
    const context = vi.fn();
    await runFollowUps(deps({ busy: guard, context, sessions: {} }));
    expect(context).not.toHaveBeenCalled();
  });
});
