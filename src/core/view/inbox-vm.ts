import type { ImapHeaderRow } from "../imap/client";
import { normalizeMessageId } from "../mime/headers";
import { parseEml } from "../mime/parse";

export type InboxState = "leer" | "laedt" | "fehler" | "gefuellt";

export interface InboxRow {
  uid: number;
  /** Message-ID der Mail (roh, wie `parseEml` sie liefert) — der Schluessel, unter dem der
   *  Notiz-Index die entstehende Notiz fuehrt (Task 6: Posteingangs-Weg zu einer Aufgabe). */
  mailId: string;
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

/** Grund, warum die Zeilen-Aktionen gesperrt sind — der Nutzer bekommt ihn als Tooltip zu
 *  sehen (Spec § 3d), statt dass die Knoepfe wortlos verschwinden (Befund I6). `null` heisst
 *  aktiv. */
export type InboxAktionenGrund = "unsupported" | "busy" | null;

export interface InboxViewModel {
  state: InboxState;
  rows: readonly InboxRow[];
  fehlerCode: string | null;
  aktionenGrund: InboxAktionenGrund;
}

/**
 * Ein FETCH-Ergebnis wird zur Anzeigezeile. Der Header-Block geht durch denselben Parser
 * wie eine vollstaendige .eml — postal-mime kommt mit einem Block ohne Body zurecht, und
 * damit gilt fuer Betreff, Absender und Message-ID exakt dieselbe Auslegung wie im
 * Sync-Pfad. Ein zweiter, eigener Header-Parser waere eine zweite Wahrheit.
 */
export async function toInboxRow(row: ImapHeaderRow, bekannteIds: ReadonlySet<string>): Promise<InboxRow> {
  const mail = await parseEml(row.header);
  return {
    uid: row.uid,
    mailId: mail.id,
    from: mail.from?.name !== undefined && mail.from.name.length > 0 ? mail.from.name : (mail.from?.address ?? ""),
    subject: mail.subject,
    // `ParsedMail.date` ist ein Date, kein String. Die Zeile traegt einen ISO-String, damit das
    // ViewModel anzeigefertig und vergleichbar bleibt und kein Date durch die reine Schicht wandert.
    date: mail.date === null ? "" : mail.date.toISOString(),
    // Kein Null-Check: `id` ist immer gesetzt — fehlt der Header, erzeugt der Parser
    // `noid-<sha256[:32]>`, und so eine synthetische Id trifft nie einen Index-Eintrag.
    imVault: bekannteIds.has(mail.id),
    // RFC 3501: Flag-Namen sind case-insensitiv. Ein Server, der `\SEEN` statt `\Seen` sendet,
    // liesse ohne `.toLowerCase()` jede gelesene Mail als ungelesen erscheinen.
    ungelesen: !row.flags.some((f) => f.toLowerCase() === "\\seen"),
  };
}

/** Normalisiert den Vault-Index EINMAL fuer den ganzen Abruf, nicht pro Zeile — `toInboxRow`
 *  lief bisher selbst hundertfach ueber denselben Index (`fetch.ts` ruft es je UID einmal in
 *  einer Schleife; bei 5000 Notizen 500 000 Regex-Laeufe auf dem UI-Thread fuer einen einzigen
 *  Abruf, Kleinbefund im Abschluss-Review). Beide Seiten normalisieren: der Index kann Rohformen
 *  aus aelteren Staenden tragen. */
export function normalizeKnownIds(bekannteIds: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...bekannteIds].map((v) => normalizeMessageId(v)).filter((v): v is string => v !== null));
}

export function buildInboxViewModel(input: InboxInput): InboxViewModel {
  const state: InboxState =
    input.zustand === "laedt" ? "laedt"
    : input.zustand === "fehler" ? "fehler"
    : input.rows.length === 0 ? "leer"
    : "gefuellt";
  // I6: der Grund statt eines Bools — das Panel zeichnet die Knoepfe IMMER und traegt den
  // Grund als Tooltip, statt sie wortlos verschwinden zu lassen (Spec § 3d). `unsupported`
  // vor `busy`: kein MOVE ist ein dauerhafter Server-Zustand, `busy` geht vorueber — bei
  // beidem gleichzeitig ist die dauerhafte Ursache die aussagekraeftigere.
  const aktionenGrund: InboxAktionenGrund =
    state !== "gefuellt" ? null
    : !input.kannVerschieben ? "unsupported"
    : input.busy ? "busy"
    : null;
  return {
    state,
    rows: input.rows,
    fehlerCode: input.zustand === "fehler" ? input.fehlerCode : null,
    aktionenGrund,
  };
}
