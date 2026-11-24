import type { ParsedMail } from "../mime/types";
import { buildDerivedFrontmatter } from "../render/frontmatter";
import { renderMessageBlock } from "../render/body";
import { mailFilename, mailFolder, emlFolder } from "../render/filename";
import { DEFAULT_NOTE_HEADINGS, keepsEml, managedKeys, type FmVal, type MailProfile } from "./profile";
import type { OriginalFacts } from "../transform/original-facts";
import { blockHeadingOf, mergeNote, newNote } from "../merge/merge";
import { applyAttachmentTargets, type AttachmentTargets, type PlannedAttachment } from "./attachments";

export type NotePlan =
  | { kind: "create"; path: string; /** null = keine .eml schreiben (`profile.saveEml: false`). */ emlPath: string | null; content: string; eml: Uint8Array; mailId: string; zoneHash: string;
      /** Zusaetzliche Binaerdateien (die Anhaenge der Mail, A6): der Executor schreibt sie VOR der Notiz; fehlt das Feld, gibt es keine. */
      attachments?: PlannedAttachment[] }
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
  /** Vorab vergebene Pfade (`assignRunPaths`): nur fuer eine neue Notiz (`existing: null`) und
   *  nur, wenn der Aufrufer die Pfade eines ganzen Laufs vorher vergibt, damit Verweise auf
   *  Mails desselben Laufs schon beim Rendern ein Ziel haben. Ohne dieses Feld rechnet
   *  `planMailNote` wie bisher aus `takenPaths`. */
  paths?: AssignedPaths;
  /** Werte nur fuer eine NEUE Notiz, die am Vault-Stand haengen (Vorgangswert); sie stehen zwischen
   *  `onCreate` und den verwalteten Feldern, die immer gewinnen. */
  createExtra?: Record<string, FmVal>;
  /** false = bestehende Notizen werden nie neu gerendert (Merge-Regel 5 der Spec § 2.2:
   *  "Re-Render nie automatisch; Sync legt nur Neues an und setzt mail_state"). Der Sync
   *  uebergibt false, das Import-Kommando true. */
  allowUpdate: boolean;
  /** Vorberechnet aus der Original-Mail, bevor ein Transformer `from` und `subject` ersetzt (A5, Schritt 1). Vorhanden
   *  hat es Vorrang (`richtung`), fehlt es, wird wie bisher aus `mail` abgeleitet. */
  facts?: OriginalFacts;
  /** Ziele der Anhaenge (A6), nur fuer eine NEUE Notiz: die Obsidian-Schicht loest sie vorab auf. Ohne dieses Feld bleibt der Plan wie bisher. */
  attachmentTargets?: AttachmentTargets;
}

/** Notiz und .eml gehoeren zusammen: beide Pfade werden gegen dieselbe Belegt-Menge geprueft
 *  und ruecken gemeinsam auf denselben Suffix. Sonst koennte eine freie .md auf eine bereits
 *  belegte .eml treffen — createBinary wuerfe, und der ganze Plan waere ein Fehlschlag. */
export interface AssignedPaths { path: string; emlPath: string }

function freePaths(folder: string, emlDir: string, base: string, taken: Set<string>): AssignedPaths {
  let n = 1;
  for (;;) {
    const suffix = n === 1 ? "" : `-${n}`;
    const path = `${folder}/${base}${suffix}.md`;
    const emlPath = `${emlDir}/${base}${suffix}.eml`;
    if (!taken.has(path) && !taken.has(emlPath)) return { path, emlPath };
    n++;
  }
}

/** Vergibt die Pfade aller NEUEN Notizen eines Laufs vorab, in Eingabereihenfolge, und traegt
 *  sie in `taken` ein. `paths[i]` gehoert zu `mails[i]`; `targets` bildet Mail-ID auf den
 *  Notizpfad ohne `.md` ab (bei doppelter ID gewinnt die erste) und dient als Linkziel fuer
 *  Verweise auf Mails desselben Laufs. */
export function assignRunPaths(
  profile: MailProfile,
  mails: readonly ParsedMail[],
  taken: Set<string>,
): { paths: AssignedPaths[]; targets: Map<string, string> } {
  const paths: AssignedPaths[] = [];
  const targets = new Map<string, string>();
  for (const mail of mails) {
    const p = freePaths(mailFolder(profile, mail), emlFolder(profile, mail), mailFilename(profile, mail), taken);
    taken.add(p.path); taken.add(p.emlPath);
    paths.push(p);
    if (!targets.has(mail.id)) targets.set(mail.id, p.path.replace(/\.md$/, ""));
  }
  return { paths, targets };
}

export function planMailNote(input: PlanInput): NotePlan {
  const { mail, profile } = input;
  const derived = buildDerivedFrontmatter(profile, {
    mail,
    source: input.source,
    state: "live",
    syncedAt: input.syncedAt,
    linkFor: input.linkFor,
    ...(input.facts ? { facts: input.facts } : {}),
  });
  const headings = profile.noteHeadings ?? DEFAULT_NOTE_HEADINGS;
  // Bestand behaelt die Ueberschrift seiner Zone (nie umschreiben), neue Notizen die der Oberflaeche.
  const block = renderMessageBlock(mail, { heading: (input.existing && blockHeadingOf(input.existing.content)) || headings.message });

  if (!input.existing) {
    const assigned = input.paths ?? freePaths(mailFolder(profile, mail), emlFolder(profile, mail), mailFilename(profile, mail), input.takenPaths);
    const made = newNote(derived, profile.onCreate, block, `## ${headings.notes}\n\n`, input.createExtra);
    const zoneHash = made.zoneHash;
    // Die Links stehen im freien Bereich vor der Zone: ein Neu-Aufbau ersetzt nur die Zone, die Pruefsumme haengt nicht an ihnen.
    const withAttachments = input.attachmentTargets ? applyAttachmentTargets(made.content, mail, input.attachmentTargets) : null;
    const content = withAttachments ? withAttachments.content : made.content;
    // Der .eml-Pfad wird in jedem Fall VERGEBEN (freePaths/assignRunPaths pruefen ihn weiter:
    // eine verwaiste Datei am Konventionspfad bleibt eine Kollision), geschrieben wird er nur,
    // wenn die .eml gebraucht wird. Eine Mail ohne Message-ID ist auf dem Server nicht
    // auffindbar, ihr Original gibt es nur hier.
    const emlPath = keepsEml(profile, mail.id) ? assigned.emlPath : null;
    return { kind: "create", path: assigned.path, emlPath, content, eml: input.eml, mailId: mail.id, zoneHash, ...(withAttachments && withAttachments.writes.length > 0 ? { attachments: withAttachments.writes } : {}) };
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
