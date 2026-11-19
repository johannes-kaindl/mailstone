// Die Vorgaengerin einer neuen Mail (E24, Welle 36): die Notiz, deren Vorgangswert die neue Notiz
// beim Anlegen uebernimmt. Gemeinsam fuer den Vorgangswert (A3) und das Erben von Feldern (A2).
import { compareDated, type Dated } from "./order";
import { tokenOf, type Subjected } from "./token";

export interface PredecessorMail extends Dated, Subjected {
  inReplyTo: string | null;
  references: readonly string[];
}

export interface PredecessorLookup {
  /** Gibt es eine Notiz (im Vault oder im selben Lauf) zu dieser Mail-ID? */
  has(mailId: string): boolean;
  /** Die juengste Notiz mit derselben Kennung im Betreff, die FRUEHER ist als `mail` (nie `mail` selbst):
   *  eine Mail zeigt nie auf eine spaetere, damit im selben Lauf kein Kreis entsteht. */
  newestWithTokenBefore(token: string, mail: Dated): string | null;
}

export function buildPredecessorLookup(nodes: readonly PredecessorMail[], tokenPattern: RegExp | null): PredecessorLookup {
  const ids = new Set<string>();
  const byToken = new Map<string, Dated[]>();
  for (const n of nodes) {
    ids.add(n.mailId);
    const token = tokenOf(n, tokenPattern);
    if (token === null) continue;
    const list = byToken.get(token);
    if (list) list.push(n); else byToken.set(token, [n]);
  }
  return {
    has: (id) => ids.has(id),
    newestWithTokenBefore: (token, mail) => {
      let best: Dated | null = null;
      for (const c of byToken.get(token) ?? []) {
        if (c.mailId === mail.mailId || compareDated(c, mail) >= 0) continue;
        if (best === null || compareDated(c, best) > 0) best = c;
      }
      return best?.mailId ?? null;
    },
  };
}

/**
 * Die Vorgaengerin: die Notiz aus `in_reply_to`, sonst die zuletzt genannte vorhandene aus `references`, sonst bei
 * gesetzter Kennung die juengste fruehere Notiz mit derselben Kennung im Betreff. Header haben Vorrang. `null`, wenn es
 * keine gibt. Nie die Mail selbst.
 */
export function predecessorOf(mail: PredecessorMail, lookup: PredecessorLookup, tokenPattern: RegExp | null): string | null {
  if (mail.inReplyTo && mail.inReplyTo !== mail.mailId && lookup.has(mail.inReplyTo)) return mail.inReplyTo;
  for (let i = mail.references.length - 1; i >= 0; i--) {
    const id = mail.references[i]!;
    if (id !== mail.mailId && lookup.has(id)) return id;
  }
  const token = tokenOf(mail, tokenPattern);
  return token === null ? null : lookup.newestWithTokenBefore(token, mail);
}
