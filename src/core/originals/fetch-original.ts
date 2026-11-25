// Das Original einer Mail per Message-ID vom Server holen, wenn die .eml neben der Notiz fehlt
// (A6, Welle 36). Rein lesend: EXAMINE, UID SEARCH HEADER, BODY.PEEK[] (uidFetchBody), nie
// SELECT, nie ein Fetch ohne .PEEK (.claude/rules/imap-vertrag.md). Netz und Konten kommen als
// Deps aus der Obsidian-Schicht.
import type { ImapErrorCode } from "../imap/types";
import type { ImapReadSession } from "../imap/client";
import { isSearchableValue } from "../imap/commands";
import { NetError } from "../net/types";
import { verifyEml } from "../commands/eml";
import { parseEml } from "../mime/parse";
import type { BusyGuard } from "../../vendor/code-kit/busy-guard";
import { errorMessage } from "../../vendor/kit/error-message";

/** Wie viele Treffer je Ordner hoechstens geholt werden. Die Suche ist ein Teilstring-Treffer
 *  (`a@x` trifft auch `aa@x`); fuenf reichen fuer jede echte Mehrdeutigkeit und begrenzen, was
 *  ein Ordner voller Beinahe-Treffer kostet. */
export const MAX_CANDIDATES_PER_FOLDER = 5;

export interface OriginalAccount {
  id: string;
  /** Anzeigename fuer die Liste der durchsuchten Ordner. */
  label: string;
  folders: { allowlist: string; archive: string };
}

export type OriginalConnect =
  | { ok: true; session: ImapReadSession }
  | { ok: false; code: ImapErrorCode | "no-secret"; detail: string };

export interface FetchOriginalDeps {
  accounts(): readonly OriginalAccount[];
  /** Eine kurze eigene Verbindung je Konto, lesend (`imapConnect`, nie `imapConnectWritable`). */
  connect(account: OriginalAccount): Promise<OriginalConnect>;
  /** Derselbe Guard wie Sync und Posteingang (`fetch.ts`): ein Lauf zur Zeit. */
  busy: BusyGuard;
}

export interface FetchOriginalRequest {
  mailId: string;
  /** `mail_source` der Notiz: `<accountId>/<ordner>` oder `import/<ordner>`; leer, wenn unbekannt. */
  source: string;
}

export type FetchOriginalCode = "busy" | "original-not-found" | "original-unsearchable" | "no-secret" | ImapErrorCode;

export type FetchOriginalResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; code: FetchOriginalCode; detail: string };

interface Target { account: OriginalAccount; folders: string[] }

/** Wen und wo: das Konto aus `source` (sonst alle Konten, auch bei `import/…`, das ein
 *  Vault-Ordner ist und kein Serverordner), je Konto die Ordnerfolge Quellordner, Allowlist,
 *  Archiv ohne leere und doppelte. */
function targetsFor(accounts: readonly OriginalAccount[], source: string): Target[] {
  const own = source.startsWith("import/")
    ? undefined
    : accounts.find((a) => source.startsWith(`${a.id}/`));
  const sourceFolder = own ? source.slice(own.id.length + 1) : "";
  const list = own ? [own] : accounts;
  return list.map((account) => {
    const folders: string[] = [];
    for (const f of [own ? sourceFolder : "", account.folders.allowlist, account.folders.archive]) {
      if (f !== "" && !folders.includes(f)) folders.push(f);
    }
    return { account, folders };
  });
}

export async function fetchOriginal(deps: FetchOriginalDeps, req: FetchOriginalRequest): Promise<FetchOriginalResult> {
  // Eine Ersatz-ID (`noid-…`, kein Message-ID-Header) und ein Wert, den SEARCH nicht tragen darf,
  // sind auf dem Server nicht auffindbar. Eigener Code, damit der Nutzer nicht liest, die Mail
  // sei "nicht gefunden", obwohl gar nicht gesucht wurde.
  if (req.mailId.startsWith("noid-") || !isSearchableValue(req.mailId)) {
    return { ok: false, code: "original-unsearchable", detail: req.mailId };
  }
  if (!deps.busy.tryAcquire()) return { ok: false, code: "busy", detail: "ein anderer Vorgang laeuft" };
  try {
    const errors: { code: FetchOriginalCode; detail: string }[] = [];
    const searched: string[] = [];
    for (const { account, folders } of targetsFor(deps.accounts(), req.source)) {
      if (folders.length === 0) continue;
      const verbunden = await deps.connect(account);
      if (!verbunden.ok) { errors.push({ code: verbunden.code, detail: verbunden.detail }); continue; }
      const session = verbunden.session;
      try {
        for (const folder of folders) {
          const geoeffnet = await session.examine(folder);
          if (!geoeffnet.ok) {
            // Ein Ordner, den es nicht gibt, ist kein Fehler der Suche (das Archiv ist
            // konfiguriert, aber nie angelegt worden); jeder andere Fehler hindert sie.
            if (geoeffnet.code !== "folder-missing") errors.push({ code: geoeffnet.code, detail: geoeffnet.detail });
            continue;
          }
          searched.push(`${account.label}: ${folder}`);
          const uids = await session.uidSearchHeader("Message-ID", req.mailId);
          // Die neuesten zuerst: eine zurueckkopierte Mail liegt mit hoeherer UID erneut im Ordner.
          for (const uid of [...uids].sort((a, b) => b - a).slice(0, MAX_CANDIDATES_PER_FOLDER)) {
            const bytes = await session.uidFetchBody(uid);
            if (!bytes) continue;
            try {
              if (verifyEml(await parseEml(bytes), req.mailId).ok) return { ok: true, bytes };
            } catch { /* nicht lesbar: kein Kandidat */ }
          }
        }
      } catch (e) {
        errors.push({ code: e instanceof NetError ? e.code : "protocol", detail: errorMessage(e) });
      } finally {
        await session.logout().catch(() => undefined);
      }
    }
    // Ein Fehler vor "nicht gefunden": ein unerreichbares Konto kann das Original halten, "nicht
    // gefunden" wuerde das als Befund ausgeben.
    const erster = errors[0];
    if (erster) return { ok: false, code: erster.code, detail: erster.detail };
    return { ok: false, code: "original-not-found", detail: searched.join(", ") || "–" };
  } finally {
    deps.busy.release();
  }
}
