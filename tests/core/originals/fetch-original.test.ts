import { describe, it, expect, vi } from "vitest";
import { fetchOriginal, MAX_CANDIDATES_PER_FOLDER, type FetchOriginalDeps, type OriginalAccount } from "../../../src/core/originals/fetch-original";
import { createBusyGuard } from "../../../src/vendor/code-kit/busy-guard";
import type { ImapReadSession } from "../../../src/core/imap/client";
import { NetError } from "../../../src/core/net/types";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s.replace(/\n/g, "\r\n"));
const mailBytes = (id: string): Uint8Array =>
  enc(`From: a@example.org\nTo: b@example.org\nSubject: Betreff\nDate: Tue, 19 Aug 2026 16:00:00 +0200\nMessage-ID: <${id}>\nMIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\n\nText\n`);

const accA: OriginalAccount = { id: "a", label: "Konto A", folders: { allowlist: "Vault", archive: "Archiv" } };
const accB: OriginalAccount = { id: "b", label: "Konto B", folders: { allowlist: "Vault", archive: "" } };

interface Server { folders: Record<string, { uid: number; bytes: Uint8Array }[]> }

/** Eine Fake-Sitzung ueber einem festen Ordnerinhalt; Suche = Teilstring auf der Message-ID der Bytes. */
function fakeSession(server: Server, calls: string[] = []): ImapReadSession {
  let offen = "";
  return {
    capabilities: [],
    examine: vi.fn(async (m: string) => {
      calls.push(`EXAMINE ${m}`);
      if (!(m in server.folders)) return { ok: false as const, code: "folder-missing" as const, detail: "no" };
      offen = m;
      return { ok: true as const, uidValidity: 1, exists: 0 };
    }),
    uidSearchHeader: vi.fn(async (f: string, v: string) => {
      calls.push(`SEARCH ${f} ${v}`);
      return (server.folders[offen] ?? []).filter((m) => new TextDecoder().decode(m.bytes).toLowerCase().includes(v.toLowerCase())).map((m) => m.uid);
    }),
    uidFetchBody: vi.fn(async (uid: number) => {
      calls.push(`FETCH ${uid}`);
      return (server.folders[offen] ?? []).find((m) => m.uid === uid)?.bytes ?? null;
    }),
    logout: vi.fn(async () => undefined),
  } as unknown as ImapReadSession;
}

function deps(servers: Record<string, Server>, accounts: OriginalAccount[], calls: string[] = []): FetchOriginalDeps & { sessions: ImapReadSession[] } {
  const sessions: ImapReadSession[] = [];
  return {
    accounts: () => accounts,
    connect: async (acc) => {
      calls.push(`CONNECT ${acc.id}`);
      const server = servers[acc.id];
      if (!server) return { ok: false, code: "connect", detail: "down" };
      const s = fakeSession(server, calls);
      sessions.push(s);
      return { ok: true, session: s };
    },
    busy: createBusyGuard(),
    sessions,
  };
}

