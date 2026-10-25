// vendored from obsidian-kit@0.70.0, src/pure/frontmatter-patch.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
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
//   · Werte sind typisiert (`string | number | string[]`) und laufen durch `serializeFrontmatter` (quotet `"1"`, `true`, `a, b`);
//     finance-ledger übergab fertiges YAML und verlagerte das Quoting auf jeden Aufrufer.
//   · `protect` (Default `["created"]`) verweigert ein `set` — finance-ledgers Grund (ein Lauf setzte `created` jedes Mal neu) gilt allgemein.
//   · Beim Anhängen an einen CRLF-Block bleibt das Zeilenende CRLF; finance-ledger schrieb dort `\n` vor die angehängte Zeile und
//     ein doppeltes `\r` dahinter (`neu: x\r\r\n---`, gemessen 2026-10-21 an der Referenzkopie).
//   · Ein leerer Block (`---` / `---`) ist ein Block; mailstone meldete ihn als nicht lesbar.
//   · Zusätzlich verweigert: ein Wert mit Zeilenumbruch (er bräche den Block, `serializeFrontmatter` quotet ihn nicht) und
//     ein Schlüssel, den der Block-Leser nicht als Schlüssel erkennt (`invalid-key`).
//   · Ein Literal (`{ literal: "53240.00" }`) wird unverändert geschrieben, nie gequotet — für Aufrufer, die fertige Skalare haben
//     (finance-ledger: `saldo_eur` aus `Money.toFixed(2)`, `anfangssaldo_eur: null`). `FmValue` kann das nicht: ein `number` verliert
//     die endende Null (`12.50` → `12.5`), ein `string` bekommt Anführungszeichen (`"null"`, `"53240.00"`). Zugelassen sind genau diese
//     Formen (`null`, `true`, `false`, Dezimalzahl, einzeiliger doppelt gequoteter Text); alles andere ist `invalid-value`, damit kein Umbruch, Kommentar oder Fremd-YAML
//     durch die Hintertür kommt. Der gequotete Text ist für Aufrufer, deren Wert im Bestand schon so steht (finance-ledger `glaeubiger_id`:
//     `"DE98ZZZ00000000001"`); `isFmLiteralText` gibt die Prüfung heraus, damit kein Konsument die Regex kopiert. Die Regex ist enger als die in `needsQuoting` (`-.5` und `+.5` liest js-yaml als Text, Obsidian als Zahl: die Menge
//     hier ist die gemeinsame). Gemessen 2026-10-25 in Obsidian 1.14.5 (`pilot/literal-formen.ts`): `parseYaml`, `metadataCache` und der gerenderte
//     Eigenschaften-Editor (Zahlenfeld) lesen `5.`, `+5`, `-0` und `007` als Zahl mit demselben Wert wie js-yaml 4.2.0 (5, 5, 7); nur `-0` bleibt bei Obsidian
//     ein `-0` (js-yaml: `0`), das Feld zeigt `0`, aus dem Cache einer unveränderten Notiz liest man `0`. Ungemessen: Bases.
// Grenzen, bewusst wie im Kit-Parser: ein Schlüssel muss `[A-Za-z0-9_][\w .-]*` sein (ein Schlüssel mit Umlaut wird nicht gefunden,
// also angehängt, nicht ersetzt — `invalid-key` fängt ihn deshalb schon beim Setzen ab); Kommentare auf der Zeile eines gesetzten
// Schlüssels gehen mit der Zeile verloren; ein Block-Skalar (`|`, `>`) wird gemeldet, nicht ersetzt.
//
// Diese Datei muss unter `noUncheckedIndexedAccess` fehlerfrei sein — siehe npm-Skript `check:index-strict`.

import { serializeFrontmatter, type FmValue } from "./frontmatter";

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
}

export type FrontmatterPatchResult =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; reason: "unparseable" | "block-scalar" | "protected" | "invalid-value" | "invalid-key"; key?: string };

// Gruppen: öffnender Zaun / Rohtext / schließender Zaun samt Zeilenende, damit beide Zäune unverändert zurückgehen.
const FM_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*\r?\n?)/;
// Ein Block ohne eine Zeile dazwischen: `---` direkt auf `---`.
const EMPTY_RE = /^(---\r?\n)(---[ \t]*(?:\r?\n|$))/;
// Schlüsselzeile: Schlüssel am Zeilenanfang (nie eingerückt) — dieselbe Form wie im Kit-Parser.
const KEY_RE = /^([A-Za-z0-9_][\w .-]*?):[ \t]*(.*)$/;
const KEY_NAME_RE = /^[A-Za-z0-9_][\w .-]*$/;
// Fortsetzung einer Schlüssel-Darstellung: eingerückt (Liste, mehrzeiliger Wert) oder Listenpunkt auf Spalte 0.
const CONT_RE = /^([ \t]|-[ \t])/;

interface Entry { start: number; end: number; rest: string }
interface Doc { open: string; close: string; lines: string[]; entries: Map<string, Entry>; eol: "\n" | "\r\n"; empty: boolean }

