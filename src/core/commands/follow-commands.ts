// „Diesem Vorgang nicht mehr folgen“ / „wieder folgen“ (A1, Welle 36). Die Markierung steht an der Wurzel-Notiz des
// Vorgangs (`followField: false`); sie wirkt auf „Folge-Mails anzeigen“ (der Vorgang wird ausgeblendet) und auf
// „Vorgängen folgen“ (Kontoeinstellung: der Sync kopiert für ihn keine Folge-Mails mehr in den Allowlist-Ordner).
//
// Beide Befehle schreiben nur Frontmatter (E1: das Feld wird angelegt, wo es fehlt; E2: `false` als YAML-Literal), an der
// Wurzel des Vorgangs der aktiven Notiz, nach Vorschau. Die Zone und ihr gespeicherter Hash bleiben stehen.
import { setFrontmatterFields } from "../merge/merge";
import type { NotePlan } from "../mirror/plan";
import { effectiveFollowField, followStopped } from "../thread/field";
import { groupThreads } from "../thread/group";
import { show } from "./diff";
import { validateInput } from "./schema";
import { threadEntryOf } from "./thread-entry";
import { keepZoneHash } from "./zone";
import { EMPTY_SCHEMA, type CommandContext, type CommandDescriptor, type CommandProbe, type PlanResult } from "./types";

function planToggle(kind: "stop" | "resume", input: Record<string, unknown>, ctx: CommandContext): PlanResult {
  if (!validateInput(EMPTY_SCHEMA, input).ok) return { ok: false, code: "invalid-input" };
  const field = effectiveFollowField(ctx.profile);
  if (field === "") return { ok: false, code: "nothing-to-do", hintKey: "error.command.follow-field-off" };

  const refs = ctx.notes ?? [];
  const index = groupThreads(refs.map((r) => threadEntryOf(ctx.profile, r)));
  const rootId = index.rootOf.get(ctx.target.mailId) ?? ctx.target.mailId;
  const root = refs.find((r) => r.mailId === rootId);
  if (root === undefined) return { ok: false, code: "nothing-to-do" };

  const stopped = followStopped(ctx.profile, root.frontmatter);
  if (kind === "stop" ? stopped : !stopped) return { ok: false, code: "nothing-to-do" };

  const hash = keepZoneHash(root.content, root.zoneHash);
  if (hash === null) return { ok: false, code: "fences-missing" };
  const merged = kind === "stop"
    ? setFrontmatterFields({ existing: root.content, values: {}, literals: { [field]: "false" } })
    : setFrontmatterFields({ existing: root.content, values: {}, remove: [field] });
  if (!merged.ok) return { ok: false, code: merged.code };
  if (!merged.changed) return { ok: false, code: "nothing-to-do" };

  const rootPath = root.path.replace(/\.md$/, "");
  const note: NotePlan = { kind: "update", path: root.path, content: merged.content, mailId: root.mailId, zoneHash: hash, expectedContent: root.content };
  const before = root.frontmatter[field] === undefined ? undefined : show(root.frontmatter[field]);
  return {
    ok: true,
    plan: {
      commandId: kind === "stop" ? "mail.stopFollowing" : "mail.resumeFollowing",
      mailId: ctx.target.mailId,
      summary: kind === "stop" ? `Stop following this thread (marked on ${rootPath}).` : `Follow this thread again (marker removed from ${rootPath}).`,
      summaryKey: kind === "stop" ? "plan.mail.stopFollowing.summary" : "plan.mail.resumeFollowing.summary",
      summaryArgs: [rootPath],
      diff: [{ field, ...(before !== undefined ? { before } : {}), ...(kind === "stop" ? { after: "false" } : {}) }],
      notes: [note],
    },
  };
}

const appliesToMailNote = (probe: CommandProbe): boolean => probe.target.mailId !== "";

export const STOP_FOLLOWING_COMMAND: CommandDescriptor = {
  id: "mail.stopFollowing",
  title: "Stop following this thread",
  titleKey: "cmd.mail.stopFollowing.title",
  description: "Marks the first mail of this thread (front matter “false” in the follow field) so that no follow-up mails are listed for it any more and “Follow threads” (account setting) no longer copies them.",
  descriptionKey: "cmd.mail.stopFollowing.desc",
  schema: EMPTY_SCHEMA,
  needs: { allNotes: true, threads: true },
  appliesTo: appliesToMailNote,
  plan: (input, ctx) => planToggle("stop", input, ctx),
};

export const RESUME_FOLLOWING_COMMAND: CommandDescriptor = {
  id: "mail.resumeFollowing",
  title: "Follow this thread again",
  titleKey: "cmd.mail.resumeFollowing.title",
  description: "Removes the marker that stops following this thread, so “Show follow-up mails” lists its follow-up mails again.",
  descriptionKey: "cmd.mail.resumeFollowing.desc",
  schema: EMPTY_SCHEMA,
  needs: { allNotes: true, threads: true },
  appliesTo: appliesToMailNote,
  plan: (input, ctx) => planToggle("resume", input, ctx),
};
