// Mails auf dem Server finden, die zu einem Vorgang im Vault gehoeren, aber noch keine Notiz haben
// (A1, Welle 36, gemeinsamer Lesepfad). Rein lesend und ohne Schreibzugriff: examine, search since,
// BODY.PEEK-Koepfe. Die Zuordnung laeuft nur ueber Header (`threadOf`); eine Betreff-Kennung gibt es hier noch nicht.
import type { ImapReadSession } from "../imap/client";
import type { ImapErrorCode } from "../imap/types";
import { parseEml } from "../mime/parse";
import { threadOf, type ThreadIndex } from "./group";

/** Suchfenster in Tagen. Eine Einstellung wird es erst, wenn die Uebernahme kommt. */
export const FOLLOW_WINDOW_DAYS = 60;
/** Hoechstens so viele Koepfe je Ordner (die neuesten); wie `MAX_HEADER_FETCH_PER_RUN` im Sync. */
export const MAX_FOLLOW_HEADERS = 2000;

/** Genau die Methoden, die dieser Ablauf braucht: lesen, nichts sonst. */
export type FollowSession = Pick<ImapReadSession, "examine" | "uidSearchSince" | "uidFetchThreadHeaders">;

export interface FollowUp {
  folder: string;
  uid: number;
  mailId: string;
  /** Mail-ID der Wurzel des Vorgangs im Vault. */
  root: string;
  subject: string;
  /** ISO-Zeitstempel, leer ohne lesbares Datum. */
  date: string;
}

export interface FollowProblem { folder: string; code: ImapErrorCode; detail: string }

export interface FollowRequest {
  folders: readonly string[];
  now: Date;
  /** Die Vorgaenge im Vault; jede Mail mit Notiz steht darin und gilt als bekannt. */
  index: ThreadIndex;
  /** Wurzeln beendeter Vorgaenge (`mail_follow: false`). */
  stopped: ReadonlySet<string>;
}

export async function findFollowUps(
  session: FollowSession,
  req: FollowRequest,
): Promise<{ followUps: FollowUp[]; problems: FollowProblem[] }> {
  const followUps: FollowUp[] = [];
  const problems: FollowProblem[] = [];
  const since = new Date(req.now.getTime() - FOLLOW_WINDOW_DAYS * 86_400_000);
  const seen = new Set<string>();

  for (const raw of req.folders) {
    const folder = raw.trim();
    if (folder === "" || seen.has(folder)) continue;
    seen.add(folder);

    const opened = await session.examine(folder);
    if (!opened.ok) { problems.push({ folder, code: opened.code, detail: opened.detail }); continue; }

    const found = await session.uidSearchSince(since);
    const newest = [...found].sort((a, b) => b - a).slice(0, MAX_FOLLOW_HEADERS);
    if (newest.length === 0) continue;

    const headers = await session.uidFetchThreadHeaders(newest);
    for (const uid of newest) {
      const bytes = headers.get(uid);
      if (bytes === undefined) continue;
      const mail = await parseEml(bytes);
      if (req.index.rootOf.has(mail.id)) continue; // hat schon eine Notiz
      const root = threadOf({ mailId: mail.id, inReplyTo: mail.inReplyTo, references: mail.references }, req.index);
      if (root === null || req.stopped.has(root)) continue;
      followUps.push({ folder, uid, mailId: mail.id, root, subject: mail.subject, date: mail.date === null ? "" : mail.date.toISOString() });
    }
  }

  // Datum aufsteigend (ohne Datum zuletzt), bei Gleichstand Ordner, dann UID.
  followUps.sort((a, b) => {
    if (a.date !== b.date) return a.date === "" ? 1 : b.date === "" ? -1 : a.date < b.date ? -1 : 1;
    return a.folder !== b.folder ? (a.folder < b.folder ? -1 : 1) : a.uid - b.uid;
  });
  return { followUps, problems };
}
