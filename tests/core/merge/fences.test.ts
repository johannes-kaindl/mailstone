import { describe, it, expect } from "vitest";
import { splitBody, wrapBlock, zoneHash, BLOCK_BEGIN, BLOCK_END } from "../../../src/core/merge/fences";
describe("fences", () => {
  it("split findet Block und Aussenbereiche", () => {
    const body = `vorher\n${BLOCK_BEGIN}\n## Nachricht\n\nx\n${BLOCK_END}\nnachher`;
    expect(splitBody(body)).toEqual({ before: "vorher\n", block: "## Nachricht\n\nx", after: "\nnachher" });
  });
  it("ohne Fences: block null", () => { expect(splitBody("nur text").block).toBeNull(); });
  it("zwei END-Marker: der letzte gewinnt (Mailtext kann die Zone nicht fruehzeitig schliessen)", () => {
    const body = `${BLOCK_BEGIN}\n## Nachricht\n\n${BLOCK_END}\nnoch drin\n${BLOCK_END}\nnachher`;
    expect(splitBody(body)).toEqual({ before: "", block: `## Nachricht\n\n${BLOCK_END}\nnoch drin`, after: "\nnachher" });
  });
  it("END-Marker nur VOR dem BEGIN: block null", () => {
    expect(splitBody(`${BLOCK_END}\ntext\n${BLOCK_BEGIN}\nx`).block).toBeNull();
  });
  it("wrapBlock + zoneHash deterministisch", () => {
    expect(wrapBlock("a")).toBe(`${BLOCK_BEGIN}\na\n${BLOCK_END}`);
    expect(zoneHash("a\n")).toBe(zoneHash("a"));
  });
});
