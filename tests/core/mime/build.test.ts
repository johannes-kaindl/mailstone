import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { buildMime, encodeQuotedPrintable, sanitizeHeaderValue } from "../../../src/core/mime/build";
import { validateOutgoing } from "../../../src/core/send/outgoing";
import { parseEml } from "../../../src/core/mime/parse";

const base = { from: "privat/mail", to: ["gast@example.org"], subject: "Einladung: Planung, 2026-09-01", text: "Du bist eingeladen.\nOrt: Büro." };
const opts = { sender: { address: "mail@example.net", name: "Max Muster" }, messageId: "test-0001@example.net", date: new Date("2026-08-23T13:00:00.000Z"), boundarySeed: "fixed" };

describe("encodeQuotedPrintable", () => {
  it("kodiert Umlaute und =, bricht bei 76", () => {
    expect(encodeQuotedPrintable("Grüße=")).toBe("Gr=C3=BC=C3=9Fe=3D");
    const long = encodeQuotedPrintable("a".repeat(100));
    for (const l of long.split("\r\n")) expect(l.length).toBeLessThanOrEqual(76);
  });
});
describe("sanitizeHeaderValue", () => {
  it("ersetzt CR/LF/CRLF durch ein Leerzeichen und kollabiert Whitespace", () => {
    expect(sanitizeHeaderValue("Hi\r\nBcc: evil@example.org")).toBe("Hi Bcc: evil@example.org");
    expect(sanitizeHeaderValue("a\r\n\r\nb")).toBe("a b");
    expect(sanitizeHeaderValue("a   b")).toBe("a b");
  });
});
describe("buildMime", () => {
  it("Plain-Text-Mail: Header, QP-Body, Umlaut-Betreff RFC 2047", async () => {
    const { bytes, envelopeRecipients } = buildMime({ ...base, subject: "Grüße" }, opts);
    const s = new TextDecoder().decode(bytes);
    expect(s).toContain("From: Max Muster <mail@example.net>\r\n");
    expect(s).toContain("Subject: =?UTF-8?B?R3LDvMOfZQ==?=\r\n");
    expect(s).toContain("Message-ID: <test-0001@example.net>\r\n");
    expect(s).toContain("Date: Sun, 23 Aug 2026 15:00:00 +0200\r\n");
    expect(s).toContain("Content-Type: text/plain; charset=utf-8\r\n");
    expect(envelopeRecipients).toEqual(["gast@example.org"]);
    const back = await parseEml(bytes);
    expect(back.subject).toBe("Grüße"); expect(back.text?.trim()).toBe("Du bist eingeladen.\nOrt: Büro.");
  });
  it("iMIP: multipart/alternative mit text/calendar; method=REQUEST + invite.ics-Anhang", async () => {
    const ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:ev-1\r\nSUMMARY:Planung\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    const { bytes } = buildMime({ ...base, calendar: { method: "REQUEST", ics } }, opts);
    const s = new TextDecoder().decode(bytes);
    expect(s).toMatch(/Content-Type: multipart\/mixed; boundary="[^"]+"\r\n/);
    expect(s).toMatch(/Content-Type: multipart\/alternative; boundary="[^"]+"\r\n/);
    expect(s).toContain('Content-Type: text/calendar; method=REQUEST; charset=utf-8\r\n');
    expect(s).toContain('Content-Disposition: attachment; filename="invite.ics"\r\n');
    const back = await parseEml(bytes);
    expect(back.text?.trim()).toBe("Du bist eingeladen.\nOrt: Büro.");
    expect(back.attachments.map((a) => a.name)).toContain("invite.ics");
    // Golden-File: beim ersten Lauf schreiben, danach vergleichen (Review sieht Aenderungen am Format)
    const golden = "tests/fixtures/golden/imip-request.eml";
    if (!existsSync(golden)) {
      // CI-Guard: ein fehlendes Golden-File darf in CI nie still neu geschrieben werden —
      // sonst faellt eine unabsichtliche Format-Aenderung nie auf (sie "besteht" einfach,
      // weil das neue Ergebnis sich selbst zum neuen Golden-File macht).
      if (process.env["CI"]) throw new Error(`golden file missing: ${golden}`);
      mkdirSync("tests/fixtures/golden", { recursive: true });
      writeFileSync(golden, bytes);
    }
    expect(s).toBe(readFileSync(golden, "utf8"));
  });
  it("Threading-Header und bcc nur im Envelope", () => {
    const { bytes, envelopeRecipients } = buildMime({ ...base, bcc: ["hidden@example.org"], inReplyTo: "x@example.org", references: ["r@example.org", "x@example.org"] }, opts);
    const s = new TextDecoder().decode(bytes);
    expect(s).toContain("In-Reply-To: <x@example.org>\r\n");
    expect(s).toContain("References: <r@example.org> <x@example.org>\r\n");
    expect(s).not.toContain("hidden@example.org");
    expect(envelopeRecipients).toEqual(["gast@example.org", "hidden@example.org"]);
  });
  it("Header-Injection ueber Subject wird unschaedlich gemacht", () => {
    const { bytes, envelopeRecipients } = buildMime({ ...base, subject: "Hi\r\nBcc: evil@example.org", to: ["gast@example.org"] }, opts);
    const s = new TextDecoder().decode(bytes);
    const subjectLines = s.split("\r\n").filter((l) => l.startsWith("Subject:"));
    expect(subjectLines.length).toBe(1);
    expect(s.split("\r\n").some((l) => l.startsWith("Bcc:"))).toBe(false);
    expect(envelopeRecipients).toEqual(["gast@example.org"]);
  });
  it("Header-Injection ueber In-Reply-To wird durch Whitespace-Entfernung entschaerft", () => {
    const { bytes } = buildMime({ ...base, inReplyTo: "x@example.org\r\nBcc: e@x" }, opts);
    const s = new TextDecoder().decode(bytes);
    expect(s).toContain("In-Reply-To: <x@example.orgBcc:e@x>\r\n");
    expect(s.split("\r\n").some((l) => l.startsWith("Bcc:"))).toBe(false);
  });
  it("Header-Injection ueber die Absenderadresse: buildMime wirft statt eine Bcc-Zeile einzuschleusen", () => {
    const badOpts = { ...opts, sender: { address: "mail@example.net\r\nBcc: e@x", name: "Max Muster" } };
    expect(() => buildMime(base, badOpts)).toThrow();
  });
  it("Empfaenger mit CRLF: buildMime wirft, envelopeRecipients wird nie ungeprueft geliefert", () => {
    expect(() => buildMime({ ...base, to: ["gast@example.org\r\nRCPT TO:<evil@example.org>"] }, opts)).toThrow("invalid recipient address");
    expect(() => buildMime({ ...base, cc: ["c@example.org\r\nDATA"] }, opts)).toThrow("invalid recipient address");
    expect(() => buildMime({ ...base, bcc: ["kein-at-zeichen"] }, opts)).toThrow("invalid recipient address");
  });
  it("Header-Injection ueber die Message-ID: keine Bcc-Zeile, genau eine Message-ID-Zeile", () => {
    const idOpts = { ...opts, messageId: "x\r\nBcc: e@x" };
    const { bytes } = buildMime(base, idOpts);
    const s = new TextDecoder().decode(bytes);
    const lines = s.split("\r\n");
    expect(lines.filter((l) => l.startsWith("Message-ID:")).length).toBe(1);
    expect(lines.some((l) => l.startsWith("Bcc:"))).toBe(false);
  });
  it("Header-Injection ueber den Anhangs-Content-Type wird auf type/subtype eingedampft", async () => {
    const { bytes } = buildMime(
      { ...base, attachments: [{ name: "a.txt", type: "text/plain\r\nContent-Disposition: inline", data: new Uint8Array([1, 2, 3]) }] },
      opts,
    );
    const s = new TextDecoder().decode(bytes);
    expect(s).toContain('Content-Type: text/plain; name="a.txt"\r\n');
    expect(s.split("\r\n").some((l) => l.startsWith("Content-Disposition: inline"))).toBe(false);
    const back = await parseEml(bytes);
    expect(back.attachments.map((a) => a.name)).toContain("a.txt");
  });
});
describe("validateOutgoing", () => {
  it("ohne Empfaenger / leerer Betreff / ungueltige Adresse", () => {
    expect(validateOutgoing({ ...base, to: [] })).toEqual({ ok: false, code: "no-recipients" });
    expect(validateOutgoing({ ...base, subject: " " })).toEqual({ ok: false, code: "empty-subject" });
    expect(validateOutgoing({ ...base, to: ["kein-at"] })).toEqual({ ok: false, code: "invalid-address" });
    expect(validateOutgoing(base)).toEqual({ ok: true });
  });
});
