// Integrationstest fuer M3 Task 9: faehrt den echten Node-Socket-Transport (kein Fake-Transport)
// gegen den ebenfalls echten scripts/fake-imap.mjs als Kindprozess. Bewusst NICHT Teil von
// `npm test` (ausgeschlossen ueber --exclude tests/integration/**, s. package.json) — ein echter
// TCP-Verbindungsaufbau + Kindprozess-Start ist langsamer/flakiger als der Rest der Suite und
// gehoert deshalb in `npm run test:integration`. Platform.isDesktop kommt aus dem vitest-Mock
// (tests/vendor/kit/obsidian-mock.ts: Platform.isDesktop === true per Default), deshalb ist
// nodeSocketTransport() hier direkt nutzbar.
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { join } from "node:path";
import type { Readable } from "node:stream";

type FakeImapChild = ChildProcessByStdio<null, Readable, Readable>;
import { imapConnect, imapConnectWritable } from "../../src/core/imap/client";
import { adoptMessage } from "../../src/core/inbox/actions";
import { fetchOriginal, type OriginalAccount } from "../../src/core/originals/fetch-original";
import { runFollowUps } from "../../src/core/thread/follow-run";
import { groupThreads } from "../../src/core/thread/group";
import { createSyncService } from "../../src/core/sync/service";
import { createBusyGuard } from "../../src/vendor/code-kit/busy-guard";
import { createEmitter } from "../../src/core/sync/events";
import { createUidCache } from "../../src/core/sync/uid-cache";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { nodeSocketTransport } from "../../src/obsidian/tls-transport";
import { newAccount } from "../../src/core/settings";
import { testTimers } from "../helpers/timers";
import type { NotePlan } from "../../src/core/mirror/plan";

const PORT = Number(process.env.FAKE_IMAP_TEST_PORT ?? 11143);

// Das stdout des Kindprozesses wird DURCHGEHEND mitgeschnitten, nicht nur bis zur
// Bereitschaftsmeldung: der Fake protokolliert dorthin jede empfangene Kommandozeile, und der
// Vertragstest unten liest genau das. Zweiter Grund, unabhaengig vom Test: ein Kindprozess mit
// unbeachteter Pipe blockiert, sobald deren Puffer voll ist.
function collectStdout(child: FakeImapChild): { text: () => string; ready: Promise<void> } {
  let out = "";
  child.stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString("utf8");
  });
  const ready = new Promise<void>((resolve, reject) => {
    const check = (): void => {
      if (out.includes("listening on")) {
        child.stdout.off("data", check);
        resolve();
      }
    };
    child.stdout.on("data", check);
    check();
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`fake-imap.mjs exited early mit code ${String(code)}: ${out}`));
    });
  });
  return { text: () => out, ready };
}

