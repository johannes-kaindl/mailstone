// Bildet die iMIP-Schnittstelle (calendar-notes: ImipMessage) auf SendService/OutgoingMessage ab.
// "Transport-ID" ist die Adressierung, die calendar-notes fuer ImipMessage.from nutzt:
// `${account.id}/${identity.id}` — ein Konto kann mehrere Identitaeten (Absenderadressen) haben,
// calendar-notes braucht eine flache Liste einzeln waehlbarer Absender.
import type { Account } from "../settings";
import type { ImipMessage } from "../api/calendar-notes-transport";
import type { OutgoingMessage } from "./outgoing";

export function transportAccounts(accounts: Account[]): { id: string; address: string; label: string }[] {
  const out: { id: string; address: string; label: string }[] = [];
  for (const account of accounts) {
    for (const identity of account.identities) {
      out.push({
        id: `${account.id}/${identity.id}`,
        address: identity.address,
        label: `${identity.name || identity.address} (${account.label})`,
      });
    }
  }
  return out;
}

export function splitTransportId(id: string): { accountId: string; identityId: string } | null {
  const slash = id.indexOf("/");
  if (slash === -1) return null;
  const accountId = id.slice(0, slash);
  const identityId = id.slice(slash + 1);
  if (!accountId || !identityId) return null;
  return { accountId, identityId };
}

export function imipToOutgoing(msg: ImipMessage): { accountId: string; outgoing: OutgoingMessage } | { error: "bad-from" } {
  const split = splitTransportId(msg.from);
  if (!split) return { error: "bad-from" };
  const outgoing: OutgoingMessage = {
    from: split.identityId,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    calendar: { method: msg.method, ics: msg.ics },
  };
  return { accountId: split.accountId, outgoing };
}
