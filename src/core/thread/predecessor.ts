// Die Vorgaengerin einer neuen Mail (E24, Welle 36): die Notiz, deren Vorgangswert die neue Notiz
// beim Anlegen uebernimmt. Gemeinsam fuer den Vorgangswert (A3) und das Erben von Feldern (A2).

export interface PredecessorMail {
  mailId: string;
  inReplyTo: string | null;
  references: readonly string[];
}

export interface PredecessorLookup {
  /** Gibt es eine Notiz (im Vault oder im selben Lauf) zu dieser Mail-ID? */
  has(mailId: string): boolean;
}

export function buildPredecessorLookup(nodes: readonly PredecessorMail[]): PredecessorLookup {
  const ids = new Set(nodes.map((n) => n.mailId));
  return { has: (id) => ids.has(id) };
}

/**
 * Die Vorgaengerin: die Notiz aus `in_reply_to`, sonst die zuletzt genannte vorhandene aus
 * `references`. `null`, wenn es keine gibt. Nie die Mail selbst.
 */
export function predecessorOf(mail: PredecessorMail, lookup: PredecessorLookup): string | null {
  if (mail.inReplyTo && mail.inReplyTo !== mail.mailId && lookup.has(mail.inReplyTo)) return mail.inReplyTo;
  for (let i = mail.references.length - 1; i >= 0; i--) {
    const id = mail.references[i]!;
    if (id !== mail.mailId && lookup.has(id)) return id;
  }
  return null;
}
