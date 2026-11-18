import { describe, it, expect } from "vitest";
import type { ImapConnectResult, ImapConnectWritableResult, ImapReadSession, ImapWriteSession, UidCopyResult } from "../../../src/core/imap/client";
import { NetError } from "../../../src/core/net/types";
import { MAX_FOLLOW_COPIES_PER_RUN, copyFollowUps, type FollowCopyDeps } from "../../../src/core/thread/follow-copy";
import { groupThreads, type ThreadEntry } from "../../../src/core/thread/group";

// A1 (Uebernahme): ein Schritt vor dem Allowlist-Lauf, der Folge-Mails per UID COPY in den Allowlist-Ordner legt.
// Hier ein kleiner Server im Speicher: Ordner mit Mails, eine lesende und eine schreibende Sitzung darauf. Ein COPY
// legt eine Kopie mit neuer UID im Zielordner an, damit ein zweiter Lauf dieselbe Mail dort findet.

const enc = new TextEncoder();
const NOW = new Date(Date.UTC(2026, 10, 18, 12, 0));
const ALLOW = "Vault";

interface Mail { uid: number; id: string; inReplyTo?: string; date?: string; noHeaderId?: boolean }

function head(m: Mail): Uint8Array {
  const lines = ["From: x@example.org", "Subject: Betreff", `Date: ${m.date ?? "Tue, 10 Nov 2026 10:00:00 +0000"}`];
  if (!m.noHeaderId) lines.push(`Message-ID: <${m.id}>`);
  if (m.inReplyTo) lines.push(`In-Reply-To: <${m.inReplyTo}>`);
  return enc.encode(`${lines.join("\r\n")}\r\n\r\n`);
}

const entry = (mailId: string, over: Partial<ThreadEntry> = {}): ThreadEntry =>
  ({ mailId, path: `Mail/${mailId}`, date: "2026-11-01", time: "10:00", inReplyTo: [], references: [], ...over });

class Server {
  boxes = new Map<string, Mail[]>();
  validity = new Map<string, number>();
  log: string[] = [];
  writeConnects = 0;
  readConnects = 0;
  copyResult: (uid: number, target: string) => UidCopyResult = () => ({ ok: true });
  copyThrows: ((uid: number) => boolean) | null = null;
  nextUid = 1000;

  constructor(boxes: Record<string, Mail[]>) {
    for (const [k, v] of Object.entries(boxes)) { this.boxes.set(k, v); this.validity.set(k, 7); }
  }

  private readApi(): Record<string, unknown> {
    let open = "";
    const boxes = this.boxes;
    const validity = this.validity;
    const log = this.log;
    return {
      capabilities: [] as string[],
      examine(name: string) {
        log.push(`EXAMINE ${name}`);
        if (!boxes.has(name)) return Promise.resolve({ ok: false as const, code: "folder-missing" as const, detail: "weg" });
        open = name;
        return Promise.resolve({ ok: true as const, uidValidity: validity.get(name) ?? 1, exists: boxes.get(name)?.length ?? 0 });
      },
      uidSearchSince: () => Promise.resolve((boxes.get(open) ?? []).map((m) => m.uid)),
      uidFetchThreadHeaders: (uids: readonly number[]) =>
        Promise.resolve(new Map((boxes.get(open) ?? []).filter((m) => uids.includes(m.uid)).map((m) => [m.uid, head(m)] as const))),
      uidSearchHeader(field: string, value: string) {
        log.push(`SEARCH ${field} ${value}`);
        return Promise.resolve((boxes.get(open) ?? []).filter((m) => m.id.toLowerCase().includes(value.toLowerCase())).map((m) => m.uid));
      },
      uidFetchMessageIds: (uids: readonly number[]) =>
        Promise.resolve(new Map((boxes.get(open) ?? []).filter((m) => uids.includes(m.uid)).map((m) => [m.uid, m.id] as const))),
      logout() { log.push("LOGOUT"); return Promise.resolve(); },
      currentOpen: () => open,
    };
  }

  read(): Promise<ImapConnectResult> {
    this.readConnects += 1;
    return Promise.resolve({ ok: true, session: this.readApi() as unknown as ImapReadSession });
  }