/** Zeilenbereiche je Schlüssel: die `key:`-Zeile plus alle Fortsetzungszeilen. Der erste Treffer gewinnt, spätere Dubletten bleiben unberührt. */
function scanEntries(lines: string[]): Map<string, Entry> {
  const out = new Map<string, Entry>();
  let i = 0;
  while (i < lines.length) {
    const kv = KEY_RE.exec(lines[i] ?? "");
    if (!kv) { i++; continue; }
    let j = i + 1;
    while (j < lines.length && CONT_RE.test(lines[j] ?? "")) j++;
    const key = (kv[1] ?? "").trim();
    if (!out.has(key)) out.set(key, { start: i, end: j, rest: (kv[2] ?? "").trim() });
    i = j;
  }
  return out;
}

function readDoc(text: string): { doc: Doc; bodyFrom: number } | null {
  const m = FM_RE.exec(text);
  if (m) {
    const open = m[1] ?? "", raw = m[2] ?? "", close = m[3] ?? "";
    const lines = raw.split(/\r?\n/);
    return {
      doc: { open, close, lines, entries: scanEntries(lines), eol: raw.includes("\r\n") || open.includes("\r\n") ? "\r\n" : "\n", empty: false },
      bodyFrom: m[0].length,
    };
  }
  const e = EMPTY_RE.exec(text);
  if (!e) return null;
  const open = e[1] ?? "";
  return {
    doc: { open, close: e[2] ?? "", lines: [], entries: new Map(), eol: open.includes("\r\n") ? "\r\n" : "\n", empty: true },
    bodyFrom: e[0].length,
  };
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

function isLiteral(v: FmValue | FmLiteral): v is FmLiteral {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Die Zeilen EINES Schlüssels: ein Literal unverändert, alles andere über das Kit serialisiert (ohne die beiden Zäune). */
function keyLines(key: string, value: FmValue | FmLiteral): string[] {
  if (isLiteral(value)) return [`${key}: ${value.literal}`];
  const lines = serializeFrontmatter({ [key]: value }, [key]).split("\n");
  return lines.slice(1, lines.length - 2);
}

function badValue(v: FmValue | FmLiteral): boolean {
  if (isLiteral(v)) return !isFmLiteralText(v.literal);
  if (typeof v === "number") return !Number.isFinite(v);
  const parts = Array.isArray(v) ? v : [v];
  return parts.some((s) => /[\r\n]/.test(s));
}

/**
 * Setzt Felder im Frontmatter einer Notiz, ohne den Rest anzufassen. Wirft nie.
 *
 * `set` ersetzt den Schlüssel (samt Fortsetzungszeilen) oder hängt ihn an, `ensure` hängt nur an, wenn er fehlt. Jede nicht
 * betroffene Zeile, der Body und das Zeilenende bleiben byte-gleich; `changed` ist `false`, wenn der Text danach derselbe ist.
 * Verweigert wird mit einem Grund statt zu raten: Schlüssel in `protect` (`protected`), ein Block-Skalar am Zielschlüssel
 * (`block-scalar`), ein Block, der nicht schließt (`unparseable`), ein Wert mit Zeilenumbruch (`invalid-value`) und ein Schlüssel,
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

  for (const [key, value] of [...setEntries, ...ensureEntries]) {
    if (!KEY_NAME_RE.test(key)) return { ok: false, reason: "invalid-key", key };
    if (badValue(value)) return { ok: false, reason: "invalid-value", key };
  }
  for (const [key] of setEntries) {
    if (protect.has(key)) return { ok: false, reason: "protected", key };
  }

  const read = readDoc(text);
  if (!read) {
    // Beginnt der Text mit einem Zaun, der nie schließt, ist das kein „Notiz ohne Block“, sondern ein Block, den wir nicht lesen können.
    if (text.startsWith("---")) return { ok: false, reason: "unparseable" };
    if (!spec.create) return { ok: true, content: text, changed: false };
    const writes = collect(setEntries, ensureEntries, () => false, spec.onlyExisting === true);
    if (writes.length === 0) return { ok: true, content: text, changed: false };
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    // Jeder Eintrag über `keyLines`, damit ein Literal hier denselben Weg nimmt wie in einem vorhandenen Block.
    const block = ["---", ...writes.flatMap(([k, v]) => keyLines(k, v)), "---", ""].join(eol);
    return { ok: true, content: `${block}${text}`, changed: true };
  }

  const { doc, bodyFrom } = read;
  const writes = collect(setEntries, ensureEntries, (k) => doc.entries.has(k), spec.onlyExisting === true);

  const replaced = new Map<number, string[]>();
  const dropped = new Set<number>();
  const appended: string[] = [];
  for (const [key, value] of writes) {
    const lines = keyLines(key, value);
    const e = doc.entries.get(key);
    if (!e) { appended.push(...lines); continue; }
    if (/^[|>]/.test(e.rest)) return { ok: false, reason: "block-scalar", key };
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
  const content = `${doc.open}${raw}${doc.close}${text.slice(bodyFrom)}`;
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
