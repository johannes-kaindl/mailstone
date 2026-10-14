export interface OutgoingMessage {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  calendar?: { method: "REQUEST" | "CANCEL" | "REPLY"; ics: string };
  attachments?: { name: string; type: string; data: Uint8Array }[];
  inReplyTo?: string;
  references?: string[];
}

export interface Sender {
  address: string;
  name: string;
}

export type OutgoingValidation = { ok: true } | { ok: false; code: "no-recipients" | "invalid-address" };

const ADDR = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Grobe, aber strenge Adressgrammatik — dieselbe Regel, die validateOutgoing auf
 *  Empfaenger anwendet. Wird auch von build.ts genutzt, um die Absenderadresse vor dem
 *  Einsetzen in den `From:`-Header zu pruefen (Haertung gegen Header-Injection). */
export function isAddress(s: string): boolean {
  return ADDR.test(s);
}

export function validateOutgoing(msg: OutgoingMessage): OutgoingValidation {
  const all = [...msg.to, ...(msg.cc ?? []), ...(msg.bcc ?? [])];
  if (all.length === 0) return { ok: false, code: "no-recipients" };
  // Ein leerer Betreff ist zulaessig (RFC 5322 verlangt keinen; jedes Mailprogramm sendet ohne) —
  // Entscheidung Johannes 2026-10-13. Unzustellbar macht eine Mail nur eine kaputte Adresse.
  if (all.some((a) => !ADDR.test(a))) return { ok: false, code: "invalid-address" };
  return { ok: true };
}
