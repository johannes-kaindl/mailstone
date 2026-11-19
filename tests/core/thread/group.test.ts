import { describe, it, expect } from "vitest";
import { groupThreads, threadOf, type ThreadEntry } from "../../../src/core/thread/group";
import { DEFAULT_TOKEN as TOKEN, tokenRe } from "../../helpers/token";

function e(mailId: string, over: Partial<ThreadEntry> = {}): ThreadEntry {
  return { mailId, path: `Mail/${mailId}`, date: "2026-08-01", time: "10:00", inReplyTo: [], references: [], subject: `Betreff ${mailId}`, ...over };
}
const rootOf = (entries: ThreadEntry[], re = TOKEN) => Object.fromEntries(groupThreads(entries, re).rootOf);

describe("groupThreads — Verbindung ueber Header", () => {
  it("verbindet eine Kette ueber In-Reply-To und waehlt die fruehste Mail als Wurzel", () => {
    const r = rootOf([
      e("c@x", { date: "2026-08-03", inReplyTo: ["b@x"] }),
      e("a@x", { date: "2026-08-01" }),
      e("b@x", { date: "2026-08-02", inReplyTo: ["a@x"] }),
    ]);
    expect(r).toEqual({ "a@x": "a@x", "b@x": "a@x", "c@x": "a@x" });
  });
  it("verbindet eine Kette ueber References ohne In-Reply-To", () => {
    const r = rootOf([
      e("a@x", { date: "2026-08-01" }),
      e("b@x", { date: "2026-08-02", references: ["a@x"] }),
      e("c@x", { date: "2026-08-03", references: ["a@x", "b@x"] }),
    ]);
    expect(r).toEqual({ "a@x": "a@x", "b@x": "a@x", "c@x": "a@x" });
  });
  it("haelt Vorgaenge getrennt, die nichts verbindet", () => {
    const r = rootOf([e("a@x"), e("b@x", { date: "2026-08-02" }), e("c@x", { date: "2026-08-03", inReplyTo: ["b@x"] })]);
    expect(r).toEqual({ "a@x": "a@x", "b@x": "b@x", "c@x": "b@x" });
  });
  it("ignoriert einen Verweis auf eine Mail, die nicht im Vault liegt, und einen Selbstverweis", () => {
    const r = rootOf([e("a@x", { inReplyTo: ["weg@x"], references: ["a@x", "weg@x"] })]);
    expect(r).toEqual({ "a@x": "a@x" });
  });
  it("nimmt bei doppelter Mail-ID den ersten Eintrag", () => {
    const r = rootOf([e("a@x", { date: "2026-08-05" }), e("a@x", { date: "2026-08-01" }), e("b@x", { date: "2026-08-06", inReplyTo: ["a@x"] })]);
    expect(r["b@x"]).toBe("a@x");
  });
});

describe("groupThreads — Betreff-Token", () => {
  it("verbindet Mails mit demselben Token ohne Header-Bezug", () => {
    const r = rootOf([
      e("a@x", { subject: "[Ticket#42] Anfrage" }),
      e("b@x", { date: "2026-08-02", subject: "Re: [Ticket#42] Anfrage" }),
      e("c@x", { date: "2026-08-03", subject: "[Ticket#43] Anderes" }),
    ]);
    expect(r).toEqual({ "a@x": "a@x", "b@x": "a@x", "c@x": "c@x" });
  });
  it("verbindet nach Token nichts, wenn die Regel aus ist (kein oder ungueltiger Regex)", () => {
    const mails = [e("a@x", { subject: "[Ticket#42] A" }), e("b@x", { date: "2026-08-02", subject: "[Ticket#42] B" })];
    expect(rootOf(mails, null)).toEqual({ "a@x": "a@x", "b@x": "b@x" });
    expect(rootOf(mails, tokenRe("["))).toEqual({ "a@x": "a@x", "b@x": "b@x" });
  });
  it("fuehrt Header-Kette und Token-Gruppe zu einem Vorgang zusammen", () => {
    const r = rootOf([
      e("a@x", { subject: "[Ticket#42] A" }),
      e("b@x", { date: "2026-08-02", subject: "Antwort", inReplyTo: ["a@x"] }),
      e("c@x", { date: "2026-08-03", subject: "[Ticket#42] noch mal" }),
    ]);
    expect(r).toEqual({ "a@x": "a@x", "b@x": "a@x", "c@x": "a@x" });
  });
});

describe("groupThreads — Gruppe des Ausdrucks", () => {
  it("hat der Ausdruck eine Gruppe, ist ihr Inhalt die Kennung: andere Schreibweise, gleiche Nummer", () => {
    const re = tokenRe("Ticket ?#(\\d+)");
    const r = rootOf([
      e("a@x", { subject: "Ticket #42 Anfrage" }),
      e("b@x", { date: "2026-08-02", subject: "Re: Ticket#42 Anfrage" }),
      e("c@x", { date: "2026-08-03", subject: "Ticket #43" }),
    ], re);
    expect(r).toEqual({ "a@x": "a@x", "b@x": "a@x", "c@x": "c@x" });
  });
  it("ohne Gruppe ist der ganze Treffer die Kennung", () => {
    const r = rootOf([e("a@x", { subject: "[Ticket#42] A" }), e("b@x", { date: "2026-08-02", subject: "[Ticket#42] B" })], tokenRe("\\[Ticket#\\d+\\]"));
    expect(r).toEqual({ "a@x": "a@x", "b@x": "a@x" });
  });
  it("ein vom Risiko-Veto abgelehnter Ausdruck verbindet nichts", () => {
    const mails = [e("a@x", { subject: "aaa" }), e("b@x", { date: "2026-08-02", subject: "aaa" })];
    expect(tokenRe("(a+)+$")).toBeNull();
    expect(rootOf(mails, tokenRe("(a+)+$"))).toEqual({ "a@x": "a@x", "b@x": "b@x" });
  });
});

