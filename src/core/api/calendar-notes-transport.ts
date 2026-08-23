// uebernommen (Typen kopiert) aus calendar-notes/src/core/api/types.ts + src/core/commands/imip.ts, 2026-08-23
// Rueckgabetyp von registerMailTransport 2026-08-23 verschaerft auf { ok: true } | { error: string },
// passend zu calendar-notes/src/core/api/types.ts (dortiger Vertrag lehnt z. B. mit
// { error: "invalid-mail-transport" } ab, statt stillschweigend nichts zurueckzugeben).

export const CALENDAR_NOTES_API_VERSION = 1 as const;

export interface ImipMessage {
  method: "REQUEST" | "CANCEL" | "REPLY";
  from: string;
  to: string[];
  subject: string;
  text: string;
  ics: string;
}

export interface MailTransport {
  id: string;
  label: string;
  accounts(): Promise<{ id: string; address: string; label: string }[]>;
  send(msg: ImipMessage): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }>;
}

export interface CalendarNotesApiSubset {
  version: number;
  registerMailTransport(t: MailTransport): { ok: true } | { error: string };
  unregisterMailTransport(id: string): unknown;
}
