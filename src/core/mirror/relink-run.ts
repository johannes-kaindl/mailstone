// Nachverlinken nach einem Sync-Lauf (Vorspann zu A3, Welle 36; Entscheidung Johannes 2026-11-18).
//
// Merge-Regel 5 (Spec § 2.2) sagt: der Sync legt nur Neues an und setzt mail_state. Eine Ausnahme,
// eng gefasst: legt ein Lauf eine Notiz an, ersetzt er in BESTEHENDEN Mail-Notizen die rohe ID
// dieser Mail in `in_reply_to` und `references` durch den Wikilink. Nur diese zwei Felder, nur IDs
// von Notizen, die DIESER Lauf angelegt hat, nie die Zone, nie ein Selbstverweis, keine Vorschau.
// Der Weg ist der von `mail.relink` (`relinkNotePlan`): zeilenweise ins Frontmatter, gespeicherter
// Zone-Hash bleibt.
import { relinkNotePlan, relinkValues } from "../commands/relink";
import type { MailNoteRef } from "../commands/types";
import { fmKeyFor, type MailProfile } from "./profile";
import type { NotePlan } from "./plan";

/** Eine bestehende Mail-Notiz, wie sie der Metadata-Cache kennt: billig zu haben, ohne den Inhalt. */
export interface RelinkHead { mailId: string; path: string; frontmatter: Record<string, unknown> }

export interface RelinkRunDeps {
  /** Alle bestehenden Mail-Notizen (Frontmatter aus dem Metadata-Cache). */
  heads(): readonly RelinkHead[];
  /** Inhalt und gespeicherter Zone-Hash einer Notiz; `null`, wenn die Datei nicht mehr da ist. */
  read(path: string): Promise<{ content: string; zoneHash: string | null } | null>;
}

/**
 * Plant das Nachverlinken. `created` bildet die Mail-ID jeder in DIESEM Lauf angelegten Notiz auf
 * ihren Pfad ohne `.md` ab. Gelesen wird nur, was einen Treffer hat: ohne rohe ID aus `created`
 * kostet eine Notiz keinen Dateizugriff. Eine Notiz, die sich nicht lesen laesst, zaehlt als Fehler
 * und haelt die anderen nicht auf.
 */
export async function planRunRelinks(
  profile: MailProfile,
  created: ReadonlyMap<string, string>,
  deps: RelinkRunDeps,
): Promise<{ plans: NotePlan[]; errors: number }> {
  const keys = [fmKeyFor(profile, "in_reply_to"), fmKeyFor(profile, "references")].filter((k): k is string => k !== null);
  const plans: NotePlan[] = [];
  let errors = 0;
  if (keys.length === 0 || created.size === 0) return { plans, errors };
  const linkFor = (id: string): string | null => created.get(id) ?? null;
  for (const head of deps.heads()) {
    // Notizen dieses Laufs sind schon beim Rendern verlinkt worden (assignRunPaths).
    if (created.has(head.mailId)) continue;
    if (!relinkValues(head.frontmatter, keys, (id) => (id === head.mailId ? null : linkFor(id)))) continue;
    try {
      const file = await deps.read(head.path);
      if (!file) continue;
      const ref: MailNoteRef = { mailId: head.mailId, path: head.path, content: file.content, frontmatter: head.frontmatter, zoneHash: file.zoneHash };
      const r = relinkNotePlan(ref, keys, linkFor);
      if (r) plans.push(r.note);
    } catch {
      errors += 1;
    }
  }
  return { plans, errors };
}
