import { normalizePath, TFile, type App } from "obsidian";
import type { RelinkHead, RelinkRunDeps } from "../core/mirror/relink-run";
import type { MailProfile } from "../core/mirror/profile";
import type { ZoneHashStore } from "./vault-notes";

/** Lesen fuer das Nachverlinken nach einem Sync-Lauf (Vorspann zu A3). Die Koepfe kommen aus dem
 *  Metadata-Cache, der Inhalt wird erst gelesen, wenn der Kern einen Treffer meldet. Geschrieben wird
 *  ueber den `PlanExecutor` des Laufs: sein `update` mit `expectedContent` ruft `vault.modify` nur,
 *  wenn die Datei noch den gelesenen Inhalt hat. */
export function vaultRelinkDeps(app: App, profile: () => MailProfile, hashes: ZoneHashStore): RelinkRunDeps {
  return {
    heads: () => {
      const idField = profile().idField;
      const out: RelinkHead[] = [];
      for (const f of app.vault.getMarkdownFiles()) {
        const frontmatter = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
        const id: unknown = frontmatter[idField];
        if (typeof id === "string" && id !== "") out.push({ mailId: id, path: f.path, frontmatter });
      }
      return out;
    },
    read: async (path) => {
      const f = app.vault.getAbstractFileByPath(normalizePath(path));
      if (!(f instanceof TFile)) return null;
      const id: unknown = app.metadataCache.getFileCache(f)?.frontmatter?.[profile().idField];
      return { content: await app.vault.read(f), zoneHash: typeof id === "string" ? hashes.get(id) : null };
    },
  };
}
