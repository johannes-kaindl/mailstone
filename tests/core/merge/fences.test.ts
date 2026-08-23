import { describe, it, expect } from "vitest";
import { splitBody, wrapBlock, zoneHash, BLOCK_BEGIN, BLOCK_END } from "../../../src/core/merge/fences";
describe("fences", () => {
  it("split findet Block und Aussenbereiche", () => {
    const body = `vorher\n${BLOCK_BEGIN}\n## Nachricht\n\nx\n${BLOCK_END}\nnachher`;
    expect(splitBody(body)).toEqual({ before: "vorher\n", block: "## Nachricht\n\nx", after: "\nnachher" });
  });
  it("ohne Fences: block null", () => { expect(splitBody("nur text").block).toBeNull(); });
  it("wrapBlock + zoneHash deterministisch", () => {
    expect(wrapBlock("a")).toBe(`${BLOCK_BEGIN}\na\n${BLOCK_END}`);
    expect(zoneHash("a\n")).toBe(zoneHash("a"));
  });
});
