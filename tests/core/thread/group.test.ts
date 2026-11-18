import { describe, it, expect } from "vitest";
import { groupThreads, threadOf, type ThreadEntry } from "../../../src/core/thread/group";

function e(mailId: string, over: Partial<ThreadEntry> = {}): ThreadEntry {
  return { mailId, path: `Mail/${mailId}`, date: "2026-08-01", time: "10:00", inReplyTo: [], references: [], ...over };
}
const rootOf = (entries: ThreadEntry[]) => Object.fromEntries(groupThreads(entries).rootOf);

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

describe("threadOf", () => {
  const index = groupThreads([e("a@x", { date: "2026-08-01" }), e("b@x", { date: "2026-08-02" })]);
  it("ordnet ueber In-Reply-To zu", () => {
    expect(threadOf({ mailId: "n@x", inReplyTo: "a@x", references: [] }, index)).toBe("a@x");
  });
  it("nimmt In-Reply-To vor References", () => {
    expect(threadOf({ mailId: "n@x", inReplyTo: "a@x", references: ["b@x"] }, index)).toBe("a@x");
  });
  it("faellt auf References zurueck, wenn In-Reply-To auf keine Notiz im Vault trifft", () => {
    expect(threadOf({ mailId: "n@x", inReplyTo: "weg@x", references: ["a@x"] }, index)).toBe("a@x");
  });
  it("nimmt aus References die zuletzt genannte vorhandene Mail", () => {
    expect(threadOf({ mailId: "n@x", inReplyTo: null, references: ["a@x", "b@x"] }, index)).toBe("b@x");
  });
  it("liefert null, wenn kein Header auf eine Notiz im Vault trifft", () => {
    expect(threadOf({ mailId: "n@x", inReplyTo: "weg@x", references: ["auch-weg@x"] }, index)).toBeNull();
    expect(threadOf({ mailId: "n@x", inReplyTo: null, references: [] }, index)).toBeNull();
  });
  it("uebergeht einen Selbstverweis", () => {
    expect(threadOf({ mailId: "a@x", inReplyTo: "a@x", references: [] }, index)).toBeNull();
  });
});
