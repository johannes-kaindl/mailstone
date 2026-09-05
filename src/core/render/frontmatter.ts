import type { ParsedMail } from "../mime/types";
import { formatAddress } from "../mime/headers";
import { wikilink } from "./wikilink";
import { fmKeyFor, identityKeys, MAIL_SERVER_FIELDS, type FmVal, type MailProfile, type MailServerField } from "../mirror/profile";

export interface MailFrontmatterInput {
  mail: ParsedMail;
  source: string;
  state: "live" | "detached";
  syncedAt: Date;
  linkFor?: (id: string) => string | null; // Wikilink-Ziel oder null
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function localDateParts(d: Date): { date: string; time: string } {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** ISO-8601 mit lokalem Offset, z. B. 2026-08-23T15:00:00+02:00 */
export function localIso(d: Date): string {
  const { date, time } = localDateParts(d);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${date}T${time}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function buildDerivedFrontmatter(p: MailProfile, input: MailFrontmatterInput): Record<string, FmVal> {
  const { mail, linkFor } = input;
  // Faellt auf die rohe Message-ID zurueck, wenn es kein Ziel gibt ODER der Zielpfad sich
  // nicht als Wikilink schreiben laesst (M3b-Nachlese, geparkter Befund 1).
  const link = (id: string): string => {
    const t = linkFor?.(id) ?? null;
    return (t === null ? null : wikilink(t)) ?? id;
  };
  const parts = mail.date ? localDateParts(mail.date) : { date: "", time: "" };
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
  };

  const [idK, srcK, stK, syK] = identityKeys(p) as [string, string, string, string];
  const out: Record<string, FmVal> = {
    [idK]: mail.id,
    [srcK]: input.source,
    [stK]: input.state,
    [syK]: localIso(input.syncedAt),
  };
  for (const f of MAIL_SERVER_FIELDS) {
    const k = fmKeyFor(p, f);
    if (k) out[k] = values[f];
  }
  return out;
}
