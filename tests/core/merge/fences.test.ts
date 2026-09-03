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

// M1-Nachlese Punkt 1 (2026-08-23, offen bis 2026-09-03): der Frontmatter-Rewrite ist EOL-treu,
// die Zone war es nicht — `wrapBlock` schrieb immer LF und erzeugte in einer CRLF-Notiz
// gemischte Zeilenenden. Der Sync schreibt unbeaufsichtigt, also faellt so etwas niemandem auf.
describe("Zeilenenden", () => {
  it("wrapBlock schreibt den Block mit dem Zeilenende der Notiz", () => {
    const out = wrapBlock("## Nachricht\n\nHallo", "\r\n");
    expect(out).toBe(`${BLOCK_BEGIN}\r\n## Nachricht\r\n\r\nHallo\r\n${BLOCK_END}`);
    expect(/[^\r]\n/.test(out)).toBe(false);
  });

  it("wrapBlock bleibt ohne Angabe bei LF", () => {
    expect(wrapBlock("x")).toBe(`${BLOCK_BEGIN}\nx\n${BLOCK_END}`);
  });

  // Die Falle an diesem Fix, nicht der Fix selbst: der Zonen-Hash wird beim Planen aus dem
  // frisch gerenderten (LF-)Block gebildet und beim naechsten Lauf aus dem, was in der Notiz
  // steht. Schriebe wrapBlock CRLF, ohne dass zoneHash die Zeilenenden vereinheitlicht, meldete
  // jede CRLF-Notiz beim naechsten Sync "von Hand geaendert" — ein Konflikt, den niemand
  // verursacht hat.
  it("zoneHash ist unabhaengig vom Zeilenende", () => {
    expect(zoneHash("a\r\nb")).toBe(zoneHash("a\nb"));
  });
});

