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

  async function starteServer(): Promise<void> {
    child = spawn(process.execPath, [join(process.cwd(), "scripts/fake-imap.mjs")], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForReady(child);
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
});
