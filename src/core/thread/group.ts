// Gruppierung der Mail-Notizen eines Vaults zu Vorgaengen (A3/A1, Welle 36) — rein, ohne Vault.
//
// Verbunden sind zwei Mails, wenn eine die andere in `in_reply_to` oder `references` nennt oder beide dieselbe
// Kennung im Betreff tragen (`token.ts`). Die Wurzel eines Vorgangs ist seine fruehste Mail. Der Aufrufer
// (die Obsidian-Schicht) hat Wikilinks schon zu Mail-IDs aufgeloest (E6): hier werden IDs verglichen,
// nie Linktexte.
import { compareDated, dateKey } from "./order";
import { tokenOf, type Subjected } from "./token";

export interface ThreadEntry extends Subjected {
  mailId: string;
  /** Pfad der Notiz ohne `.md`. */
  path: string;
  date: string;
  time: string;
  /** Aufgeloeste Mail-IDs aus `in_reply_to` (Wikilinks und rohe IDs). */
  inReplyTo: readonly string[];
  /** Aufgeloeste Mail-IDs aus `references`. */
  references: readonly string[];
}

export interface ThreadIndex {
  /** Mail-ID -> Mail-ID der Wurzel ihres Vorgangs (die Wurzel nennt sich selbst). */
  rootOf: ReadonlyMap<string, string>;
  /** Kennung im Betreff -> Wurzel des Vorgangs, in dem sie vorkommt. */
  tokenRoot: ReadonlyMap<string, string>;
  /** Der Ausdruck, mit dem dieser Index gebaut wurde (`null` = Regel aus); `threadOf` liest damit den Betreff der Kandidatin. */
  tokenPattern: RegExp | null;
}

const namesOf = (e: ThreadEntry): string[] => [...e.inReplyTo, ...e.references];

/** Die Wurzel einer Gruppe: die fruehste Mail. Bei Gleichstand von Datum und Minute ist die Mail
 *  spaeter, die eine andere der Gleichstandsgruppe nennt (eine Antwort steht nach dem, worauf sie
 *  antwortet); erst unter den uebrigen entscheidet die mailId. */
function pickRoot(members: readonly ThreadEntry[]): string {
  const dated = members.filter((m) => dateKey(m) !== null);
  const pool = dated.length > 0 ? dated : members;
  const earliest = pool.reduce((best, m) => (compareDated({ ...m, mailId: "" }, { ...best, mailId: "" }) < 0 ? m : best));
  const key = dateKey(earliest);
  const tie = pool.filter((m) => dateKey(m) === key);
  const ids = new Set(tie.map((m) => m.mailId));
  const heads = tie.filter((m) => !namesOf(m).some((n) => n !== m.mailId && ids.has(n)));
  return (heads.length > 0 ? heads : tie).reduce((best, m) => (compareDated(m, best) < 0 ? m : best)).mailId;
}

export function groupThreads(entries: readonly ThreadEntry[], tokenPattern: RegExp | null): ThreadIndex {
  const byId = new Map<string, ThreadEntry>();
  for (const e of entries) if (!byId.has(e.mailId)) byId.set(e.mailId, e);

  const parent = new Map<string, string>([...byId.keys()].map((id) => [id, id]));
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    for (let c = id; c !== r;) { const next = parent.get(c)!; parent.set(c, r); c = next; }
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const firstWithToken = new Map<string, string>();
  const tokenOfEntry = new Map<string, string>();
  for (const e of byId.values()) {
    for (const n of namesOf(e)) if (n !== e.mailId && byId.has(n)) union(e.mailId, n);
    const token = tokenOf(e, tokenPattern);
    if (token === null) continue;
    tokenOfEntry.set(e.mailId, token);
    const first = firstWithToken.get(token);
    if (first === undefined) firstWithToken.set(token, e.mailId);
    else union(e.mailId, first);
  }

  const groups = new Map<string, ThreadEntry[]>();
  for (const e of byId.values()) {
    const g = groups.get(find(e.mailId));
    if (g) g.push(e); else groups.set(find(e.mailId), [e]);
  }
  const rootOf = new Map<string, string>();
  for (const members of groups.values()) {
    const root = pickRoot(members);
    for (const m of members) rootOf.set(m.mailId, root);
  }
  const tokenRoot = new Map<string, string>();
  for (const [mailId, token] of tokenOfEntry) tokenRoot.set(token, rootOf.get(mailId)!);
  return { rootOf, tokenRoot, tokenPattern };
}

export interface ThreadCandidate extends Subjected {
  mailId: string;
  inReplyTo: string | null;
  references: readonly string[];
}

/**
 * Die Wurzel des Vorgangs im Vault, dem eine Kandidaten-Mail angehoert — oder `null`. In der
 * Reihenfolge der Quelle: erst die Header (In-Reply-To, dann References, die zuletzt genannte zuerst), dann die
 * Kennung im Betreff. Ein Header, der auf eine Notiz im Vault trifft, gewinnt gegen eine Kennung, die auf einen anderen
 * Vorgang zeigt. Der gemeinsame Kern fuer das Folgen eines Vorgangs auf dem Server (A1).
 */
export function threadOf(candidate: ThreadCandidate, index: ThreadIndex): string | null {
  const headers = [...(candidate.inReplyTo ? [candidate.inReplyTo] : []), ...[...candidate.references].reverse()];
  for (const id of headers) {
    if (id === candidate.mailId) continue;
    const root = index.rootOf.get(id);
    if (root !== undefined) return root;
  }
  const token = tokenOf(candidate, index.tokenPattern);
  return token === null ? null : index.tokenRoot.get(token) ?? null;
}
