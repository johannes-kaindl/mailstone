import { describe, it, expect } from "vitest";
import { inheritableFrom, inheritedForNew } from "../../../src/core/thread/inherit";
import type { KnownThreadNote, NewThreadMail } from "../../../src/core/thread/create-links";

const known = (mailId: string, inherit: Record<string, unknown> = {}): KnownThreadNote => ({
  mailId, path: `Mail/${mailId}`, value: null, inherit, date: "", time: "", subject: "",
});
const fresh = (mailId: string, over: Partial<NewThreadMail> = {}): NewThreadMail => ({
  mailId, path: `Mail/neu-${mailId}`, inReplyTo: null, references: [], date: "", time: "", subject: "", ...over,
});
const run = (f: NewThreadMail[], k: KnownThreadNote[], keys = ["projekt"], token: RegExp | null = null) =>
  Object.fromEntries(inheritedForNew(f, k, keys, token));
/** Der Wert, wie ihn der Typfilter weitergibt (ein Schluessel, Rohwert aus dem Metadata-Cache). */
const filtered = (raw: unknown) => inheritableFrom({ frontmatter: { k: raw } }, ["k"]).k;

describe("inheritableFrom — Typfilter (Kit-Umwandlung `rawToFmValue`)", () => {
  it("laesst Text, Zahl, Wahrheitswert und Textliste durch, unveraendert", () => {
    expect(filtered("Alpha")).toBe("Alpha");
    expect(filtered(3)).toBe(3);
    expect(filtered(true)).toBe(true);
    expect(filtered(false)).toBe(false);
    expect(filtered(["[[A]]", "[[B]]"])).toEqual(["[[A]]", "[[B]]"]);
  });
  it("ueberspringt verschachtelte Werte, gemischte Listen, null und Unbekanntes", () => {
    for (const v of [{ a: 1 }, [{ a: 1 }], ["a", 1], [["a"]], null, undefined, Number.NaN, () => 1]) {
      expect(filtered(v), JSON.stringify(v)).toBeUndefined();
    }
  });
  it("ueberspringt Leeres: ein leerer Text und eine leere Liste tragen nichts", () => {
    expect(filtered("")).toBeUndefined();
    expect(filtered([])).toBeUndefined();
  });
  it("gibt die Liste als Kopie zurueck", () => {
    const quelle = ["[[A]]"];
    expect(filtered(quelle)).not.toBe(quelle);
  });
  it("gibt eine Liste mit einer Zahl oder einem Wahrheitswert nicht weiter: das Kit machte Text daraus, der Wert wuerde umgetypt", () => {
    expect(filtered([1, 2])).toBeUndefined();
    expect(filtered(["a", true])).toBeUndefined();
  });
  it("nimmt nur die eingestellten Schluessel und laesst fehlende aus", () => {
    expect(inheritableFrom({ frontmatter: { a: "x", b: "y" } }, ["a", "c"])).toEqual({ a: "x" });
    expect(inheritableFrom({ frontmatter: {} }, ["a"])).toEqual({});
  });
});

describe("inheritedForNew — Vorgaengerwahl", () => {
  it("uebernimmt von der Notiz aus in_reply_to", () => {
    expect(run([fresh("n@x", { inReplyTo: "p@x" })], [known("p@x", { projekt: "Alpha" })])).toEqual({ "n@x": { projekt: "Alpha" } });
  });
  it("nimmt in_reply_to vor references, auch wenn references eine andere Notiz nennt", () => {
    const r = run([fresh("n@x", { inReplyTo: "p@x", references: ["q@x"] })], [known("p@x", { projekt: "P" }), known("q@x", { projekt: "Q" })]);
    expect(r).toEqual({ "n@x": { projekt: "P" } });
  });
  it("nimmt ohne in_reply_to die zuletzt genannte vorhandene Notiz aus references", () => {
    const r = run([fresh("n@x", { references: ["a@x", "b@x", "weg@x"] })], [known("a@x", { projekt: "A" }), known("b@x", { projekt: "B" })]);
    expect(r).toEqual({ "n@x": { projekt: "B" } });
  });
  it("ueberspringt in_reply_to, wenn es die Notiz nicht gibt, und faellt auf references zurueck", () => {
    const r = run([fresh("n@x", { inReplyTo: "weg@x", references: ["a@x"] })], [known("a@x", { projekt: "A" })]);
    expect(r).toEqual({ "n@x": { projekt: "A" } });
  });
  it("erbt nichts ohne Vorgaengerin", () => {
    expect(run([fresh("n@x", { inReplyTo: "weg@x" })], [known("a@x", { projekt: "A" })])).toEqual({});
  });
  it("erbt nur die eingestellten Schluessel, und nur die, die die Vorgaengerin hat", () => {
    const r = run([fresh("n@x", { inReplyTo: "p@x" })], [known("p@x", { projekt: "A", andere: "B" })], ["projekt", "fehlt"]);
    expect(r).toEqual({ "n@x": { projekt: "A" } });
  });
  it("legt keinen Eintrag an, wenn die Vorgaengerin keinen der Werte traegt", () => {
    expect(run([fresh("n@x", { inReplyTo: "p@x" })], [known("p@x", { projekt: { tief: 1 } })])).toEqual({});
  });
  it("ohne Schluessel gibt es nichts zu erben", () => {
    expect(run([fresh("n@x", { inReplyTo: "p@x" })], [known("p@x", { projekt: "A" })], [])).toEqual({});
  });
  it("eine Mail, die es als Notiz schon gibt, erbt nicht noch einmal", () => {
    expect(run([fresh("p@x", { inReplyTo: "q@x" })], [known("p@x", { projekt: "A" }), known("q@x", { projekt: "Q" })])).toEqual({});
  });
  it("eine Mail erbt nie von sich selbst", () => {
    expect(run([fresh("n@x", { inReplyTo: "n@x", references: ["n@x"] })], [])).toEqual({});
  });
});

