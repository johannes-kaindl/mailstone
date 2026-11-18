// „Folge-Mails anzeigen“ (A1, Welle 36): faehrt `findFollowUps` ueber den Posteingang und den Gesendet-Ordner jedes
// Kontos. Lesend (`imapConnect`, nie `imapConnectWritable`; EXAMINE, BODY.PEEK) und ohne Schreibzugriff auf Vault oder
// Server. Belegt den Busy-Guard wie `fetch.ts`; Netz, Konten und Vault-Stand kommen als Deps aus der Obsidian-Schicht.
import type { OriginalConnect } from "../originals/fetch-original";
import { NetError } from "../net/types";
import type { BusyGuard } from "../../vendor/code-kit/busy-guard";
import { findFollowUps, type FollowUp } from "./follow";
import type { ThreadIndex } from "./group";

export interface FollowAccount {
  id: string;
  /** Anzeigename fuer die Liste. */
  label: string;
  folders: { inbox: string; sent: string };
}

/** Was der Lauf vom Vault wissen muss: die Vorgaenge und die beendeten unter ihnen. */
export interface FollowContext {
  index: ThreadIndex;
  stopped: ReadonlySet<string>;
}

export interface FollowRunDeps {
  accounts(): readonly FollowAccount[];
  /** Eine kurze eigene Verbindung je Konto, lesend. */
  connect(account: FollowAccount): Promise<OriginalConnect>;
  busy: BusyGuard;
  /** Der Vault-Stand; wird erst gelesen, wenn der Lauf den Guard hat. */
  context(): FollowContext;
  now(): Date;
}

export interface FollowItem extends FollowUp {
  accountId: string;
  accountLabel: string;
}

export interface FollowRunProblem {
  accountId: string;
  accountLabel: string;
  /** Leer, wenn schon die Verbindung oder ein Netzfehler das Konto betrifft. */
  folder: string;
  /** Netz-/IMAP-Code (`auth`, `timeout`, `folder-missing`, …) oder `no-secret`. */
  code: string;
  detail: string;
}

export type FollowRunResult =
  | { ok: true; items: FollowItem[]; problems: FollowRunProblem[] }
  | { ok: false; code: "busy"; detail: string };

export async function runFollowUps(deps: FollowRunDeps): Promise<FollowRunResult> {
  if (!deps.busy.tryAcquire()) return { ok: false, code: "busy", detail: "ein anderer Vorgang laeuft" };
  try {
    const { index, stopped } = deps.context();
    const now = deps.now();
    const items: FollowItem[] = [];
    const problems: FollowRunProblem[] = [];

    for (const account of deps.accounts()) {
      const who = { accountId: account.id, accountLabel: account.label };
      const connected = await deps.connect(account);
      if (!connected.ok) { problems.push({ ...who, folder: "", code: connected.code, detail: connected.detail }); continue; }
      const session = connected.session;
      try {
        const r = await findFollowUps(session, { folders: [account.folders.inbox, account.folders.sent], now, index, stopped });
        for (const f of r.followUps) items.push({ ...who, ...f });
        for (const p of r.problems) problems.push({ ...who, ...p });
      } catch (e) {
        // Ein Netzfehler eines Kontos haelt die uebrigen nicht auf; ein Programmierfehler schon.
        if (!(e instanceof NetError)) throw e;
        problems.push({ ...who, folder: "", code: e.code, detail: e.message });
      } finally {
        await session.logout().catch(() => undefined);
      }
    }
    return { ok: true, items, problems };
  } finally {
    deps.busy.release();
  }
}
