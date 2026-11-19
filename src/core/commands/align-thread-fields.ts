import { setFrontmatterFields } from "../merge/merge";
import type { NotePlan } from "../mirror/plan";
import { rawToFmValue, valueEquals, type FmValue } from "../../vendor/kit/frontmatter";
import { effectiveInheritFields } from "../thread/field";
import { groupThreads } from "../thread/group";
import { inheritableFrom } from "../thread/inherit";
import { tokenRegexOf } from "../thread/token";
import { show } from "./diff";
import { validateInput } from "./schema";
import { threadEntryOf } from "./thread-entry";
import { keepZoneHash } from "./zone";
import { EMPTY_SCHEMA, type CommandContext, type CommandDescriptor, type CommandProbe, type PlanResult } from "./types";

const MAX_DIFF_ROWS = 20;

/** Steht in `have` (Rohwert aus dem Metadata-Cache) schon genau der Wert `want`? Typgenau (Kit `valueEquals`, `typed`):
 *  `true` ist nicht der Text `"true"`, die Zahl `2` nicht der Text `"2"`, ein Text nicht die Liste mit ihm. */
function haveValue(have: unknown, want: FmValue): boolean {
  const v = rawToFmValue(have);
  return v !== null && valueEquals(v, want, { typed: true });
}

/**
 * „Felder im Vorgang angleichen“ (A2, Welle 36): setzt die Werte der eingestellten `inheritFields` von der Wurzel des Vorgangs
 * der aktiven Notiz in alle anderen Notizen dieses Vorgangs. Das Feld wird angelegt, wo es fehlt (E1: `setFrontmatterFields`,
 * nicht `mergeFrontmatterOnly`); ein Wahrheitswert geht als YAML-Literal durch (E2). Ein Schluessel, den die Wurzel nicht
 * (oder nur als verschachtelten Wert) traegt, wird nicht angefasst und loescht nirgends etwas. Nur Frontmatter; die Zone und
 * ihr gespeicherter Hash bleiben, eine Notiz ohne Zone wird mit Grund uebersprungen.
 */
export const ALIGN_THREAD_FIELDS_COMMAND: CommandDescriptor = {
  id: "mail.alignThreadFields",
  title: "Align fields in thread",
  titleKey: "cmd.mail.alignThreadFields.title",
  description: "Copies the values of the fields listed under “Fields passed on in a thread” in the settings from the first mail of this thread into all its other notes, and adds them where they are missing. Fields the first mail does not have are left alone.",
  descriptionKey: "cmd.mail.alignThreadFields.desc",
  schema: EMPTY_SCHEMA,
  needs: { allNotes: true, threads: true },

  appliesTo(probe: CommandProbe): boolean {
    return probe.target.mailId !== "";
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    if (!validateInput(EMPTY_SCHEMA, input).ok) return { ok: false, code: "invalid-input" };
    const keys = effectiveInheritFields(ctx.profile);
    if (keys.length === 0) return { ok: false, code: "nothing-to-do", hintKey: "error.command.inherit-fields-off" };

    const refs = ctx.notes ?? [];
    const index = groupThreads(refs.map((r) => threadEntryOf(ctx.profile, r)), tokenRegexOf(ctx.profile));
    const rootId = index.rootOf.get(ctx.target.mailId) ?? ctx.target.mailId;
    const root = refs.find((r) => r.mailId === rootId);
    if (root === undefined) return { ok: false, code: "nothing-to-do" };

    // Was die Wurzel weitergeben kann; fehlt ein Wert, gibt es fuer den Schluessel nichts anzugleichen.
    const source = new Map(Object.entries(inheritableFrom(root, keys)));
    if (source.size === 0) return { ok: false, code: "nothing-to-do" };

    const notes: NotePlan[] = [];
    const diff: { field: string; before?: string; after?: string }[] = [];
    const touched = new Set<string>();
    for (const ref of refs) {
      if (ref.mailId === rootId || index.rootOf.get(ref.mailId) !== rootId) continue;
      const differing = [...source].filter(([key, want]) => !haveValue(ref.frontmatter[key], want));
      if (differing.length === 0) continue;
      const hash = keepZoneHash(ref.content, ref.zoneHash);
      if (hash === null) {
        notes.push({ kind: "skip", path: ref.path, mailId: ref.mailId, reason: "fences-missing" });
        continue;
      }
      const values: Record<string, FmValue> = {};
      const literals: Record<string, string> = {};
      for (const [key, want] of differing) {
        if (typeof want === "boolean") literals[key] = String(want); else values[key] = want;
      }
      const merged = setFrontmatterFields({ existing: ref.content, values, literals });
      if (!merged.ok) {
        notes.push({ kind: "skip", path: ref.path, mailId: ref.mailId, reason: merged.code });
        continue;
      }
      if (!merged.changed) continue;
      notes.push({ kind: "update", path: ref.path, content: merged.content, mailId: ref.mailId, zoneHash: hash, expectedContent: ref.content });
      for (const [key, want] of differing) {
        touched.add(key);
        if (diff.length >= MAX_DIFF_ROWS) continue;
        const had = ref.frontmatter[key];
        diff.push({ field: `${ref.path}: ${key}`, ...(had === undefined ? {} : { before: show(had) }), after: show(want) });
      }
    }
    const zuSchreiben = notes.filter((n) => n.kind === "update").length;
    if (zuSchreiben === 0) return { ok: false, code: "nothing-to-do" };

    const fields = keys.filter((k) => touched.has(k)).join(", ");
    return {
      ok: true,
      plan: {
        commandId: "mail.alignThreadFields",
        mailId: ctx.target.mailId,
        summary: `Align fields: ${String(zuSchreiben)} note(s) get the values of the first mail of the thread for ${fields}`,
        summaryKey: "plan.mail.alignThreadFields.summary",
        summaryArgs: [zuSchreiben, fields],
        diff,
        notes,
      },
    };
  },
};
