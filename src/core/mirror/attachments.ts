// Anhaenge beim Anlegen einer Notiz (A6, Teil Anhaenge): ein create-Plan traegt die echten (nicht inline) Anhaenge als zusaetzliche
// Binaerdateien und verlinkt sie im freien Bereich vor der Zone. Die Pfade loest die Obsidian-Schicht VOR dem Planen auf
// (`AttachmentResolver`, `getAvailablePathForAttachment` ist async, die Planung rein und synchron).
import { attachmentLink, insertAttachmentLink } from "../commands/extract";
import type { ParsedMail } from "../mime/types";
import { mailFilename, mailFolder } from "../render/filename";
import type { MailProfile } from "./profile";

/** Wohin ein Anhang kommt. `write: false`: dort liegt schon eine byte-gleiche Datei, sie wird nur verlinkt. */
export interface AttachmentTarget { path: string; write: boolean }
/** Ziele einer Mail, je `MailAttachmentMeta.key` (nie je Name: zwei Anhaenge koennen gleich heissen). */
export type AttachmentTargets = ReadonlyMap<string, AttachmentTarget>;
/** Loest die Ziele einer Mail auf. `notePath` ist der Pfad der kuenftigen Notiz (der Anhangordner kann relativ zu ihr sein).
 *  Ein Resolver gehoert zu EINEM Lauf: er merkt sich, was dieser Lauf schon vergeben hat. */
export type AttachmentResolver = (mail: ParsedMail, notePath: string) => Promise<AttachmentTargets>;

export interface PlannedAttachment { path: string; data: Uint8Array }

/** Byte-Gleichheit zweier Dateien (voller Vergleich, kein Hash: beide liegen ohnehin im Speicher). */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Setzt die Links der Anhaenge in den freien Bereich vor der Zone und liefert die Dateien, die zu schreiben sind.
 *  Ein Anhang ohne Ziel oder ohne Bytes bleibt unberuehrt; fehlt die Zone, bleibt der Inhalt unveraendert. */
export function applyAttachmentTargets(content: string, mail: ParsedMail, targets: AttachmentTargets): { content: string; writes: PlannedAttachment[] } {
  let out = content;
  const writes: PlannedAttachment[] = [];
  for (const meta of mail.attachments) {
    if (meta.inline) continue;
    const target = targets.get(meta.key);
    const data = mail.attachmentData.get(meta.key);
    if (!target || !data) continue;
    const ins = insertAttachmentLink(out, attachmentLink(target.path, meta.type));
    if (ins.ok) out = ins.content;
    else if (ins.code === "fences-missing") continue;
    if (target.write && !writes.some((w) => w.path === target.path)) writes.push({ path: target.path, data });
  }
  return { content: out, writes };
}

/** Der Pfad, den die Notiz dieser Mail haben wird, soweit der Anhangordner ihn braucht (Ordner und Dateiname; ein Zaehlersuffix bei
 *  Kollision aendert den Ordner nicht). Vergeben wird der echte Pfad erst bei der Planung. */
export function notePathFor(profile: MailProfile, mail: ParsedMail): string {
  return `${mailFolder(profile, mail)}/${mailFilename(profile, mail)}.md`;
}
