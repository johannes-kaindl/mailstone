// Integrationstest fuer M2 Task 7: faehrt den echten Node-Socket-Transport (kein Fake-Transport)
// gegen den ebenfalls echten scripts/fake-smtp.mjs als Kindprozess. Bewusst NICHT Teil von
// `npm test` (ausgeschlossen ueber --exclude tests/integration/**, s. package.json) — ein echter
// TCP-Verbindungsaufbau + Kindprozess-Start ist langsamer/flakiger als der Rest der Suite und
// gehoert deshalb in `npm run test:integration`. Platform.isDesktop kommt aus dem vitest-Mock
// (tests/vendor/kit/obsidian-mock.ts: Platform.isDesktop === true per Default), deshalb ist
// nodeSocketTransport() hier direkt nutzbar.
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

type FakeSmtpChild = ChildProcessByStdio<null, Readable, Readable>;
import { createSendService } from "../../src/core/send/service";
import { nodeSocketTransport } from "../../src/obsidian/tls-transport";
import { newAccount, type Account } from "../../src/core/settings";

const PORT = Number(process.env.FAKE_SMTP_TEST_PORT ?? 12525);

function waitForReady(child: FakeSmtpChild): Promise<void> {
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
      if (code !== 0 && code !== null) reject(new Error(`fake-smtp.mjs exited early mit code ${String(code)}: ${out}`));
    });
  });
}

describe("SendService gegen scripts/fake-smtp.mjs (echter Socket, echter Kindprozess)", () => {
  let child: FakeSmtpChild | undefined;
  let outDir: string | undefined;

  afterEach(() => {
    child?.kill();
    child = undefined;
    if (outDir) {
      rmSync(outDir, { recursive: true, force: true });
      outDir = undefined;
    }
  });

  it("liefert {ok:true} und schreibt Subject/From korrekt nach <n>.eml", async () => {
    outDir = mkdtempSync(join(tmpdir(), "mailstone-fake-smtp-"));
    child = spawn(process.execPath, [join(process.cwd(), "scripts/fake-smtp.mjs")], {
      env: { ...process.env, PORT: String(PORT), FAKE_SMTP_DIR: outDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForReady(child);

    const account: Account = {
      ...newAccount("fake"),
      label: "Fake",
      username: "user",
      secretId: "mailstone-fake",
      smtp: { host: "127.0.0.1", port: PORT, tls: "none" },
      identities: [{ id: "ich", address: "ich@example.net", name: "Ich Selbst" }],
      defaultIdentityId: "ich",
    };

    const sendService = createSendService({
      accounts: () => [account],
      secret: () => "irrelevant-fuer-den-fake",
      transport: () => nodeSocketTransport(),
      now: () => new Date("2026-08-23T13:00:00.000Z"),
      randomId: () => "fake-smtp-integration",
    });

    const result = await sendService.send("fake", {
      from: "ich",
      to: ["ich@example.net"],
      subject: "Mailstone test",
      text: "Mailstone test 2026-08-23T13:00:00.000Z",
    });

    expect(result).toEqual({ ok: true, messageId: "fake-smtp-integration@example.net" });

    const eml = readFileSync(join(outDir, "1.eml"), "utf8");
    expect(eml).toContain("Subject: Mailstone test");
    expect(eml).toContain("From: Ich Selbst <ich@example.net>");
  });
});
