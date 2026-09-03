import { serializeFrontmatter, type FmValue } from "../../vendor/kit/frontmatter";
import type { FmVal } from "../mirror/profile";
import { splitBody, wrapBlock, zoneHash } from "./fences";

export type MergeErrorCode = "fences-missing" | "zone-edited" | "frontmatter-unparseable";
export interface MergeInput {
  existing: string;
  derived: Record<string, FmVal>;
  managed: string[];
  block: string;
  expectedZoneHash: string | null; // null = noch kein Hash bekannt (Erstanlage via Import)
  /** Keys, die sich bei JEDEM Lauf aendern (z. B. mail_synced). Sie zaehlen fuer sich allein
   *  nicht als Aenderung: bleibt sonst alles gleich, wird gar nicht geschrieben und der alte
   *  Stempel bleibt stehen. Ohne dieses Feld waere jeder Sync-Lauf ein Schreibvorgang. */
  volatileKeys?: string[];
}
export type MergeResult =
  | { ok: true; content: string; changed: boolean; zoneHash: string }
  | { ok: false; code: MergeErrorCode };

const toFm = (v: FmVal): FmValue => (typeof v === "boolean" ? String(v) : v);

// serializeFrontmatter liefert bereits den vollstaendigen "---\n...\n---\n"-Block MIT
// Delimitern (siehe src/vendor/kit/frontmatter.ts) — hier also kein zweites Wrapping.
function fmBlock(data: Record<string, FmValue>, order: string[]): string {
  return serializeFrontmatter(data, order);
}

export function newNote(
  derived: Record<string, FmVal>,
  onCreate: Record<string, FmVal>,
  block: string,
  userHead = "## Notizen\n\n",
): { content: string; zoneHash: string } {
  const data: Record<string, FmValue> = {};
  const order: string[] = [];
  for (const [k, v] of Object.entries({ ...onCreate, ...derived })) {
    data[k] = toFm(v);
    order.push(k);
  }
  return { content: `${fmBlock(data, order)}\n${userHead}${wrapBlock(block)}\n`, zoneHash: zoneHash(block) };
}

// --- Frontmatter in-place ----------------------------------------------------------
// Merge-Regel 2 (Spec § 2.2): "unbekannte Keys bleiben samt Wert und Reihenfolge; Parsing
// nach Schluessel, nie nach Position." Eine Re-Serialisierung ueber das vendorte yaml_lite
// kann das nicht halten — es kennt weder Kommentare noch verschachtelte Maps, Block-Skalare
// oder Block-Listen und wuerfe sie beim Schreiben weg. Deshalb wird der ROHTEXT des
// Frontmatters zeilenweise umgeschrieben: nur die Zeilen der verwalteten Keys werden
// ersetzt bzw. ergaenzt, alles andere bleibt Byte fuer Byte stehen.
//
// Gruppen dieselbe Delimiter-Form wie DELIM_RE im Kit, aber mit getrennten Gruppen fuer
// oeffnenden Delimiter / Rohtext / schliessenden Delimiter, damit beide Delimiter
// unveraendert wieder eingesetzt werden koennen.
const FM_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*\r?\n?)/;
// Key-Zeile: Schluessel am Zeilenanfang (nie eingerueckt) — identisch zur Kit-Form.
const KEY_RE = /^([A-Za-z0-9_][\w .-]*?):[ \t]*(.*)$/;
// Fortsetzungszeile einer Key-Darstellung: eingerueckt (verschachtelte Map, Block-Skalar)
// oder Listenpunkt auf Spalte 0.
const CONT_RE = /^([ \t]|-[ \t])/;

interface FmEntry { start: number; end: number; rest: string }

/** Zeilenbereiche je Key ("Darstellung des Keys"): die `key:`-Zeile plus alle folgenden
 *  Fortsetzungszeilen. Erster Treffer gewinnt; spaetere Dubletten bleiben unberuehrt. */
