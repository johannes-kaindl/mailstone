import { mergeFrontmatterOnly } from "../merge/merge";
import { fmKeyFor, type FmVal } from "../mirror/profile";
import { keepZoneHash } from "./zone";
import type { NotePlan } from "../mirror/plan";
import { validateInput } from "./schema";
import { EMPTY_SCHEMA, type CommandContext, type CommandDescriptor, type CommandProbe, type PlanResult } from "./types";

/** Ein Frontmatter-Wert, der schon ein Wikilink ist, bleibt einer — die Rueckrichtung
 *  braeuchte die Message-ID, und die steht dann nirgends mehr. */
function isWikilink(v: string): boolean {
  return v.startsWith("[[") && v.endsWith("]]");
}

/** Frontmatter-Rohwert (aus dem Metadata-Cache, also `unknown`) fuer die Diff-Vorschau in
 *  Text — `String(unknown)` waere ein no-base-to-string-Fund, falls der Wert je ein Objekt ist. */
function show(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v) ?? "";
}

export function relinkOne(value: string, linkFor: (id: string) => string | null): string {
  if (value === "" || isWikilink(value)) return value;
  const target = linkFor(value);
  return target ? `[[${target}]]` : value;
}

/** Die geaenderten Keys — oder null, wenn dieser Aufruf nichts zu tun hat. */
export function relinkValues(
  frontmatter: Record<string, unknown>,
  keys: readonly string[],
  linkFor: (id: string) => string | null,
): Record<string, FmVal> | null {
  const out: Record<string, FmVal> = {};
  for (const k of keys) {
    const v = frontmatter[k];
    if (typeof v === "string") {
      const neu = relinkOne(v, linkFor);
      if (neu !== v) out[k] = neu;
    } else if (Array.isArray(v) && v.every((x): x is string => typeof x === "string")) {
      const neu = v.map((x) => relinkOne(x, linkFor));
      if (neu.some((x, i) => x !== v[i])) out[k] = neu;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

const MAX_DIFF_ROWS = 20;

export const RELINK_COMMAND: CommandDescriptor = {
  id: "mail.relink",
  title: "Relink threads",
  titleKey: "cmd.mail.relink.title",
  description: "Turns the message ids in in_reply_to and references into wikilinks wherever the target note exists. Runs across all mail notes; existing wikilinks are left alone.",
  descriptionKey: "cmd.mail.relink.desc",
  schema: EMPTY_SCHEMA,
  needs: { allNotes: true },

  appliesTo(probe: CommandProbe): boolean {
    return probe.target.mailId !== "";
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    if (!validateInput(EMPTY_SCHEMA, input).ok) return { ok: false, code: "invalid-input" };
    const keys = [fmKeyFor(ctx.profile, "in_reply_to"), fmKeyFor(ctx.profile, "references")]
      .filter((k): k is string => k !== null);
    if (keys.length === 0) return { ok: false, code: "nothing-to-do" };

    const linkFor = (id: string): string | null => ctx.linkFor(id);
    const notes: NotePlan[] = [];
    const diff: { field: string; before?: string; after?: string }[] = [];
    for (const ref of ctx.notes ?? []) {
      const values = relinkValues(ref.frontmatter, keys, linkFor);
      if (!values) continue;
      const hash = keepZoneHash(ref.content, ref.zoneHash);
      if (hash === null) continue; // Notiz ohne Zone: Merge-Regel 3, nicht halb anfassen
      const merged = mergeFrontmatterOnly({ existing: ref.content, values });
      if (!merged.ok || !merged.changed) continue;
      notes.push({ kind: "update", path: ref.path, content: merged.content, mailId: ref.mailId, zoneHash: hash });
      if (diff.length < MAX_DIFF_ROWS) {
        const k = Object.keys(values)[0] as string;
        diff.push({ field: ref.path, before: show(ref.frontmatter[k]), after: String(values[k] ?? "") });
      }
    }
    if (notes.length === 0) return { ok: false, code: "nothing-to-do" };

    return {
      ok: true,
      plan: {
        commandId: "mail.relink",
        mailId: ctx.target.mailId,
        summary: `Relink threads: ${notes.length} note(s) get new wikilinks`,
        summaryKey: "plan.mail.relink.summary",
        summaryArgs: [notes.length],
        diff,
        notes,
      },
    };
  },
};
