import { BLOCK_BEGIN } from "../merge/fences";
import { validateInput, type ObjectSchema } from "./schema";
import { keepZoneHash } from "./zone";
import type { CommandContext, CommandDescriptor, CommandErrorCode, CommandProbe, PlanResult } from "./types";

const EMBED_TYPES = /^(image\/|video\/|audio\/)|^application\/pdf$/;

/** Bilder, Medien und PDFs bettet Obsidian mit `![[…]]` direkt ein; alles andere bleibt ein
 *  Link, damit die Notiz nicht mit einem leeren Rahmen aufgeht. */
export function attachmentLink(path: string, type: string): string {
  return `${EMBED_TYPES.test(type) ? "!" : ""}[[${path}]]`;
}

/**
 * Setzt den Link in den FREIEN Bereich, unmittelbar vor die verwaltete Zone. In der Zone
 * waere er beim naechsten mail.rerender verschwunden — sie wird dort vollstaendig ersetzt.
 */
export function insertAttachmentLink(content: string, link: string): { ok: true; content: string } | { ok: false; code: CommandErrorCode } {
  if (content.includes(link)) return { ok: false, code: "nothing-to-do" };
  const i = content.indexOf(BLOCK_BEGIN);
  if (i < 0) return { ok: false, code: "fences-missing" };
  return { ok: true, content: `${content.slice(0, i)}${link}\n\n${content.slice(i)}` };
}

/** Die Namen aus der .eml — nur echte Anhaenge, keine Inline-Bilder (die bleiben laut
 *  Spec § 2.2 in der .eml und erscheinen im Text als Platzhalter). */
function attachmentNames(ctx: CommandContext): string[] {
  return (ctx.mail?.attachments ?? []).filter((a) => !a.inline).map((a) => a.name);
}

function extractSchema(ctx: CommandContext): ObjectSchema {
  return {
    type: "object",
    properties: {
      name: {
        type: "string",
        enum: attachmentNames(ctx),
        description: "Which attachment to copy into the vault.",
        descriptionKey: "cmd.mail.extractAttachment.field.name",
      },
    },
    required: ["name"],
  };
}

export const EXTRACT_ATTACHMENT_COMMAND: CommandDescriptor = {
  id: "mail.extractAttachment",
  title: "Extract an attachment",
  titleKey: "cmd.mail.extractAttachment.title",
  description: "Copies one attachment out of the .eml into the vault's attachment folder and links it from the note. The .eml keeps its own copy.",
  descriptionKey: "cmd.mail.extractAttachment.desc",
  schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  schemaFor: extractSchema,
  needs: { eml: true },

  /** Billige Vorpruefung ueber das Frontmatter-Feld: `appliesTo` laeuft bei JEDEM Oeffnen
   *  der Kommandopalette, und dafuer eine .eml zu parsen waere unverhaeltnismaessig. Die
   *  DATEN kommen weiterhin ausschliesslich aus der .eml (Spec § 2.2). */
  appliesTo(probe: CommandProbe): boolean {
    const v = probe.frontmatter["attachments"];
    return Array.isArray(v) && v.length > 0;
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    const mail = ctx.mail;
    if (!mail) return { ok: false, code: "eml-missing" };
    const v = validateInput(extractSchema(ctx), input);
    if (!v.ok) return { ok: false, code: "invalid-input" };

    const name = String(v.value["name"]);
    const meta = mail.attachments.find((a) => !a.inline && a.name === name);
    if (!meta) return { ok: false, code: "attachment-missing" };
    const data = mail.attachmentData.get(meta.contentId ?? meta.name);
    if (!data) return { ok: false, code: "attachment-missing" };

    const path = ctx.attachmentPathFor(name);
    const link = attachmentLink(path, meta.type);
    const ins = insertAttachmentLink(ctx.content, link);
    if (!ins.ok) return { ok: false, code: ins.code };
    const hash = keepZoneHash(ctx.content, ctx.zoneHash);
    if (hash === null) return { ok: false, code: "fences-missing" };

    return {
      ok: true,
      plan: {
        commandId: "mail.extractAttachment",
        mailId: ctx.target.mailId,
        summary: `Extract attachment: ${name} → ${path}`,
        summaryKey: "plan.mail.extractAttachment.summary",
        summaryArgs: [name, path],
        diff: [{ field: "attachment", after: path }],
        notes: [{ kind: "update", path: ctx.target.path, content: ins.content, mailId: ctx.target.mailId, zoneHash: hash }],
        attachment: { path, data },
      },
    };
  },
};
