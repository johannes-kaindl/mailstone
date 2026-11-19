import { effectiveSaveEml } from "../mirror/profile";
import { emlPathFor } from "./eml";
import { EMPTY_SCHEMA, type CommandContext, type CommandDescriptor, type CommandProbe, type MailCommandPlan, type PlanResult } from "./types";
import { validateInput } from "./schema";

/** Wie viele Pfade die Vorschau hoechstens zeigt (gezaehlt wird alles). */
const MAX_TRASH_ROWS = 20;
const MAX_SKIPPED_ROWS = 10;

/**
 * Raeumt die .eml-Dateien auf, die neben den Mail-Notizen liegen (A6, Welle 36) — fuer Vaults,
 * die `saveEml` ausgeschaltet haben und deren Bestand die Doppelung noch traegt. Das ist die
 * eine Ausnahme von „Loeschen gibt es nicht“ (docs/internal/decisions.md): Johannes wollte sie
 * ausdruecklich. Deshalb eng gefasst:
 *  - nur der Konventionspfad (`emlPathFor`), nie eine Quelldatei eines Imports;
 *  - nur eine .eml, deren Message-ID-Kopf zur `mail_id` der Notiz passt (die Obsidian-Schicht
 *    prueft das je Datei, dieses Kommando bleibt rein und synchron);
 *  - nie eine Notiz, immer ueber den Papierkorb nach Vault-Einstellung, immer mit Vorschau.
 */
export const REMOVE_EML_COMMAND: CommandDescriptor = {
  id: "mail.removeEml",
  title: "Remove stored .eml files",
  titleKey: "cmd.mail.removeEml.title",
  description: "Moves the .eml files next to your mail notes to the trash. Notes are never touched. Only a .eml that belongs to its note is moved.",
  descriptionKey: "cmd.mail.removeEml.desc",
  schema: EMPTY_SCHEMA,
  needs: { allNotes: true, emlProbe: true },

  /** Nur ohne wirksames `saveEml` (ausgeschaltet oder Pseudonymisierung an): wer die .eml behalten will, soll den Befehl nicht in der
   *  Palette finden. */
  appliesTo(probe: CommandProbe): boolean {
    return probe.target.mailId !== "" && !effectiveSaveEml(probe.profile);
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    if (!validateInput(EMPTY_SCHEMA, input).ok) return { ok: false, code: "invalid-input" };
    const trash: NonNullable<MailCommandPlan["trash"]> = [];
    const skipped: { path: string; reason: "mismatch" | "unreadable" }[] = [];
    for (const ref of ctx.notes ?? []) {
      const eml = ref.eml;
      if (!eml) continue; // keine .eml neben dieser Notiz — nichts zu tun
      // Der Pfad kommt aus der Obsidian-Schicht; hier gilt trotzdem nur der Konventionspfad.
      if (eml.path !== emlPathFor(ctx.profile, ref.path)) continue;
      if (eml.status === "match") trash.push({ kind: "trash", path: eml.path, mailId: ref.mailId });
      else skipped.push({ path: eml.path, reason: eml.status });
    }
    if (trash.length === 0) return { ok: false, code: "nothing-to-do" };
    const diff: MailCommandPlan["diff"] = [
      ...trash.slice(0, MAX_TRASH_ROWS).map((t) => ({ field: "trash", before: t.path })),
      ...skipped.slice(0, MAX_SKIPPED_ROWS).map((s) => ({ field: "skipped", before: s.path, after: s.reason })),
    ];
    return {
      ok: true,
      plan: {
        commandId: "mail.removeEml",
        mailId: ctx.target.mailId,
        summary: `Move ${String(trash.length)} .eml file(s) to the trash; ${String(skipped.length)} left alone. Notes are not touched.`,
        summaryKey: "plan.mail.removeEml.summary",
        summaryArgs: [trash.length, skipped.length],
        diff,
        notes: [],
        trash,
      },
    };
  },
};
