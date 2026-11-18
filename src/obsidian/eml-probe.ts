import { normalizePath, TFile, type App } from "obsidian";
import { emlPathFor } from "../core/commands/eml";
import type { MailNoteRef } from "../core/commands/types";
import { messageIdFromHeader } from "../core/imap/client";
import { normalizeMessageId } from "../core/mime/headers";
import type { MailProfile } from "../core/mirror/profile";

/** Soviel vom Anfang der Datei reicht fuer den Kopf; der Rest (Text, Anhaenge) wird nie
 *  dekodiert. */
const HEAD_BYTES = 64 * 1024;

/**
 * Die Probe fuer `mail.removeEml`: gehoert die .eml am Konventionspfad zu dieser Notiz? Gelesen
 * wird nur der Message-ID-Kopf (dasselbe Muster wie der Abgleich im Sync, `messageIdFromHeader`),
 * kein `parseEml` — bei Hunderten von Notizen mit Anhaengen waere der volle Parse der Preis fuer
 * eine einzige Frage. `undefined`, wenn keine Datei dort liegt.
 */
export async function probeEml(app: App, profile: MailProfile, notePath: string, mailId: string): Promise<MailNoteRef["eml"]> {
  const path = emlPathFor(profile, notePath);
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  if (!(file instanceof TFile)) return undefined;
  let head: Uint8Array;
  try {
    head = new Uint8Array(await app.vault.readBinary(file)).subarray(0, HEAD_BYTES);
  } catch {
    return { path, status: "unreadable" };
  }
  // Nur der Kopfblock: eine Message-ID, die erst im Text steht, ist keine.
  const text = new TextDecoder().decode(head);
  const end = /\r?\n\r?\n/.exec(text);
  const block = end ? text.slice(0, end.index) : text;
  const found = messageIdFromHeader(new TextEncoder().encode(block));
  if (found === null) return { path, status: "unreadable" };
  return { path, status: found === (normalizeMessageId(mailId) ?? mailId) ? "match" : "mismatch" };
}