describe("inheritedForNew — Kennung im Betreff und Original (wie beim Vorgangswert)", () => {
  const ticket = /\[Ticket#\d+\]/;
  const alt = known("t0@x", { projekt: "Alpha" });
  const mitKennung = { ...alt, subject: "[Ticket#1] Start", date: "2026-08-01", time: "08:00" };
  it("erbt ohne Header von der juengsten fruehere Notiz mit derselben Kennung im Betreff", () => {
    const n = fresh("n@x", { subject: "Re: [Ticket#1] Weiter", date: "2026-08-02", time: "08:00" });
    expect(run([n], [mitKennung], ["projekt"], ticket)).toEqual({ "n@x": { projekt: "Alpha" } });
  });
  it("ohne Kennungsregel (null) erbt sie nicht", () => {
    const n = fresh("n@x", { subject: "Re: [Ticket#1] Weiter", date: "2026-08-02", time: "08:00" });
    expect(run([n], [mitKennung], ["projekt"], null)).toEqual({});
  });
  it("die Kennung aus dem Original (threadToken) geht dem Betreff vor, auch als null", () => {
    const n = fresh("n@x", { subject: "Re: [Ticket#1] Weiter", date: "2026-08-02", time: "08:00", threadToken: "[Ticket#9]" });
    expect(run([n], [mitKennung], ["projekt"], ticket)).toEqual({});
    const m = fresh("m@x", { subject: "Weiter", date: "2026-08-02", time: "08:00", threadToken: "[Ticket#1]" });
    expect(run([m], [mitKennung], ["projekt"], ticket)).toEqual({ "m@x": { projekt: "Alpha" } });
  });
  it("die Header gehen der Kennung vor", () => {
    const n = fresh("n@x", { inReplyTo: "p@x", subject: "[Ticket#1] x", date: "2026-08-02", time: "08:00" });
    expect(run([n], [mitKennung, known("p@x", { projekt: "P" })], ["projekt"], ticket)).toEqual({ "n@x": { projekt: "P" } });
  });
});

describe("inheritedForNew — Typen und Werte", () => {
  it("laesst eine Liste von Wikilinks eine Liste von Wikilinks bleiben", () => {
    const r = run([fresh("n@x", { inReplyTo: "p@x" })], [known("p@x", { projekt: ["[[A]]", "[[B]]"] })]);
    expect(r["n@x"]).toEqual({ projekt: ["[[A]]", "[[B]]"] });
  });
  it("reicht einen Wahrheitswert als Wahrheitswert durch", () => {
    const r = run([fresh("n@x", { inReplyTo: "p@x" })], [known("p@x", { privat: true, offen: false })], ["privat", "offen"]);
    expect(r["n@x"]).toEqual({ privat: true, offen: false });
  });
  it("uebernimmt Zahlen unveraendert", () => {
    expect(run([fresh("n@x", { inReplyTo: "p@x" })], [known("p@x", { prio: 2 })], ["prio"])["n@x"]).toEqual({ prio: 2 });
  });
  it("uebernimmt je Schluessel getrennt: ein verschachtelter Wert verhindert die anderen nicht", () => {
    const r = run([fresh("n@x", { inReplyTo: "p@x" })], [known("p@x", { projekt: "A", tief: { a: 1 } })], ["projekt", "tief"]);
    expect(r["n@x"]).toEqual({ projekt: "A" });
  });
});

describe("inheritedForNew — Vorgaengerin im selben Lauf", () => {
  it("gilt der geerbte Wert der Vorgaengerin, unabhaengig von der Reihenfolge", () => {
    const a = fresh("a@x", { inReplyTo: "p@x" });
    const b = fresh("b@x", { inReplyTo: "a@x" });
    const c = fresh("c@x", { references: ["p@x", "b@x"] });
    const erwartet = { projekt: ["[[A]]"] };
    expect(run([c, b, a], [known("p@x", { projekt: ["[[A]]"] })])).toEqual({ "a@x": erwartet, "b@x": erwartet, "c@x": erwartet });
  });
  it("erbt nichts, wenn die Vorgaengerin des Laufs selbst nichts geerbt hat", () => {
    expect(run([fresh("a@x"), fresh("b@x", { inReplyTo: "a@x" })], [])).toEqual({});
  });
  it("ein Kreis in den Verweisen wirft nicht", () => {
    const r = run([fresh("a@x", { inReplyTo: "b@x" }), fresh("b@x", { inReplyTo: "a@x" })], []);
    expect(r).toEqual({});
  });
});
