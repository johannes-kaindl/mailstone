import type { ParsedMail } from "../mime/types";
import { buildDerivedFrontmatter } from "../render/frontmatter";
import { renderMessageBlock } from "../render/body";
import { mailFilename, mailFolder, emlFolder } from "../render/filename";
import { managedKeys, type MailProfile } from "./profile";
import { mergeNote, newNote } from "../merge/merge";

export type NotePlan =
  | { kind: "create"; path: string; emlPath: string; content: string; eml: Uint8Array; mailId: string; zoneHash: string }
  | { kind: "update"; path: string; content: string; mailId: string; zoneHash: string }
  | { kind: "skip"; path: string; mailId: string; reason: "unchanged" | "fences-missing" | "zone-edited" | "frontmatter-unparseable" }
  | { kind: "setState"; path: string; mailId: string; state: "live" | "detached" };

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
}

function freePath(folder: string, base: string, ext: string, taken: Set<string>): string {
  let p = `${folder}/${base}.${ext}`;
  let n = 2;
  while (taken.has(p)) {
    p = `${folder}/${base}-${n}.${ext}`;
    n++;
  }
  return p;
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
    const base = mailFilename(profile, mail);
    const path = freePath(mailFolder(profile, mail), base, "md", input.takenPaths);
    const emlBase = path.slice(path.lastIndexOf("/") + 1, -3);
    const emlPath = `${emlFolder(profile, mail)}/${emlBase}.eml`;
    const { content, zoneHash } = newNote(derived, profile.onCreate, block);
    return { kind: "create", path, emlPath, content, eml: input.eml, mailId: mail.id, zoneHash };
  }

  const r = mergeNote({
    existing: input.existing.content,
    derived,
    managed: managedKeys(profile),
    block,
    expectedZoneHash: input.existing.zoneHash,
  });
  if (!r.ok) return { kind: "skip", path: input.existing.path, mailId: mail.id, reason: r.code };
  if (!r.changed) return { kind: "skip", path: input.existing.path, mailId: mail.id, reason: "unchanged" };
  return { kind: "update", path: input.existing.path, content: r.content, mailId: mail.id, zoneHash: r.zoneHash };
}
