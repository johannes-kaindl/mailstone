// Eigene Datei, weil hier `parseEml` per vi.mock ersetzt wird: eine reproduzierbar unparsbare
// Mail laesst sich mit echten Bytes nicht zuverlaessig erzeugen (postal-mime ist absichtlich
// nachsichtig). Geprueft wird der Befund der Abschluss-Runde: `undetermined` war ein globaler
// Zaehler, und `undetermined > 0` unterdrueckte JEDES Detach des Laufs. Eine Mail, die parseEml
// reproduzierbar wirft, wirft in jedem Lauf — der Detach-Zweig war damit nicht bis zum naechsten
// sauberen Lauf ausgesetzt, sondern dauerhaft. Bei MIME-Schaden parst der HEADER aber in aller
// Regel noch, die ID steht also im UID-Cache und onServer ist fuer diese UID vollstaendig.
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/core/mime/parse", () => ({
  parseEml: () => {
    throw new Error("MIME kaputt");
  },
}));

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

function account(): Account {
  const a = newAccount("acc");
  a.imap = { host: "imap.example.net", port: 993, tls: "implicit" };
  a.username = "u@example.net";
  a.folders.allowlist = "Vault";
  return a;
}

function run(steps: DialogStep[], index: MailIndex, uidCache: ReturnType<typeof createUidCache>) {
  const seen: NotePlan[] = [];
  const fake = new FakeSocketTransport(["* OK ready"], [
    { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", "a001 OK done"] },
    { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
    { expect: /^a003 EXAMINE /, send: ["* 1 EXISTS", "* OK [UIDVALIDITY 42] ok", "a003 OK done"] },
    ...steps,
  ]);
  const svc = createSyncService({
    accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim",
    transport: () => fake, index: () => index, takenPaths: () => new Set<string>(),
    executor: () => ({
      execute: (plans) => {
        seen.push(...plans);
        return Promise.resolve({
          created: plans.filter((p) => p.kind === "create").length,
          updated: 0,
          stateChanged: plans.filter((p) => p.kind === "setState").length,
          skipped: [],
          errors: [],
        });
      },
    }),
    uidCache, busy: createBusyGuard(), events: createEmitter(), timers: testTimers,
    now: () => new Date("2026-08-30T09:00:00Z"),
  });
  return { svc, seen };
}

const BODY = new TextEncoder().encode("From: a@example.net\r\nMessage-ID: <kaputt@example.net>\r\n\r\nkaputt\r\n");

const steps: DialogStep[] = [
  { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 7", "a004 OK done"] },
  { expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: [`* 1 FETCH (UID 7 BODY[] {${String(BODY.byteLength)}}`, BODY, ")", "a005 OK done"] },
  { expect: /LOGOUT$/, send: ["* BYE", "a999 OK done"] },
];

describe("SyncService mit einer dauerhaft unparsbaren Mail", () => {
  it("legt den Detach-Zweig NICHT still, wenn die ID der kaputten Mail im Cache steht", async () => {
    const index: MailIndex = new Map([["weg@example.net", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }]]);
    const cache = createUidCache({ "acc|Vault": { uidValidity: 42, map: { "7": "kaputt@example.net" } } });
    const { svc, seen } = run(steps, index, cache);
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { detached: 1, detachSkipped: 0, errors: 1 } });
    expect(seen).toEqual([{ kind: "setState", path: "Mail/2026/w.md", mailId: "weg@example.net", state: "detached", stateField: "mail_state" }]);
  });

  it("setzt Detaches weiterhin aus, wenn die ID der kaputten Mail auch im Cache fehlt", async () => {
    const index: MailIndex = new Map([["weg@example.net", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }]]);
    // Ohne Cache-Treffer muss der Lauf erst den Header holen — der liefert hier nichts, die ID
    // bleibt also wirklich unbestimmt und onServer unvollstaendig.
    const withHeader: DialogStep[] = [
      { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 7", "a004 OK done"] },
      { expect: /^a005 UID FETCH .*HEADER\.FIELDS/, send: ["a005 OK done"] },
      { expect: /^a006 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: [`* 1 FETCH (UID 7 BODY[] {${String(BODY.byteLength)}}`, BODY, ")", "a006 OK done"] },
      { expect: /LOGOUT$/, send: ["* BYE", "a999 OK done"] },
    ];
    const { svc, seen } = run(withHeader, index, createUidCache(undefined));
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { detached: 0, detachSkipped: 1, errors: 1 } });
    expect(seen).toEqual([]);
  });
});
