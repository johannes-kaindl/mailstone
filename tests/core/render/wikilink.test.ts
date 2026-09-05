import { describe, it, expect } from "vitest";
import { wikilink } from "../../../src/core/render/wikilink";

describe("wikilink", () => {
  it("klammert einen gewoehnlichen Vault-Pfad", () => {
    expect(wikilink("Mail/2026/2026-08-19-1000-termin")).toBe("[[Mail/2026/2026-08-19-1000-termin]]");
  });

  it("vertraegt Leerzeichen, Umlaute und Punkte", () => {
    expect(wikilink("Mail/2026/Grüße von Erika (v. 2)")).toBe("[[Mail/2026/Grüße von Erika (v. 2)]]");
  });

  it.each([
    ["eckige Klammer auf", "Mail/[Entwurf]"],
    ["Raute", "Mail/Notiz#2"],
    ["senkrechter Strich", "Mail/a|b"],
    ["Zirkumflex", "Mail/a^b"],
  ])("liefert null bei %s — der Link waere kaputt", (_name, pfad) => {
    expect(wikilink(pfad)).toBeNull();
  });

  it("liefert null fuer einen leeren Pfad", () => {
    expect(wikilink("")).toBeNull();
  });
});
