// Felder im Vorgang erben (A2, Welle 36): eine NEUE Notiz uebernimmt die eingestellten Frontmatter-Schluessel
// unveraendert von ihrer Vorgaengerin (`predecessorOf`, dieselbe Wahl wie beim Vorgangswert, E24). Die Vorgaengerin
// darf eine Notiz desselben Laufs sein; dann gilt deren geerbter Wert. Keine Gruppierung, kein Blick auf die Wurzel.
import { rawToFmValue, type FmValue } from "../../vendor/kit/frontmatter";
import type { MailNoteRef } from "../commands/types";
import type { KnownThreadNote, NewThreadMail } from "./create-links";
import { buildPredecessorLookup, predecessorOf, type PredecessorMail } from "./predecessor";

/**
 * Der Wert, den ein Schluessel weitergeben darf, oder `undefined`: der rohe Wert aus dem Metadata-Cache durch die
 * Kit-Umwandlung `rawToFmValue(raw, { skipEmpty })` (Text, endliche Zahl, Wahrheitswert, Liste; Verschachteltes, `null`
 * und Leeres tragen nichts). Eine Liste mit einem Nicht-Text (eine Zahl, ein Wahrheitswert) wird hier NICHT weitergegeben:
 * das Kit macht dort Text aus der Zahl, und wer den Wert zurueckschreibt, darf nichts umtypen (Kit MIGRATION 0.100.0, `relinkValues`).
 */
function inheritable(raw: unknown): FmValue | undefined {
  if (Array.isArray(raw) && !raw.every((x) => typeof x === "string")) return undefined;
  return rawToFmValue(raw, { skipEmpty: true }) ?? undefined;
}

/** Aus den Rohwerten (Metadata-Cache) einer Notiz die weitergebbaren der eingestellten Schluessel. */
function inheritableValues(raw: Readonly<Record<string, unknown>> | undefined, keys: readonly string[]): Record<string, FmValue> {
  const out: Record<string, FmValue> = {};
  for (const key of keys) {
    const v = inheritable(raw?.[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Die weitergebbaren Werte einer Mail-Notiz (aus ihrem Frontmatter) fuer die eingestellten Schluessel: die Quelle des Befehls
 *  „Felder im Vorgang angleichen“ ist die Wurzel, dieselbe Regel wie beim Anlegen. */
export function inheritableFrom(note: Pick<MailNoteRef, "frontmatter">, keys: readonly string[]): Record<string, FmValue> {
  return inheritableValues(note.frontmatter, keys);
}

/** Mail-ID der neuen Notiz -> die Werte, die sie erbt. Eine Mail ohne Vorgaengerin oder ohne weitergebbaren Wert
 *  fehlt in der Antwort. Eine Mail, zu der es die Notiz schon gibt (`known`), erbt nicht noch einmal. */
export function inheritedForNew(
  fresh: readonly NewThreadMail[],
  known: readonly KnownThreadNote[],
  keys: readonly string[],
  tokenPattern: RegExp | null,
): Map<string, Record<string, FmValue>> {
  const out = new Map<string, Record<string, FmValue>>();
  if (keys.length === 0) return out;
  const knownById = new Map<string, KnownThreadNote>();
  for (const k of known) if (!knownById.has(k.mailId)) knownById.set(k.mailId, k);
  const runById = new Map<string, NewThreadMail>();
  for (const f of fresh) if (!runById.has(f.mailId) && !knownById.has(f.mailId)) runById.set(f.mailId, f);

  const lookup = buildPredecessorLookup([
    ...[...knownById.values()].map((k): PredecessorMail => ({ ...k, inReplyTo: null, references: [] })),
    ...runById.values(),
  ], tokenPattern);
  const memo = new Map<string, Record<string, FmValue>>();
  const visiting = new Set<string>();

  /** Was die Notiz zu `id` traegt oder tragen wird. */
  function valuesOf(id: string): Record<string, FmValue> {
    const k = knownById.get(id);
    if (k) return inheritableValues(k.inherit, keys);
    const r = runById.get(id);
    if (!r) return {};
    const cached = memo.get(id);
    if (cached) return cached;
    // Ein Kreis in den Verweisen (kaputte Header): die Notiz, an der er sich schliesst, erbt nichts.
    if (visiting.has(id)) return {};
    visiting.add(id);
    const pred = predecessorOf(r, lookup, tokenPattern);
    const v = pred === null ? {} : valuesOf(pred);
    visiting.delete(id);
    memo.set(id, v);
    return v;
  }

  for (const id of runById.keys()) {
    const v = valuesOf(id);
    if (Object.keys(v).length > 0) out.set(id, v);
  }
  return out;
}
