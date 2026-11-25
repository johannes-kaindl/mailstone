// vendored from obsidian-kit@0.111.0, src/pure/frontmatter-patch.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// frontmatter-patch.ts — eigene Frontmatter-Felder setzen, fremde Zeilen byte-gleich lassen. Kein obsidian-Import.
//
// Zusammengeführt aus zwei unabhängigen Fassungen desselben Vorgangs (Diachronic wäre die dritte):
//   · finance-ledger `src/core/notes/frontmatter.ts:56` `patchFrontmatter` — zeilenweise, `set`/`ensure`, `created` geschützt,
//     eine Notiz ohne Block bleibt unverändert, Listen abgelehnt, Fehler werfen.
//   · mailstone `src/core/merge/merge.ts:209` `setFrontmatterField` — ersetzt einen Schlüssel samt Fortsetzungszeilen (Listen),
//     serialisiert über `serializeFrontmatter` (Quoting), legt einen fehlenden Block an, meldet Block-Skalare als Wert.
// Der Ablauf ist mailstones (Einträge mit Fortsetzungszeilen, ein Schlüssel über das Kit serialisiert, Zeilenende aus dem Block);
// dazu kommen `ensure`, `protect`, `create` und `onlyExisting`. Unterschiede zu den Vorgängern und ihr Grund:
//   · Fehler sind Werte (`ok: false`), nie ein Wurf — Kit-Konvention (`marker-zone`, `tool-provider`).
//   · Eine Notiz OHNE Block bleibt unverändert, solange `create` nicht gesetzt ist: eine fremde Notiz bekommt keinen Block,
//     eine eigene Notiz (mailstone) schon — beide Fälle sind begründet, der sichere ist der Default.
//   · Listen gehen als Flow-Liste (`[a, b]`) und ersetzen eine bestehende Blockliste samt ihren Zeilen. Obsidians
//     Eigenschaften-Editor schreibt sie beim nächsten Bearbeiten als Blockliste um, Bases liest beide gleich.
//   · Werte sind typisiert (`string | number | boolean | string[]`; ein `boolean` steht bar als `true`/`false`, ein Text `"true"` gequotet) und laufen durch `serializeFrontmatter` (quotet `"1"`, `true`, `a, b`);
//     finance-ledger übergab fertiges YAML und verlagerte das Quoting auf jeden Aufrufer.
//   · `protect` (Default `["created"]`) verweigert ein `set` — finance-ledgers Grund (ein Lauf setzte `created` jedes Mal neu) gilt allgemein.
//   · Beim Anhängen an einen CRLF-Block bleibt das Zeilenende CRLF; finance-ledger schrieb dort `\n` vor die angehängte Zeile und
//     ein doppeltes `\r` dahinter (`neu: x\r\r\n---`, gemessen 2026-10-21 an der Referenzkopie).
//   · Ein leerer Block (`---` / `---`) ist ein Block; mailstone meldete ihn als nicht lesbar.
//   · Zusätzlich verweigert: eine Zahl, die keine endliche ist (`invalid-value`), und ein Schlüssel, den der Block-Leser nicht als Schlüssel erkennt (`invalid-key`).
//     Ein Text mit Zeilenumbruch wird geschrieben, als Escape in doppelten Anführungszeichen (`a: "x\ny"`); bis 0.95.0 war das `invalid-value` (Welle 36, k9b).
//   · Ein Literal (`{ literal: "53240.00" }`) wird unverändert geschrieben, nie gequotet — für Aufrufer, die fertige Skalare haben
//     (finance-ledger: `saldo_eur` aus `Money.toFixed(2)`, `anfangssaldo_eur: null`). `FmValue` kann das nicht: ein `number` verliert
//     die endende Null (`12.50` → `12.5`), ein `string` bekommt Anführungszeichen (`"null"`, `"53240.00"`). Zugelassen sind genau diese
//     Formen (`null`, `true`, `false`, Dezimalzahl, einzeiliger doppelt gequoteter Text); alles andere ist `invalid-value`, damit kein Umbruch, Kommentar oder Fremd-YAML
//     durch die Hintertür kommt. Der gequotete Text ist für Aufrufer, deren Wert im Bestand schon so steht (finance-ledger `glaeubiger_id`:
//     `"DE98ZZZ00000000001"`); `isFmLiteralText` gibt die Prüfung heraus, damit kein Konsument die Regex kopiert. Die Regex ist enger als die in `needsQuoting` (`-.5` und `+.5` liest js-yaml als Text, Obsidian als Zahl: die Menge
//     hier ist die gemeinsame). Gemessen 2026-10-25 in Obsidian 1.14.5 (`pilot/literal-formen.ts`): `parseYaml`, `metadataCache` und der gerenderte
//     Eigenschaften-Editor (Zahlenfeld) lesen `5.`, `+5`, `-0` und `007` als Zahl mit demselben Wert wie js-yaml 4.2.0 (5, 5, 7); nur `-0` bleibt bei Obsidian
//     ein `-0` (js-yaml: `0`), das Feld zeigt `0`, aus dem Cache einer unveränderten Notiz liest man `0`.
//     Bases gemessen (Obsidian 1.14.5, `pilot/bases-literale.ts`, Tabellenansicht mit der Formel `x + 1` und einer Sortierung nach `x`): `5.`, `+5`, `-0` und `007` sind Zahlen (Zelle `5`, `5`, `0`, `7`;
//     `x + 1` ergibt `6`, `6`, `1`, `8`, nie eine Verkettung wie `5.1`; `12.50` zeigt `12.5`), die Sortierung ist numerisch (`0`, `5`, `5`, `7`, `12.5`), `"DE98"` bleibt Text. Dieselbe Lesart wie js-yaml und Obsidian: die Regex bleibt.
// Grenzen, bewusst wie im Kit-Parser: ein Schlüssel muss `[A-Za-z0-9_][\w .-]*` sein (ein Schlüssel mit Umlaut wird nicht gefunden,
// also angehängt, nicht ersetzt — `invalid-key` fängt ihn deshalb schon beim Setzen ab); Kommentare auf der Zeile eines gesetzten
// Schlüssels gehen mit der Zeile verloren; ein Block-Skalar (`|`, `>`, auch hinter Tag oder Anker: `!!str |`, `&z >`) wird gemeldet, nicht ersetzt.
//
// Das Ende eines Werts bestimmt der Leser selbst (Welle 34, Paket 12; vorher beendete die erste nicht eingerückte Zeile den Wert und `set`/`remove` schnitten Listen mit Leerzeile oder Kommentar an, gemessen: 16 von 22 Formen
// gegen js-yaml falsch): ein einfacher oder leerer Wert reicht über alle eingerückten Zeilen; Leerzeilen und Kommentare auf Spalte 0 gehören dazu, wenn danach eine Fortsetzung folgt (sonst stehen sie vor dem nächsten Schlüssel);
// bei leerem Wert zählen auch Listenpunkte auf Spalte 0. Ein gequoteter Wert reicht bis zur schließenden Quote, ein Flow-Wert (`[`, `{`) bis zur schließenden Klammer, beides über Zeilen hinweg (Quotes und Kommentare in der Klammer
// werden übersprungen, ein `'` öffnet nur am Tokenanfang). Schließt eine Quote oder Klammer bis zum Blockende nicht, ist das Ende nicht bestimmbar: der Schlüssel wird verweigert (`unparseable` mit `key`), die übrigen Schlüssel
// bleiben bearbeitbar. Gequotete Schlüssel (`"t":`, `'t':`) sind der Schlüssel `t`. Maßstab ist js-yaml als Orakel im Test (`tests/frontmatter-patch-yaml.test.ts`), die Wahrheit ist Obsidian (Pilot `frontmatter-leser`).
//
// `remove` (Welle 34, Paket 5; Wunsch finance-ledger, `scripts/migrate-note-schema.ts`): entfernt je Schlüssel ALLE seine Vorkommen samt Fortsetzungszeilen (Blockliste, eingerückte Folgezeilen) — dieselbe Zeilengruppe, die `set` ersetzt,
// nur ohne Ersatz. Ein fehlender Schlüssel ist kein Fehler; `protect` gilt auch hier; derselbe Schlüssel in `remove` und in `set`/`ensure` ist `conflict` (nie raten, welcher gewinnt). Fällt der letzte Schlüssel, bleibt der leere Block
// (`---` und `---`) stehen. Ein Schlüssel mit Leerzeichen am Ende ist auch beim Entfernen `invalid-key` (gemessen 2026-11-14: der Leser trimmt den Schlüssel, `a : x` steht als `a` im Block, also entfernt `remove: ["a"]` diese Zeile; eine Ausnahme ist nicht nötig).
//
// VERWEIGERT, WO OBSIDIAN SICH SELBST WIDERSPRICHT (Welle 34, Paket C1b; gemessen 2026-11-14, Obsidian 1.15.1, Pilot `frontmatter-leser`, Tabelle im Kopf von `frontmatter.ts`): `getFrontMatterInfo` und der `metadataCache` lesen dasselbe Dokument verschieden. Das Kit LIEST
// nach `getFrontMatterInfo` (`locateFrontmatter`), SCHREIBT aber nur, wo beide Leser einig sind; sonst `{ ok: false, reason: "unparseable" }` für jede Operation (`set`, `ensure`, `remove`, mit und ohne `create`), der Text bleibt unberührt:
//   (1) Im gefundenen Block beginnt eine Zeile auf Spalte 0 mit `---` (`---x`, `----`, `--- b`, auch `---` plus Leerraum; der schließende Zaun selbst steht nicht im Block): der Cache schließt den Block an dieser Zeile, `getFrontMatterInfo` erst am echten Zaun,
//       ein geschriebener Schlüssel stünde hinter dem Ende, das die Eigenschaften-Ansicht sieht.
//   (2) Eine Zeile auf Spalte 0 gehört keinem Schlüssel (kein Schlüssel, Kommentar, Leerzeile oder Fortsetzung, deren Ende der Leser bestimmt hat): der Block ist kein Mapping (Fließtext zwischen zwei Trennlinien, `...`). Ein Block nur aus Leerzeilen und Kommentaren bleibt beschreibbar.
//   (3) Der Text beginnt mit einem BOM, direkt dahinter eine Zaunzeile `---` samt Zeilenende: `getFrontMatterInfo` sieht keinen Block, der Cache liest den BOM mit; `create: true` schriebe einen zweiten Block VOR den alten. Ein BOM ohne Zaun dahinter bleibt wie vorher (kein Block, mit `create` kommt der Block davor).
//
// VERWEIGERT, WO OBSIDIAN DEN BLOCK NICHT LIEST, UND FREIGEGEBEN, WO ER IHN LIEST (Welle 35, Paket 4 C; gemessen 2026-11-15, Obsidian 1.15.1, Pilot `frontmatter-leser` Teil D, zwei Läufe, Rohzeilen im Bericht kitw3). Regel (Vertrag): `patchFrontmatter` schreibt genau dann, wenn BEIDE Leser den Block lesen
// (`metadataCache` und Eigenschaften-Ansicht liefern den erwarteten Schlüsselsatz); liest einer ihn nicht, ist die Antwort `unparseable` für jede Operation und der Text bleibt unberührt. js-yaml ist dafür kein Maßstab (es liest f4 und f6, Obsidian nicht). Die Formen:
//   f1 VERWEIGERT  eingerückte schlüssellose Zeile vor dem ersten Schlüssel (`  x` / `a: 1`): Cache `null`, Ansicht „Invalid properties“; ebenso f1b (`a: "x"` / `  y` / `b: 2`) und f2b (Tab-Zeile vor dem ersten Schlüssel). Regel (3).
//   f2 VERWEIGERT  Tab-Zeile zwischen zwei Schlüsseln (`a: 1` / `\tx` / `b: 2`): Cache `null`, Ansicht „Invalid properties“. Regel (4).
//   f3 VERWEIGERT  Plain-Fortsetzung mit Doppelpunkt (`a: x` / `  t: 5`): Cache `null`, Ansicht „Invalid properties“. Regel (5); bei leerem Wert (`t:` / `  u: 5`) ist es ein verschachteltes Mapping und bleibt beschreibbar.
//   f4 VERWEIGERT  mehrzeilige Flow-Liste mit uneingerückter Folgezeile (`t: [a,` / `b]`): Cache `null`, Ansicht „Invalid properties“ (js-yaml liest `{t:[a,b]}`). Regel (6); bis 0.93.0 wurde hier geschrieben (gemeldet, nicht geglättet). Dieselbe Liste mit eingerückter Folgezeile (f4b) liest Obsidian: geprüft, beschreibbar.
//   f5 GEPRÜFT     Schlüssel mit führendem Bindestrich (`-a: 1`, auch `-1: x`, allein oder neben `b: 2`): Cache und Ansicht lesen ihn unter seinem Namen, js-yaml auch; bis 0.93.0 verweigert, weil der Leser die Zeile keinem Schlüssel zuordnete (Regel (2)). Jetzt ein Schlüssel des Blocks (Bindestrich plus Wortzeichen;
//                  `- a: 1` mit Leerzeichen bleibt ein Listenpunkt, `---x` fällt unter Regel (1)). Setzen und Entfernen unter dem Namen `-a` bleibt `invalid-key` (`isFrontmatterKeyName`); der Eintrag wird nur gelesen und byte-gleich gelassen.
//   f6 VERWEIGERT  mehrzeiliger gequoteter Wert mit uneingerückter Folgezeile (`t: "x` / `y"`): Cache `null`, Ansicht „Invalid properties“ (js-yaml liest `x y`). Regel (6). Mit eingerückter Folgezeile (f6b) liest Obsidian: geprüft. Die einfache Quote (`'x` / `y'`) ist nicht gemessen, sie folgt derselben Regel.
// Kontrolle der Messung: f0 (zwei gewöhnliche Schlüssel) und f1c (eingerückter Kommentar vor dem ersten Schlüssel) lesen beide Leser, das Ergebnis des Schreibens liest der Cache wieder. Nicht gemessen und unverändert: der Doppelpunkt hinter dem Wert der Schlüsselzeile selbst (`a: x: y`),
// ein Tab hinter einer Einrückung (`  \tx`), Tabs in Quote und Flow-Wert, Schlüssel mit zwei Bindestrichen (`--a`).
//
// Diese Datei muss unter `noUncheckedIndexedAccess` fehlerfrei sein — siehe npm-Skript `check:index-strict`.

