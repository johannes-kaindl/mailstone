// vendored from code-kit@0.91.1, src/ts/pure/placeholder.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: new in code-kit (Welle 36, kp2, order 2 of the pseudonymizer design, spec section 8.1, released by Johannes 2026-11-18 22:44). Sibling of
// `createRedactionSession` in `redact.ts`, not part of it: that session numbers placeholders per session and cannot be serialized; these placeholders
// carry a random ID that outlives the session and stands in the notes.
//
// The grammar, word for word from the spec:
//
//   placeholder = carrier "_" id [ "_" field ] [ "_" n ]      for a value that belongs to a person or an organisation
//               | field   "_" id [ "_" n ]                    for a value that belongs to nobody
//   carrier     = "Person" / "Organisation"
//   id          = 10 characters of 0-9 and a-z without i, l, o, u   (Crockford base32, 50 bit)
//   field       = "Mail" / "Telefon" / "Adresse" / "IBAN"            (German)
//               / "Mail" / "Phone" / "Address" / "IBAN"              (English)
//   n           = "2" .. "99"                                         (a further spelling or value of the same field; the first has none)
//
// Read without regard to case (`person_K3X9M2AB7Q_phone_2` is a placeholder) and in both languages. A placeholder begins after, and ends before, a
// character that is no letter, no digit and no underscore (any script: `\p{L}`, `\p{N}`), or at the edge of the text: `Person_k3x9m2ab7q_Mailbox`,
// `Person_k3x9`, `xPerson_k3x9m2ab7q`, `Person_k3x9m2ab7q_1` and `Person_k3x9m2ab7q_100` are none.
//
// Linear time, no lookbehind (iOS Safari before 16.4 does not parse it): one global regular expression finds the CANDIDATES, the boundary is read from
// the neighbouring code point by plain code (so it is the Unicode letter, not an ASCII guess). The expression has no `u` flag on purpose: with `i`
// AND `u`, "ſ" (U+017F) would match `s` and the Kelvin sign (U+212A) would match `k`, and a placeholder could carry a character that is none.
// Without `u` the case folding of `i` stays inside ASCII. Every attempt of the expression is bounded by the length of the longest placeholder
// (about 40 characters), a rejected candidate costs one more attempt from the next position, so the whole scan is O(length of the text).
//
// No `crypto` in this module: the ID function takes the random bytes the caller got from `crypto.getRandomValues`.

/** The 32 characters of an ID: Crockford base32 in lower case (no `i`, `l`, `o`, `u`). */
export const PLACEHOLDER_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** How many random bytes {@link placeholderIdFromBytes} needs: 10 characters of 5 bit are 50 bit, 7 bytes hold them. */
export const PLACEHOLDER_ID_BYTES = 7;

export type PlaceholderCarrier = "person" | "organisation";
/** The field word, language-free: `Telefon` and `Phone` are both `phone`, `Adresse` and `Address` both `address`. */
export type PlaceholderField = "mail" | "phone" | "address" | "iban";

/** What a placeholder says. `carrier` is `null` for a value that belongs to nobody (then `field` is set). `field` is `null` for the name of a
 *  carrier. `n` is the spelling or value number: `1` for the first (written without a number), `2`..`99` for the later ones. `id` is lower case. */
export interface PlaceholderParts {
  carrier: PlaceholderCarrier | null;
  id: string;
  field: PlaceholderField | null;
  n: number;
}

/** A placeholder found in a text: its parts plus the place. `start`/`end` are UTF-16 offsets (`text.slice(start, end) === raw`), `raw` is as written. */
export interface Placeholder extends PlaceholderParts {
  start: number;
  end: number;
  raw: string;
}

const ID = "[0-9a-hjkmnp-tv-z]{10}";
const FIELD = "mail|telefon|adresse|phone|address|iban";
const N = "(?:[1-9][0-9]|[2-9])";
// Group 1: carrier (or absent), 2: id, 3: field (carrier form), 4: n (carrier form); 5: field (no carrier), 6: id, 7: n.
// The trailing lookahead (ASCII only) lets the expression back off to another reading when the first one is followed by a word character: `_20` is
// read as 20, not as 2 followed by a `0`. Letters and digits of other scripts after the match are rejected in `findPlaceholders`; backing off further
// could not help there, since every shorter reading of a candidate ends in front of an underscore.
const CORE =
  `(?:(person|organisation)_(${ID})(?:_(${FIELD}))?(?:_(${N}))?|(${FIELD})_(${ID})(?:_(${N}))?)(?![A-Za-z0-9_])`;

const FIELD_OF: ReadonlyMap<string, PlaceholderField> = new Map<string, PlaceholderField>([
  ["mail", "mail"], ["telefon", "phone"], ["phone", "phone"], ["adresse", "address"], ["address", "address"], ["iban", "iban"],
]);

