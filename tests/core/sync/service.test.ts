import { describe, it, expect, vi } from "vitest";
import { FakeSocketTransport, type DialogStep } from "../../helpers/fake-socket";
import { testTimers } from "../../helpers/timers";
import { createSyncService, MAX_FETCH_PER_RUN } from "../../../src/core/sync/service";
import { createBusyGuard } from "../../../src/core/sync/busy";
import { createEmitter } from "../../../src/core/sync/events";
import { createUidCache } from "../../../src/core/sync/uid-cache";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import { newAccount, type Account } from "../../../src/core/settings";
import type { MailIndex } from "../../../src/core/mirror/apply";
import type { NotePlan } from "../../../src/core/mirror/plan";
import type { PlanExecutor } from "../../../src/core/mirror/execute";

const EML = "From: a@example.net\r\nTo: b@example.net\r\nSubject: Testmail\r\nMessage-ID: <neu@example.net>\r\nDate: Sat, 29 Aug 2026 08:00:00 +0000\r\n\r\nHallo\r\n";

function account(): Account {
  const a = newAccount("acc");
  a.imap = { host: "imap.example.net", port: 993, tls: "implicit" };
  a.username = "u@example.net";
  a.folders.allowlist = "Vault";
  return a;
}

function recordingExecutor(): { executor: PlanExecutor; seen: NotePlan[] } {
  const seen: NotePlan[] = [];
  return {
    seen,
    executor: {
      execute: (plans) => {
        seen.push(...plans);
        return Promise.resolve({
          created: plans.filter((p) => p.kind === "create").length,
          updated: 0,
          stateChanged: plans.filter((p) => p.kind === "setState").length,
          skipped: plans.filter((p) => p.kind === "skip"),
          errors: [],
        });
      },
    },
  };
}

/** `exists` ist der EXISTS-Wert der EXAMINE-Antwort. Er muss zur UID-Liste des jeweiligen Tests
 *  passen: seit dem Quercheck in service.ts bricht ein Lauf mit `exists > 0` und leerer UID-Liste
 *  bewusst mit code "protocol" ab (das waere sonst ein Total-Detach des Kontos). */