  write(): Promise<ImapConnectWritableResult> {
    this.writeConnects += 1;
    const base = this.readApi() as Record<string, unknown> & { currentOpen(): string };
    const server = this;
    const api = {
      ...base,
      uidCopy(uid: number, target: string): Promise<UidCopyResult> {
        const open = base.currentOpen();
        server.log.push(`COPY ${open} ${String(uid)} -> ${target}`);
        if (server.copyThrows?.(uid)) return Promise.reject(new NetError("timeout", "zu langsam"));
        const r = server.copyResult(uid, target);
        if (r.ok) {
          const src = (server.boxes.get(open) ?? []).find((m) => m.uid === uid);
          if (src) { server.nextUid += 1; server.boxes.get(target)?.push({ ...src, uid: server.nextUid }); }
        }
        return Promise.resolve(r);
      },
    };
    return Promise.resolve({ ok: true, session: api as unknown as ImapWriteSession });
  }

  copies(): string[] { return this.log.filter((l) => l.startsWith("COPY ")); }
  allowlist(): Mail[] { return this.boxes.get(ALLOW) ?? []; }
}

const vault = groupThreads([entry("wurzel@example.org")]);
const FOLDERS = { inbox: "INBOX", sent: "Sent", allowlist: ALLOW };

function deps(server: Server, over: Partial<FollowCopyDeps> = {}): FollowCopyDeps {
  return { connectRead: () => server.read(), connectWrite: () => server.write(), context: () => ({ index: vault, stopped: new Set<string>() }), now: () => NOW, ...over };
}
const reply = (uid: number, id: string, extra: Partial<Mail> = {}): Mail => ({ uid, id, inReplyTo: "wurzel@example.org", ...extra });

