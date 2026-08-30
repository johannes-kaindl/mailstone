import { describe, it, expect } from "vitest";
import { FakeSocketTransport } from "../../helpers/fake-socket";
import { newAccount, type Account } from "../../../src/core/settings";
import { resolveSender, createSendService, isLoopback, type SendDeps } from "../../../src/core/send/service";
import type { OutgoingMessage } from "../../../src/core/send/outgoing";

function makeAccount(overrides: Partial<Account> = {}): Account {
  const a = newAccount("privat");
  a.label = "Privat";
  a.username = "user";
  a.secretId = "mailstone-privat";
  a.smtp = { host: "smtp.example.net", port: 587, tls: "implicit" };
  a.identities = [{ id: "mail", address: "mail@example.net", name: "Max Muster" }];
  a.defaultIdentityId = "mail";
  return { ...a, ...overrides };
}

const baseMsg: OutgoingMessage = { from: "mail", to: ["gast@example.org"], subject: "Hallo", text: "Hi" };

function happyPathTransport(): FakeSocketTransport {
  return new FakeSocketTransport(
    ["220 smtp.example.net ESMTP"],
    [
      { expect: /^EHLO /, send: ["250-smtp.example.net", "250 AUTH PLAIN"] },
      { expect: /^AUTH PLAIN /, send: ["235 2.7.0 ok"] },
      { expect: "MAIL FROM:<mail@example.net>", send: ["250 ok"] },
      { expect: "RCPT TO:<gast@example.org>", send: ["250 ok"] },
      { expect: "DATA", send: ["354 go"] },
      { expect: /^\.$/, send: ["250 2.0.0 queued as abc"] },
      { expect: "QUIT", send: ["221 bye"] },
    ],
  );
}

describe("resolveSender", () => {
  const accounts = [makeAccount()];
  it("unbekanntes Konto -> unknown-account", () => {
    expect(resolveSender(accounts, "nope", "mail")).toEqual({ ok: false, code: "unknown-account" });
  });
  it("unbekannte Identity -> unknown-identity", () => {
    expect(resolveSender(accounts, "privat", "nope")).toEqual({ ok: false, code: "unknown-identity" });
  });
  it("bekannt -> Objekt mit account+identity", () => {
    const r = resolveSender(accounts, "privat", "mail");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.account.id).toBe("privat");
    expect(r.identity.id).toBe("mail");
  });
});

describe("createSendService", () => {
  function makeDeps(overrides: Partial<SendDeps> & { transportInstance?: FakeSocketTransport } = {}): { deps: SendDeps; transport: FakeSocketTransport } {
    const transport = overrides.transportInstance ?? happyPathTransport();
    const deps: SendDeps = {
      accounts: () => [makeAccount()],
      secret: () => "geheim",
      transport: () => transport,
      now: () => new Date("2026-08-23T13:00:00.000Z"),
      randomId: () => "msgid-1",
      ...overrides,
    };
    return { deps, transport };
  }

  it("Happy-Path: {ok:true, messageId endet auf @example.net}, From/To/Envelope korrekt", async () => {
    const { deps, transport } = makeDeps();
    const service = createSendService(deps);
    const result = await service.send("privat", baseMsg);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.messageId).toMatch(/@example\.net$/);
    expect(transport.written).toContain("From: Max Muster <mail@example.net>");
    expect(transport.written).toContain("To: gast@example.org");
    expect(transport.written).toContain("MAIL FROM:<mail@example.net>");
  });

  it("unbekannte Identity -> unknown-identity, Transport wurde nie verbunden", async () => {
    const { deps, transport } = makeDeps();
    const service = createSendService(deps);
    const result = await service.send("privat", { ...baseMsg, from: "dienst-kennung" });
    expect(result).toEqual({ ok: false, code: "unknown-identity" });
    expect(transport.connectCalls.length).toBe(0);
  });

  it("no-secret: secret() liefert null -> Code, kein connect", async () => {
    const { deps, transport } = makeDeps({ secret: () => null });
    const service = createSendService(deps);
    const result = await service.send("privat", baseMsg);
    expect(result).toEqual({ ok: false, code: "no-secret" });
    expect(transport.connectCalls.length).toBe(0);
  });

  it("SMTP-Fehler wird durchgereicht: 535 -> {ok:false, code:'auth'}", async () => {
    const authFailTransport = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250 AUTH PLAIN"] },
        { expect: /^AUTH PLAIN /, send: ["535 5.7.8 auth failed"] },
      ],
    );
    const { deps } = makeDeps({ transportInstance: authFailTransport });
    const service = createSendService(deps);
    const result = await service.send("privat", baseMsg);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("auth");
  });

  it("invalid: buildMime wirft (kaputte Absenderadresse) -> {ok:false, code:'invalid'}, kein connect", async () => {
    const account = makeAccount({ identities: [{ id: "mail", address: "kaputt", name: "Max Muster" }] });
    const { deps, transport } = makeDeps({ accounts: () => [account] });
    const service = createSendService(deps);
    const result = await service.send("privat", baseMsg);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("invalid");
    expect(transport.connectCalls.length).toBe(0);
  });

  it("invalid: validateOutgoing schlaegt fehl (keine Empfaenger) -> {ok:false, code:'invalid'}, kein connect", async () => {
    const { deps, transport } = makeDeps();
    const service = createSendService(deps);
    const result = await service.send("privat", { ...baseMsg, to: [] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("invalid");
    expect(transport.connectCalls.length).toBe(0);
  });

  it("tls:'none' + Nicht-Loopback-Host -> tls-required, kein connect", async () => {
    const account = makeAccount({ smtp: { host: "smtp.example.net", port: 25, tls: "none" } });
    const { deps, transport } = makeDeps({ accounts: () => [account] });
    const service = createSendService(deps);
    const result = await service.send("privat", baseMsg);
    expect(result).toEqual({ ok: false, code: "tls-required" });
    expect(transport.connectCalls.length).toBe(0);
  });

  it("tls:'none' + 127.0.0.1 -> Dialog laeuft (connect wird versucht)", async () => {
    const localTransport = new FakeSocketTransport(
      ["220 localhost ESMTP"],
      [{ expect: /^EHLO /, send: ["250 localhost"] }],
    );
    const account = makeAccount({ smtp: { host: "127.0.0.1", port: 2525, tls: "none" } });
    const { deps, transport } = makeDeps({ accounts: () => [account], transportInstance: localTransport });
    const service = createSendService(deps);
    await service.send("privat", baseMsg);
    expect(transport.connectCalls.length).toBe(1);
  });
});

