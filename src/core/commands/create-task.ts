import { fmKeyFor } from "../mirror/profile";
import { validateInput, type ObjectSchema } from "./schema";
import type { CommandContext, CommandDescriptor, CommandProbe, PlanResult } from "./types";

/** Betreff nur als Vorbelegung fuer das Formular (Beschreibungstext) — die tatsaechliche
 *  Titelwahl trifft immer der Nutzer, `plan()` uebernimmt niemals ungefragt den Betreff. */
function subjectOf(probe: CommandProbe): string {
  const key = fmKeyFor(probe.profile, "subject");
  const raw = key ? probe.frontmatter[key] : undefined;
  return typeof raw === "string" ? raw : "";
}

function createTaskSchema(ctx: CommandContext): ObjectSchema {
  const subject = subjectOf(ctx);
  return {
    type: "object",
    properties: {
      title: {
        type: "string",
        minLength: 1,
        description: subject !== "" ? `Task title (default: ${subject}).` : "Task title.",
        descriptionKey: "cmd.mail.createTask.field.title",
      },
      due: {
        type: "string",
        format: "date",
        description: "Optional due date (YYYY-MM-DD). Leave empty for no due date.",
        descriptionKey: "cmd.mail.createTask.field.due",
      },
    },
    required: ["title"],
  };
}

export const CREATE_TASK_COMMAND: CommandDescriptor = {
  id: "mail.createTask",
  title: "Create a TaskNotes task",
  titleKey: "cmd.mail.createTask.title",
  description: "Creates a TaskNotes task linked back to this mail note. Mailstone does not write the task itself.",
  descriptionKey: "cmd.mail.createTask.desc",
  schema: { type: "object", properties: { title: { type: "string", minLength: 1 } }, required: ["title"] },
  schemaFor: createTaskSchema,

  // Prueft NICHT, ob TaskNotes installiert ist — src/core/** darf die fremde API nicht
  // kennen. Diese Pruefung sitzt in der Obsidian-Schicht (Task 5). Gilt deshalb fuer jede
  // Mail-Notiz.
  appliesTo(_probe: CommandProbe): boolean {
    return true;
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    const v = validateInput(createTaskSchema(ctx), input);
    if (!v.ok) return { ok: false, code: "invalid-input" };

    const title = String(v.value["title"]);
    const rawDue = v.value["due"];
    // "" ist ein leeres Formularfeld, keine Faelligkeit — ein leerer String an ein fremdes
    // Plugin waere ein Datenfehler.
    const due = typeof rawDue === "string" && rawDue !== "" ? rawDue : null;
    const noteLink = ctx.target.path.replace(/\.md$/, "");

    return {
      ok: true,
      plan: {
        commandId: "mail.createTask",
        mailId: ctx.target.mailId,
        summary: `Create a TaskNotes task: ${title}`,
        summaryKey: "plan.mail.createTask.summary",
        summaryArgs: [title],
        diff: [],
        notes: [],
        createTask: { title, due, noteLink },
      },
    };
  },
};