describe("copyFollowUps — kopiert Folge-Mails in den Allowlist-Ordner", () => {
  it("kopiert die Folge-Mails aus INBOX und Gesendet, nur eine schreibende Verbindung, Ziel ist der Allowlist-Ordner", async () => {
    const s = new Server({ INBOX: [reply(5, "a@example.org"), { uid: 6, id: "fremd@example.org" }], Sent: [reply(2, "b@example.org")], [ALLOW]: [] });
    const r = await copyFollowUps(deps(s), FOLDERS);
    expect(r).toEqual({ copied: 2, errors: 0 });
    expect(s.copies().sort()).toEqual(["COPY INBOX 5 -> Vault", "COPY Sent 2 -> Vault"]);
    expect(s.writeConnects).toBe(1);
    expect(s.allowlist().map((m) => m.id).sort()).toEqual(["a@example.org", "b@example.org"]);
  });

  it("kopiert beim zweiten Lauf nichts doppelt und oeffnet dann keine schreibende Verbindung", async () => {
    const s = new Server({ INBOX: [reply(5, "a@example.org")], Sent: [], [ALLOW]: [] });
    await copyFollowUps(deps(s), FOLDERS);
    const zweiter = await copyFollowUps(deps(s), FOLDERS);
    expect(zweiter).toEqual({ copied: 0, errors: 0 });
    expect(s.copies()).toHaveLength(1);
    expect(s.writeConnects).toBe(1);
    expect(s.allowlist()).toHaveLength(1);
  });

  it("kopiert eine Mail, die in INBOX und Gesendet liegt, nur einmal", async () => {
    const s = new Server({ INBOX: [reply(5, "a@example.org")], Sent: [reply(2, "a@example.org")], [ALLOW]: [] });
    expect(await copyFollowUps(deps(s), FOLDERS)).toEqual({ copied: 1, errors: 0 });
    expect(s.copies()).toHaveLength(1);
  });

  it("laesst eine Mail aus, die schon im Allowlist-Ordner liegt (noch ohne Notiz), und prueft die ID genau, nicht als Teilstring", async () => {
    // Der SEARCH-Treffer ist ein Teilstring-Treffer: `xb@example.org` enthaelt `b@example.org`, ist aber eine andere Mail.
    const s = new Server({
      INBOX: [reply(5, "a@example.org"), reply(6, "b@example.org")],
      Sent: [],
      [ALLOW]: [{ uid: 1, id: "a@example.org" }, { uid: 2, id: "xb@example.org" }],
    });
    expect(await copyFollowUps(deps(s), FOLDERS)).toEqual({ copied: 1, errors: 0 });
    expect(s.copies()).toEqual(["COPY INBOX 6 -> Vault"]);
  });

  it("kopiert hoechstens MAX_FOLLOW_COPIES_PER_RUN je Lauf, die aeltesten zuerst; der Rest folgt im naechsten", async () => {
    const mails = Array.from({ length: MAX_FOLLOW_COPIES_PER_RUN + 20 }, (_, i) =>
      reply(i + 1, `m${String(i)}@example.org`, { date: `Tue, 10 Nov 2026 ${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00 +0000` }));
    const s = new Server({ INBOX: mails, Sent: [], [ALLOW]: [] });
    expect(MAX_FOLLOW_COPIES_PER_RUN).toBe(50);
    expect(await copyFollowUps(deps(s), FOLDERS)).toEqual({ copied: 50, errors: 0 });
    expect(s.copies()[0]).toBe("COPY INBOX 1 -> Vault");
    expect(await copyFollowUps(deps(s), FOLDERS)).toEqual({ copied: 20, errors: 0 });
    expect(s.allowlist()).toHaveLength(70);
  });

  it("kopiert in der Reihenfolge der Mails ueber beide Ordner hinweg (aelteste zuerst), damit die Notizen in Vorgangsreihenfolge entstehen", async () => {
    const s = new Server({
      INBOX: [reply(5, "b@example.org", { date: "Wed, 11 Nov 2026 10:00:00 +0000" }), reply(6, "c@example.org", { date: "Thu, 12 Nov 2026 10:00:00 +0000" })],
      Sent: [reply(2, "a@example.org", { date: "Tue, 10 Nov 2026 10:00:00 +0000" })],
      [ALLOW]: [],
    });
    await copyFollowUps(deps(s), FOLDERS);
    expect(s.copies()).toEqual(["COPY Sent 2 -> Vault", "COPY INBOX 5 -> Vault", "COPY INBOX 6 -> Vault"]);
  });

  it("zaehlt ein abgelehntes COPY als Fehler und kopiert die uebrigen weiter", async () => {
    const s = new Server({ INBOX: [reply(5, "a@example.org"), reply(6, "b@example.org")], Sent: [], [ALLOW]: [] });
    s.copyResult = (uid) => (uid === 5 ? { ok: false, code: "protocol", detail: "[OVERQUOTA] voll" } : { ok: true });
    expect(await copyFollowUps(deps(s), FOLDERS)).toEqual({ copied: 1, errors: 1 });
    expect(s.copies()).toHaveLength(2);
  });

  it("zaehlt 'gone' (die UID ist inzwischen weg) nicht als Fehler", async () => {
    const s = new Server({ INBOX: [reply(5, "a@example.org")], Sent: [], [ALLOW]: [] });
    s.copyResult = () => ({ ok: false, code: "gone", detail: "weg" });
    expect(await copyFollowUps(deps(s), FOLDERS)).toEqual({ copied: 0, errors: 0 });
  });

  it("bricht bei einem Netzfehler mitten im Kopieren ab, zaehlt die uebrigen als Fehler und meldet sich ab", async () => {
    const s = new Server({ INBOX: [reply(5, "a@example.org"), reply(6, "b@example.org"), reply(7, "c@example.org")], Sent: [], [ALLOW]: [] });
    s.copyThrows = (uid) => uid === 6;
    expect(await copyFollowUps(deps(s), FOLDERS)).toEqual({ copied: 1, errors: 2 });
    expect(s.log.at(-1)).toBe("LOGOUT");
  });

  it("kopiert nichts und zaehlt Fehler, wenn sich die UIDVALIDITY zwischen Lesen und Schreiben aendert", async () => {
    const s = new Server({ INBOX: [reply(5, "a@example.org")], Sent: [], [ALLOW]: [] });
    const write = s.write.bind(s);
    s.write = () => { s.validity.set("INBOX", 8); return write(); };
    expect(await copyFollowUps(deps(s), FOLDERS)).toEqual({ copied: 0, errors: 1 });
    expect(s.copies()).toEqual([]);
  });
});

