import { describe, it, expect } from "vitest";
import { parseEml } from "../../../src/core/mime/parse";
import { loadFixture } from "../../helpers/fixtures";

describe("parseEml", () => {
  it("utf8-plain: Adressen, Betreff, Datum, ID", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    expect(m.id).toBe("utf8-plain-001@mail.example.org");
    expect(m.from).toEqual({ name: "Erika Beispiel", address: "erika@example.org" });
    expect(m.to).toEqual([{ name: "Max Muster", address: "max@example.net" }]);
    expect(m.cc).toEqual([{ name: "", address: "team@example.com" }]);
    expect(m.subject).toBe("Hallo Welt");
    expect(m.date?.toISOString()).toBe("2026-08-19T12:32:00.000Z");
    expect(m.text).toContain("Schöne Grüße aus München — ß und €.");
    expect(m.html).toBeNull();
  });
  it("iso8859-1-qp: Umlaute in Name, Betreff, Body", async () => {
    const m = await parseEml(loadFixture("iso8859-1-qp"));
    expect(m.from?.name).toBe("Jürgen Müller");
    expect(m.subject).toBe("Grüße aus Köln");
    expect(m.text).toContain("Schöne Grüße, Straße.");
  });
  it("windows-1252: typografische Anfuehrungszeichen", async () => {
    const m = await parseEml(loadFixture("windows-1252-base64-subject"));
    expect(m.subject).toBe("Angebot “Premium”");
    expect(m.text).toContain("Angebot “Premium”");
  });
  it("multipart/alternative: text und html beide vorhanden", async () => {
    const m = await parseEml(loadFixture("multipart-alternative"));
    expect(m.text).toContain("Donnerstag");
    expect(m.html).toContain("<b>Donnerstag</b>");
  });
  it("mixed: Anhaenge mit Name/Typ/Groesse, Bytes abrufbar ueber ihren key", async () => {
    const m = await parseEml(loadFixture("multipart-mixed-attachments"));
    expect(m.attachments).toEqual([
      { name: "bericht.pdf", type: "application/pdf", size: 5, inline: false, key: "0:bericht.pdf" },
      { name: "notiz.txt", type: "text/plain", size: 5, inline: false, key: "1:notiz.txt" },
    ]);
    expect(new TextDecoder().decode(m.attachmentData.get("1:notiz.txt"))).toBe("hallo");
  });
  it("related: Inline-Bild mit contentId, inline=true, key = contentId", async () => {
    const m = await parseEml(loadFixture("multipart-related-inline"));
    expect(m.attachments[0]).toMatchObject({ name: "logo.gif", type: "image/gif", contentId: "logo@example.org", inline: true, key: "logo@example.org" });
    expect(m.attachmentData.has("logo@example.org")).toBe(true);
  });
  it("duplicate-attachment-names: gleicher Dateiname zweimal, jeder Anhang behaelt seine EIGENEN Bytes", async () => {
    const m = await parseEml(loadFixture("duplicate-attachment-names"));
    expect(m.attachments).toHaveLength(2);
    expect(m.attachments[0]?.name).toBe("invoice.pdf");
    expect(m.attachments[1]?.name).toBe("invoice.pdf");
    // Der Name allein waere kein Schluessel — beide Anhaenge muessen einen VERSCHIEDENEN key
    // tragen, sonst ueberschreibt der zweite `attachmentData.set()` die Bytes des ersten
    // (M3b-Nachlese, Fund 1: kollabierende Anhaenge mit demselben Dateinamen).
    const key0 = m.attachments[0]?.key;
    const key1 = m.attachments[1]?.key;
    expect(key0).toBeDefined();
    expect(key1).toBeDefined();
    expect(key0).not.toBe(key1);
    expect(new TextDecoder().decode(m.attachmentData.get(key0 ?? ""))).toBe("erste");
    expect(new TextDecoder().decode(m.attachmentData.get(key1 ?? ""))).toBe("zweite");
  });
  it("no-message-id: deterministische Fallback-ID", async () => {
    const m = await parseEml(loadFixture("no-message-id"));
    expect(m.messageIdRaw).toBeNull();
    expect(m.id).toMatch(/^noid-[0-9a-f]{32}$/);
  });
  it("broken-boundary: wirft nicht, liefert Text", async () => {
    const m = await parseEml(loadFixture("broken-boundary"));
    expect(m.text ?? "").toContain("Text ohne schließende Boundary");
  });
  it("date-negative-offset: UTC korrekt", async () => {
    const m = await parseEml(loadFixture("date-negative-offset"));
    expect(m.date?.toISOString()).toBe("2026-08-19T22:30:00.000Z");
  });
  it("winmail-dat: TNEF wird als Anhang application/ms-tnef gefuehrt, nicht ausgepackt", async () => {
    const m = await parseEml(loadFixture("winmail-dat"));
    expect(m.attachments).toEqual([{ name: "winmail.dat", type: "application/ms-tnef", size: 4, inline: false, key: "0:winmail.dat" }]);
  });
  it("thread-reply: inReplyTo und references normalisiert", async () => {
    const m = await parseEml(loadFixture("thread-reply"));
    expect(m.inReplyTo).toBe("alt-001@mail.example.org");
    expect(m.references).toEqual(["root-000@mail.example.org", "alt-001@mail.example.org"]);
  });
});