describe("fetchOriginal", () => {
  it("sucht beim Konto aus mail_source zuerst im Ordner aus mail_source und liefert die Bytes", async () => {
    const calls: string[] = [];
    const bytes = mailBytes("gesucht@example.org");
    const d = deps({ a: { folders: { Vault: [], Archiv: [], Sonst: [{ uid: 4, bytes }] } }, b: { folders: { Vault: [] } } }, [accA, accB], calls);
    const r = await fetchOriginal(d, { mailId: "gesucht@example.org", source: "a/Sonst" });
    expect(r).toEqual({ ok: true, bytes });
    expect(calls.filter((c) => c.startsWith("CONNECT"))).toEqual(["CONNECT a"]);
    expect(calls.filter((c) => c.startsWith("EXAMINE"))).toEqual(["EXAMINE Sonst"]);
    expect(calls).toContain("SEARCH Message-ID gesucht@example.org");
  });

  it("Ordnerfolge: Quellordner, Allowlist, Archiv; leere und doppelte entfallen", async () => {
    const calls: string[] = [];
    const d = deps({ a: { folders: { Vault: [], Archiv: [] } } }, [accA], calls);
    const r = await fetchOriginal(d, { mailId: "x@example.org", source: "a/Vault" });
    expect(r).toMatchObject({ ok: false, code: "original-not-found" });
    expect(calls.filter((c) => c.startsWith("EXAMINE"))).toEqual(["EXAMINE Vault", "EXAMINE Archiv"]);
    const calls2: string[] = [];
    const d2 = deps({ b: { folders: { Vault: [] } } }, [accB], calls2);
    await fetchOriginal(d2, { mailId: "x@example.org", source: "b/INBOX2" });
    expect(calls2.filter((c) => c.startsWith("EXAMINE"))).toEqual(["EXAMINE INBOX2", "EXAMINE Vault"]);
  });

  it("source import/<ordner> durchsucht alle Konten nacheinander, jeweils Allowlist und Archiv", async () => {
    const calls: string[] = [];
    const bytes = mailBytes("im-b@example.org");
    const d = deps({ a: { folders: { Vault: [], Archiv: [] } }, b: { folders: { Vault: [{ uid: 2, bytes }] } } }, [accA, accB], calls);
    const r = await fetchOriginal(d, { mailId: "im-b@example.org", source: "import/Import" });
    expect(r).toEqual({ ok: true, bytes });
    expect(calls.filter((c) => c.startsWith("CONNECT"))).toEqual(["CONNECT a", "CONNECT b"]);
    // Der Importordner ist ein Vault-Ordner, kein Serverordner: er wird nie gesucht.
    expect(calls.some((c) => c.includes("Import"))).toBe(false);
  });

  it("leere oder unbekannte source: alle Konten", async () => {
    for (const source of ["", "gibtsnicht/INBOX"]) {
      const calls: string[] = [];
      const d = deps({ a: { folders: { Vault: [], Archiv: [] } }, b: { folders: { Vault: [] } } }, [accA, accB], calls);
      await fetchOriginal(d, { mailId: "x@example.org", source });
      expect(calls.filter((c) => c.startsWith("CONNECT")), source).toEqual(["CONNECT a", "CONNECT b"]);
    }
  });

  it("verwirft einen Treffer mit falscher Message-ID (Teilstring-Suche) und nimmt den echten", async () => {
    const falsch = mailBytes("xgesucht@example.org");
    const richtig = mailBytes("gesucht@example.org");
    const d = deps({ a: { folders: { Vault: [{ uid: 1, bytes: falsch }, { uid: 2, bytes: richtig }], Archiv: [] } } }, [accA]);
    expect(await fetchOriginal(d, { mailId: "gesucht@example.org", source: "a/Vault" })).toEqual({ ok: true, bytes: richtig });
    const nur = deps({ a: { folders: { Vault: [{ uid: 1, bytes: falsch }], Archiv: [] } } }, [accA]);
    expect(await fetchOriginal(nur, { mailId: "gesucht@example.org", source: "a/Vault" })).toMatchObject({ ok: false, code: "original-not-found" });
  });

  it("holt je Ordner hoechstens fuenf Kandidaten", async () => {
    const calls: string[] = [];
    const falsch = Array.from({ length: 9 }, (_, i) => ({ uid: i + 1, bytes: mailBytes(`xgesucht${i}@example.org`) }));
    // Alle enthalten den Suchwert als Teilstring, keiner ist die gesuchte Mail.
    const viele = falsch.map((m, i) => ({ uid: m.uid, bytes: mailBytes(`gesucht@example.org.${i}`) }));
    const d = deps({ a: { folders: { Vault: viele, Archiv: [] } } }, [accA], calls);
    await fetchOriginal(d, { mailId: "gesucht@example.org", source: "a/Vault" });
    expect(calls.filter((c) => c.startsWith("FETCH"))).toHaveLength(MAX_CANDIDATES_PER_FOLDER);
  });

  it("not-found nennt die durchsuchten Ordner", async () => {
    const d = deps({ a: { folders: { Vault: [], Archiv: [] } } }, [accA]);
    const r = await fetchOriginal(d, { mailId: "x@example.org", source: "a/Vault" });
    expect(r).toMatchObject({ ok: false, code: "original-not-found" });
    if (r.ok) throw new Error("unreachable");
    expect(r.detail).toBe("Konto A: Vault, Konto A: Archiv");
  });

  it("ein fehlender Ordner zaehlt nicht als durchsucht und ist kein Fehler", async () => {
    const d = deps({ a: { folders: { Vault: [] } } }, [accA]);
    const r = await fetchOriginal(d, { mailId: "x@example.org", source: "a/Vault" });
    expect(r).toMatchObject({ ok: false, code: "original-not-found", detail: "Konto A: Vault" });
  });

  it("Nicht-ASCII, noid- und leere ID: eigener Code, kein Kommando, keine Verbindung", async () => {
    for (const id of ["müller@example.org", "noid-0123456789abcdef", ""]) {
      const calls: string[] = [];
      const d = deps({ a: { folders: { Vault: [] } } }, [accA], calls);
      const r = await fetchOriginal(d, { mailId: id, source: "a/Vault" });
      expect(r, id).toMatchObject({ ok: false, code: "original-unsearchable" });
      expect(calls, id).toEqual([]);
    }
  });

  it("Netzfehler behalten ihren Code und gehen vor not-found; ein anderes Konto kann trotzdem finden", async () => {
    const d = deps({ b: { folders: { Vault: [] } } }, [accA, accB]); // Konto A: connect schlaegt fehl
    expect(await fetchOriginal(d, { mailId: "x@example.org", source: "import/X" })).toMatchObject({ ok: false, code: "connect", detail: "down" });
    const bytes = mailBytes("x@example.org");
    const d2 = deps({ b: { folders: { Vault: [{ uid: 1, bytes }] } } }, [accA, accB]);
    expect(await fetchOriginal(d2, { mailId: "x@example.org", source: "import/X" })).toEqual({ ok: true, bytes });
  });

  it("ein werfender NetError mitten in der Sitzung behaelt seinen Code", async () => {
    const d = deps({ a: { folders: { Vault: [] } } }, [accA]);
    const connect = d.connect;
    d.connect = async (acc) => {
      const r = await connect(acc);
      if (r.ok) (r.session.uidSearchHeader as ReturnType<typeof vi.fn>).mockRejectedValue(new NetError("timeout", "zu langsam"));
      return r;
    };
    expect(await fetchOriginal(d, { mailId: "x@example.org", source: "a/Vault" })).toMatchObject({ ok: false, code: "timeout", detail: "zu langsam" });
  });

  it("loggt aus und gibt den Guard frei, auch beim Treffer", async () => {
    const bytes = mailBytes("x@example.org");
    const d = deps({ a: { folders: { Vault: [{ uid: 1, bytes }] } } }, [accA]);
    await fetchOriginal(d, { mailId: "x@example.org", source: "a/Vault" });
    expect(d.sessions[0]!.logout).toHaveBeenCalled();
    expect(d.busy.isBusy()).toBe(false);
  });

  it("belegt den Guard wie fetch.ts: belegt ergibt busy, ohne Verbindung", async () => {
    const calls: string[] = [];
    const d = deps({ a: { folders: { Vault: [] } } }, [accA], calls);
    d.busy.tryAcquire();
    expect(await fetchOriginal(d, { mailId: "x@example.org", source: "a/Vault" })).toMatchObject({ ok: false, code: "busy" });
    expect(calls).toEqual([]);
  });

  it("liest nur: kein select, kein BODY[] (nur uidFetchBody = BODY.PEEK[])", async () => {
    const d = deps({ a: { folders: { Vault: [] } } }, [accA]);
    await fetchOriginal(d, { mailId: "x@example.org", source: "a/Vault" });
    expect((d.sessions[0] as unknown as Record<string, unknown>).select).toBeUndefined();
  });
});
