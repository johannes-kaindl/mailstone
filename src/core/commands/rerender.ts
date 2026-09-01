import { mergeNote } from "../merge/merge";
import { renderMessageBlock } from "../render/body";
import { buildDerivedFrontmatter } from "../render/frontmatter";
import { managedKeys } from "../mirror/profile";
import { diffFrontmatter } from "./diff";
import { EMPTY_SCHEMA, type CommandContext, type CommandDescriptor, type CommandProbe, type PlanResult } from "./types";
import { validateInput } from "./schema";

/**
 * Der einzige Weg zu `allowUpdate: true` ausserhalb des Import-Kommandos (Spec § 2.2,
 * Merge-Regel 5) — deshalb laeuft er ueber `mergeNote()` mit dem gespeicherten Zone-Hash:
 * eine von Hand geaenderte Zone fuehrt zu `zone-edited` und es wird NICHTS geschrieben.
 *
 * `mail_source` und `mail_state` kommen unveraendert aus der Notiz. Beim Zustand ist das
 * offensichtlich; bei der Herkunft ist es der teurere Fall: `planSync()` haelt Notizen mit
 * fremder `source` in Ruhe — ein hier neu gesetzter Wert wuerde die Notiz dauerhaft aus
 * ihrem eigenen Sync-Lauf herausdrehen.
 */
export const RERENDER_COMMAND: CommandDescriptor = {
  id: "mail.rerender",
  title: "Re-render note from its .eml",
  titleKey: "cmd.mail.rerender.title",
  description: "Rebuilds the message zone and the derived front matter keys from the .eml stored next to the note. Anything you wrote outside the zone stays untouched.",
  descriptionKey: "cmd.mail.rerender.desc",
  schema: EMPTY_SCHEMA,
  needs: { eml: true },

  appliesTo(probe: CommandProbe): boolean {
    return probe.target.mailId !== "";
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    if (!validateInput(EMPTY_SCHEMA, input).ok) return { ok: false, code: "invalid-input" };
    const mail = ctx.mail;
    if (!mail) return { ok: false, code: "eml-missing" };

    const p = ctx.profile;
    const derived = buildDerivedFrontmatter(p, {
      mail,
      source: ctx.target.source,
      state: ctx.target.state === "detached" ? "detached" : "live",
      syncedAt: ctx.now,
      linkFor: (id) => ctx.linkFor(id),
    });
    const block = renderMessageBlock(mail);
    const r = mergeNote({
      existing: ctx.content,
      derived,
      managed: managedKeys(p),
      block,
      expectedZoneHash: ctx.zoneHash,
      volatileKeys: [p.syncedField],
    });
    if (!r.ok) return { ok: false, code: r.code };
    if (!r.changed) return { ok: false, code: "nothing-to-do" };

    // `mail_synced` steht in jedem Re-Render neu und saehe in der Tabelle wie eine Aenderung
    // aus, die der Nutzer zu verantworten haette — es ist der Zeitstempel des Vorgangs selbst.
    const keys = managedKeys(p).filter((k) => k !== p.syncedField);
    const diff = diffFrontmatter(ctx.frontmatter, derived, keys);
    const changedFields = diff.length;
    return {
      ok: true,
      plan: {
        commandId: "mail.rerender",
        mailId: ctx.target.mailId,
        summary: `Re-render note: ${changedFields} field(s) change, message body rebuilt`,
        summaryKey: "plan.mail.rerender.summary",
        summaryArgs: [changedFields],
        diff,
        notes: [{ kind: "update", path: ctx.target.path, content: r.content, mailId: ctx.target.mailId, zoneHash: r.zoneHash, expectedContent: ctx.content }],
      },
    };
  },
};
