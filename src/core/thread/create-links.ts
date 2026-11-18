// Der Vorgangswert NEUER Notizen beim Anlegen (E24, Welle 36). Keine volle Gruppierung: die neue
// Notiz uebernimmt den Wert ihrer Vorgaengerin; hat die Vorgaengerin keinen, ist sie die Wurzel; ohne
// Vorgaengerin ist die neue Notiz ihre eigene Wurzel. Die volle Gruppierung (`group.ts`) laeuft nur im
// Befehl „Vorgaenge neu berechnen“. Die Vorgaengerin darf eine Notiz desselben Laufs sein.
import { wikilinkOf } from "../../vendor/kit/frontmatter";
import { buildPredecessorLookup, predecessorOf, type PredecessorMail } from "./predecessor";

/** Eine Notiz, die es im Vault schon gibt. */
export interface KnownThreadNote {
  mailId: string;
  /** Pfad ohne `.md`. */
  path: string;
  /** Der Vorgangswert, der in der Notiz steht (Wikilink auf die Wurzel), `null` ohne Wert. */
  value: string | null;
}

/** Eine Notiz, die dieser Lauf anlegt; `path` steht schon fest (`assignRunPaths`). */
export interface NewThreadMail extends PredecessorMail {
  /** Pfad der neuen Notiz ohne `.md`. */
  path: string;
}

const isWikilink = (v: string): boolean => /^\[\[.+\]\]$/.test(v.trim());

/** Mail-ID der neuen Notiz -> Vorgangswert (`[[Pfad der Wurzel]]`). Eine Mail, deren Wurzelpfad sich nicht als
 *  Wikilink schreiben laesst, fehlt in der Antwort (ein Link auf die falsche Notiz waere schlimmer als keiner). */
export function threadValuesForNew(
  fresh: readonly NewThreadMail[],
  known: readonly KnownThreadNote[],
): Map<string, string> {
  const knownById = new Map<string, KnownThreadNote>();
  for (const k of known) if (!knownById.has(k.mailId)) knownById.set(k.mailId, k);
  const runById = new Map<string, NewThreadMail>();
  for (const f of fresh) if (!runById.has(f.mailId) && !knownById.has(f.mailId)) runById.set(f.mailId, f);

  const lookup = buildPredecessorLookup([
    ...[...knownById.values()].map((k): PredecessorMail => ({ mailId: k.mailId, inReplyTo: null, references: [] })),
    ...runById.values(),
  ]);
  const memo = new Map<string, string | null>();
  const visiting = new Set<string>();

  /** Der Vorgangswert, den die Notiz zu `id` traegt oder tragen wird. */
  function valueOf(id: string): string | null {
    const k = knownById.get(id);
    if (k) return k.value !== null && isWikilink(k.value) ? k.value : wikilinkOf(k.path);
    const r = runById.get(id);
    if (!r) return null;
    if (memo.has(id)) return memo.get(id) ?? null;
    // Ein Kreis in den Verweisen (kaputte Header): die Notiz, an der er sich schliesst, wird Wurzel.
    if (visiting.has(id)) return wikilinkOf(r.path);
    visiting.add(id);
    const pred = predecessorOf(r, lookup);
    const v = pred === null ? wikilinkOf(r.path) : valueOf(pred);
    visiting.delete(id);
    memo.set(id, v);
    return v;
  }

  const out = new Map<string, string>();
  for (const id of runById.keys()) {
    const v = valueOf(id);
    if (v !== null) out.set(id, v);
  }
  return out;
}
