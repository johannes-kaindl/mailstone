// Muster urspruenglich aus calendar-notes/src/core/mirror/body.ts (2026-08-23); die Zonen-Zerlegung liegt seit Welle 24 im Kit (code-kit `marker-zone`).
import { splitZone, wrapZone } from "../../vendor/code-kit/marker-zone";
import { sha256HexUtf8 } from "../../vendor/code-kit/sha256";

export const BLOCK_BEGIN = "%% mailstone:begin %%";
export const BLOCK_END = "%% mailstone:end %%";
const MARKERS = { begin: BLOCK_BEGIN, end: BLOCK_END };

/** Zerlegt den Body an den Zonen-Markern (code-kit `marker-zone`). **Der LETZTE End-Marker schliesst die Zone** (`end: "last"`, mailstones
 *  Regel fuer Bestandsnotizen): taucht die Marker-Zeichenkette im Mailtext auf, wuerde sonst der Rest der Zone zum freien Bereich — und
 *  beim naechsten Merge stuende Mailinhalt ausserhalb der verwalteten Zone. `renderMessageBlock` neutralisiert die Marker zusaetzlich
 *  beim Rendern; das hier ist die zweite Haelfte derselben Zusicherung (fremd erzeugte Zonen). Das Kit liest standardmaessig den ERSTEN
 *  End-Marker (calendar-notes), mailstone behaelt "last" mit Grund: der Inhalt der Zone ist ein fremder Mailtext, der den Marker
 *  enthalten kann; steht ein End-Marker des Nutzers UNTER der Zone, gehoert er in mailstones Notizen nicht zum Nutzertext.
 *  Unterschiede zur frueheren lokalen Fassung: ein BEGIN ohne END (`broken`) und kein Marker (`none`) liefern beide `block: null` wie
 *  vorher, der Aufrufer (`mergeNote`) meldet `fences-missing` und schreibt nichts; der Block verliert ein Zeilenende nach dem Zeilenende,
 *  mit dem die Zone geschrieben wurde (eine LF-Zone verschluckt ein einzelnes `\r` am Blockende nicht mehr). */
export function splitBody(body: string): { before: string; block: string | null; after: string } {
  const z = splitZone(body, MARKERS, { end: "last" });
  if (z.kind === "zone") return { before: z.before, block: z.block, after: z.after };
  return { before: body, block: null, after: "" };
}

/** Setzt die verwaltete Zone in die Marker. `eol` ist das Zeilenende der Zielnotiz: der
 *  Frontmatter-Rewrite ist EOL-treu, und die Zone muss es auch sein, sonst mischt ein
 *  unbeaufsichtigter Sync in einer CRLF-Notiz die Zeilenenden (M1-Nachlese Punkt 1). Der
 *  gerenderte Block kommt immer mit LF an und wird hier umgesetzt. */
export function wrapBlock(block: string, eol: "\n" | "\r\n" = "\n"): string {
  return wrapZone(block, MARKERS, eol);
}

/** Vergleichswert fuer "hat jemand die Zone von Hand geaendert?". Zeilenenden zaehlen dabei
 *  NICHT: der Hash entsteht einmal aus dem frisch gerenderten Block (LF) und einmal aus dem,
 *  was in der Notiz steht (deren EOL) — ohne diese Vereinheitlichung meldete jede CRLF-Notiz
 *  einen Konflikt, den niemand verursacht hat. */
export function zoneHash(block: string): string {
  return sha256HexUtf8(block.replace(/\r\n/g, "\n").trim());
}