function dialog(extra: DialogStep[], exists = 1): DialogStep[] {
  return [
    { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", "a001 OK done"] },
    { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
    { expect: /^a003 EXAMINE /, send: [`* ${String(exists)} EXISTS`, "* OK [UIDVALIDITY 42] ok", "a003 OK done"] },
    ...extra,
  ];
}

function service(steps: DialogStep[], index: MailIndex, exec = recordingExecutor(), uidCache = createUidCache(undefined)) {
  const fake = new FakeSocketTransport(["* OK ready"], steps);
  const svc = createSyncService({
    accounts: () => [account()],
    profile: () => defaultMailProfile(),
    secret: () => "geheim",
    transport: () => fake,
    index: () => index,
    takenPaths: () => new Set<string>(),
    executor: () => exec.executor,
    uidCache,
    busy: createBusyGuard(),
    events: createEmitter(), timers: testTimers,
    now: () => new Date("2026-08-30T09:00:00Z"),
  });
  return { svc, fake, exec };
}

describe("createSyncService", () => {
  it("legt fuer eine neue Mail im Allowlist-Ordner eine Notiz an", async () => {
    const header = new TextEncoder().encode("Message-ID: <neu@example.net>\r\n\r\n");
    const body = new TextEncoder().encode(EML);
    const { svc, exec } = service(
      dialog([
        { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 7", "a004 OK done"] },
        { expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[HEADER\.FIELDS \(MESSAGE-ID\)\]\)$/, send: [`* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(header.byteLength)}}`, header, ")", "a005 OK done"] },
        { expect: /^a006 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: [`* 1 FETCH (UID 7 BODY[] {${String(body.byteLength)}}`, body, ")", "a006 OK done"] },
        { expect: /^a007 LOGOUT$/, send: ["* BYE", "a007 OK done"] },
      ]),
      new Map(),
    );
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: 1 } });
    expect(exec.seen[0]).toMatchObject({ kind: "create", mailId: "neu@example.net" });
  });

  it("holt keinen Body fuer eine Mail, deren Notiz es schon gibt", async () => {
    const header = new TextEncoder().encode("Message-ID: <da@example.net>\r\n\r\n");
    const index: MailIndex = new Map([["da@example.net", { path: "Mail/2026/d.md", state: "live", source: "acc/Vault" }]]);
    const { svc, fake } = service(
      dialog([
        { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 7", "a004 OK done"] },
        { expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[HEADER\.FIELDS \(MESSAGE-ID\)\]\)$/, send: [`* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(header.byteLength)}}`, header, ")", "a005 OK done"] },
        { expect: /^a006 LOGOUT$/, send: ["* BYE", "a006 OK done"] },
      ]),
      index,
    );
    const r = await svc.syncAccount("acc");
    expect(r.ok).toBe(true);
    expect(fake.written.some((l) => l.includes("BODY.PEEK[]"))).toBe(false);
  });

  it("setzt detached fuer eine Notiz, deren Mail den Ordner verlassen hat", async () => {
    const index: MailIndex = new Map([["weg@example.net", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }]]);
    const { svc, exec } = service(
      dialog([
        { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH", "a004 OK done"] },
        { expect: /^a005 LOGOUT$/, send: ["* BYE", "a005 OK done"] },
      ], 0),
      index,
    );
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { detached: 1, detachSkipped: 0 } });
    expect(exec.seen).toEqual([{ kind: "setState", path: "Mail/2026/w.md", mailId: "weg@example.net", state: "detached", stateField: "mail_state" }]);
  });

  it("nutzt beim zweiten Lauf den UID-Cache statt erneut Header zu holen", async () => {
    const header = new TextEncoder().encode("Message-ID: <da@example.net>\r\n\r\n");
    const index: MailIndex = new Map([["da@example.net", { path: "Mail/2026/d.md", state: "live", source: "acc/Vault" }]]);
    const cache = createUidCache(undefined);
    const steps = (n: number, withHeader: boolean): DialogStep[] => [
      { expect: new RegExp(`^a00${String(n)} UID SEARCH ALL$`), send: ["* SEARCH 7", `a00${String(n)} OK done`] },
      ...(withHeader ? [{ expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[HEADER/, send: [`* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(header.byteLength)}}`, header, ")", "a005 OK done"] }] : []),
      // Die Antwort auf LOGOUT ist absichtlich tag-neutral und beliebig: logout() wertet das
      // Ergebnis nicht aus (jeder Fehler wird verschluckt, s. client.ts), und ein fest
      // ausgerechneter Tag wuerde bei jeder Aenderung der vorangehenden Kommandofolge wieder
      // stillschweigend falsch. Geprueft wird stattdessen direkt per Assertion unten, dass der
      // Client ueberhaupt ein LOGOUT-Kommando sendet.
      { expect: /LOGOUT$/, send: ["* BYE", "a999 OK done"] },
    ];
    const mk = (withHeader: boolean): FakeSocketTransport => new FakeSocketTransport(["* OK ready"], dialog(steps(4, withHeader)));
    let current = mk(true);
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim",
      transport: () => current, index: () => index, takenPaths: () => new Set<string>(),
      executor: () => recordingExecutor().executor, uidCache: cache, busy: createBusyGuard(),
      events: createEmitter(), timers: testTimers, now: () => new Date("2026-08-30T09:00:00Z"),
    });
    await svc.syncAccount("acc");
    current = mk(false);
    expect((await svc.syncAccount("acc")).ok).toBe(true);
    expect(current.written.some((l) => l.includes("HEADER.FIELDS"))).toBe(false);
    expect(current.written.some((l) => /^a\d+ LOGOUT$/.test(l))).toBe(true);
  });

  it("meldet no-secret, ohne eine Verbindung aufzubauen", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], []);
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => null,
      transport: () => fake, index: () => new Map(), takenPaths: () => new Set<string>(),
      executor: () => recordingExecutor().executor, uidCache: createUidCache(undefined),
      busy: createBusyGuard(), events: createEmitter(), timers: testTimers, now: () => new Date(),
    });
    expect(await svc.syncAccount("acc")).toMatchObject({ ok: false, code: "no-secret" });
    expect(fake.connectCalls).toHaveLength(0);
  });

  it("meldet busy, wenn der Guard belegt ist, und laesst den Guard danach frei", async () => {
    const busy = createBusyGuard();
    busy.tryAcquire();
    const fake = new FakeSocketTransport(["* OK ready"], []);
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim",
      transport: () => fake, index: () => new Map(), takenPaths: () => new Set<string>(),
      executor: () => recordingExecutor().executor, uidCache: createUidCache(undefined),
      busy, events: createEmitter(), timers: testTimers, now: () => new Date(),
    });
    expect(await svc.syncAccount("acc")).toMatchObject({ ok: false, code: "busy" });
    busy.release();
    expect(busy.isBusy()).toBe(false);
  });

  it("gibt den Busy-Guard auch frei, wenn der Dialog mittendrin abbricht", async () => {
    const busy = createBusyGuard();
    const fake = new FakeSocketTransport(["* OK ready"], [{ expect: /^a001 CAPABILITY$/, send: ["a001 BAD kaputt"] }]);
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim",
      transport: () => fake, index: () => new Map(), takenPaths: () => new Set<string>(),
      executor: () => recordingExecutor().executor, uidCache: createUidCache(undefined),
      busy, events: createEmitter(), timers: testTimers, now: () => new Date(),
    });
    expect((await svc.syncAccount("acc")).ok).toBe(false);
    expect(busy.isBusy()).toBe(false);
    expect(fake.closed).toBe(true);
  });

  it("feuert synced mit den Zaehlern und changed je ausgefuehrtem Plan", async () => {
    const index: MailIndex = new Map([["weg@example.net", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }]]);
    const events = createEmitter<{ synced: { accountId: string; counts: { detached: number } }; changed: { path: string } }>();
    const synced = vi.fn();
    const changed = vi.fn();
    events.on("synced", synced);
    events.on("changed", changed);
    const fake = new FakeSocketTransport(["* OK ready"], dialog([
      { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH", "a004 OK done"] },
      { expect: /^a005 LOGOUT$/, send: ["* BYE", "a005 OK done"] },
    ], 0));
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim",
      transport: () => fake, index: () => index, takenPaths: () => new Set<string>(),
      executor: () => recordingExecutor().executor, uidCache: createUidCache(undefined),
      busy: createBusyGuard(), events: events as never, timers: testTimers, now: () => new Date(),
    });
    await svc.syncAccount("acc");
    expect(synced).toHaveBeenCalledWith(expect.objectContaining({ accountId: "acc" }));
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ path: "Mail/2026/w.md" }));
  });

  it("feuert kein changed fuer einen Plan, den der Executor scheitern laesst, und zaehlt ihn als Fehler", async () => {
    const index: MailIndex = new Map([["weg@example.net", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }]]);
    const events = createEmitter<{ synced: { accountId: string; counts: { detached: number; errors: number } }; changed: { path: string } }>();
    const changed = vi.fn();
    events.on("changed", changed);
    // Der Executor gibt fuer jeden Plan eine FLACHE KOPIE zurueck statt der Original-Referenz —
    // ein Abgleich ueber Objektidentitaet wuerde diesen (durchaus vertragskonformen) Executor
    // faelschlich als "ausgefuehrt" behandeln und trotz Fehlschlag ein changed-Event feuern.
    const failingExecutor: PlanExecutor = {
      execute: (plans) => Promise.resolve({
        created: 0,
        updated: 0,
        stateChanged: 0,
        skipped: [],
        errors: plans.map((p) => ({ plan: { ...p }, message: "kaputt" })),
      }),
    };
    const fake = new FakeSocketTransport(["* OK ready"], dialog([
      { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH", "a004 OK done"] },
      { expect: /^a005 LOGOUT$/, send: ["* BYE", "a005 OK done"] },
    ], 0));
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim",
      transport: () => fake, index: () => index, takenPaths: () => new Set<string>(),
      executor: () => failingExecutor, uidCache: createUidCache(undefined),
      busy: createBusyGuard(), events: events as never, timers: testTimers, now: () => new Date(),
    });
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { detached: 0, errors: 1 } });
    expect(changed).not.toHaveBeenCalled();
  });

  // CRITICAL der Abschluss-Runde: zwei UIDs mit derselben normalisierten Message-ID (zurueck-
  // kopierte Mail, Sieve-Kopie, an sich selbst weitergeleitet) bekamen zwei create-Plaene und
  // damit zwei Notizen mit identischem mail_id — die zweite waere im mailIndex (Map ueber
  // mail_id) fuer immer unerreichbar gewesen. Der Header-Fetch liefert hier bewusst KEINE IDs,
  // damit beide Bodies geholt werden und der Riegel nach dem Parsen greift (nicht schon der
  // Cache-Zweig davor).
  it("legt fuer zwei UIDs mit derselben Message-ID nur eine Notiz an", async () => {
    const mk = (): Uint8Array => new TextEncoder().encode("From: a@example.net\r\nTo: b@example.net\r\nSubject: Zweimal da\r\nMessage-ID: <dup@example.net>\r\nDate: Sat, 29 Aug 2026 08:00:00 +0000\r\n\r\nHallo\r\n");
    const body = mk();
    const { svc, exec } = service(
      dialog([
        { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 7 9", "a004 OK done"] },
        { expect: /^a005 UID FETCH .*HEADER\.FIELDS/, send: ["a005 OK done"] },
        { expect: /^a006 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: [`* 1 FETCH (UID 7 BODY[] {${String(body.byteLength)}}`, body, ")", "a006 OK done"] },
        { expect: /^a007 UID FETCH 9 \(BODY\.PEEK\[\]\)$/, send: [`* 2 FETCH (UID 9 BODY[] {${String(body.byteLength)}}`, body, ")", "a007 OK done"] },
        { expect: /LOGOUT$/, send: ["* BYE", "a999 OK done"] },
      ], 2),
      new Map(),
    );
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: 1 } });
    expect(exec.seen.filter((p) => p.kind === "create")).toHaveLength(1);
  });

  // Nach dem Connect uebersetzt niemand mehr: examine/uidSearchAll/uidFetchBody werfen ihren
  // NetError bis in den catch von syncAccount. Der meldete pauschal "protocol" — ein Abbruch
  // mitten im Lauf (haeufigster Fehler beim Intervall-Sync ueber wackliges WLAN) las sich damit
  // als "Die Antwort des Servers war unverstaendlich".
  it("reicht den NetError-Code eines Abbruchs nach dem Connect durch", async () => {
    const { svc } = service(
      // Der Schritt matcht, sendet aber nichts: der Fake wirft beim naechsten readLine
      // NetError("closed") — genau wie ein Server, der die Verbindung mittendrin zumacht.
      dialog([
        { expect: /^a004 UID SEARCH ALL$/ },
        { expect: /LOGOUT$/ },
      ]),
      new Map(),
    );
    expect(await svc.syncAccount("acc")).toMatchObject({ ok: false, code: "closed" });
  });

  // Ein setState-Plan, dessen Zieldatei zwischen Planung und Ausfuehrung verschwunden ist, landet
  // im Executor nicht in errors, sondern als "missing-target"-Skip (src/obsidian/vault-notes.ts).
  it("zaehlt einen vom Executor uebersprungenen setState-Plan nicht als detached und feuert kein changed", async () => {
    const index: MailIndex = new Map([["weg@example.net", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }]]);
    const changed = vi.fn();
    const events = createEmitter<{ synced: { accountId: string; counts: { detached: number } }; changed: { path: string } }>();
    events.on("changed", changed);
    const skippingExecutor: PlanExecutor = {
      execute: (plans) => Promise.resolve({
        created: 0, updated: 0, stateChanged: 0,
        // Flache Kopie mit anderem kind: der Abgleich laeuft ueber path+mailId, nicht ueber Identitaet.
        skipped: plans.map((p) => ({ kind: "skip" as const, path: p.path, mailId: p.mailId, reason: "missing-target" as const })),
        errors: [],
      }),
    };
    const fake = new FakeSocketTransport(["* OK ready"], dialog([
      { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH", "a004 OK done"] },
      { expect: /^a005 LOGOUT$/, send: ["* BYE", "a005 OK done"] },
    ], 0));
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim",
      transport: () => fake, index: () => index, takenPaths: () => new Set<string>(),
      executor: () => skippingExecutor, uidCache: createUidCache(undefined),
      busy: createBusyGuard(), events: events as never, timers: testTimers, now: () => new Date(),
    });
    expect(await svc.syncAccount("acc")).toMatchObject({ ok: true, counts: { detached: 0, skipped: 1 } });
    expect(changed).not.toHaveBeenCalled();
  });

  // Reichweite von `undetermined`: nur eine UID, deren ID dieser Lauf wirklich nicht bestimmen
  // konnte, darf den Detach-Zweig aussetzen. Steht die ID im Cache, ist onServer fuer diese UID
  // vollstaendig — ein Fehlschlag beim Body aendert daran nichts.
  it("setzt detached fort, wenn der Body fehlschlaegt, die ID aber aus dem Cache bekannt ist", async () => {
    const index: MailIndex = new Map([["weg@example.net", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }]]);
    const cache = createUidCache({ "acc|Vault": { uidValidity: 42, map: { "7": "neu@example.net" } } });
    const { svc, exec } = service(
      dialog([
        { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 7", "a004 OK done"] },
        { expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: ["a005 OK done"] },
        { expect: /LOGOUT$/, send: ["* BYE", "a999 OK done"] },
      ]),
      index,
      recordingExecutor(),
      cache,
    );
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { detached: 1, detachSkipped: 0, errors: 1 } });
    expect(exec.seen).toEqual([{ kind: "setState", path: "Mail/2026/w.md", mailId: "weg@example.net", state: "detached", stateField: "mail_state" }]);
  });

  // MAX_FETCH_PER_RUN: der erste Lauf ueber einen hineingezogenen Bestand darf nicht den ganzen
  // Ordner gleichzeitig im Speicher aufbauen. Entscheidend ist, dass der Abbruch KEINE falschen
  // Detaches ausloest — onServer wird bis zur letzten UID weiter aus dem Cache befuellt.
  it("holt hoechstens MAX_FETCH_PER_RUN Bodies und detacht deswegen nichts faelschlich", async () => {
    const uids = Array.from({ length: MAX_FETCH_PER_RUN + 2 }, (_, i) => i + 1);
    const map: Record<string, string> = {};
    for (const uid of uids) map[String(uid)] = `m${String(uid)}@x`;
    const cache = createUidCache({ "acc|Vault": { uidValidity: 42, map } });
    // m202 liegt auf dem Server und hat schon eine Notiz — sie steht hinter der Grenze und darf
    // trotzdem nicht abgeloest werden. weg@x liegt NICHT mehr auf dem Server und muss es werden.
    const index: MailIndex = new Map([
      [`m${String(MAX_FETCH_PER_RUN + 2)}@x`, { path: "Mail/2026/letzte.md", state: "live", source: "acc/Vault" }],
      ["weg@x", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }],
    ]);
    const steps: DialogStep[] = [{ expect: /^a004 UID SEARCH ALL$/, send: [`* SEARCH ${uids.join(" ")}`, "a004 OK done"] }];
    uids.slice(0, MAX_FETCH_PER_RUN).forEach((uid, i) => {
      const body = new TextEncoder().encode(`From: a@example.net\r\nTo: b@example.net\r\nSubject: Mail ${String(uid)}\r\nMessage-ID: <m${String(uid)}@x>\r\nDate: Sat, 29 Aug 2026 08:00:00 +0000\r\n\r\nHallo\r\n`);
      const tag = `a${String(5 + i).padStart(3, "0")}`;
      steps.push({
        expect: new RegExp(`^${tag} UID FETCH ${String(uid)} \\(BODY\\.PEEK\\[\\]\\)$`),
        send: [`* 1 FETCH (UID ${String(uid)} BODY[] {${String(body.byteLength)}}`, body, ")", `${tag} OK done`],
      });
    });
    steps.push({ expect: /LOGOUT$/, send: ["* BYE", "a999 OK done"] });

    const { svc, fake, exec } = service(dialog(steps, uids.length), index, recordingExecutor(), cache);
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: MAX_FETCH_PER_RUN, detached: 1, detachSkipped: 0 } });
    expect(fake.written.filter((l) => l.includes("BODY.PEEK[]"))).toHaveLength(MAX_FETCH_PER_RUN);
    // Genau ein Detach — und zwar der richtige.
    expect(exec.seen.filter((p) => p.kind === "setState")).toEqual([
      { kind: "setState", path: "Mail/2026/w.md", mailId: "weg@x", state: "detached", stateField: "mail_state" },
    ]);
  });

  // syncAll ist der einzige Weg, den src/main.ts benutzt, und der sync.enabled-Filter existiert
  // nur dort. Der Aufruf laeuft bewusst nicht ueber `this`: destrukturiert man den Service, waere
  // das ein TypeError.
  it("syncAll filtert auf sync.enabled, haelt die Reihenfolge und ueberlebt Destrukturierung", async () => {
    const a1 = account(); a1.id = "a1";
    const a2 = account(); a2.id = "a2"; a2.sync.enabled = false;
    const a3 = account(); a3.id = "a3";
    const svc = createSyncService({
      accounts: () => [a1, a2, a3], profile: () => defaultMailProfile(), secret: () => "geheim",
      // Jeder Lauf bekommt einen frischen Fake mit demselben Skript (leerer Ordner).
      transport: () => new FakeSocketTransport(["* OK ready"], dialog([
        { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH", "a004 OK done"] },
        { expect: /^a005 LOGOUT$/, send: ["* BYE", "a005 OK done"] },
      ], 0)),
      index: () => new Map(), takenPaths: () => new Set<string>(),
      executor: () => recordingExecutor().executor, uidCache: createUidCache(undefined),
      busy: createBusyGuard(), events: createEmitter(), timers: testTimers, now: () => new Date(),
    });
    const { syncAll } = svc;
    const results = await syncAll();
    expect(results.map((r) => r.accountId)).toEqual(["a1", "a3"]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  // Einziger verfuegbarer Quercheck gegen das teuerste Fehlerbild des Moduls: ohne ihn wuerde ein
  // Lauf mit gefuelltem Ordner, aber leerer UID-Antwort JEDE Notiz des Kontos detachen.
  it("bricht ab, wenn EXAMINE Nachrichten meldet und UID SEARCH ALL nichts liefert", async () => {
    const index: MailIndex = new Map([["da@example.net", { path: "Mail/2026/d.md", state: "live", source: "acc/Vault" }]]);
    const { svc, exec } = service(
      dialog([
        { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH", "a004 OK done"] },
        { expect: /LOGOUT$/, send: ["* BYE", "a999 OK done"] },
      ], 3),
      index,
    );
    expect(await svc.syncAccount("acc")).toMatchObject({ ok: false, code: "protocol" });
    expect(exec.seen).toEqual([]);
  });

  it("laesst detached aus, wenn eine Server-ID in diesem Lauf nicht bestimmbar war", async () => {
    const index: MailIndex = new Map([["geblieben@example.net", { path: "Mail/2026/g.md", state: "live", source: "acc/Vault" }]]);
    // UID 9 ist unbekannt (kein Cache-Treffer), der Header-Fetch liefert keine Message-ID (z. B.
    // Header schon verschwunden) und der anschliessende Body-Fetch liefert ebenfalls nichts —
    // die UID "verschwindet" also spurlos, ihre Mail-ID bleibt unbestimmt.
    const { svc, exec } = service(
      dialog([
        { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 9", "a004 OK done"] },
        { expect: /^a005 UID FETCH 9 \(BODY\.PEEK\[HEADER\.FIELDS \(MESSAGE-ID\)\]\)$/, send: ["a005 OK done"] },
        { expect: /^a006 UID FETCH 9 \(BODY\.PEEK\[\]\)$/, send: ["a006 OK done"] },
        { expect: /^a007 LOGOUT$/, send: ["* BYE", "a007 OK done"] },
      ]),
      index,
    );
    const r = await svc.syncAccount("acc");
    // detachSkipped macht den stillgelegten Detach-Durchgang sichtbar — sonst waere er von
    // "es gab nichts zu tun" nicht zu unterscheiden, der Lauf meldet in beiden Faellen ok: true.
    expect(r).toMatchObject({ ok: true, counts: { detached: 0, detachSkipped: 1, errors: 1 } });
    expect(exec.seen).toEqual([]);
  });

  it("meldet no-account fuer eine unbekannte Konto-ID", async () => {
    const { svc } = service([], new Map());
    expect(await svc.syncAccount("gibtsnicht")).toMatchObject({ ok: false, code: "no-account" });
  });
});
