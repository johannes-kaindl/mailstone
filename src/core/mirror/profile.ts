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

/** M5 Task 7: `taskPreset` (Settings, ausserhalb der MailProfile) fliesst additiv in
 *  `onCreate` ein — dieselbe Zusage, die `onCreate` schon fuer sich traegt, gilt dann auch
 *  fuer das Preset: `newNote()` (merge.ts) wendet `onCreate` NUR im create-Zweig an, nie beim
 *  Merge einer bestehenden Notiz. Ein leeres Preset aendert nichts (identisches Objekt zurueck,
 *  kein Allokations-Rauschen im haeufigen Fall). Kollisionen entscheidet `onCreate`: das
 *  Profil traegt strukturelle Marker (z. B. `type: "mail"`), das Preset ist Nutzer-Freitext —
 *  im Zweifel gewinnt die Struktur. */
export function withTaskPreset(profile: MailProfile, taskPreset: Record<string, FmVal>): MailProfile {
  if (Object.keys(taskPreset).length === 0) return profile;
  return { ...profile, onCreate: { ...taskPreset, ...profile.onCreate } };
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