function fieldOf(word: string): PlaceholderField {
  return FIELD_OF.get(word.toLowerCase()) ?? "mail"; // the expression admits no other word, the fallback is never read
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** True when the code point just before `index` is a letter, digit or underscore of any script. */
function wordBefore(text: string, index: number): boolean {
  if (index <= 0) return false;
  let from = index - 1;
  const low = text.charCodeAt(from);
  if (low >= 0xdc00 && low <= 0xdfff && from > 0) {
    const high = text.charCodeAt(from - 1);
    if (high >= 0xd800 && high <= 0xdbff) from -= 1;
  }
  return WORD_CHAR.test(text.slice(from, index));
}

/** True when the code point at `index` is a letter, digit or underscore of any script. */
function wordAt(text: string, index: number): boolean {
  if (index >= text.length) return false;
  const cp = text.codePointAt(index);
  return cp !== undefined && WORD_CHAR.test(String.fromCodePoint(cp));
}

function partsOf(m: RegExpExecArray): PlaceholderParts {
  const [, carrier, id = "", field, n, bareField = "", bareId = "", bareN] = m;
  if (carrier !== undefined) {
    return {
      carrier: carrier.toLowerCase() === "person" ? "person" : "organisation",
      id: id.toLowerCase(),
      field: field !== undefined ? fieldOf(field) : null,
      n: n !== undefined ? Number(n) : 1,
    };
  }
  return { carrier: null, id: bareId.toLowerCase(), field: fieldOf(bareField), n: bareN !== undefined ? Number(bareN) : 1 };
}

/** Every placeholder in `text`, left to right, none overlapping. Never throws; a non-string gives `[]`. */
export function findPlaceholders(text: string): Placeholder[] {
  const out: Placeholder[] = [];
  if (typeof text !== "string") return out;
  const re = new RegExp(CORE, "gi");
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (wordBefore(text, start) || wordAt(text, end)) {
      // not a placeholder here; a later one cannot start inside this candidate (its words follow an underscore or a letter), so move on by one
      re.lastIndex = start + 1;
      continue;
    }
    out.push({ ...partsOf(m), start, end, raw: m[0] });
  }
  return out;
}

/** The parts of `text` when the WHOLE text is one placeholder, else `null`. */
export function parsePlaceholder(text: string): PlaceholderParts | null {
  const found = findPlaceholders(text);
  const only = found.length === 1 ? found[0] : undefined;
  if (only === undefined || only.start !== 0 || only.end !== text.length) return null;
  return { carrier: only.carrier, id: only.id, field: only.field, n: only.n };
}

const CARRIER_WORD: Readonly<Record<PlaceholderCarrier, string>> = { person: "Person", organisation: "Organisation" };
const FIELD_WORD: Readonly<Record<"de" | "en", Readonly<Record<PlaceholderField, string>>>> = {
  de: { mail: "Mail", phone: "Telefon", address: "Adresse", iban: "IBAN" },
  en: { mail: "Mail", phone: "Phone", address: "Address", iban: "IBAN" },
};

/** The canonical spelling of `parts` (`Person_k3x9m2ab7q_Telefon_2`), words in `lang` (default German), or `null` when the parts are no placeholder:
 *  a bad ID, `n` not an integer from 1 to 99 (`1` is written without a number), no carrier and no field. */
export function formatPlaceholder(parts: PlaceholderParts, lang: "de" | "en" = "de"): string | null {
  if (!isPlaceholderId(parts.id) || !Number.isInteger(parts.n) || parts.n < 1 || parts.n > 99) return null;
  if (parts.carrier === null && parts.field === null) return null;
  const words = FIELD_WORD[lang];
  const head = parts.carrier === null ? (words[parts.field as PlaceholderField]) : CARRIER_WORD[parts.carrier];
  const mid = parts.carrier !== null && parts.field !== null ? `_${words[parts.field]}` : "";
  return `${head}_${parts.id}${mid}${parts.n > 1 ? `_${parts.n}` : ""}`;
}

/** True for a string of exactly ten characters of {@link PLACEHOLDER_ID_ALPHABET} (lower case). */
export function isPlaceholderId(id: string): boolean {
  if (typeof id !== "string" || id.length !== 10) return false;
  for (let i = 0; i < 10; i++) if (PLACEHOLDER_ID_ALPHABET.indexOf(id.charAt(i)) < 0) return false;
  return true;
}

/** A new ID from random bytes the caller drew (`crypto.getRandomValues(new Uint8Array(7))`): the first 50 bits of the first
 *  {@link PLACEHOLDER_ID_BYTES} bytes, five bits per character, so every ID is equally likely (no modulo). Surplus bytes are ignored. `null` when
 *  `bytes` is no `Uint8Array` or shorter than 7 bytes; the module never invents randomness. */
