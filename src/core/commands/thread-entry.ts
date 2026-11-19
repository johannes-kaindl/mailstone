import { fmKeyFor, type MailProfile } from "../mirror/profile";
import type { ThreadEntry } from "../thread/group";
import { noteSubject } from "../thread/token";
import type { MailNoteRef } from "./types";

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Der Eintrag einer Mail-Notiz fuer die Gruppierung der Vorgaenge (`groupThreads`): Datum und Uhrzeit aus dem
 *  Frontmatter, Verweise von der Obsidian-Schicht schon zu Mail-IDs aufgeloest. */
export function threadEntryOf(profile: MailProfile, ref: MailNoteRef): ThreadEntry {
  const f = (name: "date" | "time"): string => {
    const key = fmKeyFor(profile, name);
    return key === null ? "" : text(ref.frontmatter[key]);
  };
  return {
    mailId: ref.mailId,
    path: ref.path.replace(/\.md$/, ""),
    date: f("date"),
    time: f("time"),
    inReplyTo: ref.thread?.inReplyTo ?? [],
    references: ref.thread?.references ?? [],
    subject: noteSubject(profile, ref.frontmatter),
  };
}