import { locateFrontmatter, quoteScalar, serializeFrontmatter, type FmValue } from "./frontmatter";

/**
 * Ein fertig geschriebener YAML-Skalar, der unverändert in die Zeile geht (`key: <literal>`). Nur `null`, `true`, `false` (klein
 * geschrieben), Dezimalzahlen wie `12.50`, `-0`, `.5`, `5.` und ein einzeiliger doppelt gequoteter Text ohne `"` und `\` darin
 * (`"DE98ZZZ00000000001"`); alles andere meldet `patchFrontmatter` als `invalid-value`. Vorab prüfen: `isFmLiteralText`.
 */
export interface FmLiteral { literal: string }

export interface FrontmatterPatchSpec {
  /** Setzen oder anhängen. */
  set?: Record<string, FmValue | FmLiteral>;
  /** Nur anhängen, wenn der Schlüssel fehlt (auch nach `set`). */
  ensure?: Record<string, FmValue | FmLiteral>;
  /** Schlüssel, die ein `set` verweigert. Default `["created"]`. */
  protect?: readonly string[];
  /** Eine Notiz ohne Block bekommt einen. Default `false`: sie bleibt unverändert. */
  create?: boolean;
  /** Nur Schlüssel in `set` schreiben, die schon da sind. Default `false`. Betrifft `ensure` nicht. */
  onlyExisting?: boolean;
  /** Schlüssel entfernen (seit Welle 34): alle Vorkommen samt Fortsetzungszeilen. Fehlt ein Schlüssel, geschieht für ihn nichts. `protect` gilt auch hier; derselbe Schlüssel in `set` oder `ensure` ist `conflict`. */
  remove?: readonly string[];
  /** Wie eine `string[]` geschrieben wird (seit 0.71.0): `"flow"` (Default) als `key: [a, b]`, `"block"` als Blockliste (`key:` und je Eintrag `  - a`, zwei Leerzeichen eingerückt). Gilt für `set`, `ensure`
   *  und `create`; die Einträge laufen durch dieselbe Quotierung wie in der Flow-Liste, ein leerer Eintrag steht als `""`. Eine **leere** Liste bleibt `key: []` (es gibt keine leere Blockliste; wer `key: null`
   *  will, übergibt `{ literal: "null" }`). Skalare und Zahlen betrifft die Option nicht. Für Notizen, deren Bestand Blocklisten trägt (finance-ledger: Parität mit dem Python-Importer); Obsidian liest
   *  beide Formen gleich (Cache, Eigenschaften-Editor und Bases, gemessen 2026-10-25, `pilot/bases-listen.ts`). */
  listStyle?: "flow" | "block";
}