export function placeholderIdFromBytes(bytes: Uint8Array): string | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < PLACEHOLDER_ID_BYTES) return null;
  let bits = 0;
  let have = 0;
  let out = "";
  for (let i = 0; i < PLACEHOLDER_ID_BYTES && out.length < 10; i++) {
    bits = (bits << 8) | (bytes[i] ?? 0);
    have += 8;
    while (have >= 5 && out.length < 10) {
      have -= 5;
      out += PLACEHOLDER_ID_ALPHABET.charAt((bits >> have) & 31);
    }
    bits &= (1 << have) - 1;
  }
  return out;
}

// ---- replacing ------------------------------------------------------------------------------

/** One replacement: `text.slice(start, end)` becomes `insert`. `priority` breaks a tie between overlapping edits of equal length (higher wins). */
export interface Edit {
  start: number;
  end: number;
  insert: string;
  priority?: number;
}

/** Applies `edits` to `text` (the result is the one of applying them from right to left; offsets are those of the ORIGINAL text). Of two overlapping edits the LONGER one wins (equal length: higher `priority`, then the earlier
 *  start, then the earlier in the list); an edit that is out of range, empty-and-inverted or not made of integers is skipped. Touching edits
 *  (`a.end === b.start`) do not overlap. Returns the new text and the edits that were applied, in text order. `insert` is taken literally (no `$&`). */
export function applyEdits(text: string, edits: readonly Edit[]): { text: string; applied: Edit[] } {
  const ok = edits.filter(
    (e) => Number.isInteger(e.start) && Number.isInteger(e.end) && e.start >= 0 && e.end >= e.start && e.end <= text.length && typeof e.insert === "string",
  );
  // strongest first: longer, then higher priority, then earlier start; a stable sort keeps list order for the rest
  const ranked = [...ok].sort((a, b) => b.end - b.start - (a.end - a.start) || (b.priority ?? 0) - (a.priority ?? 0) || a.start - b.start);
  // `kept` stays sorted by start and its members are disjoint, so a new edit can only collide with the first kept edit at or after its start or with the
  // one before it: a binary search instead of a scan over all of them (a long note can hold thousands of placeholders).
  const kept: Edit[] = [];
  for (const e of ranked) {
    let lo = 0;
    let hi = kept.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((kept[mid]?.start ?? 0) < e.start) lo = mid + 1;
      else hi = mid;
    }
    const before = kept[lo - 1];
    const after = kept[lo];
    if ((before !== undefined && overlaps(before, e)) || (after !== undefined && overlaps(after, e))) continue;
    kept.splice(lo, 0, e);
  }
  // `kept` is sorted by start and disjoint, so cutting the text in one pass with the ORIGINAL offsets gives exactly what applying the edits from
  // right to left gives (no edit moves another's offsets), without copying the whole text once per edit.
  const pieces: string[] = [];
  let at = 0;
  for (const e of kept) {
    pieces.push(text.slice(at, e.start), e.insert);
    at = e.end;
  }
  pieces.push(text.slice(at));
  const out = pieces.join("");
  return { text: out, applied: kept };
}

function overlaps(a: Edit, b: Edit): boolean {
  if (a.start === a.end && b.start === b.end) return a.start === b.start; // two insertions at one point
  return a.start < b.end && b.start < a.end;
}

// ---- restoring ------------------------------------------------------------------------------

/** What the table says about one placeholder: `known` with the original value, or `forgotten` (the person was forgotten, the value is gone). The
 *  lookup returns `undefined` for a placeholder it has never issued. */
export type PlaceholderResolution = { status: "known"; value: string } | { status: "forgotten" };

export type PlaceholderLookup = (placeholder: Placeholder) => PlaceholderResolution | undefined;

export interface RestoreResult {
  text: string;
  /** How many placeholders were replaced by their value. */
  restored: number;
  /** Placeholders the lookup does not know, in text order; they stay in the text as written (an invented one finds nothing and stays). */
  unknown: Placeholder[];
  /** Placeholders of forgotten entries, in text order; they stay in the text as written. */
  forgotten: Placeholder[];
}

/** Puts the originals back: every placeholder in `text` is asked of `lookup`; `known` ones are replaced (right to left, the value literally), `unknown`
 *  and `forgotten` ones stay as they are and are listed separately. A lookup that throws is not caught: it is the caller's code. */
export function restorePlaceholders(text: string, lookup: PlaceholderLookup): RestoreResult {
  const unknown: Placeholder[] = [];
  const forgotten: Placeholder[] = [];
  const edits: Edit[] = [];
  for (const p of findPlaceholders(text)) {
    const r = lookup(p);
    if (r === undefined) unknown.push(p);
    else if (r.status === "forgotten") forgotten.push(p);
    else edits.push({ start: p.start, end: p.end, insert: r.value });
  }
  const { text: out, applied } = applyEdits(typeof text === "string" ? text : "", edits);
  return { text: out, restored: applied.length, unknown, forgotten };
}
