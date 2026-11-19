import { TFile, type App } from "obsidian";
import type { MailNoteRef } from "../core/commands/types";
import { normalizeMessageId } from "../core/mime/headers";
import { fmKeyFor, type MailProfile } from "../core/mirror/profile";
import type { KnownThreadNote } from "../core/thread/create-links";
import { effectiveInheritFields } from "../core/thread/field";
import { noteSubject } from "../core/thread/token";

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Die Mail-ID hinter einem Wikilink-Wert oder einer rohen ID. Ein Wikilink wird ueber Obsidians
 *  Linkaufloesung zur Zieldatei und deren `mail_id` (E6): kurze Links, Aliase und umbenannte Notizen
 *  stimmen so; der Kern vergleicht IDs, nie Linktexte. `null` fuer einen Link, der auf keine Mail-Notiz zeigt. */
export function mailIdOfValue(app: App, profile: MailProfile, sourcePath: string, value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  const link = /^\[\[([^\]|#]*)[^\]]*\]\]$/.exec(v);
  if (!link) return normalizeMessageId(v) ?? v;
  const dest = app.metadataCache.getFirstLinkpathDest(link[1]!.trim(), sourcePath);
  if (!(dest instanceof TFile)) return null;
  const id: unknown = app.metadataCache.getFileCache(dest)?.frontmatter?.[profile.idField];
  return typeof id === "string" && id !== "" ? id : null;
}

function idsOf(app: App, profile: MailProfile, sourcePath: string, value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const id = mailIdOfValue(app, profile, sourcePath, item);
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Die aufgeloesten Verweise und der aufgeloeste Vorgangswert einer Notiz fuer `mail.recomputeThreads`. */
export function threadRefsFor(app: App, profile: MailProfile, path: string, fm: Record<string, unknown>): NonNullable<MailNoteRef["thread"]> {
  const replyKey = fmKeyFor(profile, "in_reply_to");
  const refKey = fmKeyFor(profile, "references");
  const valueRaw = profile.threadField.trim() === "" ? "" : text(fm[profile.threadField.trim()]);
  return {
    inReplyTo: replyKey ? idsOf(app, profile, path, fm[replyKey]) : [],
    references: refKey ? idsOf(app, profile, path, fm[refKey]) : [],
    valueId: valueRaw === "" ? null : mailIdOfValue(app, profile, path, valueRaw),
  };
}

/** Die Mail-Notizen des Vaults fuer den Vorgangswert und die geerbten Felder beim Anlegen (E24, A2): Pfad, Datum, Betreff,
 *  der Wert, der schon in `threadField` steht, und die Rohwerte der Schluessel aus `inheritFields`. Aus dem
 *  Metadata-Cache; wird nur gebaut, wenn der Lauf neue Mails hat. */
export function threadNotes(app: App, profile: MailProfile): KnownThreadNote[] {
  const out: KnownThreadNote[] = [];
  const key = profile.threadField.trim();
  const dateKey = fmKeyFor(profile, "date");
  const timeKey = fmKeyFor(profile, "time");
  const inheritKeys = effectiveInheritFields(profile);
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const id: unknown = fm[profile.idField];
    if (typeof id !== "string" || id === "") continue;
    const value = key === "" ? "" : text(fm[key]);
    out.push({
      mailId: id,
      path: f.path.replace(/\.md$/, ""),
      subject: noteSubject(profile, fm),
      date: dateKey === null ? "" : text(fm[dateKey]),
      time: timeKey === null ? "" : text(fm[timeKey]),
      value: value === "" ? null : value,
      ...(inheritKeys.length > 0 ? { inherit: Object.fromEntries(inheritKeys.filter((k) => fm[k] !== undefined).map((k) => [k, fm[k]])) } : {}),
    });
  }
  return out;
}
