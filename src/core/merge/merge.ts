import { parseFrontmatter, serializeFrontmatter, type FmValue } from "../../vendor/kit/frontmatter";
import { patchFrontmatter, type FrontmatterPatchResult } from "../../vendor/kit/frontmatter-patch";
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

/** Ueberschrift der verwalteten Zone einer bestehenden Notiz (`## <Text>` als erste Zeile), oder
 *  `undefined`. Ein Re-Render nimmt sie wieder auf: Bestand wird nie in eine andere Sprache umgeschrieben. */
export function blockHeadingOf(content: string): string | undefined {
  const { block } = splitBody(content);
  const m = block === null ? null : /^## ([^\r\n]+)\r?\n/.exec(block + "\n");
  return m ? m[1]!.trim() : undefined;
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
// oder Block-Listen und wuerfe sie beim Schreiben weg. Deshalb schreibt das Kit
// (`patchFrontmatter`) den ROHTEXT zeilenweise um: nur die Zeilen der verwalteten Keys werden
// ersetzt bzw. ergaenzt, alles andere bleibt Byte fuer Byte stehen, auch alles hinter dem Block.

/** Die Notiz mit dem Ergebnis des Kits als Kopf und der Zone aus `block`: der Rumpf kommt aus dem gepatchten Text (das Kit laesst
 *  alles hinter dem Frontmatter byte-gleich), nur die Zone zwischen den Markern wird ersetzt. Das Zeilenende folgt dem Kopf, bei
 *  einer Notiz ohne Kopf dem Text: eine CRLF-Notiz bleibt CRLF. */
function assemble(patched: string, existing: string, block: string): string {
  const body = parseFrontmatter(patched).body;
  const head = patched.slice(0, patched.length - body.length);
  const { before, after } = splitBody(body);
  const eol: "\n" | "\r\n" = (head === "" ? existing : head).includes("\r\n") ? "\r\n" : "\n";
  return `${head}${before}${wrapBlock(block, eol)}${after}`;
}

export function mergeNote(input: MergeInput): MergeResult {
  const set: Record<string, FmValue> = {};
  for (const k of input.managed) if (Object.hasOwn(input.derived, k)) set[k] = toFm(input.derived[k] as FmVal);
  // `create`: eine Notiz ohne Frontmatter bekommt einen Block; `protect: []`: `created` ist hier kein geschuetzter Schluessel.
  const patched = patchFrontmatter(input.existing, { set, create: true, protect: [] });
  // Rangfolge der Fehler wie bisher: ein nie geschlossener Block gewinnt gegen alles; erst danach Zone, und was das Kit sonst am
  // Frontmatter ablehnt (Block-Skalar am verwalteten Key, unlesbarer Schluessel, Wert mit Zeilenumbruch) zuletzt. Das Kit prueft
  // Schluessel und Werte VOR dem Block und nennt dann `invalid-*`, auch bei einem nie geschlossenen Block: den fragt eine Anfrage
  // ohne Schreibauftrag allein.
  if (!patchFrontmatter(input.existing, {}).ok) return { ok: false, code: "frontmatter-unparseable" };
  const existingFm = parseFrontmatter(input.existing);
  const { block } = splitBody(existingFm.body);
  if (block === null) return { ok: false, code: "fences-missing" };
  if (input.expectedZoneHash !== null && zoneHash(block) !== input.expectedZoneHash) {
    return { ok: false, code: "zone-edited" };
  }
  if (!patched.ok) return { ok: false, code: "frontmatter-unparseable" };

  const candidate = assemble(patched.content, input.existing, input.block);
  // Vergleichsfassung: fluechtige Keys, die es schon gibt, auf ihrem BESTEHENDEN Wert
  // halten. Nur wenn sich sonst etwas unterscheidet, wird geschrieben.
  const present = new Set(existingFm.order);
  const skip = (input.volatileKeys ?? []).filter((k) => present.has(k));
  let probe = candidate;
  if (skip.length > 0) {
    const stable = { ...set };
    for (const k of skip) delete stable[k];
    const p = patchFrontmatter(input.existing, { set: stable, create: true, protect: [] });
    if (!p.ok) return { ok: false, code: "frontmatter-unparseable" };
    probe = assemble(p.content, input.existing, input.block);
  }
  if (probe === input.existing) {
    return { ok: true, content: input.existing, changed: false, zoneHash: zoneHash(input.block) };
  }
  return { ok: true, content: candidate, changed: true, zoneHash: zoneHash(input.block) };
}

/** Die Gruende des Kits (`unparseable`, `block-scalar`, `invalid-key`, `invalid-value`, `protected`) heissen hier alle
 *  `frontmatter-unparseable`: der Aufrufer faellt auf die API zurueck bzw. ueberspringt die Notiz (`plan.ts`). `protected`
 *  ist mit `protect: []` unerreichbar. */
function fromPatch(r: FrontmatterPatchResult):
  | { ok: true; content: string; changed: boolean }
  | { ok: false; code: MergeErrorCode } {
  return r.ok ? { ok: true, content: r.content, changed: r.changed } : { ok: false, code: "frontmatter-unparseable" };
}

function toFmValues(values: Record<string, FmVal>): Record<string, FmValue> {
  const out: Record<string, FmValue> = {};
  for (const [k, v] of Object.entries(values)) out[k] = toFm(v);
  return out;
}

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
 * `frontmatter-unparseable` heisst hier: der Block schliesst nicht, der Key selbst liegt als
 * Block-Skalar vor (den koennte nur eine echte YAML-Implementierung ersetzen), oder der Key ist
 * keiner, den der Zeilenleser erkennt (etwa mit Umlaut), oder der Wert enthaelt einen Zeilenumbruch.
 * Der Aufrufer darf in diesem Fall auf die API zurueckfallen — sie kann es, um den Preis der
 * Re-Serialisierung.
 */
export function setFrontmatterField(input: { existing: string; key: string; value: FmVal }):
  | { ok: true; content: string; changed: boolean }
  | { ok: false; code: MergeErrorCode } {
  return fromPatch(patchFrontmatter(input.existing, { set: toFmValues({ [input.key]: input.value }), create: true, protect: [] }));
}

/**
 * Aendert AUSSCHLIESSLICH bestehende Frontmatter-Keys und laesst den Body Byte fuer Byte
 * stehen — auch die verwaltete Zone. Fuer Kommandos, die am Inhalt der Nachricht nichts zu
 * suchen haben (mail.relink). Bewusst OHNE Zone-Hash-Pruefung: wer die Zone nicht anfasst,
 * darf an einer von Hand geaenderten Zone nicht scheitern.
 *
 * Keys, die im Frontmatter nicht vorkommen, werden ignoriert statt angelegt: ein Kommando,
 * das `in_reply_to` setzt, soll es dort, wo es die Mail nie gab, auch nicht erfinden.
 *
 * Ein Key, den der Zeilenleser nicht erkennt (Nicht-ASCII-Zeichen), oder ein Wert mit Zeilenumbruch
 * heisst `frontmatter-unparseable`, auch wenn der Key im Frontmatter gar nicht vorkommt: das Kit prueft
 * vor dem Lesen. Der Relink fuehrt die Notiz dann als uebersprungen.
 */
export function mergeFrontmatterOnly(input: { existing: string; values: Record<string, FmVal> }):
  | { ok: true; content: string; changed: boolean }
  | { ok: false; code: MergeErrorCode } {
  return fromPatch(patchFrontmatter(input.existing, { set: toFmValues(input.values), onlyExisting: true, protect: [] }));
}
