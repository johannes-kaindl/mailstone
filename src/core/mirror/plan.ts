import type { ParsedMail } from "../mime/types";
import { buildDerivedFrontmatter } from "../render/frontmatter";
import { renderMessageBlock } from "../render/body";
import { mailFilename, mailFolder, emlFolder } from "../render/filename";
import { managedKeys, type MailProfile } from "./profile";
import { mergeNote, newNote } from "../merge/merge";

export type NotePlan =
  | { kind: "create"; path: string; emlPath: string; content: string; eml: Uint8Array; mailId: string; zoneHash: string }
  | {
      kind: "update";
      path: string;
      content: string;
      mailId: string;
      zoneHash: string;
      /** OPTIONAL: der Notiz-Inhalt, aus dem dieser Plan berechnet wurde. `buildContext`
       *  liest die Notiz VOR unbeschraenkter Nutzer-Zeit (Formular- und Vorschau-Modal); wird
       *  dieses Feld gesetzt, prueft der Executor beim Schreiben, ob die Datei noch denselben
       *  Inhalt hat, und schreibt sonst NICHT (skip, reason "content-changed") — sonst wuerde
       *  ein Schreibvorgang, der lange nach dem Lesen ausgefuehrt wird, eine zwischenzeitliche
       *  Aenderung (Sync, anderes Fenster, anderes Plugin) stillschweigend ueberschreiben
       *  (M3b-Nachlese, Fund 2). Sync- und Import-Pfad (`planMailNote`, `planSync`) lassen es
       *  bewusst weg: sie planen und schreiben ohne Nutzer-Wartezeit dazwischen. */
      expectedContent?: string;
    }
  | {
      kind: "skip";
      path: string;
      mailId: string;
      reason: "unchanged" | "fences-missing" | "zone-edited" | "frontmatter-unparseable" | "missing-target" | "content-changed";
    }
  | { kind: "setState"; path: string; mailId: string; state: "live" | "detached"; stateField: string };

export interface ExistingNote {
  path: string;
  content: string;
  zoneHash: string | null;
}

export interface PlanInput {
  mail: ParsedMail;
  eml: Uint8Array;
  profile: MailProfile;
  source: string;
  syncedAt: Date;
  existing: ExistingNote | null;
  linkFor?: (id: string) => string | null;
  takenPaths: Set<string>; // Kollisionen → -2, -3
  /** false = bestehende Notizen werden nie neu gerendert (Merge-Regel 5 der Spec § 2.2:
   *  "Re-Render nie automatisch; Sync legt nur Neues an und setzt mail_state"). Der Sync
   *  uebergibt false, das Import-Kommando true. */
  allowUpdate: boolean;
}

/** Notiz und .eml gehoeren zusammen: beide Pfade werden gegen dieselbe Belegt-Menge geprueft
 *  und ruecken gemeinsam auf denselben Suffix. Sonst koennte eine freie .md auf eine bereits
 *  belegte .eml treffen — createBinary wuerfe, und der ganze Plan waere ein Fehlschlag. */
function freePaths(folder: string, emlDir: string, base: string, taken: Set<string>): { path: string; emlPath: string } {
  let n = 1;
  for (;;) {
    const suffix = n === 1 ? "" : `-${n}`;
    const path = `${folder}/${base}${suffix}.md`;
    const emlPath = `${emlDir}/${base}${suffix}.eml`;
    if (!taken.has(path) && !taken.has(emlPath)) return { path, emlPath };
    n++;
  }
}

export function planMailNote(input: PlanInput): NotePlan {
  const { mail, profile } = input;
  const derived = buildDerivedFrontmatter(profile, {
    mail,
    source: input.source,
    state: "live",
    syncedAt: input.syncedAt,
    linkFor: input.linkFor,
  });
  const block = renderMessageBlock(mail);

  if (!input.existing) {
    const { path, emlPath } = freePaths(mailFolder(profile, mail), emlFolder(profile, mail), mailFilename(profile, mail), input.takenPaths);
    const { content, zoneHash } = newNote(derived, profile.onCreate, block);
    return { kind: "create", path, emlPath, content, eml: input.eml, mailId: mail.id, zoneHash };
  }

  if (!input.allowUpdate) return { kind: "skip", path: input.existing.path, mailId: mail.id, reason: "unchanged" };

  const r = mergeNote({
    existing: input.existing.content,
    derived,
    managed: managedKeys(profile),
    block,
    expectedZoneHash: input.existing.zoneHash,
    volatileKeys: [profile.syncedField],
  });
  if (!r.ok) return { kind: "skip", path: input.existing.path, mailId: mail.id, reason: r.code };
  if (!r.changed) return { kind: "skip", path: input.existing.path, mailId: mail.id, reason: "unchanged" };
  return { kind: "update", path: input.existing.path, content: r.content, mailId: mail.id, zoneHash: r.zoneHash };
}