describe("copyFollowUps — wann nichts passiert", () => {
  it("oeffnet ohne Kandidaten keine schreibende Verbindung", async () => {
    const s = new Server({ INBOX: [{ uid: 6, id: "fremd@example.org" }], Sent: [], [ALLOW]: [] });
    expect(await copyFollowUps(deps(s), FOLDERS)).toEqual({ copied: 0, errors: 0 });
    expect(s.writeConnects).toBe(0);
  });

  it("laesst einen beendeten Vorgang aus", async () => {
    const s = new Server({ INBOX: [reply(5, "a@example.org")], Sent: [], [ALLOW]: [] });
    const r = await copyFollowUps(deps(s, { context: () => ({ index: vault, stopped: new Set(["wurzel@example.org"]) }) }), FOLDERS);
    expect(r).toEqual({ copied: 0, errors: 0 });
    expect(s.writeConnects).toBe(0);
  });

  it("kopiert keine Mail ohne Message-ID (Ersatz-ID noid-) und keine mit nicht suchbarer ID: sie liessen sich nicht auf Doppel pruefen", async () => {
    const s = new Server({
      INBOX: [reply(5, "x@example.org", { noHeaderId: true }), reply(7, "umlaut-ä@example.org")],
      Sent: [], [ALLOW]: [],
    });
    expect(await copyFollowUps(deps(s), FOLDERS)).toEqual({ copied: 0, errors: 0 });
    expect(s.writeConnects).toBe(0);
  });

  it("kopiert nicht aus dem Allowlist-Ordner in sich selbst, wenn er als Posteingang eingetragen ist", async () => {
    const s = new Server({ [ALLOW]: [reply(5, "a@example.org")], Sent: [] });
    expect(await copyFollowUps(deps(s), { inbox: ALLOW, sent: "Sent", allowlist: ALLOW })).toEqual({ copied: 0, errors: 0 });
    expect(s.writeConnects).toBe(0);
  });

  it("zaehlt einen fehlenden Allowlist-Ordner als Fehler, ohne zu schreiben", async () => {
    const s = new Server({ INBOX: [reply(5, "a@example.org")], Sent: [] });
    expect(await copyFollowUps(deps(s), FOLDERS)).toEqual({ copied: 0, errors: 1 });
    expect(s.writeConnects).toBe(0);
  });

  it("zaehlt eine gescheiterte lesende Verbindung als Fehler und schreibt nicht", async () => {
    const s = new Server({ INBOX: [reply(5, "a@example.org")], Sent: [], [ALLOW]: [] });
    const r = await copyFollowUps(deps(s, { connectRead: () => Promise.resolve({ ok: false, code: "auth", detail: "nein" }) }), FOLDERS);
    expect(r).toEqual({ copied: 0, errors: 1 });
    expect(s.writeConnects).toBe(0);
  });

  it("zaehlt eine gescheiterte schreibende Verbindung als einen Fehler", async () => {
    const s = new Server({ INBOX: [reply(5, "a@example.org")], Sent: [], [ALLOW]: [] });
    const r = await copyFollowUps(deps(s, { connectWrite: () => Promise.resolve({ ok: false, code: "timeout", detail: "zu langsam" }) }), FOLDERS);
    expect(r).toEqual({ copied: 0, errors: 1 });
  });

  it("zaehlt einen Netzfehler beim Lesen als Fehler (kein Wurf) und meldet die Lese-Sitzung ab", async () => {
    const s = new Server({ INBOX: [reply(5, "a@example.org")], Sent: [], [ALLOW]: [] });
    const lesen = s.read.bind(s);
    s.read = async () => {
      const r = await lesen();
      if (r.ok) (r.session as unknown as { uidSearchSince: () => Promise<number[]> }).uidSearchSince = () => Promise.reject(new NetError("timeout", "zu langsam"));
      return r;
    };
    const r = await copyFollowUps(deps(s), FOLDERS);
    expect(r).toEqual({ copied: 0, errors: 1 });
    expect(s.log).toContain("LOGOUT");
    expect(s.writeConnects).toBe(0);
  });
});