export type FrontmatterPatchResult =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; reason: "unparseable" | "block-scalar" | "protected" | "invalid-value" | "invalid-key" | "conflict"; key?: string };

// Schlüsselzeile: Schlüssel am Zeilenanfang (nie eingerückt) — dieselbe Form wie im Kit-Parser.
const KEY_RE = /^([A-Za-z0-9_][\w .-]*?):[ \t]*(.*)$/;
// Kein Leerzeichen am Ende: `patchFrontmatter` schrieb `a : x`, der Leser (`scanEntries`) trimmt den Schlüssel auf `a`, findet `a ` nie wieder, und das zweite `set` hängte eine
// Dublette an (Befund kitok4-w28, 2026-10-27). Ein Leerzeichen in der Mitte bleibt erlaubt, am Ende stehen Wortzeichen, Punkt oder Bindestrich.
const KEY_NAME_RE = /^[A-Za-z0-9_](?:[\w .-]*[\w.-])?$/;
// Gequotete Schlüssel (`"t": 5`, `'t': 5`) und jede andere Zeile auf Spalte 0, die wie `name:` aussieht (Umlaut, Sonderzeichen): sie sind Schlüssel des Blocks und begrenzen den Wert davor, auch wenn `patchFrontmatter`
// sie nie setzt (`invalid-key`). Ohne sie wäre die Folgezeile eines mehrzeiligen Werts eines solchen Schlüssels ein „Schlüssel“.
const DQ_KEY_RE = /^"((?:[^"\\]|\\.)*)"[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/;
const SQ_KEY_RE = /^'((?:[^']|'')*)'[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/;
const ANY_KEY_RE = /^([^\s#\-[\]{}&*!|>'"%@`][^:]*?):(?:[ \t]+(.*)|[ \t]*)$/;
// Ein Schlüssel, der mit Bindestrich beginnt (`-a: 1`, `-1: x`): Obsidian liest ihn (Cache und Eigenschaften-Ansicht, gemessen 2026-11-15, Pilot `frontmatter-leser` f5, f5b), js-yaml auch. Nur Bindestrich und Wortzeichen, damit `- a: 1` (Listenpunkt) und `---x` keine Schlüssel werden.
const HYPHEN_KEY_RE = /^(-[A-Za-z0-9_][^:]*?):(?:[ \t]+(.*)|[ \t]*)$/;

/** `ok`: Ende des Werts bestimmt; `block-scalar`: Wert ist ein Blockskalar (`|`, `>`, auch hinter Tag oder Anker), wird nie angefasst; `unclear`: das Ende des Werts ist nicht bestimmbar (offene Quote, offene Flow-Klammer), wird nie angefasst. */
type EntryKind = "ok" | "block-scalar" | "unclear";
/** `plain`: der Wert ist einfach oder leer (kein Quote, keine Flow-Klammer, kein Blockskalar); `emptyValue`: hinter dem Schlüssel steht nichts (oder nur ein Kommentar); `flow`: der Wert beginnt mit `[` oder `{`; `quoted`: er beginnt mit einer Quote. */
interface Entry { start: number; end: number; rest: string; kind: EntryKind; anchor: boolean; plain: boolean; emptyValue: boolean; flow: boolean; quoted: boolean }
interface Doc { open: string; close: string; lines: string[]; entries: Map<string, Entry>; eol: "\n" | "\r\n"; empty: boolean }

/** Der Schlüssel einer Zeile auf Spalte 0 und der Rest dahinter, sonst `null`. Gequotete Schlüssel liefern den Namen ohne Quotes (`"t": 5` ist der Schlüssel `t`). */
function keyOf(line: string): { key: string; rest: string } | null {
  const plain = KEY_RE.exec(line);
  if (plain) return { key: (plain[1] ?? "").trim(), rest: plain[2] ?? "" };
  const dq = DQ_KEY_RE.exec(line);
  if (dq) {
    let name = dq[1] ?? "";
    try { name = JSON.parse(`"${name}"`) as string; } catch { /* der Rohname genügt: ein solcher Schlüssel wird nie gesetzt */ }
    return { key: name.trim(), rest: dq[2] ?? "" };
  }
  const sq = SQ_KEY_RE.exec(line);
  if (sq) return { key: (sq[1] ?? "").replace(/''/g, "'").trim(), rest: sq[2] ?? "" };
  const any = ANY_KEY_RE.exec(line);
  if (any) return { key: (any[1] ?? "").trim(), rest: any[2] ?? "" };
  const hyphen = HYPHEN_KEY_RE.exec(line);
  if (hyphen) return { key: (hyphen[1] ?? "").trim(), rest: hyphen[2] ?? "" };
  return null;
}

/** Der Wert hinter Tags und Ankern (`!!str |` → `|`, `&z [a` → `[a`, `&z` allein → leer) und ob dabei ein Anker `&name` abgestreift wurde. */
function nodeProps(rest: string): { value: string; anchor: boolean } {
  let v = rest.trimStart();
  let anchor = false;
  for (let m = /^[!&]\S*(?:[ \t]+|$)/.exec(v); m; m = /^[!&]\S*(?:[ \t]+|$)/.exec(v)) {
    if (m[0].startsWith("&")) anchor = true;
    v = v.slice(m[0].length).trimStart();
  }
  return { value: v, anchor };
}

interface Cursor { ln: number; s: string; p: number }

/** Hinter die schließende Quote `q` (Position `p` liegt hinter der öffnenden), auch über Zeilen hinweg; `null`, wenn der Block vorher endet. `\` maskiert in `"`, `''` in `'`. */
function skipQuoted(lines: string[], c: Cursor, q: '"' | "'"): Cursor | null {
  let { ln, s, p } = c;
  for (;;) {
    while (p < s.length) {
      const ch = s[p];
      if (q === '"' && ch === "\\") { p += 2; continue; }
      if (ch === q) {
        if (q === "'" && s[p + 1] === "'") { p += 2; continue; }
        return { ln, s, p: p + 1 };
      }
      p++;
    }
    ln++;
    if (ln >= lines.length) return null;
    s = lines[ln] ?? "";
    p = 0;
  }
}

/** Beginnt an Position `p` ein Token (davor nur Leerraum oder `[ { , :`)? Nur dort öffnet ein `'` oder `"` eine Quote; `don't` im Flow-Text tut es nicht. */
function tokenStart(s: string, p: number): boolean {
  let i = p - 1;
  while (i >= 0 && (s[i] === " " || s[i] === "\t")) i--;
  return i < 0 || "[{,:".includes(s[i] ?? "");
}

/** Letzte Zeile eines Werts, der mit `[` oder `{` beginnt (Klammern gezählt, Quotes und Kommentare übersprungen); `null`, wenn der Block vorher endet. */
function flowEnd(lines: string[], i: number, v: string): number | null {
  let c: Cursor = { ln: i, s: v, p: 0 };
  let depth = 0;
  for (;;) {
    while (c.p < c.s.length) {
      const ch = c.s[c.p];
      if (ch === "#" && (c.p === 0 || c.s[c.p - 1] === " " || c.s[c.p - 1] === "\t")) break;
      if ((ch === '"' || ch === "'") && tokenStart(c.s, c.p)) {
        const n = skipQuoted(lines, { ln: c.ln, s: c.s, p: c.p + 1 }, ch);
        if (!n) return null;
        c = n;
        continue;
      }
      if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") { depth--; if (depth === 0) return c.ln; }
      c.p++;
    }
    const next = c.ln + 1;
    if (next >= lines.length) return null;
    c = { ln: next, s: lines[next] ?? "", p: 0 };
  }
}

/** Definiert der Eintrag (Zeilen `start` bis `end`, `rest` = Rest der Schlüsselzeile) einen YAML-Anker `&name`? Ein Anker steht am Anfang eines Knotens: hinter dem Schlüsseldoppelpunkt, einem Listenstrich `- `, `[`, `{`, `,`, `: ` und hinter einem Tag;
 *  Quotes (auch über Zeilen) und Kommentare werden übersprungen. Im Zweifel (`Tom &Jerry` als Fließtext in einer Folgezeile) gilt er als definiert: das Kit verweigert dann, es bricht keinen Verweis `*name` an anderer Stelle. */
function definesAnchor(lines: string[], start: number, end: number, rest: string): boolean {
  for (let ln = start; ln < end; ln++) {
    let s = ln === start ? rest : (lines[ln] ?? "");
    let p = 0;
    let node = true;
    while (p < s.length) {
      const ch = s[p] ?? "";
      if (ch === " " || ch === "\t") { p++; continue; }
      if (ch === "#" && (p === 0 || s[p - 1] === " " || s[p - 1] === "\t")) break;
      if (node) {
        if (ch === "&" && /^&[^\s,[\]{}]/.test(s.slice(p))) return true;
        if (ch === "!") { while (p < s.length && !/\s/.test(s[p] ?? "")) p++; continue; }
        if (ch === '"' || ch === "'") {
          const n = skipQuoted(lines, { ln, s, p: p + 1 }, ch);
          if (!n) return false;
          ln = n.ln; s = n.s; p = n.p; node = false;
          continue;
        }
      }
      if (ch === "[" || ch === "{" || ch === ",") { node = true; p++; continue; }
      if ((ch === "-" || ch === ":") && (p + 1 >= s.length || s[p + 1] === " " || s[p + 1] === "\t")) { node = true; p++; continue; }
      node = false;
      p++;
    }
  }
  return false;
}

/** Ende (exklusiv) eines einfachen oder leeren Werts: eingerückte Zeilen gehören dazu, Leerzeilen und Kommentare auf Spalte 0 nur, wenn danach eine Fortsetzung folgt (sonst stehen sie vor dem nächsten Schlüssel);
 *  bei leerem Wert (`key:` oder nur Kommentar) auch Listenpunkte auf Spalte 0. */
function plainEnd(lines: string[], i: number, emptyValue: boolean): number {
  let last = i;
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j] ?? "";
    if (l.trim() === "") continue;
    if (l.startsWith(" ") || l.startsWith("\t")) { last = j; continue; }
    if (l.startsWith("#")) continue;
    if (emptyValue && /^-(?:[ \t]|$)/.test(l)) { last = j; continue; }
    break;
  }
  return last + 1;
}

