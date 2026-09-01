import { normalizePath, TFile, type App } from "obsidian";
import type { NotePlan } from "../core/mirror/plan";
import type { PlanExecutionResult, PlanExecutor, ZoneHashStore } from "../core/mirror/execute";
import type { MailIndex } from "../core/mirror/apply";
import type { MailProfile } from "../core/mirror/profile";

export type { PlanExecutionResult, PlanExecutor, ZoneHashStore };

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
            // Der Plan kann aelter sein als der Schreibvorgang — zwischen Lesen (buildContext)
            // und hier lag ein unbeschraenktes Formular-/Vorschau-Modal. Wenn der Aufrufer den
            // Inhalt mitgegeben hat, den der Plan voraussetzt, wird nur geschrieben, wenn die
            // Datei ihn noch genauso hat; sonst waere dies ein Lost Update (M3b-Nachlese, Fund 2).
            if (p.expectedContent !== undefined) {
              const current = await app.vault.read(f);
              if (current !== p.expectedContent) {
                skipped.push({ kind: "skip", path: p.path, mailId: p.mailId, reason: "content-changed" });
                continue;
              }
            }
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

/** Legt eine Anlage im Vault an und stellt den Zielordner sicher. Eigene Pfadzerlegung
 *  statt des modulinternen `dirOf`: ein Anhangordner auf Vault-Ebene liefert einen Pfad
 *  ohne "/", und `dirOf` schnitte dann das letzte Zeichen des Dateinamens ab. */
export function writeAttachment(app: App): (path: string, data: Uint8Array) => Promise<void> {
  return async (path, data) => {
    const p = normalizePath(path);
    const cut = p.lastIndexOf("/");
    if (cut > 0) await ensureFolder(app, p.slice(0, cut));
    await app.vault.createBinary(p, new Uint8Array(data).buffer);
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

/** Wie findMailNotes, liefert aber zusaetzlich Zustand und Herkunft — der Sync braucht beide,
 *  um fremde Notizen (anderes Konto, Import ohne mail_source) nicht anzufassen. */
export function mailIndex(app: App, profile: MailProfile): MailIndex {
  const out: MailIndex = new Map();
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    const id: unknown = fm?.[profile.idField];
    if (typeof id !== "string" || !id) continue;
    const state: unknown = fm?.[profile.stateField];
    const source: unknown = fm?.[profile.sourceField];
    out.set(id, { path: f.path, state: typeof state === "string" ? state : null, source: typeof source === "string" ? source : null });
  }
  return out;
}
