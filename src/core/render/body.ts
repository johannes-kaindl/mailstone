import TurndownService from "turndown";
import type { ParsedMail } from "../mime/types";

export interface RenderBodyOptions { plainMinRatio?: number }

// Reale Mails: HTML traegt oft tausende Zeichen Text, ein Plain-Stub ("Diese Nachricht
// enthaelt HTML.") nur 30-80. 0.1 trennt das zuverlaessig; kalibrierbar ueber RenderBodyOptions.plainMinRatio.
export const DEFAULT_PLAIN_MIN_RATIO = 0.1;

function textLenOfHtml(html: string): number {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

export function chooseSource(m: Pick<ParsedMail, "text" | "html">, opts: RenderBodyOptions = {}): "text" | "html" | "none" {
  const ratio = opts.plainMinRatio ?? DEFAULT_PLAIN_MIN_RATIO;
  const text = (m.text ?? "").trim();
  const html = (m.html ?? "").trim();
  if (!text && !html) return "none";
  if (!html) return "text";
  if (!text) return "html";
  return text.length >= ratio * textLenOfHtml(html) ? "text" : "html";
}

let td: TurndownService | null = null;
function turndown(): TurndownService {
  if (td) return td;
  td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  td.remove(["style", "script", "head", "title"]);
  // Trackingpixel + sonstige 1x1-Bilder verwerfen
  // Nur literale width="1" height="1"-Attribute; CSS-groesse 1x1-Pixel liegen ausserhalb dieser Heuristik.
  td.addRule("tracking-pixel", {
    filter: (node) => node.nodeName === "IMG" && ((node.getAttribute("width") === "1" && node.getAttribute("height") === "1")),
    replacement: () => "",
  });
  // cid:-Bilder → Platzhalter (nie data-URI, nie extrahiert; Anzeige in der .eml-View)
  td.addRule("cid-image", {
    filter: (node) => node.nodeName === "IMG" && (node.getAttribute("src") ?? "").startsWith("cid:"),
    replacement: (_c, node) => {
      const label = node.getAttribute("alt") || node.getAttribute("title") || (node.getAttribute("src") ?? "").slice(4);
      return `(Inline-Bild: ${label})`;
    },
  });
  // Tabellen: Zellen als Text mit Leerzeichen, Zeilen als Absaetze (Layout-Tabellen in Mails sind kein Tabellendaten)
  td.addRule("table-cell", { filter: ["td", "th"], replacement: (content) => `${content.trim()} ` });
  td.addRule("table-row", { filter: "tr", replacement: (content) => `${content.trim()}\n\n` });
  td.addRule("table", { filter: ["table", "thead", "tbody", "tfoot"], replacement: (content) => content });
  return td;
}

export function htmlToMarkdown(html: string): string {
  return turndown().turndown(html).replace(/\n{3,}/g, "\n\n").trim();
}

/** Die Fence-Marker duerfen im gerenderten Mailtext nicht vorkommen: ein "%% mailstone:end %%"
 *  in einer Mail wuerde die verwaltete Zone vorzeitig schliessen und den Rest des Mailtexts in
 *  den freien Bereich entlassen — der beim naechsten Merge unangetastet bliebe und dauerhaft
 *  in der Notiz stuende. Absichtlich unuebersetzt: core bleibt sprachfrei. */
const FENCE_MARKER_RE = /%%\s*mailstone:(begin|end)\s*%%/gi;
const FENCE_MARKER_REPLACEMENT = "(mailstone marker removed)";

export function renderMessageBlock(m: Pick<ParsedMail, "text" | "html">, opts: RenderBodyOptions = {}): string {
  const src = chooseSource(m, opts);
  let body: string;
  if (src === "text") body = (m.text ?? "").replace(/\r\n/g, "\n").trim();
  else if (src === "html") body = htmlToMarkdown(m.html ?? "");
  else body = "*(no text content)*";
  return `## Nachricht\n\n${body.replace(FENCE_MARKER_RE, FENCE_MARKER_REPLACEMENT)}`;
}
