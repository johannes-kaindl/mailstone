import { normalizePath, TFile, type App } from "obsidian";
import type { NotePlan } from "../core/mirror/plan";

export interface PlanExecutionResult {
  created: number;
  updated: number;
  skipped: NotePlan[];
  stateChanged: number;
  /** Ein gescheiterter Plan beendet den Lauf nicht — die uebrigen werden ausgefuehrt und der
   *  Fehlschlag wird als Wert gemeldet (Spec § 5: Fehler sind Werte, kein Stacktrace-Spam). */
  errors: { plan: NotePlan; message: string }[];
}

export interface PlanExecutor {
  execute(plans: NotePlan[]): Promise<PlanExecutionResult>;
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

/** Ein Plan, dessen Ziel nicht (mehr) als Datei aufzufinden ist — z. B. weil die Notiz
 *  zwischen Planung und Ausfuehrung umbenannt oder geloescht wurde. */
function missingTarget(p: NotePlan): NotePlan {
  return { kind: "skip", path: p.path, mailId: p.mailId, reason: "missing-target" };
}

export function vaultPlanExecutor(app: App, hashes: ZoneHashStore): PlanExecutor {
  return {
    async execute(plans) {
      let created = 0;
      let updated = 0;
      let stateChanged = 0;
      const skipped: NotePlan[] = [];
      const errors: { plan: NotePlan; message: string }[] = [];

      for (const p of plans) {
        try {
          if (p.kind === "create") {
            await ensureFolder(app, dirOf(p.path));
            await ensureFolder(app, dirOf(p.emlPath));
            await app.vault.createBinary(normalizePath(p.emlPath), new Uint8Array(p.eml).buffer);
            await app.vault.create(normalizePath(p.path), p.content);
            hashes.set(p.mailId, p.zoneHash);
            created++;
          } else if (p.kind === "update") {
            const f = app.vault.getAbstractFileByPath(normalizePath(p.path));
            if (!(f instanceof TFile)) { skipped.push(missingTarget(p)); continue; }
            await app.vault.modify(f, p.content);
            hashes.set(p.mailId, p.zoneHash);
            updated++;
          } else if (p.kind === "setState") {
            const f = app.vault.getAbstractFileByPath(normalizePath(p.path));
            if (!(f instanceof TFile)) { skipped.push(missingTarget(p)); continue; }
            await app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
              fm[p.stateField] = p.state;
            });
            stateChanged++;
          } else {
            skipped.push(p);
          }
        } catch (e) {
          errors.push({ plan: p, message: e instanceof Error ? e.message : String(e) });
        }
      }
      return { created, updated, skipped, stateChanged, errors };
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
