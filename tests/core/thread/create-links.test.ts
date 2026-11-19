import { describe, it, expect } from "vitest";
import { threadValuesForNew, type KnownThreadNote, type NewThreadMail } from "../../../src/core/thread/create-links";
import { DEFAULT_TOKEN as TOKEN } from "../../helpers/token";

const known = (mailId: string, over: Partial<KnownThreadNote> = {}): KnownThreadNote => ({
  mailId, path: `Mail/${mailId}`, subject: `Betreff ${mailId}`, date: "2026-08-01", time: "10:00", value: null, ...over,
});
const fresh = (mailId: string, over: Partial<NewThreadMail> = {}): NewThreadMail => ({
  mailId, path: `Mail/neu-${mailId}`, inReplyTo: null, references: [], subject: `Betreff ${mailId}`, date: "2026-08-05", time: "10:00", ...over,
});
const run = (f: NewThreadMail[], k: KnownThreadNote[] = []) => Object.fromEntries(threadValuesForNew(f, k, TOKEN));

describe("threadValuesForNew", () => {
  it("uebernimmt den Wert der Vorgaengerin", () => {
    expect(run([fresh("n@x", { inReplyTo: "p@x" })], [known("p@x", { value: "[[Mail/root]]" })])).toEqual({ "n@x": "[[Mail/root]]" });
  });
  it("macht die Vorgaengerin zur Wurzel, wenn sie keinen Wert hat", () => {
    expect(run([fresh("n@x", { inReplyTo: "p@x" })], [known("p@x")])).toEqual({ "n@x": "[[Mail/p@x]]" });
  });
  it("macht eine Vorgaengerin zur Wurzel, deren Wert kein Wikilink ist", () => {
    expect(run([fresh("n@x", { inReplyTo: "p@x" })], [known("p@x", { value: "irgendwas" })])).toEqual({ "n@x": "[[Mail/p@x]]" });
  });
  it("macht die neue Notiz zu ihrer eigenen Wurzel, wenn es keine Vorgaengerin gibt", () => {
    expect(run([fresh("n@x")])).toEqual({ "n@x": "[[Mail/neu-n@x]]" });
  });
  it("kennt eine Vorgaengerin desselben Laufs, unabhaengig von der Reihenfolge", () => {
    const a = fresh("a@x", { date: "2026-08-01" });
    const b = fresh("b@x", { date: "2026-08-02", inReplyTo: "a@x" });
    const c = fresh("c@x", { date: "2026-08-03", references: ["a@x", "b@x"] });
    const erwartet = { "a@x": "[[Mail/neu-a@x]]", "b@x": "[[Mail/neu-a@x]]", "c@x": "[[Mail/neu-a@x]]" };
    expect(run([a, b, c])).toEqual(erwartet);
    expect(run([c, b, a])).toEqual(erwartet);
  });
  it("hangelt sich im Lauf von einer Vorgaengerin im Vault zur Wurzel, die ihr Wert nennt", () => {
    const r = run([fresh("b@x", { inReplyTo: "a@x" }), fresh("c@x", { inReplyTo: "b@x" })], [known("a@x", { value: "[[Mail/wurzel]]" })]);
    expect(r).toEqual({ "b@x": "[[Mail/wurzel]]", "c@x": "[[Mail/wurzel]]" });
  });
  it("ordnet zwei Mails desselben Laufs ueber den Betreff-Token zu", () => {
    const r = run([fresh("a@x", { subject: "[Ticket#9] a", date: "2026-08-01" }), fresh("b@x", { subject: "[Ticket#9] b", date: "2026-08-02" })]);
    expect(r).toEqual({ "a@x": "[[Mail/neu-a@x]]", "b@x": "[[Mail/neu-a@x]]" });
  });
  it("haelt einen Zyklus in den Verweisen aus: kein Wurf, jede Mail bekommt einen Wert", () => {
    const r = run([fresh("a@x", { inReplyTo: "b@x" }), fresh("b@x", { inReplyTo: "a@x" })]);
    expect(Object.keys(r).sort()).toEqual(["a@x", "b@x"]);
  });
  it("laesst die Mail aus, deren Pfad sich nicht als Wikilink schreiben laesst", () => {
    expect(run([fresh("n@x", { path: "Mail/Ticket #5" })])).toEqual({});
  });
});

describe("threadValuesForNew — vorberechnete Kennung (A5, Schritt 1)", () => {
  it("ordnet zwei Mails mit Platzhalter-Betreff ueber die Kennung aus dem Original zu", () => {
    const r = run([
      fresh("a@x", { subject: "Person_a", threadToken: "[Ticket#9]", date: "2026-08-01" }),
      fresh("b@x", { subject: "Person_b", threadToken: "[Ticket#9]", date: "2026-08-02" }),
    ]);
    expect(r).toEqual({ "a@x": "[[Mail/neu-a@x]]", "b@x": "[[Mail/neu-a@x]]" });
  });
  it("ohne die Kennung bleiben beide eigene Wurzeln (Gegenprobe)", () => {
    const r = run([fresh("a@x", { subject: "Person_a", date: "2026-08-01" }), fresh("b@x", { subject: "Person_b", date: "2026-08-02" })]);
    expect(r).toEqual({ "a@x": "[[Mail/neu-a@x]]", "b@x": "[[Mail/neu-b@x]]" });
  });
});