describe("isLoopback", () => {
  it("127.0.0.1, ::1, localhost -> true", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("localhost")).toBe(true);
  });
  it("smtp.example.net -> false", () => {
    expect(isLoopback("smtp.example.net")).toBe(false);
  });
});

describe("Kopie im Sent-Ordner", () => {
  function imapFake(appendAntwort: string[]): FakeSocketTransport {
    return new FakeSocketTransport(
      ["* OK ready"],
      [
        { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", "a001 OK done"] },
        { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
        { expect: /^a003 APPEND /, send: appendAntwort },
        { expect: /^$/, send: ["a003 OK [APPENDUID 1 9] done"] },
        { expect: /^a004 LOGOUT$/, send: ["* BYE", "a004 OK done"] },
      ],
    );
  }

  function sendeMit(imap: FakeSocketTransport | undefined, sentOrdner: string | undefined) {
    const konto = makeAccount();
    konto.folders = { ...konto.folders, ...(sentOrdner === undefined ? {} : { sent: sentOrdner }) };
    const smtp = happyPathTransport();
    return createSendService({
      accounts: () => [konto],
      secret: () => "geheim",
      transport: () => smtp,
      now: () => new Date("2026-08-23T13:00:00.000Z"),
      randomId: () => "msgid-1",
      timers: { setTimeout: (f, ms) => globalThis.setTimeout(f, ms) as unknown as number, clearTimeout: (i) => { globalThis.clearTimeout(i); } },
      ...(imap ? { imapTransport: () => imap } : {}),
    });
  }

  it("legt die gesendete Mail per APPEND im Sent-Ordner ab", async () => {
    const imap = imapFake(["+ Ready for literal data"]);
    const r = await sendeMit(imap, "Sent").send("privat", baseMsg);
    expect(r).toMatchObject({ ok: true, sentCopy: "ok" });
    expect(imap.written.some((l) => /^a003 APPEND "Sent" \(\\Seen\) \{\d+\}$/.test(l))).toBe(true);
    // Die abgelegte Kopie ist dieselbe Nachricht, die verschickt wurde.
    expect(imap.written.join("\n")).toContain("Subject: Hallo");
  });

  it("ein Fehlschlag der Kopie laesst den Versand erfolgreich bleiben", async () => {
    const imap = imapFake(["a003 NO [TRYCREATE] Mailbox doesn't exist"]);
    const r = await sendeMit(imap, "Sent").send("privat", baseMsg);
    expect(r).toMatchObject({ ok: true, messageId: "msgid-1@example.net", sentCopy: "failed" });
  });

  it("ohne Sent-Ordner wird nichts abgelegt und nichts verbunden", async () => {
    const imap = imapFake(["+ ok"]);
    const r = await sendeMit(imap, "").send("privat", baseMsg);
    expect(r).toMatchObject({ ok: true, sentCopy: "skipped" });
    expect(imap.connectCalls).toHaveLength(0);
  });
});
