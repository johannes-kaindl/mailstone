// uebernommen (Muster) aus calendar-notes/src/core/mirror/body.ts (splitBody/mergeBody), 2026-08-23
import { sha256HexUtf8 } from "../../vendor/code-kit/sha256";

export const BLOCK_BEGIN = "%% mailstone:begin %%";
export const BLOCK_END = "%% mailstone:end %%";

export function splitBody(body: string): { before: string; block: string | null; after: string } {
  const i = body.indexOf(BLOCK_BEGIN);
  if (i < 0) return { before: body, block: null, after: "" };
  // Der LETZTE End-Marker schliesst die Zone, nicht der erste: taucht die Marker-Zeichenkette
  // im Mailtext auf, wuerde sonst der Rest der Zone zum freien Bereich — und beim naechsten
  // Merge stuende Mailinhalt ausserhalb der verwalteten Zone. renderMessageBlock neutralisiert
  // die Marker zusaetzlich beim Rendern; das hier ist die zweite Haelfte derselben Zusicherung
  // (Bestandsnotizen, fremd erzeugte Zonen).
  const j = body.lastIndexOf(BLOCK_END);
  if (j < i + BLOCK_BEGIN.length) return { before: body, block: null, after: "" };
  const inner = body
    .slice(i + BLOCK_BEGIN.length, j)
    .replace(/^\r?\n/, "")
    .replace(/\r?\n$/, "");
  return { before: body.slice(0, i), block: inner, after: body.slice(j + BLOCK_END.length) };
}

/** Setzt die verwaltete Zone in die Marker. `eol` ist das Zeilenende der Zielnotiz: der
 *  Frontmatter-Rewrite ist EOL-treu, und die Zone muss es auch sein, sonst mischt ein
 *  unbeaufsichtigter Sync in einer CRLF-Notiz die Zeilenenden (M1-Nachlese Punkt 1). Der
 *  gerenderte Block kommt immer mit LF an und wird hier umgesetzt. */
export function wrapBlock(block: string, eol: "\n" | "\r\n" = "\n"): string {
  const inner = eol === "\n" ? block : block.replace(/\r?\n/g, eol);
  return `${BLOCK_BEGIN}${eol}${inner}${eol}${BLOCK_END}`;
}

/** Vergleichswert fuer "hat jemand die Zone von Hand geaendert?". Zeilenenden zaehlen dabei
 *  NICHT: der Hash entsteht einmal aus dem frisch gerenderten Block (LF) und einmal aus dem,
 *  was in der Notiz steht (deren EOL) — ohne diese Vereinheitlichung meldete jede CRLF-Notiz
 *  einen Konflikt, den niemand verursacht hat. */
export function zoneHash(block: string): string {
  return sha256HexUtf8(block.replace(/\r\n/g, "\n").trim());
}
