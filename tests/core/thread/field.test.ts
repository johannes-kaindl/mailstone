import { describe, it, expect } from "vitest";
import { effectiveFollowField, effectiveThreadField, followFieldProblem, followStopped, threadFieldProblem } from "../../../src/core/thread/field";
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

const withBoth = (threadField: string, followField: string) => ({ ...defaultMailProfile(), threadField, followField });

describe("followFieldProblem / effectiveFollowField (E7)", () => {
  it("der Standard ist mail_follow und gilt", () => {
    expect(defaultMailProfile().followField).toBe("mail_follow");
    expect(followFieldProblem(defaultMailProfile())).toBeNull();
    expect(effectiveFollowField(defaultMailProfile())).toBe("mail_follow");
  });
  it("leer ist aus, kein Problem", () => {
    expect(followFieldProblem(withBoth("", ""))).toBeNull();
    expect(effectiveFollowField(withBoth("", ""))).toBe("");
  });
  it("ein verwalteter Schluessel wird abgelehnt: die Markierung ist aus", () => {
    for (const k of ["mail_id", "mail_source", "mail_state", "mail_synced", "subject", "references"]) {
      expect(followFieldProblem(withBoth("", k)), k).toBe("managed");
      expect(effectiveFollowField(withBoth("", k)), k).toBe("");
    }
  });
  it("Nicht-ASCII und Sonderzeichen werden abgelehnt", () => {
    for (const k of ["folgen-ä", "a:b", "-x"]) {
      expect(followFieldProblem(withBoth("", k)), k).toBe("unreadable");
      expect(effectiveFollowField(withBoth("", k)), k).toBe("");
    }
  });
  it("derselbe Name wie das Vorgangsfeld ist eine Kollision: beide sind aus, bis einer geaendert ist", () => {
    expect(followFieldProblem(withBoth("vorgang", "vorgang"))).toBe("collision");
    expect(threadFieldProblem(withBoth("vorgang", "vorgang"))).toBe("collision");
    expect(effectiveFollowField(withBoth("vorgang", "vorgang"))).toBe("");
    expect(effectiveThreadField(withBoth("vorgang", "vorgang"))).toBe("");
    // verschieden: beide gelten
    expect(effectiveFollowField(withBoth("vorgang", "folgen"))).toBe("folgen");
    expect(effectiveThreadField(withBoth("vorgang", "folgen"))).toBe("vorgang");
  });
  it("zwei leere Felder kollidieren nicht", () => {
    expect(threadFieldProblem(withBoth("", ""))).toBeNull();
  });
});

describe("followStopped — Lesen der Markierung (E2)", () => {
  const p = defaultMailProfile();
  it("false als Wahrheitswert und der Text false (in jeder Schreibweise) heissen beendet", () => {
    expect(followStopped(p, { mail_follow: false })).toBe(true);
    expect(followStopped(p, { mail_follow: "false" })).toBe(true);
    expect(followStopped(p, { mail_follow: " False " })).toBe(true);
  });
  it("alles andere heisst: es wird gefolgt", () => {
    for (const v of [true, "true", "", 0, null, undefined, "nein", []]) expect(followStopped(p, { mail_follow: v }), JSON.stringify(v)).toBe(false);
    expect(followStopped(p, {})).toBe(false);
  });
  it("ohne wirksames Feld (leer oder abgelehnt) ist nie etwas beendet", () => {
    expect(followStopped(withBoth("", ""), { mail_follow: false })).toBe(false);
    expect(followStopped(withBoth("", "mail_id"), { mail_id: false })).toBe(false);
  });
});
