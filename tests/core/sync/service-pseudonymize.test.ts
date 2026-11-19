import { describe, it, expect } from "vitest";
import { FakeSocketTransport, type DialogStep } from "../../helpers/fake-socket";
import { testTimers } from "../../helpers/timers";
import { createSyncService } from "../../../src/core/sync/service";
import { createBusyGuard } from "../../../src/vendor/code-kit/busy-guard";
import { createEmitter } from "../../../src/core/sync/events";
import { createUidCache } from "../../../src/core/sync/uid-cache";
import { defaultMailProfile, withOwnAddresses, type PseudonymizeMode } from "../../../src/core/mirror/profile";
import { newAccount, type Account } from "../../../src/core/settings";
import type { MailIndex } from "../../../src/core/mirror/apply";
import type { NotePlan } from "../../../src/core/mirror/plan";
import type { PlanExecutor } from "../../../src/core/mirror/execute";
import type { PortOutcome, TransformPort } from "../../../src/core/transform/transform-mail";
import type { TransformRequest } from "../../../src/vendor/kit/pseudonymizer-source";

// A5, Schritt 3 (Einhaengepunkt Sync): die Transformation laeuft NACH der Fetch-Schleife und NACH dem Logout, vor planSync.
const EML = "From: Erika Muster <erika@kunde.example>\r\nTo: ich@eigen.example\r\nSubject: Re: [Ticket#4711] Rechnung\r\nMessage-ID: <neu@example.net>\r\nDate: Sat, 29 Aug 2026 08:00:00 +0000\r\n\r\nHallo Erika\r\n";