/** Alle Zeilenbereiche in Reihenfolge, mit dem Schlüssel wie ihn der Leser kennt (getrimmt, gequotete ohne Quotes). Das Ende eines Werts bestimmt der Leser selbst: einfach oder leer (`plainEnd`), gequotet über Zeilen
 *  hinweg, Flow-Klammer gezählt; ein Blockskalar ist `block-scalar`, ein Wert, dessen Ende nicht bestimmbar ist (Quote oder Klammer nie geschlossen), `unclear` — beide fasst `patchFrontmatter` nicht an. */
function scanAll(lines: string[]): Array<Entry & { key: string }> {
  const out: Array<Entry & { key: string }> = [];
  let i = 0;
  while (i < lines.length) {
    const kv = keyOf(lines[i] ?? "");
    if (!kv) { i++; continue; }
    const v = nodeProps(kv.rest).value;
    let kind: EntryKind = "ok";
    let end: number;
    if (/^[|>]/.test(v)) { kind = "block-scalar"; end = plainEnd(lines, i, false); }
    else if (v.startsWith('"') || v.startsWith("'")) {
      const e = skipQuoted(lines, { ln: i, s: v, p: 1 }, v.startsWith('"') ? '"' : "'");
      if (e) end = e.ln + 1; else { kind = "unclear"; end = i + 1; }
    } else if (v.startsWith("[") || v.startsWith("{")) {
      const e = flowEnd(lines, i, v);
      if (e !== null) end = e + 1; else { kind = "unclear"; end = i + 1; }
    } else end = plainEnd(lines, i, v === "" || v.startsWith("#"));
    const flow = v.startsWith("[") || v.startsWith("{");
    const plain = !flow && !/^[|>"']/.test(v);
    out.push({ key: kv.key, start: i, end, rest: kv.rest.trim(), kind, anchor: kind === "ok" && definesAnchor(lines, i, end, kv.rest), plain, emptyValue: v === "" || v.startsWith("#"), flow, quoted: /^["']/.test(v) });
    i = end;
  }
  return out;
}

/** Zeilenbereiche je Schlüssel. Der erste Treffer gewinnt, spätere Dubletten bleiben unberührt (`set`); `remove` nimmt alle (`scanAll`). */
function scanEntries(lines: string[]): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const { key, ...e } of scanAll(lines)) if (!out.has(key)) out.set(key, e);
  return out;
}

function readDoc(text: string): { doc: Doc; bodyFrom: number } | null {
  // Den Block findet `locateFrontmatter` (frontmatter.ts), derselbe Leser wie `parseFrontmatter`: eine Wahrheit darüber, was Block und was Text ist.
  const span = locateFrontmatter(text);
  if (!span) return null;
  if (span.empty) {
    return { doc: { open: span.open, close: span.close, lines: [], entries: new Map(), eol: span.open.includes("\r\n") ? "\r\n" : "\n", empty: true }, bodyFrom: span.bodyFrom };
  }
  const lines = span.raw.split(/\r?\n/);
  return {
    doc: { open: span.open, close: span.close, lines, entries: scanEntries(lines), eol: span.raw.includes("\r\n") || span.open.includes("\r\n") ? "\r\n" : "\n", empty: false },
    bodyFrom: span.bodyFrom,
  };
}

/** Ist der Block ein Mapping, das dieser Leser sicher kennt UND das Obsidian liest? Verweigert (`false`), wenn (1) eine Zeile auf Spalte 0 mit `---` beginnt (jede: `----`, `--- b`, `---x`; der schließende Zaun steht nicht im Block) oder (2) eine Zeile auf Spalte 0 steht,
 *  die der Leser keinem Schlüssel zuordnen kann (kein Schlüssel, kein Kommentar, keine Leerzeile, keine Fortsetzung, deren Ende er bestimmt hat). Ein Block nur aus Leerzeilen und Kommentaren ist beschreibbar.
 *  Seit Welle 35 (Paket 4 C; Obsidian liefert für diese Formen im `metadataCache` `null` und in der Eigenschaften-Ansicht „Invalid properties“, gemessen 2026-11-15, Obsidian 1.15.1, Pilot `frontmatter-leser`, Teil D) zusätzlich verweigert, wenn
 *  (3) eine eingerückte Zeile mit Inhalt keinem Schlüssel gehört und kein Kommentar ist (`  x` vor dem ersten Schlüssel), (4) eine Zeile eines einfachen oder leeren Werts mit einem Tab beginnt (`a: 1` / `\tx`), (5) die Folgezeile eines einfachen Werts mit Inhalt auf der
 *  Schlüsselzeile einen Doppelpunkt trägt (`a: x` / `  t: 5`; bei leerem Wert ist das ein verschachteltes Mapping und bleibt erlaubt), (6) die Folgezeile eines Flow-Werts (`[`, `{`) oder eines gequoteten Werts nicht eingerückt ist (`t: [a,` / `b]`, `t: "x` / `y"`; js-yaml liest beides, Obsidian nicht). */
function writableBlock(lines: string[]): boolean {
  if (lines.some((l) => l.startsWith("---"))) return false;
  const covered: boolean[] = lines.map(() => false);
  const entries = scanAll(lines);
  for (const e of entries) for (let i = e.start; i < e.end; i++) covered[i] = true;
  const indented = (l: string): boolean => l.startsWith(" ") || l.startsWith("\t");
  if (!lines.every((l, i) => covered[i] === true || l.trim() === "" || l.startsWith("#") || (indented(l) && l.trim().startsWith("#")))) return false;
  for (const e of entries) {
    for (let j = e.start + 1; j < e.end; j++) {
      const l = lines[j] ?? "";
      if (l.trim() === "") continue;
      if (e.plain && l.startsWith("\t")) return false;
      if (e.plain && !e.emptyValue && /:(?:[ \t]|$)/.test(l.replace(/(?:^|[ \t])#.*$/, ""))) return false;
      if ((e.flow || e.quoted) && !indented(l)) return false;
    }
  }
  return true;
}

// Genau die Formen, die ein Literal haben darf — die EINZIGE Quelle (`badValue` und `isFmLiteralText`). Nicht die Regex aus `needsQuoting`
// (sie lässt `-.5` und `+.5` durch, die js-yaml als Text liest). Die gequotete Form hält Anführungszeichen und Rückstrich draußen; Zeilenumbruch
// und Steuerzeichen (ein NUL lehnt js-yaml ab) fängt `hasControl` ab, weil eine Zeichenklasse mit Steuerzeichen die Kernregel
// `no-control-regex` auslöst (Konsumenten-Lint, 0.69.0).
const LITERAL_RE = /^(?:null|true|false)$|^[+-]?\d+(\.\d*)?$|^\.\d+$|^"[^"\\]*"$/;

/** Enthält `text` ein Zeichen unter 0x20 außer dem Tabulator? (Zeilenumbruch, NUL und die übrigen Steuerzeichen; DEL und Nicht-ASCII bleiben erlaubt.) */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && c !== 0x09) return true;
  }
  return false;
}

/** Ist `text` ein gültiges Literal für `{ literal }`? Dieselbe Prüfung wie in `patchFrontmatter` (`invalid-value`); wirft nie, Nicht-Text ist `false`.
 *  @example
 *  isFmLiteralText("53240.00") // → true
 *  isFmLiteralText('"DE98"')   // → true
 *  isFmLiteralText("DE98")     // → false */
export function isFmLiteralText(text: string): boolean {
  return typeof text === "string" && LITERAL_RE.test(text) && !hasControl(text);
}

// Schreibweisen, die YAML nicht als Text liest: `null` in drei Schreibweisen (der Schlüssel kommt bei Obsidian als leerer Name zurück) und der Wahrheitswert in großer oder gemischter Schreibweise (`True` kommt als `true` zurück).
// Klein geschrieben bleiben `true` und `false` unter ihrem Namen (die Zeichenkette des Wahrheitswerts), ebenso `yes`, `no`, `on`, `off`, `y`, `n` (YAML 1.2 kennt sie nicht): gemessen 2026-11-14, Obsidian 1.15.1 (Pilot `frontmatter-leser`, Tabelle B).
const YAML_NON_TEXT_RE = /^(?:null|Null|NULL|True|TRUE|False|FALSE)$/;
// Schreibweisen von Zahlen (Dezimal, Exponent, hex `0x`, oktal `0o`), die Obsidian als Zahl liest: der Schlüssel kommt dann unter dem Namen der Zahl zurück (`1.0` → `1`, `1e3` → `1000`, `0x1f` → `31`, `01` → `1`, `1.` → `1`, `0.0` → `0`). Nicht dabei: `0b1` und `1_000`, die kommen unter ihrem Namen zurück (gemessen).
const YAML_NUMBER_RE = /^(?:[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+)$/;

/** Ist `name` ein Schlüsselname, den der Block-Leser des Kits als Schlüssel erkennt UND den Obsidian unter genau diesem Namen zurückgibt? Dieselbe Prüfung wie in `patchFrontmatter` (`invalid-key`); wirft nie, Nicht-Text ist `false`.
 *  Ob Obsidian den Namen zurückgibt, ist gemessen (2026-11-14, Obsidian 1.15.1, `metadataCache` und Eigenschaften-Ansicht, Pilot `frontmatter-leser`): `null`, `Null`, `NULL` (und `~`) kommen als leerer Schlüssel zurück, `True` als `true` —
 *  sie sind `false`, ebenso die Schreibweisen derselben Familie (`TRUE`, `False`, `FALSE`) und jeder Name, den YAML als Zahl liest und der als Zahl anders heißt (`1.0` → `1`, `1e3`, `0x1f`, `0o7`, `01`, `1.`, `0.0`). Klein geschriebenes `true`, `false`,
 *  `yes`, `no`, `on`, `off`, `y`, `n`, `tRUE`, `0b1`, `1_000`, Datumsformen wie `2026-11-14` und Namen wie `a`, `1`, `1.5`, `k_1` kommen unter ihrem Namen zurück und bleiben `true` (die Messtabelle steht im Kopf der Pilot-Datei und im Bericht zu Paket C2).
 *  @example
 *  isFrontmatterKeyName("diachronic-round") // → true
 *  isFrontmatterKeyName("Größe")            // → false (Umlaut: der Leser findet die Zeile nicht)
 *  isFrontmatterKeyName("a: b")             // → false
 *  isFrontmatterKeyName("a ")               // → false (Leerzeichen am Ende: der Leser trimmt, das zweite set legte eine Dublette an)
 *  isFrontmatterKeyName("null")             // → false (Obsidian liest den Schlüssel als leeren Namen)
 *  isFrontmatterKeyName("True")             // → false (Obsidian liest ihn als `true`) */
export function isFrontmatterKeyName(name: string): boolean {
  if (typeof name !== "string" || !KEY_NAME_RE.test(name)) return false;
  if (YAML_NON_TEXT_RE.test(name)) return false;
  if (YAML_NUMBER_RE.test(name) && String(Number(name)) !== name) return false;   // YAML liest den Namen als Zahl, die anders heißt (`1.0`, `1e3`, `0x1f`, `0o7`, `01`, `1.`, `0.0`)
  return true;
}

function isLiteral(v: FmValue | FmLiteral): v is FmLiteral {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Die Zeilen EINES Schlüssels: ein Literal unverändert, alles andere über das Kit serialisiert (ohne die beiden Zäune); eine nicht leere Liste mit `listStyle: "block"` als Blockliste. */
function keyLines(key: string, value: FmValue | FmLiteral, listStyle: "flow" | "block" = "flow"): string[] {
  if (isLiteral(value)) return [`${key}: ${value.literal}`];
  if (listStyle === "block" && Array.isArray(value) && value.length > 0) return [`${key}:`, ...value.map((item) => `  - ${item === "" ? '""' : quoteScalar(item)}`)];
  const lines = serializeFrontmatter({ [key]: value }, [key]).split("\n");
  return lines.slice(1, lines.length - 2);
}

function badValue(v: FmValue | FmLiteral): boolean {
  if (isLiteral(v)) return !isFmLiteralText(v.literal);
  if (typeof v === "number") return !Number.isFinite(v);
  return false; // ein Text mit Zeilenumbruch bricht den Block nicht mehr: `serializeFrontmatter` und `quoteScalar` schreiben ihn als Escape in doppelten Anführungszeichen
}

/**
 * Setzt Felder im Frontmatter einer Notiz, ohne den Rest anzufassen. Wirft nie.
 *
 * `set` ersetzt den Schlüssel (samt Fortsetzungszeilen) oder hängt ihn an, `ensure` hängt nur an, wenn er fehlt. Jede nicht
 * betroffene Zeile, der Body und das Zeilenende bleiben byte-gleich; `changed` ist `false`, wenn der Text danach derselbe ist.
 * Verweigert wird mit einem Grund statt zu raten: Schlüssel in `protect` (`protected`), ein Block-Skalar am Zielschlüssel
 * (`block-scalar`), ein Block, der nicht schließt oder den Obsidian nicht liest (`unparseable`, siehe Kopf der Datei), ein Schlüssel,
 * den der Block-Leser nicht erkennt (`invalid-key`).
 *
 * Ein fertiger Skalar geht als `{ literal }` unquotet in die Zeile (`null`, `true`, `false`, Dezimalzahl); ein anderer Wert ist `invalid-value`.
 *
 * @example
 * patchFrontmatter("---\ntitle: A\n---\nText\n", { set: { "diachronic-round": 2 } })
 * // → { ok: true, changed: true, content: "---\ntitle: A\ndiachronic-round: 2\n---\nText\n" }
 * @example
 * patchFrontmatter("---\ntitle: A\n---\n", { set: { saldo_eur: { literal: "53240.00" } }, ensure: { stand: { literal: "null" } } })
 * // → { ok: true, changed: true, content: "---\ntitle: A\nsaldo_eur: 53240.00\nstand: null\n---\n" }
 */
export function patchFrontmatter(text: string, spec: FrontmatterPatchSpec): FrontmatterPatchResult {
  const protect = new Set(spec.protect ?? ["created"]);
  const setEntries = Object.entries(spec.set ?? {});
  const ensureEntries = Object.entries(spec.ensure ?? {});
  const removeKeys = [...new Set(spec.remove ?? [])];

  for (const [key, value] of [...setEntries, ...ensureEntries]) {
    if (!isFrontmatterKeyName(key)) return { ok: false, reason: "invalid-key", key };
    if (badValue(value)) return { ok: false, reason: "invalid-value", key };
  }
  for (const key of removeKeys) {
    if (!isFrontmatterKeyName(key)) return { ok: false, reason: "invalid-key", key };
  }
  for (const [key] of setEntries) {
    if (protect.has(key)) return { ok: false, reason: "protected", key };
  }
  for (const key of removeKeys) {
    if (protect.has(key)) return { ok: false, reason: "protected", key };
  }
  for (const key of removeKeys) {
    if (key in (spec.set ?? {}) || key in (spec.ensure ?? {})) return { ok: false, reason: "conflict", key };
  }

  // Ein BOM vor dem ersten Zaun: `getFrontMatterInfo` sieht keinen Block, der `metadataCache` aber doch (er liest den BOM mit). Schriebe `create` einen Block davor, wäre der alte Text und der gelesene Block ein anderer: verweigert.
  if (/^\uFEFF---\r?\n/.test(text)) return { ok: false, reason: "unparseable" };
  const read = readDoc(text);
  if (!read) {
    // Beginnt der Text mit einem Zaun, der nie schließt, ist das kein „Notiz ohne Block“, sondern ein Block, den wir nicht lesen können.
    if (text.startsWith("---")) return { ok: false, reason: "unparseable" };
    if (!spec.create) return { ok: true, content: text, changed: false };
    const writes = collect(setEntries, ensureEntries, () => false, spec.onlyExisting === true);
    if (writes.length === 0) return { ok: true, content: text, changed: false };
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    // Jeder Eintrag über `keyLines`, damit ein Literal hier denselben Weg nimmt wie in einem vorhandenen Block.
    const block = ["---", ...writes.flatMap(([k, v]) => keyLines(k, v, spec.listStyle)), "---", ""].join(eol);
    return { ok: true, content: `${block}${text}`, changed: true };
  }

  const { doc, bodyFrom } = read;
  if (!doc.empty && !writableBlock(doc.lines)) return { ok: false, reason: "unparseable" };
  const writes = collect(setEntries, ensureEntries, (k) => doc.entries.has(k), spec.onlyExisting === true);

  const replaced = new Map<number, string[]>();
  const dropped = new Set<number>();
  const appended: string[] = [];
  // `remove`: alle Vorkommen jedes Schlüssels, samt Fortsetzungszeilen. Ein Block-Skalar am Schlüssel wird wie bei `set` gemeldet, nicht angefasst.
  if (removeKeys.length > 0) {
    const weg = new Set(removeKeys);
    for (const e of scanAll(doc.lines)) {
      if (!weg.has(e.key)) continue;
      if (e.kind === "block-scalar") return { ok: false, reason: "block-scalar", key: e.key };
      if (e.kind === "unclear" || e.anchor) return { ok: false, reason: "unparseable", key: e.key };
      for (let i = e.start; i < e.end; i++) dropped.add(i);
    }
  }
  for (const [key, value] of writes) {
    const lines = keyLines(key, value, spec.listStyle);
    const e = doc.entries.get(key);
    if (!e) { appended.push(...lines); continue; }
    if (e.kind === "block-scalar") return { ok: false, reason: "block-scalar", key };
    if (e.kind === "unclear" || e.anchor) return { ok: false, reason: "unparseable", key };
    replaced.set(e.start, lines);
    for (let i = e.start; i < e.end; i++) dropped.add(i);
  }
  const out: string[] = [];
  for (let i = 0; i < doc.lines.length; i++) {
    const neu = replaced.get(i);
    if (neu) out.push(...neu);
    else if (!dropped.has(i)) out.push(doc.lines[i] ?? "");
  }
  out.push(...appended);
  // Ein leerer Block hat keine Zeile, an die ein Zeilenende anschließt: die Schlusszeile bekommt es hier.
  const raw = doc.empty ? (out.length > 0 ? out.join(doc.eol) + doc.eol : "") : out.join(doc.eol);
  // Fiel der letzte Schlüssel eines Blocks mit Zeilen, bleibt der leere Block (`---` direkt auf `---`): der schließende Zaun trägt sein Zeilenende vorn und verlöre sonst nicht die Leerzeile.
  const leerNachRemove = !doc.empty && out.length === 0;
  const content = `${doc.open}${raw}${leerNachRemove ? doc.close.replace(/^\r?\n/, "") : doc.close}${text.slice(bodyFrom)}`;
  return { ok: true, content, changed: content !== text };
}

/** Die Schreibvorgänge in Reihenfolge: erst `set`, dann `ensure` (nur wo der Schlüssel fehlt und `set` ihn nicht schon schreibt). */
function collect(
  setEntries: Array<[string, FmValue | FmLiteral]>,
  ensureEntries: Array<[string, FmValue | FmLiteral]>,
  has: (key: string) => boolean,
  onlyExisting: boolean,
): Array<[string, FmValue | FmLiteral]> {
  const out: Array<[string, FmValue | FmLiteral]> = [];
  const written = new Set<string>();
  for (const [k, v] of setEntries) {
    if (onlyExisting && !has(k)) continue;
    out.push([k, v]);
    written.add(k);
  }
  for (const [k, v] of ensureEntries) {
    if (has(k) || written.has(k)) continue;
    out.push([k, v]);
    written.add(k);
  }
  return out;
}

export type InsertBlockResult =
  | { ok: true; content: string; changed: true }
  | { ok: false; reason: "unparseable" | "invalid-key" | "invalid-block" | "exists"; key?: string };

/**
 * Fügt einer Notiz einen fertigen YAML-Block (verschachteltes Mapping, Liste, Mapping in Liste) unter EINEM neuen Schlüssel an (Welle 36, h2c, Bestellung 23; Anlass hypertext-exporter: `processFrontMatter` formt den ganzen Block um,
 * `patchFrontmatter` kennt keine verschachtelten Werte). Jede andere Zeile, der Text hinter dem Block und das Zeilenende bleiben byte-gleich; der Block kommt ans Ende des Frontmatters. Wirft nie.
 *
 * `body` sind die Zeilen UNTER dem Schlüssel, jede Zeile mit Inhalt um mindestens ein Leerzeichen eingerückt (die Einrückung bestimmt der Aufrufer, sie bleibt wie übergeben); Zeilenenden in `body` (`\n` oder `\r\n`) werden
 * auf das Zeilenende des Blocks gebracht, führende und endende Leerzeilen entfallen. Ohne Block in der Notiz entsteht einer (wie `create: true` in `patchFrontmatter`).
 *
 * Verweigert mit Grund statt zu raten: der Schlüssel steht schon im Block (`exists`, auch als gequoteter Schlüssel oder hinter einem Block-Skalar), ein Block, den `patchFrontmatter` nicht beschreibt (`unparseable`: dieselben Regeln, siehe Kopf der Datei,
 * auch ein BOM vor dem Zaun), ein Schlüssel, den der Block-Leser nicht erkennt (`invalid-key`), ein `body`, der leer ist, nur aus Kommentaren besteht, eine Zeile auf Spalte 0 oder einen Tab oder ein Steuerzeichen trägt, einen Anker setzt oder aus dem
 * Eintrag des Schlüssels einen anderen machte (`invalid-block`; geprüft wird das Ergebnis: der neue Eintrag deckt genau die angefügten Zeilen, alle alten Einträge behalten ihren Bereich, der Block bleibt für Obsidian lesbar).
 *
 * @example
 * insertFrontmatterBlock("---\ntitle: A\n---\nText\n", "export", "  format: pdf\n  pages: [1, 2]")
 * // → { ok: true, changed: true, content: "---\ntitle: A\nexport:\n  format: pdf\n  pages: [1, 2]\n---\nText\n" }
 */
export function insertFrontmatterBlock(text: string, key: string, body: string): InsertBlockResult {
  if (!isFrontmatterKeyName(key)) return { ok: false, reason: "invalid-key", key };
  if (typeof body !== "string" || hasControl(body.replace(/\r?\n/g, "")) || body.includes("\t")) return { ok: false, reason: "invalid-block", key };
  const bodyLines = body.split(/\r?\n/);
  while (bodyLines.length > 0 && (bodyLines[0] ?? "").trim() === "") bodyLines.shift();
  while (bodyLines.length > 0 && (bodyLines[bodyLines.length - 1] ?? "").trim() === "") bodyLines.pop();
  if (!bodyLines.every((l) => l.trim() === "" || l.startsWith(" "))) return { ok: false, reason: "invalid-block", key };
  if (!bodyLines.some((l) => l.trim() !== "" && !l.trim().startsWith("#"))) return { ok: false, reason: "invalid-block", key };

  if (/^\uFEFF---\r?\n/.test(text)) return { ok: false, reason: "unparseable" };
  const read = readDoc(text);
  if (!read) {
    if (text.startsWith("---")) return { ok: false, reason: "unparseable" };
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = [`${key}:`, ...bodyLines];
    if (!insertedAsOne(lines, 0, [])) return { ok: false, reason: "invalid-block", key };
    return { ok: true, content: ["---", ...lines, "---", ""].join(eol) + text, changed: true };
  }
  const { doc, bodyFrom } = read;
  if (!doc.empty && !writableBlock(doc.lines)) return { ok: false, reason: "unparseable" };
  if (doc.entries.has(key)) return { ok: false, reason: "exists", key };
  const added = [`${key}:`, ...bodyLines];
  if (!insertedAsOne([...doc.lines, ...added], doc.lines.length, scanAll(doc.lines))) return { ok: false, reason: "invalid-block", key };
  const all = [...doc.lines, ...added];
  const raw = doc.empty ? all.join(doc.eol) + doc.eol : all.join(doc.eol);
  return { ok: true, content: `${doc.open}${raw}${doc.close}${text.slice(bodyFrom)}`, changed: true };
}

/** Prüft das Ergebnis: der Block ist für Obsidian lesbar, die alten Einträge behalten ihre Bereiche, und hinter ihnen steht genau ein neuer Eintrag ab `from` bis zum Ende, ohne Anker. Die Prüfungen decken sich teils (eine Spalte-0-Zeile im `body` fällt schon vorher auf, und hier an Anzahl, Anfang und Ende): Doppelsicherung, weil das Ergebnis die Wahrheit ist, nicht die Vorprüfung. */
function insertedAsOne(lines: string[], from: number, old: Array<Entry & { key: string }>): boolean {
  if (!writableBlock(lines)) return false;
  const now = scanAll(lines);
  if (now.length !== old.length + 1) return false;
  for (let i = 0; i < old.length; i++) {
    const a = old[i], b = now[i];
    if (!a || !b || a.start !== b.start || a.end !== b.end || a.key !== b.key || a.kind !== b.kind) return false;
  }
  const e = now[now.length - 1];
  return !!e && e.start === from && e.end === lines.length && e.kind === "ok" && !e.anchor;
}
