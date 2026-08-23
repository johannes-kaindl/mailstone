import { describe, it, expect } from "vitest";
import { normalizeMessageId, splitReferences, formatAddress, encodeHeaderWord, foldHeader, fallbackId } from "../../../src/core/mime/headers";

describe("normalizeMessageId", () => {
  it("entfernt spitze Klammern und Whitespace", () => {
    expect(normalizeMessageId(" <abc@example.org> ")).toBe("abc@example.org");
  });
  it("liefert null fuer leer/undefined", () => {
    expect(normalizeMessageId("")).toBeNull();
    expect(normalizeMessageId(undefined)).toBeNull();
    expect(normalizeMessageId("<>")).toBeNull();
  });
  it("lehnt Header-Injection ab (kein Match, Fallback verwirft Whitespace/Klammern)", () => {
    expect(normalizeMessageId("<a@x\r\nBcc: evil@example.org>")).toBeNull();
  });
});
describe("splitReferences", () => {
  it("extrahiert alle IDs in Reihenfolge ohne Duplikate", () => {
    expect(splitReferences("<a@x> <b@x>\r\n <a@x>")).toEqual(["a@x", "b@x"]);
  });
  it("leer → []", () => { expect(splitReferences(null)).toEqual([]); });
  it("gefaltete Header funktionieren weiterhin", () => {
    expect(splitReferences("<a@x>\r\n <b@x>")).toEqual(["a@x", "b@x"]);
  });
});
describe("formatAddress", () => {
  it("mit Name", () => { expect(formatAddress({ name: "Erika Beispiel", address: "e@example.org" })).toBe("Erika Beispiel <e@example.org>"); });
  it("ohne Name", () => { expect(formatAddress({ name: "", address: "e@example.org" })).toBe("e@example.org"); });
});
describe("encodeHeaderWord", () => {
  it("ASCII bleibt", () => { expect(encodeHeaderWord("Hello")).toBe("Hello"); });
  it("Nicht-ASCII wird B-kodiert (UTF-8)", () => { expect(encodeHeaderWord("Grüße")).toBe("=?UTF-8?B?R3LDvMOfZQ==?="); });
});
describe("foldHeader", () => {
  it("kurz: eine Zeile", () => { expect(foldHeader("Subject", "Hi")).toBe("Subject: Hi"); });
  it("lang: faltet an Leerzeichen mit CRLF+SP, keine Zeile > 78", () => {
    const v = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    const out = foldHeader("Subject", v);
    for (const line of out.split("\r\n")) expect(line.length).toBeLessThanOrEqual(78);
    expect(out.replace(/\r\n /g, " ")).toBe(`Subject: ${v}`);
  });
});
describe("fallbackId", () => {
  it("ist deterministisch und hat das noid-Praefix", () => {
    const a = fallbackId("2026-08-19T12:32:00Z", "e@example.org", "Hi");
    expect(a).toMatch(/^noid-[0-9a-f]{32}$/);
    expect(fallbackId("2026-08-19T12:32:00Z", "e@example.org", "Hi")).toBe(a);
  });
});
