import { describe, it, expect } from "vitest";
import { buildPredecessorLookup, predecessorOf, type PredecessorMail } from "../../../src/core/thread/predecessor";
import { DEFAULT_TOKEN as TOKEN } from "../../helpers/token";

const m = (mailId: string, over: Partial<PredecessorMail> = {}): PredecessorMail => ({
  mailId, inReplyTo: null, references: [], subject: `Betreff ${mailId}`, date: "2026-08-05", time: "10:00", ...over,
});
const lookup = (nodes: PredecessorMail[]) => buildPredecessorLookup(nodes, TOKEN);

describe("predecessorOf", () => {
  it("nimmt die Mail aus In-Reply-To, wenn es sie gibt", () => {
    const mail = m("n@x", { inReplyTo: "a@x", references: ["b@x"] });
    expect(predecessorOf(mail, lookup([m("a@x"), m("b@x")]), TOKEN)).toBe("a@x");
  });
  it("nimmt sonst die zuletzt genannte vorhandene Mail aus References", () => {
    const mail = m("n@x", { inReplyTo: "weg@x", references: ["a@x", "b@x", "weg@x"] });
    expect(predecessorOf(mail, lookup([m("a@x"), m("b@x")]), TOKEN)).toBe("b@x");
  });
  it("nimmt sonst die juengste fruehere Notiz mit demselben Token im Betreff", () => {
    const mail = m("n@x", { subject: "Re: [Ticket#5] x", date: "2026-08-10" });
    const nodes = [
      m("alt@x", { subject: "[Ticket#5] a", date: "2026-08-01" }),
      m("neuer@x", { subject: "[Ticket#5] b", date: "2026-08-07" }),
      m("andere@x", { subject: "[Ticket#6] c", date: "2026-08-09" }),
    ];
    expect(predecessorOf(mail, lookup(nodes), TOKEN)).toBe("neuer@x");
  });
  it("ein Header, der auf eine Notiz trifft, geht der Kennung vor, auch wenn die Kennung eine juengere Notiz traefe", () => {
    const mail = m("n@x", { subject: "Re: [Ticket#5] x", date: "2026-08-10", inReplyTo: "kopf@x" });
    const nodes = [m("kopf@x", { subject: "Anderes", date: "2026-08-01" }), m("ticket@x", { subject: "[Ticket#5] b", date: "2026-08-07" })];
    expect(predecessorOf(mail, lookup(nodes), TOKEN)).toBe("kopf@x");
  });
  it("trifft der Header keine Notiz, gilt die Kennung", () => {
    const mail = m("n@x", { subject: "Re: [Ticket#5] x", date: "2026-08-10", inReplyTo: "fern@x", references: ["auch-fern@x"] });
    expect(predecessorOf(mail, lookup([m("ticket@x", { subject: "[Ticket#5] b", date: "2026-08-07" })]), TOKEN)).toBe("ticket@x");
  });
  it("nimmt per Token keine Mail, die nicht frueher ist als die eigene", () => {
    const mail = m("n@x", { subject: "[Ticket#5] x", date: "2026-08-01" });
    expect(predecessorOf(mail, lookup([m("spaeter@x", { subject: "[Ticket#5] y", date: "2026-08-09" })]), TOKEN)).toBeNull();
  });
  it("liefert null ohne Bezug, ohne Token und ohne Regel", () => {
    expect(predecessorOf(m("n@x"), lookup([m("a@x")]), TOKEN)).toBeNull();
    const mail = m("n@x", { subject: "[Ticket#5] x" });
    expect(predecessorOf(mail, buildPredecessorLookup([m("a@x", { subject: "[Ticket#5] y", date: "2026-08-01" })], null), null)).toBeNull();
  });
  it("nennt nie die Mail selbst als Vorgaengerin", () => {
    const mail = m("n@x", { inReplyTo: "n@x", references: ["n@x"], subject: "[Ticket#5] x" });
    expect(predecessorOf(mail, lookup([mail]), TOKEN)).toBeNull();
  });
});

// A5, Schritt 1: die Kennung kann vorberechnet aus der Original-Mail kommen (Betreff nach einer Pseudonymisierung ist ein Platzhalter).
describe("predecessorOf — Kennung aus dem Original (threadToken)", () => {
  it("findet die Vorgaengerin ueber die vorberechnete Kennung, obwohl der Betreff ein Platzhalter ist", () => {
    const nodes = [m("t@x", { subject: "[Ticket#1] Anfrage", date: "2026-08-01" })];
    const original = m("n@x", { subject: "Re: [Ticket#1] Anfrage", date: "2026-08-10" });
    const pseudonym = m("n@x", { subject: "Person_x Re: Anfrage", threadToken: "[Ticket#1]", date: "2026-08-10" });
    expect(predecessorOf(pseudonym, lookup(nodes), TOKEN)).toBe(predecessorOf(original, lookup(nodes), TOKEN));
    expect(predecessorOf(pseudonym, lookup(nodes), TOKEN)).toBe("t@x");
  });
  it("ohne die Kennung waere die Vorgaengerin nicht zu finden (Gegenprobe)", () => {
    const mail = m("n@x", { subject: "Person_x Re: Anfrage", date: "2026-08-10" });
    expect(predecessorOf(mail, lookup([m("t@x", { subject: "[Ticket#1] Anfrage", date: "2026-08-01" })]), TOKEN)).toBeNull();
  });
  it("auch ein Knoten im Lauf wird ueber seine vorberechnete Kennung gefunden", () => {
    const frueher = m("f@x", { subject: "Person_y", threadToken: "[Ticket#1]", date: "2026-08-01" });
    const mail = m("n@x", { subject: "Person_x", threadToken: "[Ticket#1]", date: "2026-08-10" });
    expect(predecessorOf(mail, lookup([frueher]), TOKEN)).toBe("f@x");
  });
  it("eine vorhandene Kennung null heisst: keine Kennung, auch wenn der Betreff eine truege", () => {
    const mail = m("n@x", { subject: "Re: [Ticket#1] x", threadToken: null, date: "2026-08-10" });
    expect(predecessorOf(mail, lookup([m("t@x", { subject: "[Ticket#1] a", date: "2026-08-01" })]), TOKEN)).toBeNull();
  });
  it("Header gehen auch hier vor", () => {
    const mail = m("n@x", { inReplyTo: "kopf@x", threadToken: "[Ticket#1]", date: "2026-08-10" });
    expect(predecessorOf(mail, lookup([m("kopf@x", { subject: "x" }), m("t@x", { subject: "[Ticket#1] a", date: "2026-08-01" })]), TOKEN)).toBe("kopf@x");
  });
});
