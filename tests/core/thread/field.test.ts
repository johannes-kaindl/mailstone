import { describe, it, expect } from "vitest";
import { effectiveThreadField, threadFieldProblem } from "../../../src/core/thread/field";
import { defaultMailProfile } from "../../../src/core/mirror/profile";

const withField = (threadField: string) => ({ ...defaultMailProfile(), threadField });

describe("threadFieldProblem / effectiveThreadField (E7)", () => {
  it("leer ist kein Problem, sondern aus", () => {
    expect(threadFieldProblem(withField(""))).toBeNull();
    expect(effectiveThreadField(withField(""))).toBe("");
  });
  it("ein brauchbarer Name gilt", () => {
    expect(threadFieldProblem(withField("vorgang"))).toBeNull();
    expect(effectiveThreadField(withField("vorgang"))).toBe("vorgang");
    expect(effectiveThreadField(withField("  vorgang "))).toBe("vorgang");
  });
  it("ein verwalteter Schluessel wird abgelehnt: die Regel ist aus", () => {
    for (const k of ["mail_id", "mail_source", "mail_state", "mail_synced", "subject", "in_reply_to", "references", "date", "richtung"]) {
      expect(threadFieldProblem(withField(k)), k).toBe("managed");
      expect(effectiveThreadField(withField(k)), k).toBe("");
    }
  });
  it("ein Name mit Nicht-ASCII-Zeichen oder Sonderzeichen wird abgelehnt (der Zeilenleser kann ihn nicht)", () => {
    for (const k of ["vorgäng", "a:b", "-x", "a\nb"]) {
      expect(threadFieldProblem(withField(k)), JSON.stringify(k)).toBe("unreadable");
      expect(effectiveThreadField(withField(k)), JSON.stringify(k)).toBe("");
    }
  });
});
