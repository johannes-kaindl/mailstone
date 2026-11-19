// Server-Stand x Vault-Stand -> NotePlan[]. Der Sync legt Neues an und setzt mail_state; er
// rendert nie eine bestehende Notiz neu (Spec § 2.2, Merge-Regel 5) — deshalb geht hier
// ausnahmslos allowUpdate: false an planMailNote.
import type { ParsedMail } from "../mime/types";
import { assignRunPaths, planMailNote, type NotePlan } from "./plan";
import type { MailProfile } from "./profile";
import type { OriginalFacts } from "../transform/original-facts";
import type { KnownThreadNote } from "../thread/create-links";
import { threadExtrasForRun } from "../thread/for-run";

/** Ein Eintrag des Vault-Index. `state: null` heisst "Notiz ohne Zustandsfeld" — zusammen mit
 *  einer zu diesem Lauf passenden `source` ergibt das einen detach-Plan, sobald die Mail nicht
 *  mehr auf dem Server liegt: der Zweig prueft auf `!== "detached"`, nicht auf `=== "live"`.
 *  Eine fremde `source` schuetzt die Notiz dagegen unabhaengig vom Zustand. */
export interface MailIndexEntry { path: string; state: string | null; source: string | null }
export type MailIndex = Map<string, MailIndexEntry>;

export interface ApplyInput {
  profile: MailProfile;
  /** "<accountId>/<ordner>" — identifiziert die Notizen, fuer die DIESER Lauf zustaendig ist. */
  source: string;
  syncedAt: Date;
  index: MailIndex;
  /** Alle im Vault schon belegten Pfade — MUSS vorbesetzt uebergeben werden, nicht leer.
   *  `planSync` traegt neu vergebene Pfade hier nach, um Kollisionen innerhalb EINES Laufs zu
   *  vermeiden; ein leeres Set laesst den Lauf Pfade vergeben, die es bereits gibt. */
  takenPaths: Set<string>;
  /** Frisch geholte Mails, die im Vault noch fehlen. */
  fetched: { mail: ParsedMail; eml: Uint8Array }[];
  /** Alle mailIds, die JETZT im Allowlist-Ordner liegen (auch die laengst bekannten). */
  onServer: Set<string>;
  linkFor?: (id: string) => string | null;
  /** Die Notizen im Vault fuer den Vorgangswert (A3). Wird nur gerufen, wenn `threadField` gilt und der
   *  Lauf neue Mails hat. */
  threadNotes?: () => readonly KnownThreadNote[];
  /** Mail-ID -> Werte aus der Original-Mail, vor einem Transformer berechnet (A5, Schritt 1). Fehlt eine Mail darin,
   *  gilt fuer sie die Ableitung aus der Mail selbst. */
  facts?: ReadonlyMap<string, OriginalFacts>;
}

export function planSync(input: ApplyInput): NotePlan[] {
  const { profile, index } = input;
  const plans: NotePlan[] = [];
  const taken = input.takenPaths;
  // Invariante "hoechstens ein Plan je Mail-ID". Zwei Mails im selben Ordner koennen dieselbe
  // normalisierte Message-ID tragen (zurueckkopierte Mail, Sieve-Kopie, an sich selbst
  // weitergeleitete Nachricht) oder — ohne Message-ID-Header — ueber fallbackId auf denselben
  // Wert fallen. Ohne diesen Riegel vergaebe freePaths() zwei verschiedene Pfade und es
  // entstuenden zwei Notizen mit identischem mail_id; die zweite waere im mailIndex (eine Map
  // ueber mail_id) dauerhaft unerreichbar, also eine Waise im Vault. Der Aufrufer filtert
  // ebenfalls, die Zusage haengt aber bewusst nicht an ihm: planKey() im SyncService beruft
  // sich ausdruecklich darauf. Die zweite Schleife braucht keinen Riegel — sie laeuft ueber die
  // Schluessel von `index` (je Mail-ID genau einer) und ist zur ersten disjunkt, weil dort nur
  // Mail-IDs geplant werden, die `index` NICHT kennt.
  const planned = new Set<string>();

  // Erster Durchgang: die neuen Mails auswaehlen (Riegel s. o.) und ihre Pfade VOR dem Rendern
  // vergeben. Erst so kennt `linkFor` auch Mails desselben Laufs, unabhaengig von der Reihenfolge
  // in `fetched` (B1, Welle 36).
  const fresh: { mail: ParsedMail; eml: Uint8Array }[] = [];
  for (const item of input.fetched) {
    if (index.has(item.mail.id)) continue; // bekannt -> Zustand entscheidet unten, nie neu rendern
    if (planned.has(item.mail.id)) continue; // dieselbe Mail-ID zweimal geliefert, s. o.
    planned.add(item.mail.id);
    fresh.push(item);
  }
  const run = assignRunPaths(profile, fresh.map((f) => f.mail), taken);
  const linkFor = (id: string): string | null => run.targets.get(id) ?? input.linkFor?.(id) ?? null;

  const extras = threadExtrasForRun(profile, fresh.map((f) => f.mail), run.targets, input.threadNotes, input.facts);

  // Zweiter Durchgang: planen.
  fresh.forEach(({ mail, eml }, i) => {
    plans.push(planMailNote({
      mail, eml, profile,
      source: input.source,
      syncedAt: input.syncedAt,
      existing: null,
      takenPaths: taken,
      allowUpdate: false,
      paths: run.paths[i]!,
      linkFor,
      ...(input.facts?.has(mail.id) ? { facts: input.facts.get(mail.id)! } : {}),
      ...(extras.has(mail.id) ? { createExtra: extras.get(mail.id)! } : {}),
    }));
  });

  for (const [mailId, entry] of index) {
    // Fremde Notiz (anderes Konto/Ordner) oder Altbestand ohne Herkunft: nicht unsere Sache.
    if (entry.source !== input.source) continue;
    const here = input.onServer.has(mailId);
    if (here && entry.state === "detached") {
      plans.push({ kind: "setState", path: entry.path, mailId, state: "live", stateField: profile.stateField });
    } else if (!here && entry.state !== "detached") {
      plans.push({ kind: "setState", path: entry.path, mailId, state: "detached", stateField: profile.stateField });
    }
  }

  return plans;
}