function account(): Account {
  const a = newAccount("acc");
  a.imap = { host: "imap.example.net", port: 993, tls: "implicit" };
  a.username = "u@example.net";
  a.folders.allowlist = "Vault";
  return a;
}
function recordingExecutor(): { executor: PlanExecutor; seen: NotePlan[] } {
  const seen: NotePlan[] = [];
  return { seen, executor: { execute: (plans) => { seen.push(...plans); return Promise.resolve({ created: plans.filter((p) => p.kind === "create").length, updated: 0, stateChanged: plans.filter((p) => p.kind === "setState").length, skipped: plans.filter((p) => p.kind === "skip"), errors: [] }); } } };
}
const header = new TextEncoder().encode("Message-ID: <neu@example.net>\r\n\r\n");
const body = new TextEncoder().encode(EML);
function steps(logoutTag: string): DialogStep[] {
  return [
    { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", "a001 OK done"] },
    { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
    { expect: /^a003 EXAMINE /, send: ["* 1 EXISTS", "* OK [UIDVALIDITY 42] ok", "a003 OK done"] },
    { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 7", "a004 OK done"] },
    { expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[HEADER\.FIELDS \(MESSAGE-ID\)\]\)$/, send: [`* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(header.byteLength)}}`, header, ")", "a005 OK done"] },
    { expect: /^a006 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: [`* 1 FETCH (UID 7 BODY[] {${String(body.byteLength)}}`, body, ")", "a006 OK done"] },
    { expect: new RegExp(`^${logoutTag} LOGOUT$`), send: ["* BYE", `${logoutTag} OK done`] },
  ];
}

function setup(mode: PseudonymizeMode, port: TransformPort | undefined, index: MailIndex = new Map(), uidCache = createUidCache(undefined)) {
  const fake = new FakeSocketTransport(["* OK ready"], steps("a007"));
  const exec = recordingExecutor();
  const log: string[] = [];
  const svc = createSyncService({
    accounts: () => [account()],
    profile: () => ({ ...withOwnAddresses(defaultMailProfile(), ["ich@eigen.example"]), pseudonymize: mode }),
    secret: () => "geheim", transport: () => fake, index: () => index, takenPaths: () => new Set<string>(),
    executor: () => exec.executor, uidCache, busy: createBusyGuard(), events: createEmitter(), timers: testTimers,
    now: () => new Date("2026-08-30T09:00:00Z"), log: (l) => { log.push(l); },
    ...(port ? { pseudonymize: port } : {}),
  });
  return { svc, fake, exec, log };
}

const replace = (req: TransformRequest): Promise<PortOutcome> => Promise.resolve({
  kind: "pseudonymized",
  result: { parts: req.parts.map((p) => ({ id: p.id, value: p.id === "body" ? "Hallo Person_k3" : p.id === "subject" ? "Re: [Ticket#4711] Person_k3" : p.id.startsWith("from.name") ? "Person_k3" : p.id.startsWith("from.address") ? "Person_k3_Mail" : p.value })), entities: [], applied: 3 },
});

describe("SyncService — Pseudonymisieren (A5)", () => {
  it("Aus: der Port wird nie gerufen, die Notiz entsteht mit .eml wie bisher, waiting ist 0", async () => {
    let calls = 0;
    const { svc, exec } = setup("off", () => { calls += 1; return replace({} as TransformRequest); });
    const r = await svc.syncAccount("acc");
    expect(calls).toBe(0);
    expect(r).toMatchObject({ ok: true, counts: { created: 1, waiting: 0, errors: 0 } });
    expect(exec.seen[0]).toMatchObject({ kind: "create", mailId: "neu@example.net" });
    const p = exec.seen[0] as Extract<NotePlan, { kind: "create" }>;
    expect(p.emlPath).not.toBeNull();
    expect(p.content).toContain("Hallo Erika");
  });

  it("pseudonymisiert: die Notiz traegt die Platzhalter, keine .eml, richtung und Vorgangs-Token stammen aus dem Original", async () => {
    const { svc, exec } = setup("required", replace);
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: 1, waiting: 0, errors: 0 } });
    const p = exec.seen[0] as Extract<NotePlan, { kind: "create" }>;
    expect(p.emlPath).toBeNull();
    expect(p.content).toContain("Hallo Person_k3");
    expect(p.content).not.toContain("Erika");
    expect(p.content).toContain("richtung: eingehend");
    expect(p.eml.byteLength).toBe(0); // das Original-Klartext-Bytepaket reist nicht mit
  });

  it("die Transformation laeuft nach dem Logout (E17): zum Zeitpunkt des Port-Aufrufs ist die Verbindung beendet", async () => {
    let logoutSeen = false;
    const holder: { fake?: FakeSocketTransport } = {};
    const port: TransformPort = (req) => { logoutSeen = holder.fake!.written.some((l) => l.includes("LOGOUT")); return replace(req); };
    const s = setup("required", port);
    holder.fake = s.fake;
    await s.svc.syncAccount("acc");
    expect(logoutSeen).toBe(true);
  });

  it("interactive ist im Sync-Lauf false, ein Aufruf mit interactive: true reicht es durch", async () => {
    const seen: boolean[] = [];
    const port: TransformPort = (req) => { seen.push(req.interactive); return replace(req); };
    await setup("required", port).svc.syncAccount("acc");
    await setup("required", port).svc.syncAccount("acc", { interactive: true });
    expect(seen).toEqual([false, true]);
  });

  it("Verlangt ohne bereites Plugin (wait/absent): keine Notiz, keine .eml, waiting 1, kein Fehler; der naechste Lauf holt die Mail wieder", async () => {
    const uidCache = createUidCache(undefined);
    const wait = setup("required", () => Promise.resolve({ kind: "wait", reason: "absent", message: "fehlt" }), new Map(), uidCache);
    const r = await wait.svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: 0, waiting: 1, errors: 0 } });
    expect(wait.exec.seen.filter((p) => p.kind === "create")).toHaveLength(0);
    expect(wait.log.some((l) => l.includes("transform") && l.includes("absent"))).toBe(true);

    // Zweiter Lauf, Plugin bereit: derselbe Body wird erneut geholt (der UID-Cache kennt die ID, der Index nicht) und geschrieben.
    const fake2 = new FakeSocketTransport(["* OK ready"], [
      steps("a006")[0]!, steps("a006")[1]!, steps("a006")[2]!, steps("a006")[3]!,
      { expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: [`* 1 FETCH (UID 7 BODY[] {${String(body.byteLength)}}`, body, ")", "a005 OK done"] },
      { expect: /^a006 LOGOUT$/, send: ["* BYE", "a006 OK done"] },
    ]);
    const exec2 = recordingExecutor();
    const svc2 = createSyncService({
      accounts: () => [account()], profile: () => ({ ...defaultMailProfile(), pseudonymize: "required" }), secret: () => "geheim", transport: () => fake2,
      index: () => new Map(), takenPaths: () => new Set<string>(), executor: () => exec2.executor, uidCache, busy: createBusyGuard(),
      events: createEmitter(), timers: testTimers, now: () => new Date("2026-08-30T09:00:00Z"), pseudonymize: replace,
    });
    expect(await svc2.syncAccount("acc")).toMatchObject({ ok: true, counts: { created: 1, waiting: 0 } });
    const p = exec2.seen[0] as Extract<NotePlan, { kind: "create" }>;
    expect(p.emlPath).toBeNull();
    expect(p.content).toContain("Hallo Person_k3");
  });

  it("eine wartende Mail macht den Lauf nicht unbestimmt: ein Detach anderer Notizen laeuft weiter", async () => {
    const index: MailIndex = new Map([["weg@example.net", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }]]);
    const { svc, exec } = setup("required", () => Promise.resolve({ kind: "wait", reason: "deferred", message: "offen" }), index);
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { detached: 1, detachSkipped: 0, waiting: 1, created: 0 } });
    expect(exec.seen).toEqual([{ kind: "setState", path: "Mail/2026/w.md", mailId: "weg@example.net", state: "detached", stateField: "mail_state" }]);
  });

  it("error: keine Notiz, ein Fehler im Lauf, der Grund steht im Protokoll", async () => {
    const { svc, exec, log } = setup("if-available", () => Promise.resolve({ kind: "error", reason: "invalid-input", message: "kaputt" }));
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: 0, waiting: 0, errors: 1 } });
    expect(exec.seen.filter((p) => p.kind === "create")).toHaveLength(0);
    expect(log.some((l) => l.includes("invalid-input") && l.includes("kaputt"))).toBe(true);
  });

  it("Wenn verfuegbar und Plugin fehlt (plain): die Notiz entsteht im Klartext, aber ohne .eml", async () => {
    const { svc, exec } = setup("if-available", () => Promise.resolve({ kind: "plain", reason: "absent" }));
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: 1, waiting: 0 } });
    const p = exec.seen[0] as Extract<NotePlan, { kind: "create" }>;
    expect(p.emlPath).toBeNull();
    expect(p.content).toContain("Hallo Erika");
  });

  it("ein Schalter ungleich Aus ohne gebundenen Port schreibt nie Klartext: die Mail wartet", async () => {
    const { svc, exec } = setup("if-available", undefined);
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: 0, waiting: 1 } });
    expect(exec.seen.filter((p) => p.kind === "create")).toHaveLength(0);
  });
});
