import { describe, it, expect, vi } from "vitest";
import { FakeSocketTransport, type DialogStep } from "../../helpers/fake-socket";
import { testTimers } from "../../helpers/timers";
import { createSyncService, MAX_FETCH_PER_RUN, MAX_HEADER_FETCH_PER_RUN } from "../../../src/core/sync/service";
import { createBusyGuard } from "../../../src/vendor/code-kit/busy-guard";
import { createEmitter, type SyncEvents } from "../../../src/core/sync/events";
import { createUidCache } from "../../../src/core/sync/uid-cache";
import { defaultMailProfile, type MailProfile } from "../../../src/core/mirror/profile";
import { newAccount, type Account } from "../../../src/core/settings";
import type { MailIndex } from "../../../src/core/mirror/apply";
import type { NotePlan } from "../../../src/core/mirror/plan";
import type { PlanExecutor } from "../../../src/core/mirror/execute";
import { groupThreads } from "../../../src/core/thread/group";
import type { FollowContext } from "../../../src/core/thread/follow-run";
import type { TransformPort } from "../../../src/core/transform/transform-mail";
import type { AttachmentResolver } from "../../../src/core/mirror/attachments";

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
    const events = createEmitter<SyncEvents>();
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
      busy: createBusyGuard(), events: events, timers: testTimers, now: () => new Date(),
    });
    await svc.syncAccount("acc");
    expect(synced).toHaveBeenCalledWith(expect.objectContaining({ accountId: "acc" }));
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ path: "Mail/2026/w.md" }));
  });

  it("feuert kein changed fuer einen Plan, den der Executor scheitern laesst, und zaehlt ihn als Fehler", async () => {
    const index: MailIndex = new Map([["weg@example.net", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }]]);
    const events = createEmitter<SyncEvents>();
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
      busy: createBusyGuard(), events: events, timers: testTimers, now: () => new Date(),
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
    const events = createEmitter<SyncEvents>();
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
      busy: createBusyGuard(), events: events, timers: testTimers, now: () => new Date(),
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

// MAX_HEADER_FETCH_PER_RUN: die FETCH-Kommandos selbst waren nie unbegrenzt — client.ts schickt
// den Header-Abgleich seit jeher in Baendern von HEADER_BATCH (200). Unbegrenzt war die MENGE je
// LAUF: alle Baender landen in EINER Map, und bei einem hineingezogenen Grossbestand zieht ein
// einziger Lauf so den ganzen Ordner durch. Der Body-Fetch ist seit M3 gedeckelt, der Header-Weg
// blieb es nicht. Entscheidend wie beim Body-Deckel: was der Deckel abschneidet, bleibt unbestimmt
// — und unbestimmte UIDs muessen den Detach-Zweig aussetzen, sonst loest die Grenze Abloesungen aus.
describe("createSyncService — Header-Fetch-Obergrenze", () => {
  const HEADER_BATCH = 200; // Bandbreite in client.ts; hier gespiegelt, um die Baender zu zaehlen

  it("holt hoechstens MAX_HEADER_FETCH_PER_RUN Header je Lauf und setzt Detaches deswegen aus", async () => {
    const uids = Array.from({ length: MAX_HEADER_FETCH_PER_RUN + 2 }, (_, i) => i + 1);
    // "weg@x" liegt nicht mehr auf dem Server. Ohne Deckel waere sie abgeloest worden; mit ihm
    // bleiben die abgeschnittenen UIDs unbestimmt, also darf der Lauf sie NICHT anfassen.
    const index: MailIndex = new Map([["weg@x", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }]]);

    let tagNr = 5;
    const nextTag = () => `a${String(tagNr++).padStart(3, "0")}`;
    const steps: DialogStep[] = [{ expect: /^a004 UID SEARCH ALL$/, send: [`* SEARCH ${uids.join(" ")}`, "a004 OK done"] }];
    // Genau MAX_HEADER_FETCH_PER_RUN / HEADER_BATCH Baender — ein elftes waere der Befund.
    // Leere Antworten: dann bleibt jede ID unbestimmt, was den Detach-Zweig pruefbar macht.
    for (let from = 1; from <= MAX_HEADER_FETCH_PER_RUN; from += HEADER_BATCH) {
      const tag = nextTag();
      steps.push({
        expect: new RegExp(`^${tag} UID FETCH ${String(from)}:${String(from + HEADER_BATCH - 1)} \\(BODY\\.PEEK\\[HEADER\\.FIELDS \\(MESSAGE-ID\\)\\]\\)$`),
        send: [`${tag} OK done`],
      });
    }
    uids.slice(0, MAX_FETCH_PER_RUN).forEach((uid) => {
      const body = new TextEncoder().encode(`From: a@example.net\r\nTo: b@example.net\r\nSubject: Mail ${String(uid)}\r\nMessage-ID: <m${String(uid)}@x>\r\nDate: Sat, 29 Aug 2026 08:00:00 +0000\r\n\r\nHallo\r\n`);
      const tag = nextTag();
      steps.push({
        expect: new RegExp(`^${tag} UID FETCH ${String(uid)} \\(BODY\\.PEEK\\[\\]\\)$`),
        send: [`* 1 FETCH (UID ${String(uid)} BODY[] {${String(body.byteLength)}}`, body, ")", `${tag} OK done`],
      });
    });
    steps.push({ expect: /LOGOUT$/, send: ["* BYE", "a999 OK done"] });

    const { svc, fake, exec } = service(dialog(steps, uids.length), index);
    const r = await svc.syncAccount("acc");

    expect(r).toMatchObject({ ok: true, counts: { created: MAX_FETCH_PER_RUN, detached: 0, detachSkipped: 1 } });
    expect(fake.written.filter((l) => l.includes("HEADER.FIELDS"))).toHaveLength(MAX_HEADER_FETCH_PER_RUN / HEADER_BATCH);
    // Keine einzige Abloesung — die Notiz ueberlebt den Lauf unangetastet.
    expect(exec.seen.filter((p) => p.kind === "setState")).toEqual([]);
  });
});

