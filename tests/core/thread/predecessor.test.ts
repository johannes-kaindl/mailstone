import { describe, it, expect } from "vitest";
import { buildPredecessorLookup, predecessorOf, type PredecessorMail } from "../../../src/core/thread/predecessor";

const m = (mailId: string, over: Partial<PredecessorMail> = {}): PredecessorMail => ({ mailId, inReplyTo: null, references: [], ...over });
const lookup = (nodes: PredecessorMail[]) => buildPredecessorLookup(nodes);

describe("predecessorOf", () => {
  it("nimmt die Mail aus In-Reply-To, wenn es sie gibt", () => {
    const mail = m("n@x", { inReplyTo: "a@x", references: ["b@x"] });
    expect(predecessorOf(mail, lookup([m("a@x"), m("b@x")]))).toBe("a@x");
  });
  it("nimmt sonst die zuletzt genannte vorhandene Mail aus References", () => {
    const mail = m("n@x", { inReplyTo: "weg@x", references: ["a@x", "b@x", "weg@x"] });
    expect(predecessorOf(mail, lookup([m("a@x"), m("b@x")]))).toBe("b@x");
  });
  it("liefert null ohne Bezug auf eine vorhandene Notiz", () => {
    expect(predecessorOf(m("n@x"), lookup([m("a@x")]))).toBeNull();
    expect(predecessorOf(m("n@x", { inReplyTo: "weg@x", references: ["auch-weg@x"] }), lookup([m("a@x")]))).toBeNull();
  });
  it("nennt nie die Mail selbst als Vorgaengerin", () => {
    const mail = m("n@x", { inReplyTo: "n@x", references: ["n@x"] });
    expect(predecessorOf(mail, lookup([mail]))).toBeNull();
  });
});
