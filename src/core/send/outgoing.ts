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

export type OutgoingValidation = { ok: true } | { ok: false; code: "no-recipients" | "empty-subject" | "invalid-address" };

const ADDR = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function validateOutgoing(msg: OutgoingMessage): OutgoingValidation {
  const all = [...msg.to, ...(msg.cc ?? []), ...(msg.bcc ?? [])];
  if (all.length === 0) return { ok: false, code: "no-recipients" };
  if (!msg.subject.trim()) return { ok: false, code: "empty-subject" };
  if (all.some((a) => !ADDR.test(a))) return { ok: false, code: "invalid-address" };
  return { ok: true };
}
