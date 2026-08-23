export type FmVal = string | number | boolean | string[];
export const MAIL_SERVER_FIELDS = ["title", "date", "time", "from", "to", "cc", "subject", "in_reply_to", "references", "attachments"] as const;
export type MailServerField = (typeof MAIL_SERVER_FIELDS)[number];

export interface MailProfile {
  id: string;
  name: string;
  folder: string; // Default "Mail"; Jahr wird als Unterordner angehaengt (yearSubfolder)
  yearSubfolder: boolean; // Default true
  emlSubfolder: string; // Default "_eml"
  filename: string; // Default "{date}-{time}-{slug}"
  idField: string;
  sourceField: string;
  stateField: string;
  syncedField: string; // "mail_id","mail_source","mail_state","mail_synced"
  fields: Record<MailServerField, string | null>;
  onCreate: Record<string, FmVal>; // Default { type: "mail" }
}

export function defaultMailProfile(): MailProfile {
  return {
    id: "default-mail",
    name: "Mail (default)",
    folder: "Mail",
    yearSubfolder: true,
    emlSubfolder: "_eml",
    filename: "{date}-{time}-{slug}",
    idField: "mail_id",
    sourceField: "mail_source",
    stateField: "mail_state",
    syncedField: "mail_synced",
    fields: {
      title: "title",
      date: "date",
      time: "time",
      from: "from",
      to: "to",
      cc: "cc",
      subject: "subject",
      in_reply_to: "in_reply_to",
      references: "references",
      attachments: "attachments",
    },
    onCreate: { type: "mail" },
  };
}

export function identityKeys(p: MailProfile): string[] {
  return [p.idField, p.sourceField, p.stateField, p.syncedField];
}

export function fmKeyFor(p: MailProfile, f: MailServerField): string | null {
  const v = p.fields[f];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function managedKeys(p: MailProfile): string[] {
  const out = identityKeys(p);
  for (const f of MAIL_SERVER_FIELDS) {
    const k = fmKeyFor(p, f);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}
