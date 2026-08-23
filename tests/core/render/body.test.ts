import { describe, it, expect } from "vitest";
import { chooseSource, htmlToMarkdown, renderMessageBlock } from "../../../src/core/render/body";
import { parseEml } from "../../../src/core/mime/parse";
import { loadFixture } from "../../helpers/fixtures";

describe("chooseSource", () => {
  it("text gewinnt, wenn substanziell", () => {
    expect(chooseSource({ text: "a".repeat(50), html: "<p>" + "b".repeat(100) + "</p>" })).toBe("text");
  });
  it("html gewinnt bei leerem/Stub-Plain", () => {
    expect(chooseSource({ text: "Diese Nachricht enthält HTML.", html: "<p>" + "x".repeat(1000) + "</p>" })).toBe("html");
    expect(chooseSource({ text: "", html: "<p>x</p>" })).toBe("html");
  });
  it("none wenn beides fehlt", () => { expect(chooseSource({ text: null, html: null })).toBe("none"); });
});
describe("htmlToMarkdown", () => {
  it("Blockquote bleibt >, cid-Bild wird Platzhalter, Trackingpixel faellt weg", () => {
    const md = htmlToMarkdown('<p>Hi</p><blockquote><p>Zitat</p></blockquote><img src="cid:logo@example.org" alt="Logo"><img src="https://example.com/p.gif" width="1" height="1">');
    expect(md).toContain("> Zitat");
    expect(md).toContain("(Inline-Bild: Logo)");
    expect(md).not.toContain("p.gif");
  });
  it("Layout-Tabellen werden zu Text, Links bleiben", () => {
    const md = htmlToMarkdown('<table><tr><td><a href="https://example.com/a">Link</a></td></tr></table>');
    expect(md).toContain("[Link](https://example.com/a)");
    expect(md).not.toContain("<table");
  });
});
describe("renderMessageBlock", () => {
  it("beginnt mit ## Nachricht und rendert Fixtures stabil (Snapshot)", async () => {
    for (const f of ["utf8-plain", "multipart-alternative", "multipart-alternative-stub-plain", "multipart-related-inline"]) {
      const block = renderMessageBlock(await parseEml(loadFixture(f)));
      expect(block.startsWith("## Nachricht\n\n")).toBe(true);
      expect(block).toMatchSnapshot(f);
    }
  });
  it("ohne Body: Hinweiszeile", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    expect(renderMessageBlock({ ...m, text: null, html: null })).toBe("## Nachricht\n\n*(no text content)*");
  });
  it("Fence-Marker im Mailtext werden neutralisiert (Zone kann nicht ausbrechen)", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    const block = renderMessageBlock({ ...m, text: "vorher\n%% mailstone:end %%\nnachher\n%%  MAILSTONE:BEGIN  %%", html: null });
    expect(block).not.toContain("mailstone:end");
    expect(block).not.toContain("MAILSTONE:BEGIN");
    expect(block).toContain("(mailstone marker removed)");
    expect(block).toContain("vorher");
    expect(block).toContain("nachher");
  });
  it("Fence-Marker aus HTML werden ebenfalls neutralisiert", () => {
    const block = renderMessageBlock({ text: null, html: "<p>%% mailstone:end %%</p><p>Rest</p>" });
    expect(block).not.toContain("mailstone:end");
    expect(block).toContain("(mailstone marker removed)");
  });
});
