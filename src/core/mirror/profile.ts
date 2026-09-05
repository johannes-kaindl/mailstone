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
 *  kein Allokations-Rauschen im haeufigen Fall).
 *
 *  Zwei verschiedene Kollisionen, zwei verschiedene Stellen:
 *  1. Preset gegen `profile.onCreate` selbst (z. B. beide setzen `type`) — entscheidet DIESE
 *     Funktion, `{...taskPreset, ...profile.onCreate}`: das Profil traegt strukturelle Marker,
 *     das Preset ist Nutzer-Freitext, im Zweifel gewinnt die Struktur.
 *  2. Preset gegen ein VERWALTETES Feld (`mail_id`, `subject`, … — `managedKeys()`) — das
 *     entscheidet NICHT hier, sondern `newNote()`s `{...onCreate, ...derived}` (merge.ts):
 *     `derived` gewinnt, das Preset-Feld wird an dieser Stelle still verworfen. Sicher (kein
 *     verwaltetes Feld wird ueberschrieben), aber wenn diese Spread-Reihenfolge je gedreht
 *     wuerde, waere das ein stiller Datenschaden an `mail_id` & Co. — bewacht von
 *     `tests/core/mirror/plan.test.ts` ("Preset gegen ein verwaltetes Feld: das verwaltete
 *     Feld gewinnt"). */
/** Ein Eintrag mit leerem Wert ("") ist noch nicht konfiguriert — `addTaskPresetEntry`
 *  (settings-tab.ts) legt eine neue Zeile genau so an (Platzhalter-Schluessel, leerer Wert),
 *  und ohne diesen Filter bekaeme jede neu angelegte Mail-Notiz ab dem Klick auf "Feld
 *  hinzufuegen" ein leeres Frontmatter-Feld, bevor der Nutzer ueberhaupt einen Wert eingegeben
 *  hat (Fix-Runde 2, Punkt 6). Ein bewusst leerer String als WERT eines fertig benannten
 *  Presets ist damit nicht darstellbar — das war vor dieser Zeile ohnehin schon der einzige
 *  Weg, ein Preset "abzuschalten", ohne die Zeile zu loeschen. */
export function withTaskPreset(profile: MailProfile, taskPreset: Record<string, FmVal>): MailProfile {
  const configured = Object.fromEntries(Object.entries(taskPreset).filter(([, v]) => v !== ""));
  if (Object.keys(configured).length === 0) return profile;
  return { ...profile, onCreate: { ...configured, ...profile.onCreate } };
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
