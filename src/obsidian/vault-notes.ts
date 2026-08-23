import { normalizePath, TFile, type App } from "obsidian";
import type { NotePlan } from "../core/mirror/plan";

export interface PlanExecutor {
  execute(plans: NotePlan[]): Promise<{ created: number; updated: number; skipped: NotePlan[]; stateChanged: number }>;
}

export interface ZoneHashStore {
  get(mailId: string): string | null;
  set(mailId: string, hash: string): void;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = normalizePath(path).split("/");
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!(await app.vault.adapter.exists(cur))) await app.vault.createFolder(cur);
  }
}

const dirOf = (p: string): string => p.slice(0, p.lastIndexOf("/"));

export function vaultPlanExecutor(app: App, hashes: ZoneHashStore): PlanExecutor {
  return {
    async execute(plans) {
      let created = 0;
      let updated = 0;
      let stateChanged = 0;
      const skipped: NotePlan[] = [];

      for (const p of plans) {
        if (p.kind === "create") {
          await ensureFolder(app, dirOf(p.path));
          await ensureFolder(app, dirOf(p.emlPath));
          await app.vault.createBinary(normalizePath(p.emlPath), new Uint8Array(p.eml).buffer);
          await app.vault.create(normalizePath(p.path), p.content);
          hashes.set(p.mailId, p.zoneHash);
          created++;
        } else if (p.kind === "update") {
          const f = app.vault.getAbstractFileByPath(normalizePath(p.path));
          if (f instanceof TFile) {
            await app.vault.modify(f, p.content);
            hashes.set(p.mailId, p.zoneHash);
            updated++;
          }
        } else if (p.kind === "setState") {
          const f = app.vault.getAbstractFileByPath(normalizePath(p.path));
          if (f instanceof TFile) {
            await app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
              fm["mail_state"] = p.state;
            });
            stateChanged++;
          }
        } else {
          skipped.push(p);
        }
      }
      return { created, updated, skipped, stateChanged };
    },
  };
}

export function findMailNotes(app: App, idField: string): Map<string, TFile> {
  const out = new Map<string, TFile>();
  for (const f of app.vault.getMarkdownFiles()) {
    const id: unknown = app.metadataCache.getFileCache(f)?.frontmatter?.[idField];
    if (typeof id === "string" && id) out.set(id, f);
  }
  return out;
}
