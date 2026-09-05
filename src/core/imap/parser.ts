// IMAP-Antworten (RFC 3501 § 4): Leser fuer logische Zeilen mit Literalen und ein Tokenizer
// fuer Atome/Strings/NIL/Listen. Kein Node-/Obsidian-Import (siehe scripts/check-pure.mjs).
import type { SocketTransport } from "../net/types";
import { NetError } from "../net/types";
import { MAX_LITERAL_BYTES, type ImapItem, type ImapResponse } from "./types";

export interface RawLine {
  text: string;
  literals: Uint8Array[];
}

/** Ein Literal wird durch `{n}` am ZEILENENDE angekuendigt (`{n+}` = LITERAL+, RFC 7888).
 *  Nur dort — dieselbe Zeichenfolge mitten in einem quoted string ist Text. */
const LITERAL_AT_END = /\{(\d+)\+?\}$/;

export async function readRawLine(t: SocketTransport): Promise<RawLine> {
  const literals: Uint8Array[] = [];
  let text = await t.readLine();
  for (;;) {
    const m = LITERAL_AT_END.exec(text);
    if (!m) return { text, literals };
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n) || n < 0 || n > MAX_LITERAL_BYTES) {
      throw new NetError("protocol", `unplausible Literal-Groesse: ${String(m[1])}`);
    }
    literals.push(await t.readBytes(n));
    text += await t.readLine();
  }
}

const DELIM = new Set([" ", "(", ")"]);

export function tokenize(text: string, literals: Uint8Array[]): ImapItem[] {
  let i = 0;
  let litIndex = 0;

  function readList(): ImapItem[] {
    const out: ImapItem[] = [];
    for (;;) {
      while (text[i] === " ") i++;
      const c = text[i];
      if (c === undefined || c === ")") return out;
      out.push(readItem());
    }
  }

  function readQuoted(): ImapItem {
    i++; // oeffnendes "
    let v = "";
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") {
        v += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        return { kind: "string", value: v };
      }
      v += c;
      i++;
    }
    throw new NetError("protocol", "unterminierter quoted string (kein schließendes Anführungszeichen)");
  }

  /**
   * Ende eines Atoms ab `start`. Mit `klammernZusammenhalten` gehoeren eckige Klammern samt
   * Inhalt zum Atom (inkl. Leerzeichen und runder Klammern darin) — das braucht
   * `BODY[HEADER.FIELDS (MESSAGE-ID)]`. Liefert -1, wenn die Zeile mit OFFENER Klammer endet.
   */
  function atomEnde(start: number, klammernZusammenhalten: boolean): number {
    let j = start;
    let depth = 0;
    while (j < text.length) {
      const c = text[j];
      if (c === undefined) break;
      if (klammernZusammenhalten && c === "[") depth++;
      // Nie unter 0: ein schliessendes ] ohne oeffnendes darf die Tiefe nicht negativ machen,
      // sonst ist `depth === 0` nie wieder wahr und kein Trennzeichen greift mehr — der Rest
      // der Zeile wuerde zu einem einzigen Atom verschmelzen.
      else if (klammernZusammenhalten && c === "]") depth = Math.max(0, depth - 1);
      else if (depth === 0 && DELIM.has(c)) break;
      j++;
    }
    return depth > 0 ? -1 : j;
  }

  /**
   * ⚠️ Die eckige Klammer ist NICHT symmetrisch, und daran haengt dieser Zweizeiler:
   * RFC 3501 § 9 zaehlt `]` ueber `resp-specials` zu den `atom-specials`, `[` aber nicht.
   * Ein Atom — etwa ein Schluesselwort-Flag — darf eine oeffnende eckige Klammer also
   * voellig regelkonform tragen, ohne sie je zu schliessen.
   *
   * Die Klammer-Buchfuehrung existiert nur fuer EINEN Fall: `BODY[…]` samt Leerzeichen und
   * runden Klammern darin zusammenzuhalten. Blieb die Tiefe bis zum Zeilenende stehen, griff
   * kein Trennzeichen mehr — das Atom schluckte auch das `)` der umschliessenden Liste,
   * `readList` schloss nie, und ALLE folgenden Felder derselben FETCH-Antwort gingen
   * verloren.
   *
   * Der naheliegende Fix (ein `)` bei `depth > 0` als Ende behandeln) ist gegengeprueft
   * SCHAEDLICH: `BODY[HEADER.FIELDS (MESSAGE-ID)]` endete damit nach `(MESSAGE-ID` —
   * ausgerechnet das Kommando, mit dem der Sync Message-IDs abgleicht. Deshalb wird die
   * Entscheidung dort getroffen, wo sie eindeutig ist: am ZEILENENDE. Endet die Zeile mit
   * offener Klammer, war das `[` kein Abschnitts-Oeffner, und das Atom wird ohne
   * Klammer-Buchfuehrung neu gelesen.
   *
   * Was der Fix NICHT kann: ein verirrtes `[`, dem spaeter in derselben Zeile ein fremdes
   * `]` folgt. Dann geht die Tiefe zurueck auf 0 und nichts faellt auf. Das ist keine Luecke
   * dieser Loesung, sondern der Grammatik — auch ein Mensch koennte die beiden Faelle an
   * dieser Zeile nicht unterscheiden.
   */
  function readAtom(): ImapItem {
    const start = i;
    const ausgeglichen = atomEnde(start, true);
    i = ausgeglichen >= 0 ? ausgeglichen : atomEnde(start, false);
    const value = text.slice(start, i);
    if (value === "NIL") return { kind: "nil" };
    const lit = LITERAL_AT_END.exec(value);
    if (lit) {
      const bytes = literals[litIndex++];
      return bytes ? { kind: "literal", bytes } : { kind: "atom", value };
    }
    return { kind: "atom", value };
  }

  function readItem(): ImapItem {
    const c = text[i];
    if (c === "(") {
      i++;
      const items = readList();
      if (text[i] === ")") i++;
      return { kind: "list", items };
    }
    if (c === '"') return readQuoted();
    return readAtom();
  }

  return readList();
}

export function parseResponse(raw: RawLine): ImapResponse {
  const items = tokenize(raw.text, raw.literals);
  const first = items[0];
  const tag = first?.kind === "atom" ? first.value : "";
  const space = raw.text.indexOf(" ");
  return { tag, items, text: space === -1 ? "" : raw.text.slice(space + 1) };
}

export function firstLiteral(items: ImapItem[]): Uint8Array | null {
  for (const it of items) {
    if (it.kind === "literal") return it.bytes;
    if (it.kind === "list") {
      const inner = firstLiteral(it.items);
      if (inner) return inner;
    }
  }
  return null;
}

export function findAtomValue(items: ImapItem[], key: string): string | null {
  for (let i = 0; i < items.length - 1; i++) {
    const k = items[i];
    const v = items[i + 1];
    if (k?.kind === "atom" && k.value.toUpperCase() === key.toUpperCase() && v?.kind === "atom")
      return v.value;
  }
  return null;
}
