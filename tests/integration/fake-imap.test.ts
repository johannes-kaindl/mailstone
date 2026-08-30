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
import { createSyncService } from "../../src/core/sync/service";
import { createBusyGuard } from "../../src/core/sync/busy";
import { createEmitter } from "../../src/core/sync/events";
import { createUidCache } from "../../src/core/sync/uid-cache";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { nodeSocketTransport } from "../../src/obsidian/tls-transport";
import { newAccount } from "../../src/core/settings";
import { testTimers } from "../helpers/timers";
import type { NotePlan } from "../../src/core/mirror/plan";

const PORT = Number(process.env.FAKE_IMAP_TEST_PORT ?? 11143);

function waitForReady(child: FakeImapChild): Promise<void> {
  return new Promise((resolve, reject) => {
    let out = "";
    const onData = (chunk: Buffer): void => {
      out += chunk.toString("utf8");
      if (out.includes("listening on")) {
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`fake-imap.mjs exited early mit code ${String(code)}: ${out}`));
    });
  });
}

describe("SyncService gegen scripts/fake-imap.mjs (echter Socket, echter Kindprozess)", () => {
  let child: FakeImapChild | undefined;

  afterEach(() => {
    child?.kill();
    child = undefined;
  });

  it("legt ueber den echten Socket zwei Notizen an und meldet sie als created", async () => {
    child = spawn(process.execPath, [join(process.cwd(), "scripts/fake-imap.mjs")], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForReady(child);

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

    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: 2 } });
    expect(seen.map((p) => p.mailId).sort()).toEqual(["eins@example.net", "zwei@example.net"]);
  });
});