// Review-Befund zur Header-Obergrenze (2026-08-30): der Deckel darf den BODY-Deckel nicht
// aushebeln. `fetched` waechst nur fuer Mails, die NOCH KEINE Notiz haben — eine bereits
// gespiegelte Mail jenseits des Header-Deckels hat keine gecachte ID mehr, faellt deshalb bis
// zum Body-Fetch durch und laesst den 200er-Zaehler unberuehrt. Ohne Riegel holt ein Lauf so
// JEDEN restlichen Body. Vor dem Header-Deckel gab es diesen Weg nicht: der billige Header
// erkannte die Mail, `index.has` sprang, kein Body.
describe("createSyncService — Header-Deckel hebelt den Body-Deckel nicht aus", () => {
  it("holt keinen einzigen Body fuer laengst gespiegelte Mails jenseits des Header-Deckels", async () => {
    const ueberhang = 100;
    const uids = Array.from({ length: MAX_HEADER_FETCH_PER_RUN + ueberhang }, (_, i) => i + 1);
    // Jede dieser Mails hat schon eine Notiz — es gibt nichts zu holen, fuer keine einzige.
    const index: MailIndex = new Map(uids.map((uid) => [`m${String(uid)}@x`, { path: `Mail/2026/${String(uid)}.md`, state: "live" as const, source: "acc/Vault" }]));

    let tagNr = 5;
    const nextTag = () => `a${String(tagNr++).padStart(3, "0")}`;
    const steps: DialogStep[] = [{ expect: /^a004 UID SEARCH ALL$/, send: [`* SEARCH ${uids.join(" ")}`, "a004 OK done"] }];
    for (let from = 1; from <= MAX_HEADER_FETCH_PER_RUN; from += 200) {
      const tag = nextTag();
      const bis = from + 199;
      const lines: (string | Uint8Array)[] = [];
      for (let uid = from; uid <= bis; uid++) {
        const h = new TextEncoder().encode(`Message-ID: <m${String(uid)}@x>\r\n\r\n`);
        lines.push(`* ${String(uid)} FETCH (UID ${String(uid)} BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(h.byteLength)}}`, h, ")");
      }
      lines.push(`${tag} OK done`);
      steps.push({ expect: new RegExp(`^${tag} UID FETCH ${String(from)}:${String(bis)} \\(BODY\\.PEEK\\[HEADER\\.FIELDS \\(MESSAGE-ID\\)\\]\\)$`), send: lines });
    }
    steps.push({ expect: /LOGOUT$/, send: ["* BYE", "a999 OK done"] });

    const { svc, fake } = service(dialog(steps, uids.length), index);
    const r = await svc.syncAccount("acc");

    expect(r).toMatchObject({ ok: true, counts: { created: 0 } });
    // Der Kern: kein einziger Body. Vor der Reparatur waren es `ueberhang` viele.
    expect(fake.written.filter((l) => l.includes("BODY.PEEK[]"))).toHaveLength(0);
  });
});

