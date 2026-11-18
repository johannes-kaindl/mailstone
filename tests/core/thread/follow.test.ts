import { describe, it, expect, vi } from "vitest";
import { FOLLOW_WINDOW_DAYS, MAX_FOLLOW_HEADERS, findFollowUps, type FollowSession } from "../../../src/core/thread/follow";
import { groupThreads, type ThreadEntry } from "../../../src/core/thread/group";

// Ein Kopf mit dem Marker `UNLESBAR` laesst den Parser werfen, als haette ihn ein kaputter Header zerlegt. PostalMime
// selbst ist so nachsichtig, dass sich so ein Kopf nicht ehrlich bauen laesst; die Ablaufregel ist, was hier gemessen wird.
vi.mock("../../../src/core/mime/parse", async (orig) => {
  const actual = await orig<typeof import("../../../src/core/mime/parse")>();
  return {
    ...actual,
    parseEml: (bytes: Uint8Array) => {
      if (new TextDecoder().decode(bytes).includes("UNLESBAR")) return Promise.reject(new Error("kaputter Header"));
      return actual.parseEml(bytes);
    },
  };
});

const enc = new TextEncoder();

interface Msg { uid: number; id?: string; inReplyTo?: string; references?: string; subject?: string; date?: string }

function header(m: Msg): Uint8Array {
  const lines = [`From: x@example.org`, `Subject: ${m.subject ?? "Betreff"}`, `Date: ${m.date ?? "Tue, 10 Nov 2026 10:00:00 +0000"}`];
  if (m.id) lines.push(`Message-ID: <${m.id}>`);
  if (m.inReplyTo) lines.push(`In-Reply-To: <${m.inReplyTo}>`);
  if (m.references) lines.push(`References: ${m.references}`);
  return enc.encode(`${lines.join("\r\n")}\r\n\r\n`);
}

/** Eine Fake-Sitzung mit einer Mail-Liste je Ordner. Protokolliert, was gefragt wurde. */
function fakeSession(folders: Record<string, Msg[]>) {
  const log: { examined: string[]; since: Date[]; fetched: number[][] } = { examined: [], since: [], fetched: [] };
  let open = "";
  const session: FollowSession = {
    examine: (name) => {
      log.examined.push(name);
      if (!(name in folders)) return Promise.resolve({ ok: false as const, code: "folder-missing" as const, detail: "no such folder" });
      open = name;
      return Promise.resolve({ ok: true as const, uidValidity: 1, exists: folders[name]!.length });
    },
    uidSearchSince: (d) => { log.since.push(d); return Promise.resolve(folders[open]!.map((m) => m.uid)); },
    uidFetchThreadHeaders: (uids) => {
      log.fetched.push([...uids]);
      return Promise.resolve(new Map(folders[open]!.filter((m) => uids.includes(m.uid)).map((m) => [m.uid, header(m)] as const)));
    },
  };
  return { session, log };
}

const entry = (mailId: string, over: Partial<ThreadEntry> = {}): ThreadEntry =>
  ({ mailId, path: `Mail/${mailId}`, date: "2026-11-01", time: "10:00", inReplyTo: [], references: [], ...over });
const NOW = new Date(Date.UTC(2026, 10, 18, 12, 0));
const vault = groupThreads([entry("wurzel@example.org"), entry("antwort@example.org", { date: "2026-11-02", inReplyTo: ["wurzel@example.org"] }), entry("andere@example.org")]);
const req = (folders: string[], over: Partial<Parameters<typeof findFollowUps>[1]> = {}) => ({ folders, now: NOW, index: vault, stopped: new Set<string>(), ...over });

describe("findFollowUps — UIDVALIDITY je Ordner", () => {
  it("meldet die UIDVALIDITY jedes geoeffneten Ordners, damit eine spaetere Schreib-Sitzung pruefen kann, dass die UIDs noch gelten", async () => {
    const { session } = fakeSession({ INBOX: [], Sent: [] });
    const r = await findFollowUps(session, req(["INBOX", "Sent", "Fehlt"]));
    expect([...r.validity]).toEqual([["INBOX", 1], ["Sent", 1]]);
  });
});

