import { describe, it, expect } from "vitest";
import { originalFactsOf } from "../../../src/core/transform/original-facts";
import { defaultMailProfile, withOwnAddresses } from "../../../src/core/mirror/profile";
import { buildDerivedFrontmatter } from "../../../src/core/render/frontmatter";
import { tokenOf, tokenRegexOf } from "../../../src/core/thread/token";
import type { ParsedMail } from "../../../src/core/mime/types";

const mail = (over: Partial<ParsedMail> = {}): ParsedMail => ({
  id: "a@x", messageIdRaw: "<a@x>", inReplyTo: null, references: [], from: { name: "Erika", address: "Erika@Example.org" }, to: [], cc: [],
  subject: "Re: [Ticket#1] Anfrage", date: new Date("2026-08-29T08:00:00Z"), text: "t", html: null, attachments: [], attachmentData: new Map(), rawSize: 1, ...over,
});

describe("originalFactsOf", () => {
  const profile = defaultMailProfile();
  it("ohne eigene Adressen: eingehend", () => { expect(originalFactsOf(mail(), profile).direction).toBe("eingehend"); });
  it("Absender unter den eigenen Adressen (Gross-/Kleinschreibung egal): ausgehend", () => {
    expect(originalFactsOf(mail(), withOwnAddresses(profile, ["erika@example.org"])).direction).toBe("ausgehend");
  });
  it("Token aus dem Betreff nach der eingestellten Regel", () => { expect(originalFactsOf(mail(), profile).threadToken).toBe("[Ticket#1]"); });
  it("ohne Treffer oder ohne Regel: null", () => {
    expect(originalFactsOf(mail({ subject: "Hallo" }), profile).threadToken).toBeNull();
    expect(originalFactsOf(mail(), { ...profile, threadTokenPattern: "" }).threadToken).toBeNull();
  });
  it("dieselben Regeln wie die Ableitung aus der Mail selbst (keine zweite Implementierung)", () => {
    const own = withOwnAddresses(profile, ["erika@example.org", "x@y.z"]);
    for (const m of [mail(), mail({ from: null }), mail({ from: { name: "", address: "fremd@example.org" } }), mail({ subject: "Ticket [Ticket#77] [Ticket#78]" })]) {
      const f = originalFactsOf(m, own);
      const fm = buildDerivedFrontmatter(own, { mail: m, source: "s", state: "live", syncedAt: new Date(0) });
      expect(f.direction).toBe(fm.richtung);
      expect(f.threadToken).toBe(tokenOf(m, tokenRegexOf(own)));
    }
  });
});
