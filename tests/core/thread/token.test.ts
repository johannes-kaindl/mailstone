import { describe, it, expect } from "vitest";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import { noteSubject, tokenOf, tokenPatternProblem, tokenRegexOf } from "../../../src/core/thread/token";
import { DEFAULT_TOKEN, tokenRe } from "../../helpers/token";

const withPattern = (threadTokenPattern: string) => ({ ...defaultMailProfile(), threadTokenPattern });
const tok = (subject: string, re: RegExp | null) => tokenOf({ subject }, re);

describe("tokenRegexOf / tokenPatternProblem", () => {
  it("die Vorgabe ist `\\[Ticket#\\d+\\]` und ohne Problem", () => {
    expect(defaultMailProfile().threadTokenPattern).toBe("\\[Ticket#\\d+\\]");
    expect(tokenRegexOf(defaultMailProfile())).toBeInstanceOf(RegExp);
    expect(tokenPatternProblem(defaultMailProfile())).toBeNull();
  });
  it("leer und nur Leerraum: die Regel ist aus, kein Problem", () => {
    for (const p of ["", "   "]) {
      expect(tokenRegexOf(withPattern(p)), JSON.stringify(p)).toBeNull();
      expect(tokenPatternProblem(withPattern(p)), JSON.stringify(p)).toBeNull();
    }
  });
  it("ein ungueltiger Ausdruck wirft nicht: kein Ausdruck, Problem syntax", () => {
    for (const p of ["[", "(", "\\", "a{2,1}"]) {
      expect(tokenRegexOf(withPattern(p)), p).toBeNull();
      expect(tokenPatternProblem(withPattern(p)), p).toBe("syntax");
    }
  });
  it("ein Ausdruck, den das Risiko-Veto des Kits ablehnt, wirkt nicht: Problem risky", () => {
    for (const p of ["(a+)+$", "(\\w+\\s?)+$", "(a|aa)+$", "\\d*\\d*x"]) {
      expect(tokenRegexOf(withPattern(p)), p).toBeNull();
      expect(tokenPatternProblem(withPattern(p)), p).toBe("risky");
    }
  });
  it("mehrere Antwort-Praefixe stehen als Einzelpraefix, nicht als verschachtelte Wiederholung", () => {
    // Bekannter Fehlalarm des Vetos: `^(?:(?:Re|AW|Fwd|WG):\\s*)+` wird abgelehnt, `^(?:Re|AW|Fwd|WG):\\s*` nicht.
    expect(tokenPatternProblem(withPattern("^(?:(?:Re|AW|Fwd|WG):\\s*)+"))).toBe("risky");
    expect(tokenPatternProblem(withPattern("^(?:Re|AW|Fwd|WG):\\s*"))).toBeNull();
  });
});

describe("tokenOf", () => {
  it("liefert den ersten Treffer im Betreff", () => {
    expect(tok("AW: [Ticket#4711] Drucker kaputt [Ticket#9]", DEFAULT_TOKEN)).toBe("[Ticket#4711]");
  });
  it("liefert null ohne Treffer und ohne Regel", () => {
    expect(tok("Drucker kaputt", DEFAULT_TOKEN)).toBeNull();
    expect(tok("[Ticket#1] x", null)).toBeNull();
  });
  it("liefert null, wenn der Ausdruck nur den leeren Text trifft", () => {
    expect(tok("irgendwas", tokenRe("x*"))).toBeNull();
  });
  it("Gruppe 1 ist die Kennung, wenn es sie gibt und sie am Treffer beteiligt ist", () => {
    expect(tok("Ticket #4711 offen", tokenRe("Ticket ?#(\\d+)"))).toBe("4711");
    expect(tok("Ticket#4711 offen", tokenRe("Ticket ?#(\\d+)"))).toBe("4711");
  });
  it("eine Gruppe, die am Treffer nicht beteiligt ist, faellt auf den ganzen Treffer zurueck", () => {
    expect(tok("Fall B", tokenRe("Fall A(\\d)|Fall B"))).toBe("Fall B");
  });
  it("eine leere Gruppe 1 ergibt keine Kennung", () => {
    expect(tok("Ticket # offen", tokenRe("Ticket #(\\d*)"))).toBeNull();
  });
  it("ist unabhaengig vom Zustand eines Ausdrucks mit g-Flag", () => {
    const g = new RegExp("\\d+", "g");
    expect(tok("a 12", g)).toBe("12");
    expect(tok("a 12", g)).toBe("12");
    expect(g.lastIndex).toBe(0);
  });
  it("sucht nur in den ersten 998 Zeichen des Betreffs", () => {
    const lang = `${"x".repeat(998)}[Ticket#1]`;
    expect(tok(lang, DEFAULT_TOKEN)).toBeNull();
    expect(tok(`${"x".repeat(900)}[Ticket#1]`, DEFAULT_TOKEN)).toBe("[Ticket#1]");
  });
});

describe("noteSubject", () => {
  it("nimmt das Feld subject, sonst title, sonst leer", () => {
    const p = defaultMailProfile();
    expect(noteSubject(p, { subject: "S", title: "T" })).toBe("S");
    expect(noteSubject(p, { title: "T" })).toBe("T");
    expect(noteSubject(p, { subject: "", title: "T" })).toBe("T");
    expect(noteSubject(p, { subject: 5 })).toBe("");
  });
  it("folgt den umbenannten Feldern des Profils", () => {
    const p = { ...defaultMailProfile(), fields: { ...defaultMailProfile().fields, subject: "betreff" } };
    expect(noteSubject(p, { betreff: "B", subject: "S" })).toBe("B");
  });
});
