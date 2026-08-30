import { describe, it, expect, vi } from "vitest";
import { FakeSocketTransport, type DialogStep } from "../../helpers/fake-socket";
import { testTimers } from "../../helpers/timers";
import { createSyncService } from "../../../src/core/sync/service";
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

function dialog(extra: DialogStep[]): DialogStep[] {
  return [
    { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN", "a001 OK done"] },
    { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
    { expect: /^a003 EXAMINE /, send: ["* 1 EXISTS", "* OK [UIDVALIDITY 42] ok", "a003 OK done"] },
    ...extra,
  ];
}

function service(steps: DialogStep[], index: MailIndex, exec = recordingExecutor()) {
  const fake = new FakeSocketTransport(["* OK ready"], steps);
  const svc = createSyncService({
    accounts: () => [account()],
    profile: () => defaultMailProfile(),
    secret: () => "geheim",
    transport: () => fake,
    index: () => index,
    takenPaths: () => new Set<string>(),
    executor: () => exec.executor,
    uidCache: createUidCache(undefined),
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
      ]),
      index,
    );
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { detached: 1 } });
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
    ]));
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
    ]));
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
    expect(r).toMatchObject({ ok: true, counts: { detached: 0, errors: 1 } });
    expect(exec.seen).toEqual([]);
  });

  it("meldet no-account fuer eine unbekannte Konto-ID", async () => {
    const { svc } = service([], new Map());
    expect(await svc.syncAccount("gibtsnicht")).toMatchObject({ ok: false, code: "no-account" });
  });
});
