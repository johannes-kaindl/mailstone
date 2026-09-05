import { fmKeyFor } from "../mirror/profile";
import { validateInput, type ObjectSchema } from "./schema";
import type { CommandContext, CommandDescriptor, CommandProbe, PlanResult } from "./types";

/** Betreff als Vorbelegung fuer das Titelfeld des Formulars — seit `default: subject` (unten)
 *  ist er der tatsaechliche Startwert: wer das Feld unveraendert absendet, uebernimmt ihn.
 *  `plan()` selbst uebernimmt den Betreff trotzdem nie ungefragt, wenn niemand das Formular
 *  ausfuellt (Abbruch, Automatisierung ohne Formular) — die Vorbelegung ist eine Erleichterung
 *  fuer den Nutzer, keine stille Zuweisung. */
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
        // Betreff als Vorbelegung (Spec § 3: "Titel (aus dem Betreff vorbelegt)") — nur
        // gesetzt, wenn es einen gibt, sonst startet das Feld leer statt mit "".
        ...(subject !== "" ? { default: subject } : {}),
        // `description` ist der reine i18n-Notfall: `trFieldDescription` (command-i18n.ts)
        // bevorzugt `descriptionKey`, und der ist unten UND in strings.ts (en/de) gesetzt —
        // dieser Text erreicht den Nutzer also nur, wenn der Key dort fehlt. Deshalb bewusst
        // ohne den Betreff: eine Variable in einem Text, den niemand sieht, waere Ballast, der
        // wie der eigentliche Erklaerweg aussieht.
        description: "Task title.",
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