// Vorspann zu A3 (Welle 36, Entscheidung Johannes 2026-11-18): nach dem Anlegen verlinkt der Lauf in
// BESTEHENDEN Notizen die rohen IDs auf Notizen, die er selbst angelegt hat — und sonst nichts.
describe("createSyncService — verlinkt aeltere Notizen nach", () => {
  const header = new TextEncoder().encode("Message-ID: <neu@example.net>\r\n\r\n");
  const body = new TextEncoder().encode(EML);
  const steps = (): DialogStep[] => dialog([
    { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 7", "a004 OK done"] },
    { expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[HEADER\.FIELDS \(MESSAGE-ID\)\]\)$/, send: [`* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(header.byteLength)}}`, header, ")", "a005 OK done"] },
    { expect: /^a006 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: [`* 1 FETCH (UID 7 BODY[] {${String(body.byteLength)}}`, body, ")", "a006 OK done"] },
    { expect: /^a007 LOGOUT$/, send: ["* BYE", "a007 OK done"] },
  ]);
  const ALT = "---\nmail_id: alt@example.net\nin_reply_to: neu@example.net\n---\n\n%% mailstone:begin %%\nx\n%% mailstone:end %%\n";
  const fremd = { mailId: "fremd@example.net", path: "Mail/2026/fremd.md", frontmatter: { mail_id: "fremd@example.net", in_reply_to: "nirgends@example.net" } };
  const alt = { mailId: "alt@example.net", path: "Mail/2026/alt.md", frontmatter: { mail_id: "alt@example.net", in_reply_to: "neu@example.net" } };

  function lauf(relink: NonNullable<Parameters<typeof createSyncService>[0]["relink"]>, exec = recordingExecutor()) {
    const fake = new FakeSocketTransport(["* OK ready"], steps());
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim", transport: () => fake,
      index: () => new Map(), takenPaths: () => new Set<string>(), executor: () => exec.executor,
      uidCache: createUidCache(undefined), busy: createBusyGuard(), events: createEmitter(), timers: testTimers,
      now: () => new Date("2026-08-30T09:00:00Z"), relink,
    });
    return { svc, exec };
  }

  it("verlinkt die rohe ID in einer aelteren Notiz auf die Notiz, die der Lauf anlegt", async () => {
    const { svc, exec } = lauf({ heads: () => [alt, fremd], read: (p) => Promise.resolve(p === alt.path ? { content: ALT, zoneHash: "h" } : null) });
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: 1, errors: 0 } });
    const create = exec.seen.find((p) => p.kind === "create")!;
    const update = exec.seen.find((p) => p.kind === "update")!;
    expect(update).toMatchObject({ path: alt.path, mailId: "alt@example.net" });
    expect(update.kind === "update" && update.content).toContain(`in_reply_to: "[[${create.path.replace(/\.md$/, "")}]]"`);
    // Die Notiz mit der ID auf eine NICHT angelegte Mail bleibt unberuehrt.
    expect(exec.seen.some((p) => p.path === fremd.path)).toBe(false);
  });

  it("legt zuerst an und verlinkt danach: zwei Executor-Aufrufe in dieser Reihenfolge", async () => {
    const aufrufe: string[][] = [];
    const exec = { seen: [] as NotePlan[], executor: { execute: (plans: NotePlan[]) => { aufrufe.push(plans.map((p) => p.kind)); return Promise.resolve({ created: plans.filter((p) => p.kind === "create").length, updated: plans.filter((p) => p.kind === "update").length, stateChanged: 0, skipped: [], errors: [] }); } } };
    const { svc } = lauf({ heads: () => [alt], read: () => Promise.resolve({ content: ALT, zoneHash: "h" }) }, exec);
    await svc.syncAccount("acc");
    expect(aufrufe).toEqual([["create"], ["update"]]);
  });

  it("ein Fehler beim Nachverlinken bricht den Lauf nicht ab und zaehlt als Fehler", async () => {
    const { svc, exec } = lauf({ heads: () => [alt], read: () => Promise.reject(new Error("weg")) });
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: 1, errors: 1 } });
    expect(exec.seen.some((p) => p.kind === "create")).toBe(true);
  });

  it("schreibt nichts nach, wenn der Lauf keine Notiz anlegt", async () => {
    let gelesen = 0;
    const header2 = new TextEncoder().encode("Message-ID: <da@example.net>\r\n\r\n");
    const fake = new FakeSocketTransport(["* OK ready"], dialog([
      { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 7", "a004 OK done"] },
      { expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[HEADER\.FIELDS \(MESSAGE-ID\)\]\)$/, send: [`* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(header2.byteLength)}}`, header2, ")", "a005 OK done"] },
      { expect: /^a006 LOGOUT$/, send: ["* BYE", "a006 OK done"] },
    ]));
    const exec = recordingExecutor();
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim", transport: () => fake,
      index: () => new Map([["da@example.net", { path: "Mail/2026/d.md", state: "live", source: "acc/Vault" }]]), takenPaths: () => new Set<string>(), executor: () => exec.executor,
      uidCache: createUidCache(undefined), busy: createBusyGuard(), events: createEmitter(), timers: testTimers,
      now: () => new Date("2026-08-30T09:00:00Z"), relink: { heads: () => [alt], read: () => { gelesen++; return Promise.resolve(null); } },
    });
    expect((await svc.syncAccount("acc")).ok).toBe(true);
    expect(gelesen).toBe(0);
  });
});