describe("findFollowUps — Zuordnung ueber Header", () => {
  it("ordnet eine Mail ohne Notiz ueber In-Reply-To dem Vorgang zu", async () => {
    const { session } = fakeSession({ INBOX: [{ uid: 5, id: "neu@example.org", inReplyTo: "antwort@example.org", subject: "Re: Hallo" }] });
    const r = await findFollowUps(session, req(["INBOX"]));
    expect(r.followUps).toEqual([{ folder: "INBOX", uid: 5, mailId: "neu@example.org", root: "wurzel@example.org", subject: "Re: Hallo", date: "2026-11-10T10:00:00.000Z" }]);
    expect(r.problems).toEqual([]);
  });

  it("ordnet ueber References zu, die zuletzt genannte bekannte Mail zuerst", async () => {
    const { session } = fakeSession({ INBOX: [{ uid: 6, id: "ref@example.org", references: "<unbekannt@example.org> <andere@example.org> <wurzel@example.org>" }] });
    const r = await findFollowUps(session, req(["INBOX"]));
    // wurzel@ steht am Ende der References und gewinnt gegen andere@.
    expect(r.followUps.map((f) => f.root)).toEqual(["wurzel@example.org"]);
  });

  it("laesst eine Mail ohne Bezug zum Vault aus", async () => {
    const { session } = fakeSession({ INBOX: [{ uid: 7, id: "fremd@example.org", inReplyTo: "irgendwo@example.org" }, { uid: 8, id: "ohne@example.org" }] });
    expect((await findFollowUps(session, req(["INBOX"]))).followUps).toEqual([]);
  });

  it("laesst eine Mail aus, die schon als Notiz im Vault liegt", async () => {
    const { session } = fakeSession({ INBOX: [{ uid: 9, id: "antwort@example.org", inReplyTo: "wurzel@example.org" }] });
    expect((await findFollowUps(session, req(["INBOX"]))).followUps).toEqual([]);
  });

  it("laesst einen beendeten Vorgang aus, die anderen bleiben", async () => {
    const { session } = fakeSession({
      INBOX: [{ uid: 1, id: "a@example.org", inReplyTo: "wurzel@example.org" }, { uid: 2, id: "b@example.org", inReplyTo: "andere@example.org" }],
    });
    const r = await findFollowUps(session, req(["INBOX"], { stopped: new Set(["wurzel@example.org"]) }));
    expect(r.followUps.map((f) => [f.mailId, f.root])).toEqual([["b@example.org", "andere@example.org"]]);
  });

  it("liest mehrere Ordner nacheinander und sortiert nach Datum", async () => {
    const { session } = fakeSession({
      INBOX: [{ uid: 1, id: "spaet@example.org", inReplyTo: "wurzel@example.org", date: "Wed, 11 Nov 2026 10:00:00 +0000" }],
      Sent: [{ uid: 3, id: "frueh@example.org", inReplyTo: "wurzel@example.org", date: "Tue, 10 Nov 2026 10:00:00 +0000" }],
    });
    const r = await findFollowUps(session, req(["INBOX", "Sent"]));
    expect(r.followUps.map((f) => [f.folder, f.mailId])).toEqual([["Sent", "frueh@example.org"], ["INBOX", "spaet@example.org"]]);
  });
});

describe("findFollowUps — Ordner, Fenster, Grenzen", () => {
  it("ueberspringt einen leeren Ordnernamen, ohne den Server zu fragen", async () => {
    const { session, log } = fakeSession({ INBOX: [] });
    const r = await findFollowUps(session, req(["", "INBOX", "  "]));
    expect(log.examined).toEqual(["INBOX"]);
    expect(r.problems).toEqual([]);
  });

  it("fragt jeden Ordner nur einmal, auch wenn er doppelt genannt ist", async () => {
    const { session, log } = fakeSession({ INBOX: [] });
    await findFollowUps(session, req(["INBOX", "INBOX"]));
    expect(log.examined).toEqual(["INBOX"]);
  });

  it("meldet einen fehlenden Ordner als Problem und liest die uebrigen weiter", async () => {
    const { session } = fakeSession({ INBOX: [{ uid: 1, id: "a@example.org", inReplyTo: "wurzel@example.org" }] });
    const r = await findFollowUps(session, req(["Gesendet", "INBOX"]));
    expect(r.problems).toEqual([{ folder: "Gesendet", code: "folder-missing", detail: "no such folder" }]);
    expect(r.followUps).toHaveLength(1);
  });

  it("sucht ab dem Fenster von 60 Tagen vor jetzt", async () => {
    expect(FOLLOW_WINDOW_DAYS).toBe(60);
    const { session, log } = fakeSession({ INBOX: [] });
    await findFollowUps(session, req(["INBOX"]));
    expect(log.since).toHaveLength(1);
    expect(log.since[0]!.toISOString()).toBe(new Date(NOW.getTime() - 60 * 86_400_000).toISOString());
  });

  it("holt hoechstens 2000 Koepfe je Ordner, die neuesten UIDs", async () => {
    expect(MAX_FOLLOW_HEADERS).toBe(2000);
    const viele = Array.from({ length: 2500 }, (_, i) => ({ uid: i + 1 }));
    const { session, log } = fakeSession({ INBOX: viele });
    await findFollowUps(session, req(["INBOX"]));
    const geholt = log.fetched.flat();
    expect(geholt).toHaveLength(2000);
    expect(Math.min(...geholt)).toBe(501);
    expect(Math.max(...geholt)).toBe(2500);
  });

  it("holt nichts, wenn die Suche nichts findet", async () => {
    const { session, log } = fakeSession({ INBOX: [] });
    await findFollowUps(session, req(["INBOX"]));
    expect(log.fetched).toEqual([]);
  });
});

describe("findFollowUps — ein unlesbarer Kopf", () => {
  it("ueberspringt die Zeile und ordnet die uebrigen Mails weiter zu", async () => {
    const { session } = fakeSession({
      INBOX: [
        { uid: 1, id: "a@example.org", inReplyTo: "wurzel@example.org" },
        { uid: 2, id: "b@example.org", inReplyTo: "wurzel@example.org", subject: "UNLESBAR" },
        { uid: 3, id: "c@example.org", inReplyTo: "andere@example.org" },
      ],
      Sent: [{ uid: 4, id: "d@example.org", inReplyTo: "wurzel@example.org" }],
    });
    const r = await findFollowUps(session, req(["INBOX", "Sent"]));
    expect(r.followUps.map((f) => f.mailId).sort()).toEqual(["a@example.org", "c@example.org", "d@example.org"]);
    expect(r.problems).toEqual([]);
  });
});
