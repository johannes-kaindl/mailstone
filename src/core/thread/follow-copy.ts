// Folge-Mails in den Allowlist-Ordner kopieren (A1, Welle 36, Uebernahme; Entscheidung Johannes 2026-11-18).
// Ein Schritt VOR dem normalen Allowlist-Lauf eines Kontos, nur bei eingeschalteter Einstellung `sync.followThreads`:
// die Mails aktiver Vorgaenge aus Posteingang und Gesendet kommen per `UID COPY` in den Allowlist-Ordner, der Sync-Lauf
// danach legt die Notizen an. Der Ordner bleibt die einzige Wahrheit; die Mail bleibt im Posteingang/Gesendet.
//
// Das ist die erste Stelle, an der ein Sync-Lauf OHNE Klick des Nutzers auf dem Server schreibt. Der Vertrag steht in
// `.claude/rules/imap-vertrag.md`: Gefunden und abgeglichen wird lesend (`imapConnect`, EXAMINE, BODY.PEEK); die
// schreibende Verbindung (`imapConnectWritable`) entsteht erst, wenn etwas zu kopieren ist, und kennt nur `examine`
// (kein SELECT: COPY wirkt nach EXAMINE) und `uidCopy`. Der Lese-Sync selbst bekommt sie nie.
import { imapConnect, imapConnectWritable, type ImapConnectOptions, type ImapConnectResult, type ImapConnectWritableResult, type ImapReadSession } from "../imap/client";
import { isSearchableValue } from "../imap/commands";
import { NetError, type SocketTransport } from "../net/types";
import { findFollowUps, type FollowUp } from "./follow";
import type { FollowContext } from "./follow-run";

/** Hoechstens so viele Kopien je Lauf und Konto. Was darueber liegt, holt der naechste Lauf (aelteste zuerst). */
export const MAX_FOLLOW_COPIES_PER_RUN = 50;

export interface FollowCopyFolders { inbox: string; sent: string; allowlist: string }

export interface FollowCopyDeps {
  /** Lesende Verbindung (`imapConnect`): Kandidaten finden und gegen den Allowlist-Ordner abgleichen. */
  connectRead(): Promise<ImapConnectResult>;
  /** Schreibende Verbindung (`imapConnectWritable`); wird nur gerufen, wenn es etwas zu kopieren gibt. */
  connectWrite(): Promise<ImapConnectWritableResult>;
  /** Der Vault-Stand: Vorgaenge und beendete Wurzeln. */
  context(): FollowContext;
  now(): Date;
  log?(line: string): void;
}

export interface FollowCopyResult {
  copied: number;
  /** Abgelehnte oder gescheiterte Schritte (Verbindung, Ordner, COPY-`NO`/`BAD`, Netzfehler). Sie halten den Lauf nicht an. */
  errors: number;
}

/** Verbindet `imapConnect` und `imapConnectWritable` mit einem Transport je Verbindung. Einzige Stelle in `src/core`,
 *  die `imapConnectWritable` aufruft (zu finden mit `grep -n "imapConnectWritable("`). */
export function followCopyConnections(
  transport: () => SocketTransport,
  options: ImapConnectOptions,
): Pick<FollowCopyDeps, "connectRead" | "connectWrite"> {
  return {
    connectRead: () => imapConnect(transport(), options),
    connectWrite: () => imapConnectWritable(transport(), options),
  };
}

/** Ist die Mail schon im Allowlist-Ordner (die Sitzung hat ihn geoeffnet)? SEARCH HEADER ist ein Teilstring-Treffer, also
 *  zaehlt nur eine Message-ID, die genau gleich ist. */
async function onAllowlist(session: ImapReadSession, mailId: string): Promise<boolean> {
  const hits = await session.uidSearchHeader("Message-ID", mailId);
  if (hits.length === 0) return false;
  for (const id of (await session.uidFetchMessageIds(hits)).values()) if (id === mailId) return true;
  return false;
}

