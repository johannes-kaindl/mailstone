import type { App } from "obsidian";
import { fmKeyFor, type MailProfile } from "../core/mirror/profile";
import { followStopped } from "../core/thread/field";
import type { FollowContext } from "../core/thread/follow-run";
import { groupThreads, type ThreadEntry } from "../core/thread/group";
import { noteSubject, tokenRegexOf } from "../core/thread/token";
import { threadRefsFor } from "./thread-index";

const text = (v: unknown): string => (typeof v === "string" ? v : "");

export interface VaultFollowContext extends FollowContext {
  /** Pfad der Notiz zu einer Mail-ID (mit `.md`), `null` ohne Notiz. Fuer den Link auf die Wurzel im Dialog. */
  pathOf(mailId: string): string | null;
}

/**
 * Der Vault-Stand fuer „Folge-Mails anzeigen“ (A1): die Vorgaenge aller Mail-Notizen (`groupThreads` ueber die aus
 * dem Metadata-Cache aufgeloesten Verweise, E6, und die Kennung im Betreff) und die Wurzeln, an denen die Markierung „nicht mehr folgen“ steht.
 * Liest nur den Cache, nicht die Dateien.
 */
export function followContext(app: App, profile: MailProfile): VaultFollowContext {
  const entries: ThreadEntry[] = [];
  const frontmatterOf = new Map<string, Record<string, unknown>>();
  const paths = new Map<string, string>();
  const dateKey = fmKeyFor(profile, "date");
  const timeKey = fmKeyFor(profile, "time");

  for (const f of app.vault.getMarkdownFiles()) {
    const fm: Record<string, unknown> = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const id: unknown = fm[profile.idField];
    if (typeof id !== "string" || id === "" || paths.has(id)) continue;
    const refs = threadRefsFor(app, profile, f.path, fm);
    entries.push({
      mailId: id,
      path: f.path.replace(/\.md$/, ""),
      date: dateKey === null ? "" : text(fm[dateKey]),
      time: timeKey === null ? "" : text(fm[timeKey]),
      inReplyTo: refs.inReplyTo,
      references: refs.references,
      subject: noteSubject(profile, fm),
    });
    frontmatterOf.set(id, fm);
    paths.set(id, f.path);
  }

  const index = groupThreads(entries, tokenRegexOf(profile));
  const stopped = new Set<string>();
  for (const [id, root] of index.rootOf) {
    if (id === root && followStopped(profile, frontmatterOf.get(id) ?? {})) stopped.add(id);
  }
  return { index, stopped, pathOf: (id) => paths.get(id) ?? null };
}
