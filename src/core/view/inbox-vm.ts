import type { ImapHeaderRow } from "../imap/client";
import { normalizeMessageId } from "../mime/headers";
import { parseEml } from "../mime/parse";

export type InboxState = "leer" | "laedt" | "fehler" | "gefuellt";

export interface InboxRow {
  uid: number;
  /** Anzeigename des Absenders, ersatzweise seine Adresse. */
  from: string;
  subject: string;
  /** ISO-Zeitstempel; leer, wenn die Mail kein lesbares Datum traegt. */
  date: string;
  /** Die Mail liegt bereits als Notiz im Vault (exakter Message-ID-Treffer). */
  imVault: boolean;
  ungelesen: boolean;
}

export interface InboxInput {
  zustand: "laedt" | "fehler" | "bereit";
  rows: readonly InboxRow[];
  fehlerCode: string | null;
  /** Server kuendigt MOVE an — ohne das gibt es keinen sicheren Weg (Spec § 3d). */
  kannVerschieben: boolean;
  busy: boolean;
}

export interface InboxViewModel {
  state: InboxState;
  rows: readonly InboxRow[];
  fehlerCode: string | null;
  aktionenAktiv: boolean;
}

/**
 * Ein FETCH-Ergebnis wird zur Anzeigezeile. Der Header-Block geht durch denselben Parser
 * wie eine vollstaendige .eml — postal-mime kommt mit einem Block ohne Body zurecht, und
 * damit gilt fuer Betreff, Absender und Message-ID exakt dieselbe Auslegung wie im
 * Sync-Pfad. Ein zweiter, eigener Header-Parser waere eine zweite Wahrheit.
 */
export async function toInboxRow(row: ImapHeaderRow, bekannteIds: ReadonlySet<string>): Promise<InboxRow> {
  const mail = await parseEml(row.header);
  // Beide Seiten normalisieren: der Index kann Rohformen aus aelteren Staenden tragen.
  const bekannt = new Set([...bekannteIds].map((v) => normalizeMessageId(v)).filter((v): v is string => v !== null));
  return {
    uid: row.uid,
    from: mail.from?.name !== undefined && mail.from.name.length > 0 ? mail.from.name : (mail.from?.address ?? ""),
    subject: mail.subject,
    // `ParsedMail.date` ist ein Date, kein String. Die Zeile traegt einen ISO-String, damit das
    // ViewModel anzeigefertig und vergleichbar bleibt und kein Date durch die reine Schicht wandert.
    date: mail.date === null ? "" : mail.date.toISOString(),
    // Kein Null-Check: `id` ist immer gesetzt — fehlt der Header, erzeugt der Parser
    // `noid-<sha256[:32]>`, und so eine synthetische Id trifft nie einen Index-Eintrag.
    imVault: bekannt.has(mail.id),
    ungelesen: !row.flags.includes("\\Seen"),
  };
}

export function buildInboxViewModel(input: InboxInput): InboxViewModel {
  const state: InboxState =
    input.zustand === "laedt" ? "laedt"
    : input.zustand === "fehler" ? "fehler"
    : input.rows.length === 0 ? "leer"
    : "gefuellt";
  return {
    state,
    rows: input.rows,
    fehlerCode: input.zustand === "fehler" ? input.fehlerCode : null,
    aktionenAktiv: state === "gefuellt" && input.kannVerschieben && !input.busy,
  };
}
