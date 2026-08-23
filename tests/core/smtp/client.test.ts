import { describe, it, expect, vi } from "vitest";
import { FakeSocketTransport } from "../../helpers/fake-socket";
import { smtpSend, smtpProbe } from "../../../src/core/smtp/client";
import type { SmtpProbeOptions, SmtpSendOptions } from "../../../src/core/smtp/client";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const baseOpts = (overrides: Partial<SmtpSendOptions> = {}): SmtpSendOptions => ({
  host: "smtp.example.net",
  port: 587,
  tls: "implicit",
  username: "user",
  password: "pass",
  from: "mail@example.net",
  recipients: ["gast@example.org"],
  message: enc("Subject: hi\r\n\r\nHello, world.\r\n"),
  ...overrides,
});

describe("smtpSend", () => {
  it("Happy-Path (implicit TLS): faehrt EHLO/AUTH/MAIL/RCPT/DATA/QUIT ab und liefert die Queued-Antwort", async () => {
    const t = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250-STARTTLS", "250 AUTH PLAIN LOGIN"] },
        { expect: "AUTH PLAIN AHVzZXIAcGFzcw==", send: ["235 2.7.0 ok"] },
        { expect: "MAIL FROM:<mail@example.net>", send: ["250 ok"] },
        { expect: "RCPT TO:<gast@example.org>", send: ["250 ok"] },
        { expect: "DATA", send: ["354 go"] },
        { expect: /^\.$/, send: ["250 2.0.0 queued as abc"] },
        { expect: "QUIT", send: ["221 bye"] },
      ],
    );
    const result = await smtpSend(t, baseOpts());
    expect(result).toEqual({ ok: true, response: "250 2.0.0 queued as abc" });
    expect(t.written).toContain("Subject: hi");
    expect(t.written).toContain("Hello, world.");
    expect(t.written).toContain(".");
    expect(t.closed).toBe(true);
  });

  it("STARTTLS-Pfad: upgraded vor AUTH und wiederholt EHLO", async () => {
    const t = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250-STARTTLS", "250 AUTH PLAIN"] },
        { expect: "STARTTLS", send: ["220 ready"], upgrade: true },
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250 AUTH PLAIN"] },
        { expect: "AUTH PLAIN AHVzZXIAcGFzcw==", send: ["235 2.7.0 ok"] },
        { expect: "MAIL FROM:<mail@example.net>", send: ["250 ok"] },
        { expect: "RCPT TO:<gast@example.org>", send: ["250 ok"] },
        { expect: "DATA", send: ["354 go"] },
        { expect: /^\.$/, send: ["250 2.0.0 queued as abc"] },
        { expect: "QUIT", send: ["221 bye"] },
      ],
    );
    const result = await smtpSend(t, baseOpts({ tls: "starttls" }));
    expect(result).toEqual({ ok: true, response: "250 2.0.0 queued as abc" });
    expect(t.connectCalls[0]?.tls).toBe("starttls");
  });

  it("tls-required: STARTTLS angefordert, aber Server bietet die Capability nicht — kein AUTH im Dialog", async () => {
    const t = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [{ expect: /^EHLO /, send: ["250 smtp.example.net"] }],
    );
    const result = await smtpSend(t, baseOpts({ tls: "starttls" }));
    expect(result).toEqual({ ok: false, code: "tls-required", detail: expect.any(String) });
    expect(t.written.some((l) => l.startsWith("AUTH"))).toBe(false);
  });

  it("auth: 535-Antwort auf AUTH PLAIN liefert code:'auth' mit 535 im detail", async () => {
    const t = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250 AUTH PLAIN"] },
        { expect: "AUTH PLAIN AHVzZXIAcGFzcw==", send: ["535 5.7.8 bad credentials"] },
      ],
    );
    const result = await smtpSend(t, baseOpts());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("auth");
      expect(result.detail).toContain("535");
    }
  });

  it("AUTH PLAIN kodiert Umlaut-Passwoerter als UTF-8-Bytes, nicht als Latin-1 (btoa-Bug)", async () => {
    // Base64 von UTF-8-Bytes von "\0user\0pässwörd" — verifiziert mit node vor dem Festschreiben.
    const t = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250 AUTH PLAIN"] },
        { expect: "AUTH PLAIN AHVzZXIAcMOkc3N3w7ZyZA==", send: ["235 2.7.0 ok"] },
        { expect: "MAIL FROM:<mail@example.net>", send: ["250 ok"] },
        { expect: "RCPT TO:<gast@example.org>", send: ["250 ok"] },
        { expect: "DATA", send: ["354 go"] },
        { expect: /^\.$/, send: ["250 2.0.0 queued as abc"] },
        { expect: "QUIT", send: ["221 bye"] },
      ],
    );
    const log = vi.fn();
    const result = await smtpSend(t, baseOpts({ password: "pässwörd", log }));
    expect(result).toEqual({ ok: true, response: "250 2.0.0 queued as abc" });
    const lines = log.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain("C: AUTH PLAIN ****");
    expect(lines.some((l) => l.includes("AHVzZXIAcMOkc3N3w7ZyZA=="))).toBe(false);
  });

  it("teilweise abgelehnte Empfaenger: ok:true mit rejected-Liste, wenn mindestens einer akzeptiert wurde", async () => {
    const t = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250 AUTH PLAIN"] },
        { expect: "AUTH PLAIN AHVzZXIAcGFzcw==", send: ["235 2.7.0 ok"] },
        { expect: "MAIL FROM:<mail@example.net>", send: ["250 ok"] },
        { expect: "RCPT TO:<gast@example.org>", send: ["250 ok"] },
        { expect: "RCPT TO:<bad@example.org>", send: ["550 5.1.1 no such user"] },
        { expect: "DATA", send: ["354 go"] },
        { expect: /^\.$/, send: ["250 2.0.0 queued as abc"] },
        { expect: "QUIT", send: ["221 bye"] },
      ],
    );
    const result = await smtpSend(t, baseOpts({ recipients: ["gast@example.org", "bad@example.org"] }));
    expect(result).toEqual({ ok: true, response: "250 2.0.0 queued as abc", rejected: ["bad@example.org"] });
  });

  it("alle Empfaenger abgelehnt: code:'recipient-rejected'", async () => {
    const t = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250 AUTH PLAIN"] },
        { expect: "AUTH PLAIN AHVzZXIAcGFzcw==", send: ["235 2.7.0 ok"] },
        { expect: "MAIL FROM:<mail@example.net>", send: ["250 ok"] },
        { expect: "RCPT TO:<bad@example.org>", send: ["550 5.1.1 no such user"] },
      ],
    );
    const result = await smtpSend(t, baseOpts({ recipients: ["bad@example.org"] }));
    expect(result).toEqual({ ok: false, code: "recipient-rejected", detail: expect.any(String), rejected: ["bad@example.org"] });
  });

  it("Log-Maskierung: AUTH PLAIN wird im log als **** maskiert, der Base64-Wert erscheint nie", async () => {
    const t = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250 AUTH PLAIN"] },
        { expect: "AUTH PLAIN AHVzZXIAcGFzcw==", send: ["235 2.7.0 ok"] },
        { expect: "MAIL FROM:<mail@example.net>", send: ["250 ok"] },
        { expect: "RCPT TO:<gast@example.org>", send: ["250 ok"] },
        { expect: "DATA", send: ["354 go"] },
        { expect: /^\.$/, send: ["250 2.0.0 queued as abc"] },
        { expect: "QUIT", send: ["221 bye"] },
      ],
    );
    const log = vi.fn();
    await smtpSend(t, baseOpts({ log }));
    const lines = log.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain("C: AUTH PLAIN ****");
    expect(lines.some((l) => l.includes("AHVzZXIAcGFzcw=="))).toBe(false);
  });

  it("NetError des Transports (Skript erschoepft) wird auf {ok:false, code:'closed'} gemappt", async () => {
    const t = new FakeSocketTransport(["220 smtp.example.net ESMTP"], []);
    const result = await smtpSend(t, baseOpts());
    expect(result).toEqual({ ok: false, code: "closed", detail: expect.any(String) });
  });
});