function scanEntries(lines: string[]): Map<string, FmEntry> {
  const out = new Map<string, FmEntry>();
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

/** Serialisiert EINEN Key ueber das Kit und schneidet die Delimiter wieder ab. */
function keyLines(k: string, v: FmVal): string[] {
  const lines = serializeFrontmatter({ [k]: toFm(v) }, [k]).split("\n");
  return lines.slice(1, lines.length - 2);
}

interface FmDoc { open: string; raw: string; close: string; lines: string[]; entries: Map<string, FmEntry>; eol: string }

function readFm(text: string): FmDoc | null {
  const m = FM_RE.exec(text);
  if (!m) return null;
  const raw = m[2] ?? "";
  const open = m[1] ?? "";
  const lines = raw.split(/\r?\n/);
  return {
    open,
    raw,
    close: m[3] ?? "",
    lines,
    entries: scanEntries(lines),
    eol: raw.includes("\r\n") || open.includes("\r\n") ? "\r\n" : "\n",
  };
}

/** Schreibt die verwalteten Keys in den Rohtext. `skip` bleibt unangetastet (fluechtige Keys
 *  in der Vergleichsfassung). `null` = ein verwalteter Key liegt als Block-Skalar vor; den
 *  koennte nur eine echte YAML-Implementierung ersetzen — also melden statt zerstoeren. */
function rewriteFm(doc: FmDoc, derived: Record<string, FmVal>, managed: string[], skip: Set<string>): string | null {
  const replaced = new Map<number, string[]>();
  const dropped = new Set<number>();
  const appended: string[] = [];
  for (const k of managed) {
    if (!Object.hasOwn(derived, k) || skip.has(k)) continue;
    const neu = keyLines(k, derived[k] as FmVal);
    const e = doc.entries.get(k);
    if (!e) { appended.push(...neu); continue; }
    if (/^[|>]/.test(e.rest)) return null;
    replaced.set(e.start, neu);
    for (let i = e.start; i < e.end; i++) dropped.add(i);
  }
  const out: string[] = [];
  for (let i = 0; i < doc.lines.length; i++) {
    const neu = replaced.get(i);
    if (neu) out.push(...neu);
    else if (!dropped.has(i)) out.push(doc.lines[i] as string);
  }
  out.push(...appended);
  return out.join(doc.eol);
}

export function mergeNote(input: MergeInput): MergeResult {
  const doc = readFm(input.existing);
  // "frontmatter-unparseable" greift, wenn der Text zwar mit "---" beginnt, aber kein
  // schliessendes "---" hat.
  if (!doc && input.existing.startsWith("---")) return { ok: false, code: "frontmatter-unparseable" };
  const body = doc ? input.existing.slice(doc.open.length + doc.raw.length + doc.close.length) : input.existing;
  const { before, block, after } = splitBody(body);
  if (block === null) return { ok: false, code: "fences-missing" };
  if (input.expectedZoneHash !== null && zoneHash(block) !== input.expectedZoneHash) {
    return { ok: false, code: "zone-edited" };
  }

  // Zeilenende der Notiz, nicht des gerenderten Blocks: eine CRLF-Notiz bleibt CRLF.
  const eol: "\n" | "\r\n" = (doc ? doc.eol : input.existing).includes("\r\n") ? "\r\n" : "\n";
  const tail = `${before}${wrapBlock(input.block, eol)}${after}`;
  const build = (skip: Set<string>): string | null => {
    if (!doc) {
      // Notiz ohne Frontmatter: einen frischen Block aus den abgeleiteten Keys voranstellen.
      const data: Record<string, FmValue> = {};
      const order: string[] = [];
      for (const k of input.managed) {
        if (!Object.hasOwn(input.derived, k) || skip.has(k)) continue;
        data[k] = toFm(input.derived[k] as FmVal);
        order.push(k);
      }
      return `${fmBlock(data, order)}${tail}`;
    }
    const raw = rewriteFm(doc, input.derived, input.managed, skip);
    return raw === null ? null : `${doc.open}${raw}${doc.close}${tail}`;
  };

  const candidate = build(new Set());
  if (candidate === null) return { ok: false, code: "frontmatter-unparseable" };
  // Vergleichsfassung: fluechtige Keys, die es schon gibt, auf ihrem BESTEHENDEN Wert
  // halten. Nur wenn sich sonst etwas unterscheidet, wird geschrieben.
  const skip = new Set((input.volatileKeys ?? []).filter((k) => doc?.entries.has(k)));
  const probe = skip.size === 0 ? candidate : build(skip);
  if (probe === null) return { ok: false, code: "frontmatter-unparseable" };
  if (probe === input.existing) {
    return { ok: true, content: input.existing, changed: false, zoneHash: zoneHash(input.block) };
  }
  return { ok: true, content: candidate, changed: true, zoneHash: zoneHash(input.block) };
}

/**
 * Aendert AUSSCHLIESSLICH bestehende Frontmatter-Keys und laesst den Body Byte fuer Byte
 * stehen — auch die verwaltete Zone. Fuer Kommandos, die am Inhalt der Nachricht nichts zu
 * suchen haben (mail.relink). Bewusst OHNE Zone-Hash-Pruefung: wer die Zone nicht anfasst,
 * darf an einer von Hand geaenderten Zone nicht scheitern.
 *
 * Keys, die im Frontmatter nicht vorkommen, werden ignoriert statt angelegt: ein Kommando,
 * das `in_reply_to` setzt, soll es dort, wo es die Mail nie gab, auch nicht erfinden.
 */
/**
 * Setzt EINEN Frontmatter-Key zeilenweise — der Ersatz fuer `fileManager.processFrontMatter`
 * im Zustandswechsel (`setState`). Der Unterschied ist nicht die Wirkung, sondern der Kollateral:
 * die Obsidian-API liest den Block als YAML und schreibt ihn komplett neu, wodurch die
 * Formatierung fremder Felder umgeschrieben wird (aus `to: [adresse]` wird eine Block-Liste —
 * an einem echten Postfach gemessen, M3-Nachlese 2026-08-30). Hier bleibt jede nicht betroffene
 * Zeile byte-identisch, wie im ganzen uebrigen Modul.
 *
 * Anders als `mergeFrontmatterOnly` LEGT diese Funktion den Key an, wenn er fehlt: der Zustand
 * einer gespiegelten Mail ist eine Aussage ueber die Notiz, kein Feld der Nachricht, das man
 * nicht erfinden darf — und `processFrontMatter` tat es ebenfalls.
 *
 * `frontmatter-unparseable` heisst hier: der Block schliesst nicht, ODER der Key selbst liegt
 * als Block-Skalar vor (den koennte nur eine echte YAML-Implementierung ersetzen). Der Aufrufer
 * darf in diesem Fall auf die API zurueckfallen — sie kann es, um den Preis der
 * Re-Serialisierung.
 */
export function setFrontmatterField(input: { existing: string; key: string; value: FmVal }):
  | { ok: true; content: string; changed: boolean }
  | { ok: false; code: MergeErrorCode } {
  const doc = readFm(input.existing);
  if (!doc) {
    if (input.existing.startsWith("---")) return { ok: false, code: "frontmatter-unparseable" };
    // Notiz ohne Frontmatter: frischen Block voranstellen, wie es processFrontMatter tut.
    return { ok: true, content: `${fmBlock({ [input.key]: toFm(input.value) }, [input.key])}${input.existing}`, changed: true };
  }
  const raw = rewriteFm(doc, { [input.key]: input.value }, [input.key], new Set());
  if (raw === null) return { ok: false, code: "frontmatter-unparseable" };
  const body = input.existing.slice(doc.open.length + doc.raw.length + doc.close.length);
  const content = `${doc.open}${raw}${doc.close}${body}`;
  return { ok: true, content, changed: content !== input.existing };
}

export function mergeFrontmatterOnly(input: { existing: string; values: Record<string, FmVal> }):
  | { ok: true; content: string; changed: boolean }
  | { ok: false; code: MergeErrorCode } {
  const doc = readFm(input.existing);
  if (!doc) {
    if (input.existing.startsWith("---")) return { ok: false, code: "frontmatter-unparseable" };
    return { ok: true, content: input.existing, changed: false };
  }
  const managed = Object.keys(input.values).filter((k) => doc.entries.has(k));
  if (managed.length === 0) return { ok: true, content: input.existing, changed: false };
  const raw = rewriteFm(doc, input.values, managed, new Set());
  if (raw === null) return { ok: false, code: "frontmatter-unparseable" };
  const body = input.existing.slice(doc.open.length + doc.raw.length + doc.close.length);
  const content = `${doc.open}${raw}${doc.close}${body}`;
  return { ok: true, content, changed: content !== input.existing };
}
