import type { ImapConnectResult } from "../imap/client";
import type { BusyGuard } from "../sync/busy";
import { toInboxRow, type InboxRow } from "../view/inbox-vm";
import type { InboxActionCode } from "./actions";

/** Wie viele Nachrichten die Liste hoechstens zeigt. Die neuesten, nicht die ersten —
 *  ein Posteingang waechst hinten. „Mehr laden" ist V1.1 (Spec § 1). */
export const INBOX_LIMIT = 100;

export interface InboxFetchDeps {
  /** Lesende Verbindung — der Posteingang wird mit EXAMINE geoeffnet, nie mit SELECT. */
  connect(): Promise<ImapConnectResult>;
  busy: BusyGuard;
  /** Message-IDs, die bereits als Notiz im Vault liegen. */
  bekannteIds(): ReadonlySet<string>;
}

export interface InboxFetchRequest {
  folder: string;
  limit?: number;
}

export type InboxFetchResult =
  | { ok: true; rows: InboxRow[]; kannVerschieben: boolean }
  | { ok: false; code: InboxActionCode; detail: string };

export async function fetchInbox(deps: InboxFetchDeps, req: InboxFetchRequest): Promise<InboxFetchResult> {
  if (!deps.busy.tryAcquire()) return { ok: false, code: "busy", detail: "ein anderer Vorgang laeuft" };
  try {
    const verbunden = await deps.connect();
    if (!verbunden.ok) return { ok: false, code: verbunden.code, detail: verbunden.detail };
    const session = verbunden.session;
    try {
      const geoeffnet = await session.examine(req.folder);
      if (!geoeffnet.ok) return { ok: false, code: geoeffnet.code, detail: geoeffnet.detail };

      const kannVerschieben = session.capabilities.includes("MOVE");
      const alle = await session.uidSearchAll();
      // Absteigend: die neueste Mail gehoert oben hin. Erst danach kappen — anders herum
      // zeigte die Liste die AELTESTEN 100.
      const neueste = [...alle].sort((a, b) => b - a).slice(0, req.limit ?? INBOX_LIMIT);
      if (neueste.length === 0) return { ok: true, rows: [], kannVerschieben };

      const bekannt = deps.bekannteIds();
      const roh = await session.uidFetchHeaders(neueste);
      const rows: InboxRow[] = [];
      // Reihenfolge kommt aus `neueste`, nicht aus der Map: die Map traegt die
      // Server-Reihenfolge, und die ist nicht zugesichert.
      for (const uid of neueste) {
        const eintrag = roh.get(uid);
        if (eintrag === undefined) continue;
        rows.push(await toInboxRow(eintrag, bekannt));
      }
      return { ok: true, rows, kannVerschieben };
    } finally {
      await session.logout().catch(() => undefined);
    }
  } catch {
    return { ok: false, code: "protocol", detail: "Abruf abgebrochen" };
  } finally {
    deps.busy.release();
  }
}