const baseProbeOpts = (overrides: Partial<SmtpProbeOptions> = {}): SmtpProbeOptions => ({
  host: "smtp.example.net",
  port: 587,
  tls: "implicit",
  username: "user",
  password: "pass",
  ...overrides,
});

describe("smtpProbe", () => {
  it("Happy-Path: EHLO -> AUTH -> QUIT, liefert die EHLO-Capabilities, faehrt nie MAIL FROM", async () => {
    const t = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250-STARTTLS", "250 AUTH PLAIN LOGIN"] },
        { expect: "AUTH PLAIN AHVzZXIAcGFzcw==", send: ["235 2.7.0 ok"] },
        { expect: "QUIT", send: ["221 bye"] },
      ],
    );
    const result = await smtpProbe(t, baseProbeOpts());
    expect(result).toEqual({ ok: true, capabilities: ["250-smtp.example.net", "250-STARTTLS", "250 AUTH PLAIN LOGIN"] });
    expect(t.written.some((l) => l.startsWith("MAIL FROM"))).toBe(false);
    expect(t.closed).toBe(true);
  });

  it("STARTTLS-Pfad: upgraded vor AUTH, Capabilities kommen aus dem zweiten EHLO", async () => {
    const t = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250 STARTTLS"] },
        { expect: "STARTTLS", send: ["220 ready"], upgrade: true },
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250 AUTH PLAIN LOGIN"] },
        { expect: "AUTH PLAIN AHVzZXIAcGFzcw==", send: ["235 2.7.0 ok"] },
        { expect: "QUIT", send: ["221 bye"] },
      ],
    );
    const result = await smtpProbe(t, baseProbeOpts({ tls: "starttls" }));
    expect(result).toEqual({ ok: true, capabilities: ["250-smtp.example.net", "250 AUTH PLAIN LOGIN"] });
    expect(t.connectCalls[0]?.tls).toBe("starttls");
  });

  it("auth: 535-Antwort auf AUTH PLAIN liefert code:'auth', kein QUIT im Dialog", async () => {
    const t = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-smtp.example.net", "250 AUTH PLAIN"] },
        { expect: "AUTH PLAIN AHVzZXIAcGFzcw==", send: ["535 5.7.8 bad credentials"] },
      ],
    );
    const result = await smtpProbe(t, baseProbeOpts());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("auth");
      expect(result.detail).toContain("535");
    }
    expect(t.written.some((l) => l === "QUIT")).toBe(false);
  });

  it("tls-required: STARTTLS angefordert, aber Server bietet die Capability nicht", async () => {
    const t = new FakeSocketTransport(
      ["220 smtp.example.net ESMTP"],
      [{ expect: /^EHLO /, send: ["250 smtp.example.net"] }],
    );
    const result = await smtpProbe(t, baseProbeOpts({ tls: "starttls" }));
    expect(result).toEqual({ ok: false, code: "tls-required", detail: expect.any(String) });
  });
});
