import { BLOCK_BEGIN } from "../merge/fences";
import type { MailAttachmentMeta } from "../mime/types";
import { fmKeyFor } from "../mirror/profile";
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

/** Byte-Gleichheit zweier Anlagen. Bewusst ein voller Vergleich statt einer Pruefsumme: die
 *  Anlagen liegen ohnehin beide im Speicher, und ein Hash koennte hier nur zusaetzlich
 *  irren. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface LabeledAttachment {
  meta: MailAttachmentMeta;
  /** Menschenlesbares Enum-/Anzeige-Label — der Dateiname, es sei denn zwei Anhaenge teilen
   *  ihn: dann bekommt der zweite und jeder weitere " (n)" angehaengt. Das Label waehlt im
   *  Formular; `meta.key` waehlt die Bytes. Ohne diese Trennung waeren zwei "invoice.pdf" im
   *  Dropdown ununterscheidbar und jede Wahl traefe zufaellig eines der beiden (M3b-Nachlese,
   *  Fund 1). */
  label: string;
}

/** Nur echte Anhaenge, keine Inline-Bilder (die bleiben laut Spec § 2.2 in der .eml und
 *  erscheinen im Text als Platzhalter) — mit eindeutigem Label je Anhang. Einziger Ort, der
 *  "nicht-inline" filtert; sowohl das Enum-Schema als auch die Auswahl in `plan()` gehen
 *  darueber, damit sie nicht auseinanderlaufen koennen. */
function nonInlineAttachments(ctx: CommandContext): LabeledAttachment[] {
  const metas = (ctx.mail?.attachments ?? []).filter((a) => !a.inline);
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const m of metas) total.set(m.name, (total.get(m.name) ?? 0) + 1);
  return metas.map((meta) => {
    const n = (seen.get(meta.name) ?? 0) + 1;
    seen.set(meta.name, n);
    // Der ERSTE Anhang eines Namens behaelt den blanken Namen (kein Verhaltenssprung fuer den
    // Normalfall ohne Kollision); erst ab dem zweiten wird das Label eindeutig gemacht.
    const label = (total.get(meta.name) ?? 0) > 1 && n > 1 ? `${meta.name} (${n})` : meta.name;
    return { meta, label };
  });
}

function extractSchema(ctx: CommandContext): ObjectSchema {
  return {
    type: "object",
    properties: {
      name: {
        type: "string",
        enum: nonInlineAttachments(ctx).map((a) => a.label),
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
  needs: { eml: true, attachments: true },

  /** Billige Vorpruefung ueber das Frontmatter-Feld: `appliesTo` laeuft bei JEDEM Oeffnen
   *  der Kommandopalette, und dafuer eine .eml zu parsen waere unverhaeltnismaessig. Die
   *  DATEN kommen weiterhin ausschliesslich aus der .eml (Spec § 2.2). Ueber `fmKeyFor` statt
   *  einem festverdrahteten "attachments", wie jedes andere Kommando auch — sonst verschwindet
   *  das Kommando lautlos aus der Palette, sobald das Feld im Profil umbenannt oder auf `null`
   *  gesetzt wird, obwohl die Mail sichtbar Anhaenge hat. */
  appliesTo(probe: CommandProbe): boolean {
    const key = fmKeyFor(probe.profile, "attachments");
    if (!key) return false;
    const v = probe.frontmatter[key];
    return Array.isArray(v) && v.length > 0;
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    const mail = ctx.mail;
    if (!mail) return { ok: false, code: "eml-missing" };
    const v = validateInput(extractSchema(ctx), input);
    if (!v.ok) return { ok: false, code: "invalid-input" };

    const label = String(v.value["name"]);
    const found = nonInlineAttachments(ctx).find((a) => a.label === label);
    if (!found) return { ok: false, code: "attachment-missing" };
    const meta = found.meta;
    // IMMER ueber meta.key, nie ueber meta.name — zwei Anhaenge mit demselben Namen wuerden
    // sonst dieselben (falschen) Bytes liefern (M3b-Nachlese, Fund 1).
    const data = mail.attachmentData.get(meta.key);
    if (!data) return { ok: false, code: "attachment-missing" };

    // Zweiter Aufruf auf denselben Anhang: liegt am unnummerierten Zielnamen schon eine
    // BYTE-GLEICHE Datei, wird sie verlinkt statt eine Kopie geschrieben. Verglichen werden die
    // Bytes und nicht der Name — ein Basename-Vergleich haette zwei gleichnamige, aber
    // VERSCHIEDENE Anhaenge derselben Mail zusammengeworfen und den zweiten unerreichbar
    // gemacht (genau der Fall aus Fund 1 der M3b-Nachlese). Entschieden am 2026-09-05.
    const vorhanden = ctx.existingAttachment(meta.name);
    const wieder = vorhanden && sameBytes(vorhanden.data, data) ? vorhanden : null;
    const path = wieder ? wieder.path : ctx.attachmentPathFor(meta.name);
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
        summary: `Extract attachment: ${meta.name} → ${path}`,
        summaryKey: "plan.mail.extractAttachment.summary",
        summaryArgs: [meta.name, path],
        diff: [{ field: "attachment", after: path }],
        notes: [{ kind: "update", path: ctx.target.path, content: ins.content, mailId: ctx.target.mailId, zoneHash: hash, expectedContent: ctx.content }],
        // Kein Schreibvorgang, wenn die Datei schon da ist — nur der Link fehlte noch.
        ...(wieder ? {} : { attachment: { path, data } }),
      },
    };
  },
};