export async function copyFollowUps(deps: FollowCopyDeps, folders: FollowCopyFolders): Promise<FollowCopyResult> {
  let errors = 0;
  let toCopy: FollowUp[] = [];
  const validity = new Map<string, number>();

  // 1. Lesend: Kandidaten finden und gegen den Allowlist-Ordner abgleichen.
  const read = await deps.connectRead();
  if (!read.ok) return { copied: 0, errors: 1 };
  try {
    const { index, stopped } = deps.context();
    const found = await findFollowUps(read.session, { folders: [folders.inbox, folders.sent], now: deps.now(), index, stopped });
    errors += found.problems.length;
    for (const [folder, v] of found.validity) validity.set(folder, v);

    // Aus dem Allowlist-Ordner kopiert man nicht in ihn selbst. Eine Mail ohne Message-ID (`noid-…`) oder mit einer ID, die
    // SEARCH nicht tragen darf, liesse sich nicht auf Doppel pruefen: sie wird nicht kopiert. Dieselbe Mail in zwei Ordnern
    // (an sich selbst gesendet) zaehlt einmal.
    const seen = new Set<string>();
    const candidates = found.followUps.filter((f) => {
      if (f.folder === folders.allowlist || f.mailId.startsWith("noid-") || !isSearchableValue(f.mailId) || seen.has(f.mailId)) return false;
      seen.add(f.mailId);
      return true;
    });

    if (candidates.length > 0) {
      const opened = await read.session.examine(folders.allowlist);
      if (!opened.ok) {
        // Der Allowlist-Ordner fehlt: kopiert wird nichts; der Lauf danach meldet den fehlenden Ordner selbst.
        errors += 1;
      } else {
        for (const c of candidates) {
          if (toCopy.length >= MAX_FOLLOW_COPIES_PER_RUN) break;
          if (!(await onAllowlist(read.session, c.mailId))) toCopy.push(c);
        }
      }
    }
  } catch (e) {
    if (!(e instanceof NetError)) throw e;
    errors += 1;
    toCopy = [];
  } finally {
    await read.session.logout().catch(() => undefined);
  }
  if (toCopy.length === 0) return { copied: 0, errors };

  // 2. Schreibend: nur hier, nur mit etwas zu kopieren.
  const write = await deps.connectWrite();
  if (!write.ok) return { copied: 0, errors: errors + 1 };
  let copied = 0;
  let left = toCopy.length;
  let current = "";
  let usable = false;
  try {
    // In der Reihenfolge der Mails (aelteste zuerst), damit die Kopien im Allowlist-Ordner in Vorgangsreihenfolge ankommen;
    // der Ordner wird nur gewechselt, wenn die Mail aus einem anderen kommt.
    for (const f of toCopy) {
      if (f.folder !== current) {
        const opened = await write.session.examine(f.folder);
        current = f.folder;
        // Die UIDs stammen aus der lesenden Sitzung. Hat der Ordner seine UIDVALIDITY gewechselt, meinen sie andere Mails.
        usable = opened.ok && opened.uidValidity === validity.get(f.folder);
      }
      if (!usable) { errors += 1; left -= 1; continue; }
      const r = await write.session.uidCopy(f.uid, folders.allowlist);
      left -= 1; // erst nach der Antwort: wirft uidCopy, zaehlt diese Mail im catch unten noch zu den nicht versuchten
      if (r.ok) copied += 1;
      else if (r.code !== "gone") { errors += 1; deps.log?.(`follow-copy: ${f.folder} UID ${String(f.uid)}: ${r.detail}`); }
    }
  } catch (e) {
    if (!(e instanceof NetError)) throw e;
    errors += left; // die Verbindung ist weg: der Rest wird nicht mehr versucht
    deps.log?.(`follow-copy: ${e.message}`);
  } finally {
    await write.session.logout().catch(() => undefined);
  }
  deps.log?.(`follow-copy: ${String(copied)} Mail(s) in ${folders.allowlist} kopiert`);
  return { copied, errors };
}
