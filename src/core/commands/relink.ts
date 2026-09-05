import { mergeFrontmatterOnly } from "../merge/merge";
import { wikilink } from "../render/wikilink";
import { fmKeyFor, type FmVal } from "../mirror/profile";
import { show } from "./diff";
import { keepZoneHash } from "./zone";
import type { NotePlan } from "../mirror/plan";
import { validateInput } from "./schema";
import { EMPTY_SCHEMA, type CommandContext, type CommandDescriptor, type CommandProbe, type PlanResult } from "./types";

/** Ein Frontmatter-Wert, der schon ein Wikilink ist, bleibt einer — die Rueckrichtung
 *  braeuchte die Message-ID, und die steht dann nirgends mehr. */
function isWikilink(v: string): boolean {
  return v.startsWith("[[") && v.endsWith("]]");
}

export function relinkOne(value: string, linkFor: (id: string) => string | null): string {
  if (value === "" || isWikilink(value)) return value;
  const target = linkFor(value);
  // Kein Ziel ODER ein Pfad, der sich nicht klammern laesst: die ID bleibt stehen. Ein Link auf
  // die falsche Notiz waere schlimmer als eine sichtbare ID (M3b-Nachlese, geparkter Befund 1).
  return (target === null ? null : wikilink(target)) ?? value;
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
    // Uebersprungen wird als `skip` MIT GRUND in den Plan gelegt, nicht per `continue`
    // verschluckt (M3b-Nachlese, geparkter Befund 4). `mail.relink` wirkt vault-weit, und eine
    // Notiz, die es stillschweigend auslaesst, sieht fuer den Nutzer aus wie eine, die nichts
    // zu tun hatte. Der Executor zaehlt die Eintraege und die Meldung nennt sie.
    for (const ref of ctx.notes ?? []) {
      const values = relinkValues(ref.frontmatter, keys, linkFor);
      if (!values) continue; // wirklich nichts zu tun — kein Uebergehen, deshalb auch kein skip
      const hash = keepZoneHash(ref.content, ref.zoneHash);
      if (hash === null) {
        // Notiz ohne Zone: Merge-Regel 3, nicht halb anfassen.
        notes.push({ kind: "skip", path: ref.path, mailId: ref.mailId, reason: "fences-missing" });
        continue;
      }
      const merged = mergeFrontmatterOnly({ existing: ref.content, values });
      if (!merged.ok) {
        notes.push({ kind: "skip", path: ref.path, mailId: ref.mailId, reason: merged.code });
        continue;
      }
      if (!merged.changed) continue;
      notes.push({ kind: "update", path: ref.path, content: merged.content, mailId: ref.mailId, zoneHash: hash, expectedContent: ref.content });
      if (diff.length < MAX_DIFF_ROWS) {
        const k = Object.keys(values)[0] as string;
        diff.push({ field: ref.path, before: show(ref.frontmatter[k]), after: show(values[k]) });
      }
    }
    // Gezaehlt wird, was WIRKLICH geschrieben wird — ein Lauf, der nur Uebersprungene
    // zusammentraegt, hat nichts zu tun und darf keine Vorschau oeffnen.
    const zuSchreiben = notes.filter((n) => n.kind === "update").length;
    if (zuSchreiben === 0) return { ok: false, code: "nothing-to-do" };

    return {
      ok: true,
      plan: {
        commandId: "mail.relink",
        mailId: ctx.target.mailId,
        summary: `Relink threads: ${zuSchreiben} note(s) get new wikilinks`,
        summaryKey: "plan.mail.relink.summary",
        summaryArgs: [zuSchreiben],
        diff,
        notes,
      },
    };
  },
};
