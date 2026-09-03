import type { ImapConnectResult } from "../imap/client";
import type { BusyGuard } from "../sync/busy";
import { NetError } from "../net/types";
import { normalizeKnownIds, toInboxRow, type InboxRow } from "../view/inbox-vm";
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
  // Kleinbefund (Abschluss-Review): ein nicht konfigurierter Posteingangsordner ist eine
  // Konfigurationsluecke, kein Netzfehler — derselbe Riegel wie `no-target-folder` in
  // actions.ts:37, nur mit dem Empty-State als Ergebnis statt eines Fehlercodes: dieselbe
  // Anzeige, die ein Konto ohne Nachrichten auch bekommt (Spec § 8).
  if (req.folder.length === 0) return { ok: true, rows: [], kannVerschieben: false };
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

      // Kleinbefund: EINMAL pro Abruf normalisieren, nicht pro Zeile — `toInboxRow` normalisierte
      // bisher den gesamten Index bei JEDEM Aufruf in der Schleife unten (bei 5000 Notizen
      // 500 000 Regex-Laeufe auf dem UI-Thread fuer einen einzigen Abruf).
      const bekannt = normalizeKnownIds(deps.bekannteIds());
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
  } catch (e) {
    // I4: derselbe blinde Fleck wie in actions.ts — ein NetError aus `examine`/`uidSearchAll`/
    // `uidFetchHeaders` trug bisher weder seinen Code noch seine Nachricht weiter, sondern
    // wurde pauschal zu "protocol" mit einem generischen Text. Das Muster steht wortgleich in
    // sync/service.ts:249-256.
    const code: InboxActionCode = e instanceof NetError ? e.code : "protocol";
    return { ok: false, code, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    deps.busy.release();
  }
}