describe("groupThreads — Wurzelwahl", () => {
  it("die Wurzel wechselt, wenn eine fruehere Mail des Vorgangs dazukommt", () => {
    const b = e("b@x", { date: "2026-08-02" });
    const c = e("c@x", { date: "2026-08-03", inReplyTo: ["b@x"] });
    expect(rootOf([b, c])).toEqual({ "b@x": "b@x", "c@x": "b@x" });
    const a = e("a@x", { date: "2026-08-01" });
    expect(rootOf([a, { ...b, inReplyTo: ["a@x"] }, c])).toEqual({ "a@x": "a@x", "b@x": "a@x", "c@x": "a@x" });
  });
  it("bei gleicher Minute ist die Mail spaeter, die die andere nennt (E5), auch wenn ihre mailId kleiner ist", () => {
    const r = rootOf([
      e("a@x", { date: "2026-08-01", time: "10:00", inReplyTo: ["z@x"] }),
      e("z@x", { date: "2026-08-01", time: "10:00" }),
    ]);
    expect(r).toEqual({ "a@x": "z@x", "z@x": "z@x" });
  });
  it("bei gleicher Minute ohne Verweis entscheidet die kleinere mailId", () => {
    const r = rootOf([e("b@x", { references: ["fern@x"] }), e("a@x", { references: ["fern@x"] }), e("fern@x", { date: "2026-08-09" })]);
    expect(r).toEqual({ "a@x": "a@x", "b@x": "a@x", "fern@x": "a@x" });
  });
  it("bei gleicher Minute und gleicher Kennung entscheidet die kleinere mailId", () => {
    const r = rootOf([e("b@x", { subject: "[Ticket#1] a" }), e("a@x", { subject: "[Ticket#1] b" })]);
    expect(r).toEqual({ "a@x": "a@x", "b@x": "a@x" });
  });
  it("eine Mail ohne Datum steht am Ende der Reihenfolge", () => {
    const r = rootOf([e("a@x", { date: "", time: "" }), e("b@x", { date: "2026-08-09", inReplyTo: ["a@x"] })]);
    expect(r).toEqual({ "a@x": "b@x", "b@x": "b@x" });
  });
  it("kommt mit einem Zyklus in den Verweisen zurecht", () => {
    const r = rootOf([e("a@x", { inReplyTo: ["b@x"] }), e("b@x", { inReplyTo: ["a@x"] })]);
    expect(r["a@x"]).toBe(r["b@x"]);
    expect(["a@x", "b@x"]).toContain(r["a@x"]);
  });
});

describe("threadOf — Header vor Token", () => {
  const index = groupThreads([
    e("a@x", { date: "2026-08-01" }),
    e("t@x", { date: "2026-08-02", subject: "[Ticket#7] Sonstiges" }),
  ], TOKEN);
  it("ordnet ueber den Header zu, auch wenn der Betreff-Token auf einen anderen Vorgang zeigt", () => {
    expect(threadOf({ mailId: "n@x", inReplyTo: "a@x", references: [], subject: "Re: [Ticket#7] x" }, index)).toBe("a@x");
  });
  it("faellt auf den Token zurueck, wenn kein Header auf eine Notiz im Vault trifft", () => {
    expect(threadOf({ mailId: "n@x", inReplyTo: "weg@x", references: ["auch-weg@x"], subject: "Re: [Ticket#7] x" }, index)).toBe("t@x");
  });
  it("nimmt aus References die zuletzt genannte vorhandene Mail", () => {
    const idx = groupThreads([e("a@x"), e("b@x", { date: "2026-08-02", subject: "andere" })], TOKEN);
    expect(threadOf({ mailId: "n@x", inReplyTo: null, references: ["a@x", "b@x"], subject: "s" }, idx)).toBe("b@x");
  });
  it("liefert null, wenn weder Header noch Token treffen", () => {
    expect(threadOf({ mailId: "n@x", inReplyTo: null, references: [], subject: "[Ticket#99] neu" }, index)).toBeNull();
    expect(threadOf({ mailId: "n@x", inReplyTo: null, references: [], subject: "ohne Token" }, index)).toBeNull();
  });
  it("nutzt den Token nur, wenn die Regel an ist", () => {
    const aus = groupThreads([e("t@x", { subject: "[Ticket#7] a" })], null);
    expect(threadOf({ mailId: "n@x", inReplyTo: null, references: [], subject: "[Ticket#7] b" }, aus)).toBeNull();
  });
});