describe("SyncService gegen scripts/fake-imap.mjs (echter Socket, echter Kindprozess)", () => {
  let child: FakeImapChild | undefined;
  let protokoll: () => string = () => "";

  afterEach(() => {
    child?.kill();
    child = undefined;
    protokoll = () => "";
  });

  async function starteServer(): Promise<void> {
    child = spawn(process.execPath, [join(process.cwd(), "scripts/fake-imap.mjs")], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const mitschnitt = collectStdout(child);
    protokoll = mitschnitt.text;
    await mitschnitt.ready;
  }

  /** Wartet, bis eine Kommandozeile im Protokoll steht. Das stdout des Kindprozesses laeuft
   *  ueber eine Pipe und trifft damit NACH der Antwort ein, auf die der Client wartet — ohne
   *  dieses Warten liest der Test das Protokoll leer und meldet den Vertrag als gebrochen,
   *  obwohl er gehalten wurde (2026-09-03 genau so passiert). */
  async function warteAufKommando(muster: RegExp, ms = 5000): Promise<void> {
    const ende = Date.now() + ms;
    while (Date.now() < ende) {
      if (kommandos().some((z) => muster.test(z))) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Kommando ${muster.source} blieb aus. Protokoll:\n${kommandos().join("\n")}`);
  }

  /** Die Kommandos, die der Server empfangen hat — ohne Bereitschaftsmeldung und ohne den
   *  IMAP-Tag ("a003 SELECT …" -> "SELECT …"), damit die Muster unten am Kommando ansetzen. */
  function kommandos(): string[] {
    return protokoll()
      .split("\n")
      .filter((l) => l.includes("[fake-imap] < "))
      .map((l) => l.slice(l.indexOf("< ") + 2).trim())
      .map((l) => l.slice(l.indexOf(" ") + 1));
  }

  function verbindungsOptionen(): Parameters<typeof imapConnect>[1] {
    return {
      host: "127.0.0.1",
      port: PORT,
      tls: "none",
      username: "u@example.net",
      password: "geheim",
      timers: testTimers,
      allowInsecureAuth: true,
    };
  }

  function service(): { lauf: () => Promise<unknown>; seen: NotePlan[] } {
    const account = newAccount("acc");
    // Account["imap"]["tls"] ist bewusst auf "implicit"|"starttls" beschraenkt (die Settings-UI
    // bietet unverschluesselt nie an) — der Fake-Server spricht aber kein TLS. Cast im Testcode
    // statt Aufweichen des Settings-Typs, dieselbe Konstruktion wie smtp.tls==="none" in M2.
    account.imap = { host: "127.0.0.1", port: PORT, tls: "none" as never };
    account.username = "u@example.net";

    const seen: NotePlan[] = [];
    const svc = createSyncService({
      accounts: () => [account],
      profile: () => defaultMailProfile(),
      secret: () => "geheim",
      transport: () => nodeSocketTransport(),
      index: () => new Map(),
      takenPaths: () => new Set<string>(),
      executor: () => ({
        execute: (plans) => {
          seen.push(...plans);
          return Promise.resolve({ created: plans.length, updated: 0, stateChanged: 0, skipped: [], errors: [] });
        },
      }),
      uidCache: createUidCache(undefined),
      busy: createBusyGuard(),
      events: createEmitter(),
      timers: testTimers,
      now: () => new Date(),
    });
    return { lauf: () => svc.syncAccount("acc"), seen };
  }

  it("legt ueber den echten Socket drei Notizen an und meldet sie als created", async () => {
    await starteServer();
    const { lauf, seen } = service();
    expect(await lauf()).toMatchObject({ ok: true, counts: { created: 3 } });
    expect(seen.map((p) => p.mailId).sort()).toEqual(["drei@example.net", "eins@example.net", "zwei@example.net"]);
  });

  // M3-Nachlese, Abdeckungsluecke: IMAP-Literale kuendigen ihre Laenge in BYTES an, nicht in
  // Zeichen. Dass der Client das richtig liest, war bis 2026-08-30 nur per Codelektuere belegt —
  // ueber einen echten Socket lief bis dahin ausschliesslich reines ASCII, wo beide Laengen
  // zusammenfallen. Die dritte Fixture-Mail trennt sie um 12 Bytes (Umlaute, Gedankenstrich,
  // Emoji). Zaehlte der Client Zeichen, bliebe der Rest des Literals im Strom stehen: die Antwort
  // desynchronisiert, und die Pruefung oben verlaengert sich um die verlorenen Mails.
  it("liest ein Literal mit Nicht-ASCII byte-genau und gibt den Text unveraendert weiter", async () => {
    await starteServer();
    const { lauf, seen } = service();
    await lauf();

    const drei = seen.find((p) => p.mailId === "drei@example.net");
    expect(drei?.kind).toBe("create");
    if (drei?.kind !== "create") throw new Error("unreachable");
    expect(drei.content).toContain("Grüße aus München");
    expect(drei.content).toContain("Äpfel, Öl, Füße");
    expect(drei.content).toContain("🚀");
    // Die .eml-Beilage ist die Treueflaeche: sie muss die BYTES tragen, nicht die Zeichen.
    expect(drei.eml.byteLength).toBeGreaterThan(new TextDecoder().decode(drei.eml).length);
    expect(new TextDecoder().decode(drei.eml)).toContain("Grüße aus München");
  });

  // AGENTS.md § "Ein Sync-Lauf darf \Seen nie setzen": eine gespiegelte Mail muss im
  // Mailprogramm ungelesen aussehen, weil im Ordner `Belege` ein anderer Abholer ueber genau
  // dieses "ungelesen" gesteuert wird. Bis M4 war das eine Konvention, seither halb ein Typ —
  // `SELECT` steht dem Sync nicht zur Verfuegung. Die zweite Haelfte, `BODY.PEEK[` statt
  // `BODY[`, bewacht kein Compiler.
  //
  // Geprueft wird deshalb der KOMMANDOTEXT auf der Leitung, nicht die Flag-Wirkung: ein
  // RFC-treuer Server setzt im EXAMINE-Modus ohnehin keine Flags (RFC 3501 § 6.3.2), ein
  // \Seen-Vergleich bliebe hier also auch dann gruen, wenn der Client `BODY[` schriebe — er
  // wuerde die Zusage messen, die der SERVER einhaelt, statt der, die dieses Plugin gibt.
  // Gegenproben (2026-09-03, jede einzeln gefahren): `BODY.PEEK[]` -> `BODY[]` in uidFetchBody
  // macht ihn rot, ebenso `BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]` -> `BODY[...]`.
  //
  // Was er den Unit-Tests VORAUS hat, gemessen statt behauptet: die erste Mutation faellt auch
  // in `npm test` auf (11 rote Tests) — die Unit-Tests pinnen den Kommandotext je Aufruf. Sie
  // pinnen aber nur die Aufrufe, die es HEUTE gibt. Dieser Test misst stattdessen den ganzen
  // Dialog eines echten Sync-Laufs auf ABWESENHEIT: ein neuer, ungetesteter Aufrufpfad mit
  // `SELECT` oder `BODY[` faellt hier auf, ohne dass jemand einen Test dafuer geschrieben haben
  // muss. Das ist der Unterschied zwischen "jede bekannte Zeile ist richtig" und "auf der
  // Leitung stand nichts Verbotenes".
  it("faehrt den Sync nur lesend: EXAMINE und BODY.PEEK, kein SELECT, kein BODY[]", async () => {
    await starteServer();
    const { lauf } = service();
    expect(await lauf()).toMatchObject({ ok: true });
    await warteAufKommando(/^LOGOUT$/i);

    const zeilen = kommandos();
    expect(zeilen.filter((z) => /^EXAMINE\b/i.test(z))).toHaveLength(1);
    // Zwei Sorten PEEK: die Message-ID-Runde und je ein Body-Abruf pro Mail.
    expect(zeilen.filter((z) => z.toUpperCase().includes("BODY.PEEK[")).length).toBeGreaterThanOrEqual(2);
    expect(zeilen.filter((z) => /\bSELECT\b/i.test(z))).toEqual([]);
    expect(zeilen.filter((z) => /BODY\[/i.test(z))).toEqual([]);
    // Das Protokoll selbst darf keine Zugangsdaten tragen — der Fake maskiert wie client.ts.
    expect(zeilen.some((z) => z.includes("geheim"))).toBe(false);
    expect(zeilen.some((z) => /^AUTHENTICATE \*+$/i.test(z))).toBe(true);
  });

  // A6 (Welle 36): das Original einer Mail per Message-ID holen. Auch dieser Weg liest nur: der
  // ganze Dialog traegt EXAMINE, UID SEARCH HEADER und BODY.PEEK[], nie SELECT und nie BODY[.
  it("holt ein Original per UID SEARCH HEADER ueber den echten Socket, nur lesend", async () => {
    await starteServer();
    const konto: OriginalAccount = { id: "acc", label: "Testkonto", folders: { allowlist: "INBOX", archive: "" } };
    const bytes = await fetchOriginal(
      {
        accounts: () => [konto],
        connect: (a) => imapConnect(nodeSocketTransport(), { ...verbindungsOptionen(), username: a.id }),
        busy: createBusyGuard(),
      },
      { mailId: "zwei@example.net", source: "acc/INBOX" },
    );
    expect(bytes.ok).toBe(true);
    if (!bytes.ok) throw new Error("unreachable");
    expect(new TextDecoder().decode(bytes.bytes)).toContain("Subject: Zweite Testmail");
    await warteAufKommando(/^LOGOUT$/i);

    const zeilen = kommandos();
    expect(zeilen.filter((z) => /^EXAMINE\b/i.test(z))).toHaveLength(1);
    expect(zeilen).toContain('UID SEARCH HEADER Message-ID "zwei@example.net"');
    expect(zeilen.filter((z) => /^UID FETCH \d+ \(BODY\.PEEK\[\]\)$/i.test(z))).toHaveLength(1);
    expect(zeilen.filter((z) => /\bSELECT\b/i.test(z))).toEqual([]);
    expect(zeilen.filter((z) => /BODY\[/i.test(z))).toEqual([]);
  });

  it("meldet eine unbekannte Message-ID als nicht gefunden, ohne Fetch", async () => {
    await starteServer();
    const konto: OriginalAccount = { id: "acc", label: "Testkonto", folders: { allowlist: "INBOX", archive: "" } };
    const r = await fetchOriginal(
      { accounts: () => [konto], connect: () => imapConnect(nodeSocketTransport(), verbindungsOptionen()), busy: createBusyGuard() },
      { mailId: "gibtsnicht@example.net", source: "acc/INBOX" },
    );
    expect(r).toMatchObject({ ok: false, code: "original-not-found", detail: "Testkonto: INBOX" });
    await warteAufKommando(/^LOGOUT$/i);
    expect(kommandos().filter((z) => /^UID FETCH/i.test(z))).toEqual([]);
  });

  // A1 (Welle 36): der Fake kennt jetzt Ordner (`Sent` hat eine eigene Liste) und `UID SEARCH SINCE`.
  it("liest den Ordner Sent mit eigener Liste: SINCE schneidet die alte Mail ab, der Kopf traegt In-Reply-To", async () => {
    await starteServer();
    const r = await imapConnect(nodeSocketTransport(), verbindungsOptionen());
    if (!r.ok) throw new Error("unreachable");
    try {
      expect(await r.session.examine("Sent")).toMatchObject({ ok: true, exists: 3 });
      expect(await r.session.uidSearchAll()).toEqual([3, 4, 5]);
      expect(await r.session.uidSearchSince(new Date(Date.UTC(2026, 6, 12)))).toEqual([3, 5]);
      const koepfe = await r.session.uidFetchThreadHeaders([3, 5]);
      expect(new TextDecoder().decode(koepfe.get(3)!)).toContain("In-Reply-To: <eins@example.net>");
      expect((await r.session.examine("Leer"))).toMatchObject({ ok: true, exists: 0 });
      expect(await r.session.uidSearchSince(new Date(Date.UTC(2026, 6, 12)))).toEqual([]);
    } finally {
      await r.session.logout();
    }
    await warteAufKommando(/^LOGOUT$/i);
    const zeilen = kommandos();
    expect(zeilen).toContain("UID SEARCH SINCE 12-Jul-2026");
    expect(zeilen.filter((z) => /\bSELECT\b/i.test(z))).toEqual([]);
    expect(zeilen.filter((z) => /BODY\[/i.test(z))).toEqual([]);
    expect(zeilen.filter((z) => /\b(COPY|STORE|MOVE)\b/i.test(z))).toEqual([]);
  });

  // A1 (Welle 36): „Folge-Mails anzeigen“ ueber einen ganzen Lauf gegen INBOX und Sent. Der Vault kennt nur die
  // Mail `eins` (Wurzel); gefunden werden die Antworten darauf in beiden Ordnern, nicht die Mail mit Notiz, nicht die
  // zu alte (faellt aus SEARCH SINCE), nicht die ohne Bezug. Der Dialog bleibt lesend.
  it("findet Folge-Mails in INBOX und Sent, nur lesend: kein SELECT, kein BODY[, kein COPY, STORE oder MOVE", async () => {
    await starteServer();
    const vault = groupThreads([{ mailId: "eins@example.net", path: "Mail/eins", date: "2026-08-29", time: "08:00", inReplyTo: [], references: [] }]);
    const r = await runFollowUps({
      accounts: () => [{ id: "acc", label: "Testkonto", folders: { inbox: "INBOX", sent: "Sent" } }],
      connect: () => imapConnect(nodeSocketTransport(), verbindungsOptionen()),
      busy: createBusyGuard(),
      context: () => ({ index: vault, stopped: new Set<string>() }),
      now: () => new Date(Date.UTC(2026, 8, 10)),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.problems).toEqual([]);
    expect(r.items.map((i) => [i.folder, i.uid, i.mailId, i.root, i.subject])).toEqual([
      ["INBOX", 9, "zwei@example.net", "eins@example.net", "Zweite Testmail"],
      ["Sent", 3, "antwort-eins@example.net", "eins@example.net", "Re: Erste Testmail"],
    ]);
    await warteAufKommando(/^LOGOUT$/i);

    const zeilen = kommandos();
    expect(zeilen.filter((z) => /^EXAMINE\b/i.test(z))).toHaveLength(2);
    expect(zeilen.filter((z) => /^UID SEARCH SINCE 12-Jul-2026$/i.test(z))).toHaveLength(2);
    expect(zeilen.filter((z) => /^UID FETCH .*BODY\.PEEK\[HEADER\.FIELDS \(FROM SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES\)\]/i.test(z))).toHaveLength(2);
    expect(zeilen.filter((z) => /\bSELECT\b/i.test(z))).toEqual([]);
    expect(zeilen.filter((z) => /BODY\[/i.test(z))).toEqual([]);
    expect(zeilen.filter((z) => /\b(COPY|STORE|MOVE|APPEND|EXPUNGE)\b/i.test(z))).toEqual([]);
  });

  it("laesst einen beendeten Vorgang auch ueber den echten Socket aus", async () => {
    await starteServer();
    const vault = groupThreads([{ mailId: "eins@example.net", path: "Mail/eins", date: "2026-08-29", time: "08:00", inReplyTo: [], references: [] }]);
    const r = await runFollowUps({
      accounts: () => [{ id: "acc", label: "Testkonto", folders: { inbox: "INBOX", sent: "Sent" } }],
      connect: () => imapConnect(nodeSocketTransport(), verbindungsOptionen()),
      busy: createBusyGuard(),
      context: () => ({ index: vault, stopped: new Set(["eins@example.net"]) }),
      now: () => new Date(Date.UTC(2026, 8, 10)),
    });
    expect(r).toMatchObject({ ok: true, items: [], problems: [] });
  });

  // A1 (Welle 36, Uebernahme; Entscheidung Johannes 2026-11-18): Vorgang-Folgen kopiert Folge-Mails per UID COPY in den
  // Allowlist-Ordner (`Ziel`). Der Vault kennt nur die Wurzel `eins`; Folge-Mails sind `zwei` (INBOX) und `antwort-eins`
  // (Sent). Das Index-Verzeichnis waechst mit jedem Lauf wie im Plugin: Notizen entstehen im selben Lauf, der Vorgang im
  // Vault (die Wurzel) bleibt aber derselbe, damit der zweite Lauf die Folge-Mails wieder FINDET und nur der Abgleich
  // gegen den Allowlist-Ordner die Doppelkopie verhindert.
  function folgeService(opts: { an: boolean; allowlist?: string; stopped?: string[] }) {
    const account = newAccount("acc");
    account.imap = { host: "127.0.0.1", port: PORT, tls: "none" as never };
    account.username = "u@example.net";
    account.folders.allowlist = opts.allowlist ?? "Ziel";
    account.sync.followThreads = opts.an;
    const angelegt = new Map<string, { path: string; state: "live"; source: string }>();
    const plaene: NotePlan[] = [];
    let contextAufrufe = 0;
    const vault = groupThreads([{ mailId: "eins@example.net", path: "Mail/eins", date: "2026-08-29", time: "08:00", inReplyTo: [], references: [] }]);
    const svc = createSyncService({
      accounts: () => [account],
      profile: () => defaultMailProfile(),
      secret: () => "geheim",
      transport: () => nodeSocketTransport(),
      index: () => angelegt,
      takenPaths: () => new Set<string>(),
      executor: () => ({
        execute: (ps) => {
          plaene.push(...ps);
          for (const p of ps) if (p.kind === "create") angelegt.set(p.mailId, { path: p.path, state: "live", source: `acc/${account.folders.allowlist}` });
          return Promise.resolve({ created: ps.filter((p) => p.kind === "create").length, updated: 0, stateChanged: 0, skipped: [], errors: [] });
        },
      }),
      uidCache: createUidCache(undefined),
      busy: createBusyGuard(),
      events: createEmitter(),
      timers: testTimers,
      now: () => new Date(Date.UTC(2026, 8, 10)),
      follow: { context: () => { contextAufrufe += 1; return { index: vault, stopped: new Set(opts.stopped ?? []) }; } },
    });
    return { lauf: () => svc.syncAccount("acc"), plaene, contextAufrufe: () => contextAufrufe };
  }

  /** Wartet, bis das Protokoll `n` passende Zeilen hat (jede Verbindung endet mit einem LOGOUT, das erst nach der Antwort ankommt). */
  async function warteAufAnzahl(muster: RegExp, n: number, ms = 5000): Promise<void> {
    const ende = Date.now() + ms;
    while (Date.now() < ende) {
      if (kommandos().filter((z) => muster.test(z)).length >= n) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`${String(n)}x ${muster.source} blieb aus. Protokoll:\n${kommandos().join("\n")}`);
  }

  it("kopiert mit eingeschaltetem Folgen die Folge-Mails aus INBOX und Sent in den Allowlist-Ordner, die Notizen entstehen im selben Lauf, ein zweiter Lauf kopiert nichts doppelt", async () => {
    await starteServer();
    const { lauf, plaene } = folgeService({ an: true });

    expect(await lauf()).toMatchObject({ ok: true, counts: { created: 3, errors: 0 } });
    // Im Ziel lag `vorhanden`; dazu kamen die beiden Kopien, und alle drei sind im selben Lauf Notizen geworden.
    expect(plaene.map((p) => p.mailId).sort()).toEqual(["antwort-eins@example.net", "vorhanden@example.net", "zwei@example.net"]);
    await warteAufAnzahl(/^LOGOUT$/i, 3); // Lesen, Schreiben, Sync
    const erste = kommandos();
    expect(erste.filter((z) => /^UID COPY\b/i.test(z)).sort()).toEqual(['UID COPY 3 "Ziel"', 'UID COPY 9 "Ziel"']);

    expect(await lauf()).toMatchObject({ ok: true, counts: { created: 0, errors: 0 } });
    await warteAufAnzahl(/^LOGOUT$/i, 5); // dazu Lesen und Sync (keine schreibende Verbindung)
    const alle = kommandos();
    expect(alle.filter((z) => /^UID COPY\b/i.test(z))).toHaveLength(2);
    expect(alle.filter((z) => /^AUTHENTICATE\b/i.test(z))).toHaveLength(5);

    // Der Dialog beider Laeufe: nichts ausser Lesen und COPY. Kein SELECT (COPY wirkt nach EXAMINE), kein STORE/EXPUNGE/MOVE/APPEND,
    // kein BODY[ ohne PEEK.
    expect(alle.filter((z) => /\bSELECT\b/i.test(z))).toEqual([]);
    expect(alle.filter((z) => /\b(STORE|EXPUNGE|MOVE|APPEND)\b/i.test(z))).toEqual([]);
    expect(alle.filter((z) => /BODY\[/i.test(z))).toEqual([]);
    expect(alle.some((z) => z.includes("geheim"))).toBe(false);
  });

  it("laesst die Quelle unberuehrt: nach dem Kopieren liegt die Mail weiter in INBOX und Sent, ungelesen bleibt ungelesen", async () => {
    await starteServer();
    await folgeService({ an: true }).lauf();
    const lesend = await imapConnect(nodeSocketTransport(), verbindungsOptionen());
    if (!lesend.ok) throw new Error("unreachable");
    try {
      expect(await lesend.session.examine("INBOX")).toMatchObject({ ok: true, exists: 3 });
      expect((await lesend.session.uidFetchHeaders([9])).get(9)?.flags).toEqual([]); // \Seen war nie gesetzt
      expect(await lesend.session.examine("Sent")).toMatchObject({ ok: true, exists: 3 });
      expect(await lesend.session.examine("Ziel")).toMatchObject({ ok: true, exists: 3 });
    } finally {
      await lesend.session.logout();
    }
  });

  it("ausgeschaltet (Standard): keine zweite Verbindung, kein COPY, kein Zugriff auf die Vorgaenge", async () => {
    await starteServer();
    const { lauf, contextAufrufe } = folgeService({ an: false });
    expect(await lauf()).toMatchObject({ ok: true, counts: { created: 1 } });
    await warteAufAnzahl(/^LOGOUT$/i, 1);
    const zeilen = kommandos();
    expect(zeilen.filter((z) => /^AUTHENTICATE\b/i.test(z))).toHaveLength(1);
    expect(zeilen.filter((z) => /\bCOPY\b/i.test(z))).toEqual([]);
    expect(contextAufrufe()).toBe(0);
  });

  it("kopiert einen beendeten Vorgang nicht", async () => {
    await starteServer();
    const { lauf } = folgeService({ an: true, stopped: ["eins@example.net"] });
    expect(await lauf()).toMatchObject({ ok: true, counts: { created: 1, errors: 0 } });
    await warteAufAnzahl(/^LOGOUT$/i, 2); // Lesen, Sync
    expect(kommandos().filter((z) => /\bCOPY\b/i.test(z))).toEqual([]);
  });

  it("zaehlt ein vom Server abgelehntes COPY als Fehler, ohne den Lauf anzuhalten", async () => {
    await starteServer();
    // Ein Kopierziel, das der Server mit NO ablehnt (`Voll`, [OVERQUOTA]): der Lauf laeuft weiter, die Fehler stehen im Zaehler.
    const { lauf } = folgeService({ an: true, allowlist: "Voll" });
    const r = await lauf();
    // `Voll` gibt es als Ordner fuer EXAMINE (der Fake liefert die gemeinsame Liste), COPY dorthin lehnt er ab.
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error("unreachable");
    expect(r.counts.errors).toBeGreaterThanOrEqual(1);
    await warteAufAnzahl(/^LOGOUT$/i, 3);
    expect(kommandos().filter((z) => /^UID COPY\b/i.test(z)).length).toBeGreaterThanOrEqual(1);
  });

  // Die andere Haelfte des Vertrags, und zugleich der erste Test, der den SCHREIBENDEN Pfad
  // ueber einen echten Socket faehrt: `scripts/fake-imap.mjs` kann SELECT und UID MOVE seit
  // M4 (c728b6b), benutzt hat das bis heute kein Test — nur Unit-Tests mit Fake-Transport.
  it("uebernimmt per UID MOVE und laesst die uebrigen Mails ungelesen", async () => {
    await starteServer();

    const ergebnis = await adoptMessage(
      { connect: () => imapConnectWritable(nodeSocketTransport(), verbindungsOptionen()), busy: createBusyGuard() },
      { uid: 7, sourceFolder: "INBOX", targetFolder: "Vault/Belege" },
    );
    expect(ergebnis).toEqual({ ok: true });
    await warteAufKommando(/^LOGOUT$/i);

    const zeilen = kommandos();
    expect(zeilen.filter((z) => /^SELECT\b/i.test(z))).toHaveLength(1);
    expect(zeilen.some((z) => /^UID MOVE 7 /i.test(z))).toBe(true);

    // Wirkung statt Wortlaut: die UID ist weg, und keine der verbliebenen Mails hat \Seen —
    // `UID MOVE` nimmt die Flags mit, statt sie unterwegs zu setzen.
    const lesend = await imapConnect(nodeSocketTransport(), verbindungsOptionen());
    expect(lesend.ok).toBe(true);
    if (!lesend.ok) throw new Error("unreachable");
    try {
      expect(await lesend.session.examine("INBOX")).toMatchObject({ ok: true, exists: 2 });
      const uids = await lesend.session.uidSearchAll();
      expect(uids).toEqual([9, 11]);
      const zeilenNachher = await lesend.session.uidFetchHeaders(uids);
      expect([...zeilenNachher.values()].flatMap((r) => r.flags)).toEqual([]);
    } finally {
      await lesend.session.logout();
    }
  });
});
