import { describe, it, expect } from "vitest";
import { bodyMarkdown, chooseSource, htmlToMarkdown, renderMessageBlock } from "../../../src/core/render/body";
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
  it("Ueberschriften aus der Mail werden unter das Block-Level (## Nachricht) demotet", () => {
    // Ein h1 aus einer Newsletter-Mail wuerde unveraendert als "#" neben dem Notiz-Titel
    // stehen und Obsidians Gliederung aufbrechen (h1 "unter" einer h2 ist keine gueltige
    // Verschachtelung). Verschoben um zwei Ebenen, gedeckelt bei h6.
    const md = htmlToMarkdown("<h1>Eins</h1><h2>Zwei</h2><h4>Vier</h4><h6>Sechs</h6>");
    expect(md).toContain("### Eins");
    expect(md).toContain("#### Zwei");
    expect(md).toContain("###### Vier");
    expect(md).toContain("###### Sechs");
    expect(md).not.toMatch(/^#[^#]/m);
    expect(md).not.toMatch(/^##[^#]/m);
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

// Vorstufe fuer A5: der Body als Markdown-Text, den ein Transformer sieht und zurueckgibt. Zusage: ein Mail-Objekt
// mit `text: bodyMarkdown(m), html: null` rendert byte-gleich zum Original, `renderMessageBlock` baut seinen Body selbst
// ueber diese Funktion (eine Wahrheit).
describe("bodyMarkdown", () => {
  const STUB = "Diese Nachricht enthält HTML.";
  const LONG_HTML = "<h1>Titel</h1><p>" + "Wort ".repeat(200) + "</p>";
  const faelle: [string, { text: string | null; html: string | null }][] = [
    ["nur Text", { text: "Hallo\nWelt", html: null }],
    ["nur HTML", { text: null, html: "<p>Hallo <b>Welt</b></p>" }],
    ["HTML mit h1", { text: null, html: "<h1>Eins</h1><p>Text</p>" }],
    ["beides, Plain ist ein Stub", { text: STUB, html: LONG_HTML }],
    ["beides, Plain ist lang", { text: "Wort ".repeat(300), html: "<p>" + "Wort ".repeat(200) + "</p>" }],
    ["leer", { text: null, html: null }],
    ["nur Leerraum", { text: "  \n ", html: "  " }],
    ["Text mit Fence-Marker", { text: "vorher\n%% mailstone:end %%\nnachher %%  MAILSTONE:BEGIN  %%", html: null }],
    ["HTML mit Fence-Marker", { text: null, html: "<p>%% mailstone:end %%</p>" }],
    ["CRLF im Text", { text: "Zeile 1\r\nZeile 2\r\n\r\nAbsatz", html: null }],
    ["Text mit Rand-Leerraum", { text: "\n\n  eingerueckt  \n\n", html: null }],
    ["HTML ohne Text (nur Trackingpixel)", { text: null, html: '<img src="https://example.com/p.gif" width="1" height="1">' }],
  ];
  const optionen: [string, { plainMinRatio?: number }][] = [["ohne plainMinRatio", {}], ["mit plainMinRatio 0.9", { plainMinRatio: 0.9 }], ["mit plainMinRatio 0.001", { plainMinRatio: 0.001 }]];
  for (const [fall, m] of faelle) {
    for (const [on, opts] of optionen) {
      it(`${fall}, ${on}: Rundlauf ueber text/html null ist byte-gleich`, () => {
        const mail = { ...m };
        expect(renderMessageBlock({ ...mail, text: bodyMarkdown(mail, opts), html: null }, opts)).toBe(renderMessageBlock(mail, opts));
      });
    }
  }
  it("renderMessageBlock setzt genau bodyMarkdown unter die Ueberschrift", () => {
    for (const [, m] of faelle) expect(renderMessageBlock(m, { heading: "Kopf" })).toBe(`## Kopf\n\n${bodyMarkdown(m)}`);
  });
  it("leer: Hinweiszeile", () => { expect(bodyMarkdown({ text: null, html: null })).toBe("*(no text content)*"); });
  it("Fence-Marker sind ersetzt, CRLF ist LF, Rand getrimmt", () => {
    expect(bodyMarkdown({ text: "a\r\n%% mailstone:end %%\r\n", html: null })).toBe("a\n(mailstone marker removed)");
  });
  it("HTML geht ueber Turndown, h1 rutscht auf Ebene 3", () => { expect(bodyMarkdown({ text: null, html: "<h1>Eins</h1><p>Text</p>" })).toBe("### Eins\n\nText"); });
  it("Plain-Stub gegen langes HTML: HTML gewinnt, plainMinRatio kippt die Wahl", () => {
    const m = { text: STUB, html: LONG_HTML };
    expect(bodyMarkdown(m)).toContain("Wort Wort");
    expect(bodyMarkdown(m, { plainMinRatio: 0.001 })).toBe(STUB);
  });
});
