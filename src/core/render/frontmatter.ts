import type { ParsedMail } from "../mime/types";
import { formatAddress } from "../mime/headers";
import { wikilink } from "./wikilink";
import { localDate, localIso, localTime } from "../../vendor/code-kit/local-stamp";
import { fmKeyFor, identityKeys, MAIL_SERVER_FIELDS, type FmVal, type MailProfile, type MailServerField } from "../mirror/profile";

export interface MailFrontmatterInput {
  mail: ParsedMail;
  source: string;
  state: "live" | "detached";
  syncedAt: Date;
  linkFor?: (id: string) => string | null; // Wikilink-Ziel oder null
}

// Bewusst NICHT code-kit `formatBytes`: dessen Basis ist 1000, dieses Format steht persistiert im Frontmatter
// (`attachments`) und wird bei jedem Update verglichen — ein Tausch schriebe jede Mail mit Anhang um (Rundschreiben 1, Welle 22).
function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** `ausgehend`, wenn der Absender eine der eigenen Adressen ist (Gross-/Kleinschreibung und Namensteil egal), sonst `eingehend`.
 *  Nur der Absender zaehlt: eine Mail an die eigene Adresse ist eingehend. Ohne Identitaeten oder ohne Absender: eingehend. */
function directionOf(from: ParsedMail["from"], own: readonly string[] | undefined): "eingehend" | "ausgehend" {
  if (!from || !own) return "eingehend";
  const sender = from.address.trim().toLowerCase();
  return sender !== "" && own.some((a) => a.trim().toLowerCase() === sender) ? "ausgehend" : "eingehend";
}

export function buildDerivedFrontmatter(p: MailProfile, input: MailFrontmatterInput): Record<string, FmVal> {
  const { mail, linkFor } = input;
  // Faellt auf die rohe Message-ID zurueck, wenn es kein Ziel gibt ODER der Zielpfad sich
  // nicht als Wikilink schreiben laesst (M3b-Nachlese, geparkter Befund 1).
  const link = (id: string): string => {
    const t = linkFor?.(id) ?? null;
    return (t === null ? null : wikilink(t)) ?? id;
  };
  const parts = mail.date ? { date: localDate(mail.date), time: localTime(mail.date) } : { date: "", time: "" };
  const values: Record<MailServerField, FmVal> = {
    title: mail.subject,
    date: parts.date,
    time: parts.time,
    from: mail.from ? formatAddress(mail.from) : "",
    to: mail.to.map(formatAddress),
    cc: mail.cc.map(formatAddress),
    subject: mail.subject,
    in_reply_to: mail.inReplyTo ? link(mail.inReplyTo) : "",
    references: mail.references.map(link),
    attachments: mail.attachments.filter((a) => !a.inline).map((a) => `${a.name} (${a.type}, ${humanSize(a.size)})`),
    richtung: directionOf(mail.from, p.ownAddresses),
  };

  const [idK, srcK, stK, syK] = identityKeys(p) as [string, string, string, string];
  const out: Record<string, FmVal> = {
    [idK]: mail.id,
    [srcK]: input.source,
    [stK]: input.state,
    [syK]: localIso(input.syncedAt, { offset: true }),
  };
  for (const f of MAIL_SERVER_FIELDS) {
    const k = fmKeyFor(p, f);
    if (k) out[k] = values[f];
  }
  return out;
}