// A1 (Uebernahme): der Schritt "Folge-Mails kopieren" vor dem Allowlist-Lauf. Ausgeschaltet (Standard) entsteht keine zweite
// Verbindung, keine Vault-Abfrage und kein COPY; eingeschaltet laeuft er vor dem Lauf, und sein Fehler haelt den Lauf nicht an.
describe("createSyncService — Vorgang-Folgen (A1)", () => {
  const leeresPostfach = [
    { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH", "a004 OK done"] },
    { expect: /^a005 LOGOUT$/, send: ["* BYE", "a005 OK done"] },
  ];
  /** Eine Verbindung des Follow-Schritts ohne Kandidaten: INBOX und Sent sind leer. */
  const folgeSchrittOhneKandidaten: DialogStep[] = [
    { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR UIDPLUS", "a001 OK done"] },
    { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
    { expect: /^a003 EXAMINE "INBOX"$/, send: ["* 0 EXISTS", "* OK [UIDVALIDITY 5] ok", "a003 OK done"] },
    { expect: /^a004 UID SEARCH SINCE /, send: ["* SEARCH", "a004 OK done"] },
    { expect: /^a005 EXAMINE "Sent"$/, send: ["* 0 EXISTS", "* OK [UIDVALIDITY 6] ok", "a005 OK done"] },
    { expect: /^a006 UID SEARCH SINCE /, send: ["* SEARCH", "a006 OK done"] },
    { expect: /^a007 LOGOUT$/, send: ["* BYE", "a007 OK done"] },
  ];

  function mitFolgen(an: boolean, fakes: FakeSocketTransport[], contextAufrufe: { n: number }, extra: { profile?: MailProfile; log?: (l: string) => void; context?: () => FollowContext } = {}) {
    const acc = account();
    acc.sync.followThreads = an;
    const verbindungen = { n: 0 };
    const exec = recordingExecutor();
    const svc = createSyncService({
      accounts: () => [acc], profile: () => extra.profile ?? defaultMailProfile(), secret: () => "geheim",
      ...(extra.log ? { log: extra.log } : {}),
      transport: () => { const f = fakes[verbindungen.n]; verbindungen.n += 1; if (!f) throw new Error("mehr Verbindungen als erwartet"); return f; },
      index: () => new Map(), takenPaths: () => new Set<string>(), executor: () => exec.executor,
      uidCache: createUidCache(undefined), busy: createBusyGuard(), events: createEmitter(), timers: testTimers,
      now: () => new Date("2026-08-30T09:00:00Z"),
      follow: { context: extra.context ?? (() => { contextAufrufe.n += 1; return { index: groupThreads([], null), stopped: new Set<string>() }; }) },
    });
    return { svc, verbindungen };
  }

  it("ausgeschaltet (Standard): genau eine Verbindung, kein Zugriff auf den Vault-Stand der Vorgaenge, kein COPY", async () => {
    const main = new FakeSocketTransport(["* OK ready"], dialog(leeresPostfach, 0));
    const context = { n: 0 };
    const { svc, verbindungen } = mitFolgen(false, [main], context);
    expect((await svc.syncAccount("acc")).ok).toBe(true);
    expect(verbindungen.n).toBe(1);
    expect(context.n).toBe(0);
    expect(main.written.some((l) => /COPY/.test(l))).toBe(false);
  });

  it("ein neues Konto hat Vorgang-Folgen aus", () => {
    expect(account().sync.followThreads).toBe(false);
  });

  it("eingeschaltet: der Schritt laeuft vor dem Allowlist-Lauf, ohne Kandidaten bleibt es bei lesenden Verbindungen", async () => {
    const folgen = new FakeSocketTransport(["* OK ready"], folgeSchrittOhneKandidaten);
    const main = new FakeSocketTransport(["* OK ready"], dialog(leeresPostfach, 0));
    const context = { n: 0 };
    const { svc, verbindungen } = mitFolgen(true, [folgen, main], context);
    expect(await svc.syncAccount("acc")).toMatchObject({ ok: true, counts: { errors: 0 } });
    expect(verbindungen.n).toBe(2);
    expect(context.n).toBe(1);
    expect([...folgen.written, ...main.written].some((l) => /COPY|SELECT|STORE|EXPUNGE|APPEND|MOVE/.test(l))).toBe(false);
  });

  // A1-Nachtrag: ohne wirksames Folgen-Feld kann der Schritt gestoppte Vorgaenge nicht erkennen und wuerde sie trotzdem
  // kopieren (Schreiben auf dem Server gegen den Willen des Nutzers). Dann laeuft er nicht; der Lese-Sync laeuft normal.
  for (const [name, followField] of [["leer", ""], ["nur Leerzeichen", "   "], ["ein verwaltetes Feld", "mail_id"], ["nicht lesbar", "Fölgen"], ["gleich dem Vorgangsfeld", "mail_thread"]] as const) {
    it(`eingeschaltet, aber Folgen-Feld ${name}: der Schritt laeuft nicht, der Lese-Sync schon, die Zeile im Log sagt warum`, async () => {
      const main = new FakeSocketTransport(["* OK ready"], dialog(leeresPostfach, 0));
      const context = { n: 0 };
      const zeilen: string[] = [];
      const profile = { ...defaultMailProfile(), followField, threadField: "mail_thread" };
      const { svc, verbindungen } = mitFolgen(true, [main], context, { profile, log: (l) => zeilen.push(l) });
      expect(await svc.syncAccount("acc")).toMatchObject({ ok: true, counts: { errors: 0 } });
      expect(verbindungen.n).toBe(1);
      expect(context.n).toBe(0);
      expect(main.written.some((l) => /COPY/.test(l))).toBe(false);
      expect(zeilen.some((l) => l.startsWith("follow-copy: skipped"))).toBe(true);
    });
  }

  it("eingeschaltet mit gueltigem Folgen-Feld: der Schritt laeuft und es steht keine Ueberspringen-Zeile im Log", async () => {
    const folgen = new FakeSocketTransport(["* OK ready"], folgeSchrittOhneKandidaten);
    const main = new FakeSocketTransport(["* OK ready"], dialog(leeresPostfach, 0));
    const context = { n: 0 };
    const zeilen: string[] = [];
    const { svc, verbindungen } = mitFolgen(true, [folgen, main], context, { log: (l) => zeilen.push(l) });
    expect((await svc.syncAccount("acc")).ok).toBe(true);
    expect(verbindungen.n).toBe(2);
    expect(zeilen.some((l) => l.startsWith("follow-copy: skipped"))).toBe(false);
  });

  it("ein Fehler des Schritts (hier: Anmeldung) zaehlt als Fehler und haelt den Lauf nicht an", async () => {
    const kaputt = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", "a001 OK done"] },
      { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 NO [AUTHENTICATIONFAILED] nein"] },
    ]);
    const main = new FakeSocketTransport(["* OK ready"], dialog(leeresPostfach, 0));
    const { svc } = mitFolgen(true, [kaputt, main], { n: 0 });
    expect(await svc.syncAccount("acc")).toMatchObject({ ok: true, counts: { errors: 1 } });
  });

  it("wirft der Schritt eine fremde Ausnahme (hier: der Vault-Stand), zaehlt sie als Fehler, steht im Log und der Lese-Sync laeuft normal", async () => {
    const folgen = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR UIDPLUS", "a001 OK done"] },
      { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
      { expect: /^a003 LOGOUT$/, send: ["* BYE", "a003 OK done"] },
    ]);
    const main = new FakeSocketTransport(["* OK ready"], dialog(leeresPostfach, 0));
    const zeilen: string[] = [];
    const { svc, verbindungen } = mitFolgen(true, [folgen, main], { n: 0 }, {
      log: (l) => zeilen.push(l), context: () => { throw new Error("Cache kaputt"); },
    });
    const r = await svc.syncAccount("acc");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.counts.errors).toBeGreaterThanOrEqual(1);
    expect(verbindungen.n).toBe(2);
    expect(main.written.some((l) => /EXAMINE/.test(l))).toBe(true);
    expect(zeilen.some((l) => l.startsWith("follow-copy: failed") && l.includes("Cache kaputt"))).toBe(true);
    expect(zeilen.some((l) => l.includes("geheim"))).toBe(false);
  });

  it("ohne Dep `follow` bleibt die Einstellung wirkungslos (kein Schritt, eine Verbindung)", async () => {
    const acc = account();
    acc.sync.followThreads = true;
    const main = new FakeSocketTransport(["* OK ready"], dialog(leeresPostfach, 0));
    let n = 0;
    const svc = createSyncService({
      accounts: () => [acc], profile: () => defaultMailProfile(), secret: () => "geheim", transport: () => { n += 1; return main; },
      index: () => new Map(), takenPaths: () => new Set<string>(), executor: () => recordingExecutor().executor,
      uidCache: createUidCache(undefined), busy: createBusyGuard(), events: createEmitter(), timers: testTimers, now: () => new Date("2026-08-30T09:00:00Z"),
    });
    expect((await svc.syncAccount("acc")).ok).toBe(true);
    expect(n).toBe(1);
  });

  describe("Anhaenge in den Anhangordner (A6, W37)", () => {
    const MIXED = [
      "From: a@example.net", "To: b@example.net", "Subject: Mit Anhang", "Message-ID: <anh@example.net>", "Date: Sat, 29 Aug 2026 08:00:00 +0000",
      "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="b"', "", "--b", "Content-Type: text/plain; charset=UTF-8", "", "Hallo", "--b",
      'Content-Type: application/pdf; name="r.pdf"', 'Content-Disposition: attachment; filename="r.pdf"', "Content-Transfer-Encoding: base64", "", "UERG", "--b--", "",
    ].join("\r\n");
    function run(profile: MailProfile, resolver: (() => AttachmentResolver) | undefined, pseudonymize?: TransformPort) {
      const header = new TextEncoder().encode("Message-ID: <anh@example.net>\r\n\r\n");
      const body = new TextEncoder().encode(MIXED);
      const exec = recordingExecutor();
      const fake = new FakeSocketTransport(["* OK ready"], dialog([
        { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 7", "a004 OK done"] },
        { expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[HEADER\.FIELDS \(MESSAGE-ID\)\]\)$/, send: [`* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(header.byteLength)}}`, header, ")", "a005 OK done"] },
        { expect: /^a006 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: [`* 1 FETCH (UID 7 BODY[] {${String(body.byteLength)}}`, body, ")", "a006 OK done"] },
        { expect: /^a007 LOGOUT$/, send: ["* BYE", "a007 OK done"] },
      ]));
      const svc = createSyncService({
        accounts: () => [account()], profile: () => profile, secret: () => "geheim", transport: () => fake, index: () => new Map(),
        takenPaths: () => new Set<string>(), executor: () => exec.executor, uidCache: createUidCache(undefined), busy: createBusyGuard(),
        events: createEmitter(), timers: testTimers, now: () => new Date("2026-08-30T09:00:00Z"),
        ...(resolver ? { attachmentResolver: resolver } : {}),
        ...(pseudonymize ? { pseudonymize } : {}),
      });
      return { svc, exec };
    }
    const resolver: () => AttachmentResolver = () => (mail) => Promise.resolve(new Map(mail.attachments.map((a) => [a.key, { path: `Anhaenge/${a.name}`, write: true }])));

    it("eingeschaltet: der create-Plan traegt die Anhangdatei und die Notiz den Link", async () => {
      const { svc, exec } = run({ ...defaultMailProfile(), saveAttachments: true }, resolver);
      expect(await svc.syncAccount("acc")).toMatchObject({ ok: true, counts: { created: 1, errors: 0 } });
      const plan = exec.seen[0]!;
      if (plan.kind !== "create") throw new Error("create erwartet");
      expect(plan.attachments?.map((a) => a.path)).toEqual(["Anhaenge/r.pdf"]);
      expect(plan.content).toContain("![[Anhaenge/r.pdf]]");
    });
    it("ausgeschaltet (Standard) oder mit Pseudonymisieren: kein Resolver-Aufruf, kein Anhang im Plan", async () => {
      for (const profile of [defaultMailProfile(), { ...defaultMailProfile(), saveAttachments: true, pseudonymize: "required" as const }]) {
        let calls = 0;
        const { svc, exec } = run(profile, () => { calls += 1; return resolver(); }, (req) => Promise.resolve({ kind: "pseudonymized", result: { parts: req.parts.map((p) => ({ id: p.id, value: p.value })), entities: [], applied: 0 } }));
        await svc.syncAccount("acc");
        expect(calls).toBe(0);
        const plan = exec.seen.find((p) => p.kind === "create");
        expect(plan?.kind).toBe("create");
        if (plan && plan.kind === "create") expect(plan.attachments).toBeUndefined();
      }
    });
    it("wirft der Resolver, entsteht die Notiz ohne Anhangdatei und der Lauf zaehlt einen Fehler", async () => {
      const { svc, exec } = run({ ...defaultMailProfile(), saveAttachments: true }, () => () => Promise.reject(new Error("kaputt")));
      expect(await svc.syncAccount("acc")).toMatchObject({ ok: true, counts: { created: 1, errors: 1 } });
      const plan = exec.seen[0]!;
      expect(plan.kind === "create" && plan.attachments).toBeFalsy();
    });
  });

  // W37 (Task „Sync-Grenze von 200 Mails zählt wartende Pseudonymizer-Mails nicht mit“): die Transformation läuft nach der Fetch-Schleife,
  // also zählten wartende Mails zur Grenze mit. 200 Mails, die jedes Mal wieder warten, hielten jede neue Mail dahinter fuer immer draussen
  // und wurden in jedem Lauf neu geholt.
  describe("wartende Mails und die Grenze je Lauf (W37)", () => {
    /** Ein IMAP-Doppelgaenger, der auf jeden Befehl antwortet (statt eines festen Skripts): die Reihenfolge der Abrufe ist ja das Messobjekt. */
    class ReactiveImap extends FakeSocketTransport {
      readonly bodyFetches: number[] = [];
      constructor(private readonly uids: number[], private readonly bodyOf: (uid: number) => string) { super(["* OK ready"], []); }
      override async write(data: Uint8Array | string): Promise<void> {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        for (const line of text.split("\r\n").filter((l) => l !== "")) {
          const m = /^(a\d+) (.*)$/.exec(line);
          if (!m) continue;
          const [, tag, cmd] = m as unknown as [string, string, string];
          const push = (parts: (string | Uint8Array)[]): void => { (this as unknown as { push(p: (string | Uint8Array)[]): void }).push(parts); };
          const body = /^UID FETCH (\d+) \(BODY\.PEEK\[\]\)$/.exec(cmd);
          if (cmd === "CAPABILITY") push(["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", `${tag} OK done`]);
          else if (cmd.startsWith("AUTHENTICATE")) push([`${tag} OK authenticated`]);
          else if (cmd.startsWith("EXAMINE")) push([`* ${String(this.uids.length)} EXISTS`, "* OK [UIDVALIDITY 42] ok", `${tag} OK done`]);
          else if (cmd === "UID SEARCH ALL") push([`* SEARCH ${this.uids.join(" ")}`, `${tag} OK done`]);
          else if (body) {
            const uid = Number(body[1]);
            this.bodyFetches.push(uid);
            const bytes = new TextEncoder().encode(this.bodyOf(uid));
            push([`* 1 FETCH (UID ${String(uid)} BODY[] {${String(bytes.byteLength)}}`, bytes, ")", `${tag} OK done`]);
          } else if (cmd === "LOGOUT") push(["* BYE", `${tag} OK done`]);
          else push([`${tag} BAD unexpected ${cmd}`]);
        }
        await super.write("");
      }
    }
    const mail = (uid: number, wait: boolean): string =>
      `From: a@example.net\r\nTo: b@example.net\r\nSubject: ${wait ? "WARTEN" : "sauber"} ${String(uid)}\r\nMessage-ID: <${wait ? "w" : "n"}${String(uid)}@x>\r\nDate: Sat, 29 Aug 2026 08:00:00 +0000\r\n\r\nHallo\r\n`;

    it("201 dauerhaft wartende Mails halten eine neue saubere Mail nicht mehr dauerhaft draussen und werden nicht jedes Mal alle neu geholt", async () => {
      const WAITING = MAX_FETCH_PER_RUN + 1;
      const uids = Array.from({ length: WAITING + 1 }, (_, i) => i + 1); // 1..201 warten, 202 ist sauber
      const map: Record<string, string> = {};
      for (const uid of uids) map[String(uid)] = `${uid <= WAITING ? "w" : "n"}${String(uid)}@x`;
      const imaps: ReactiveImap[] = [];
      const exec = recordingExecutor();
      const port: TransformPort = (req) => {
        const body = req.parts.find((p) => p.id === "subject")?.value ?? "";
        if (body.includes("WARTEN")) return Promise.resolve({ kind: "wait", reason: "not-ready", message: "wartet" });
        return Promise.resolve({ kind: "pseudonymized", result: { parts: req.parts.map((p) => ({ id: p.id, value: p.value })), entities: [], applied: 0 } });
      };
      const svc = createSyncService({
        accounts: () => [account()], profile: () => ({ ...defaultMailProfile(), pseudonymize: "required" }), secret: () => "geheim",
        transport: () => { const t = new ReactiveImap(uids, (uid) => mail(uid, uid <= WAITING)); imaps.push(t); return t; },
        index: () => new Map(), takenPaths: () => new Set<string>(), executor: () => exec.executor,
        uidCache: createUidCache({ "acc|Vault": { uidValidity: 42, map } }), busy: createBusyGuard(), events: createEmitter(), timers: testTimers,
        now: () => new Date("2026-08-30T09:00:00Z"), pseudonymize: port,
      });
      const first = await svc.syncAccount("acc");
      expect(first).toMatchObject({ ok: true, counts: { created: 0, waiting: MAX_FETCH_PER_RUN } });
      const second = await svc.syncAccount("acc");
      expect(second).toMatchObject({ ok: true, counts: { created: 1 } });
      expect(exec.seen.some((p) => p.kind === "create" && p.mailId === `n${String(WAITING + 1)}@x`)).toBe(true);
      // Die wartenden kommen NACH den neuen und nur mit einem kleinen Anteil wieder dran, nicht alle 200 in jedem Lauf.
      expect(imaps[1]!.bodyFetches.length).toBeLessThan(MAX_FETCH_PER_RUN / 2);
    });
  });
});
