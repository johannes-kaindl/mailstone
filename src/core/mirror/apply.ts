// Server-Stand x Vault-Stand -> NotePlan[]. Der Sync legt Neues an und setzt mail_state; er
// rendert nie eine bestehende Notiz neu (Spec § 2.2, Merge-Regel 5) — deshalb geht hier
// ausnahmslos allowUpdate: false an planMailNote.
import type { ParsedMail } from "../mime/types";
import { planMailNote, type NotePlan } from "./plan";
import type { MailProfile } from "./profile";

export interface MailIndexEntry { path: string; state: string | null; source: string | null }
export type MailIndex = Map<string, MailIndexEntry>;

export interface ApplyInput {
  profile: MailProfile;
  /** "<accountId>/<ordner>" — identifiziert die Notizen, fuer die DIESER Lauf zustaendig ist. */
  source: string;
  syncedAt: Date;
  index: MailIndex;
  takenPaths: Set<string>;
  /** Frisch geholte Mails, die im Vault noch fehlen. */
  fetched: { mail: ParsedMail; eml: Uint8Array }[];
  /** Alle mailIds, die JETZT im Allowlist-Ordner liegen (auch die laengst bekannten). */
  onServer: Set<string>;
  linkFor?: (id: string) => string | null;
}

export function planSync(input: ApplyInput): NotePlan[] {
  const { profile, index } = input;
  const plans: NotePlan[] = [];
  const taken = input.takenPaths;

  for (const { mail, eml } of input.fetched) {
    if (index.has(mail.id)) continue; // bekannt -> Zustand entscheidet unten, nie neu rendern
    const plan = planMailNote({
      mail, eml, profile,
      source: input.source,
      syncedAt: input.syncedAt,
      existing: null,
      takenPaths: taken,
      allowUpdate: false,
      ...(input.linkFor ? { linkFor: input.linkFor } : {}),
    });
    if (plan.kind === "create") { taken.add(plan.path); taken.add(plan.emlPath); }
    plans.push(plan);
  }

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
