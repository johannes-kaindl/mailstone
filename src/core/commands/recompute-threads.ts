import { setFrontmatterFields } from "../merge/merge";
import { wikilinkOf } from "../../vendor/kit/frontmatter";
import type { NotePlan } from "../mirror/plan";
import { effectiveThreadField } from "../thread/field";
import { groupThreads } from "../thread/group";
import { tokenRegexOf } from "../thread/token";
import { show } from "./diff";
import { validateInput } from "./schema";
import { threadEntryOf } from "./thread-entry";
import { keepZoneHash } from "./zone";
import { EMPTY_SCHEMA, type CommandContext, type CommandDescriptor, type CommandProbe, type PlanResult } from "./types";

const MAX_DIFF_ROWS = 20;

/**
 * „Vorgaenge neu berechnen“ (A3, Welle 36): setzt `threadField` in allen Mail-Notizen des Vaults auf den
 * Wikilink der Wurzel ihres Vorgangs, wo der Wert fehlt oder auf eine andere Mail zeigt. Das Feld wird
 * angelegt, wo es fehlt (E1: `setFrontmatterFields`, nicht `mergeFrontmatterOnly`). Verglichen werden die
 * aufgeloesten Ziele, nicht die Zeichenketten (E6): ein kurzer Link oder ein Alias auf die richtige Wurzel
 * bleibt stehen. Nur Frontmatter; die Zone und ihr gespeicherter Hash bleiben, eine Notiz ohne Zone wird
 * mit Grund uebersprungen.
 */
export const RECOMPUTE_THREADS_COMMAND: CommandDescriptor = {
  id: "mail.recomputeThreads",
  title: "Recompute threads",
  titleKey: "cmd.mail.recomputeThreads.title",
  description: "Sets the thread field on all mail notes to a link to the earliest mail of their thread, and fills it in where it is missing. Needs a thread field name in the settings.",
  descriptionKey: "cmd.mail.recomputeThreads.desc",
  schema: EMPTY_SCHEMA,
  needs: { allNotes: true, threads: true },

  appliesTo(probe: CommandProbe): boolean {
    return probe.target.mailId !== "";
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    if (!validateInput(EMPTY_SCHEMA, input).ok) return { ok: false, code: "invalid-input" };
    const field = effectiveThreadField(ctx.profile);
    if (field === "") return { ok: false, code: "nothing-to-do", hintKey: "error.command.thread-field-off" };

    const refs = ctx.notes ?? [];
    const entries = refs.map((r) => threadEntryOf(ctx.profile, r));
    const index = groupThreads(entries, tokenRegexOf(ctx.profile));
    const pathOf = new Map(entries.map((e) => [e.mailId, e.path]));

    const notes: NotePlan[] = [];
    const diff: { field: string; before?: string; after?: string }[] = [];
    for (const ref of refs) {
      const root = index.rootOf.get(ref.mailId) ?? ref.mailId;
      if (ref.thread?.valueId === root) continue; // zeigt schon auf die Wurzel, in welcher Schreibweise auch immer
      const link = wikilinkOf(pathOf.get(root) ?? "");
      if (link === null) {
        notes.push({ kind: "skip", path: ref.path, mailId: ref.mailId, reason: "missing-target" });
        continue;
      }
      const hash = keepZoneHash(ref.content, ref.zoneHash);
      if (hash === null) {
        notes.push({ kind: "skip", path: ref.path, mailId: ref.mailId, reason: "fences-missing" });
        continue;
      }
      const merged = setFrontmatterFields({ existing: ref.content, values: { [field]: link } });
      if (!merged.ok) {
        notes.push({ kind: "skip", path: ref.path, mailId: ref.mailId, reason: merged.code });
        continue;
      }
      if (!merged.changed) continue;
      notes.push({ kind: "update", path: ref.path, content: merged.content, mailId: ref.mailId, zoneHash: hash, expectedContent: ref.content });
      if (diff.length < MAX_DIFF_ROWS) diff.push({ field: ref.path, before: show(ref.frontmatter[field]), after: link });
    }
    const zuSchreiben = notes.filter((n) => n.kind === "update").length;
    if (zuSchreiben === 0) return { ok: false, code: "nothing-to-do" };

    return {
      ok: true,
      plan: {
        commandId: "mail.recomputeThreads",
        mailId: ctx.target.mailId,
        summary: `Recompute threads: ${String(zuSchreiben)} note(s) get a thread link in "${field}"`,
        summaryKey: "plan.mail.recomputeThreads.summary",
        summaryArgs: [zuSchreiben, field],
        diff,
        notes,
      },
    };
  },
};
