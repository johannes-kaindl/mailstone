import { normalizePath, TFile, type App } from "obsidian";
import { isInFolder } from "../vendor/code-kit/folder-scope";
import { parseEml } from "../core/mime/parse";
import type { ParsedMail } from "../core/mime/types";
import { assignRunPaths, planMailNote, type ExistingNote, type NotePlan } from "../core/mirror/plan";
import type { MailProfile } from "../core/mirror/profile";
import { findMailNotes, vaultPlanExecutor, type ZoneHashStore } from "./vault-notes";

export interface ImportDeps { app: App; profile: MailProfile; hashes: ZoneHashStore; now: () => Date }

export async function importEmlFolder(deps: ImportDeps, folder: string): Promise<{ created: number; updated: number; skipped: NotePlan[]; errors: { path: string; message: string }[] }> {
  const { app, profile } = deps;
  const root = normalizePath(folder);
  const files = app.vault.getFiles().filter((f) => f.extension === "eml" && isInFolder(f.path, root, { self: true }));
  const index = findMailNotes(app, profile.idField);
  const taken = new Set(app.vault.getFiles().map((f) => f.path));
  const errors: { path: string; message: string }[] = [];
  const syncedAt = deps.now();
  // Erster Durchgang: alle Dateien lesen und parsen, damit die Pfade der neuen Notizen VOR dem
  // Rendern feststehen (Verweise auf Mails desselben Imports, B1 Welle 36).
  const items: { mail: ParsedMail; eml: Uint8Array; existing: ExistingNote | null }[] = [];
  for (const f of files) {
    try {
      const eml = new Uint8Array(await app.vault.readBinary(f));
      const mail = await parseEml(eml);
      const ex = index.get(mail.id);
      const existing = ex instanceof TFile ? { path: ex.path, content: await app.vault.read(ex), zoneHash: deps.hashes.get(mail.id) } : null;
      items.push({ mail, eml, existing });
    } catch (e) { errors.push({ path: f.path, message: e instanceof Error ? e.message : String(e) }); }
  }
  const fresh = items.filter((i) => !i.existing);
  const run = assignRunPaths(profile, fresh.map((i) => i.mail), taken);
  const pathsOf = new Map(fresh.map((item, i) => [item, run.paths[i]!]));
  const linkFor = (id: string): string | null => run.targets.get(id) ?? index.get(id)?.path.replace(/\.md$/, "") ?? null;
  const plans: NotePlan[] = [];
  for (const item of items) {
    const { mail, eml, existing } = item;
    // Der Import ist der ausdrueckliche Wunsch des Nutzers — hier darf eine bestehende
    // Notiz aktualisiert werden (der Sync in M3 uebergibt allowUpdate: false).
    const paths = pathsOf.get(item);
    plans.push(planMailNote({ mail, eml, profile, source: `import/${root}`, syncedAt, existing, takenPaths: taken, allowUpdate: true, linkFor, ...(paths ? { paths } : {}) }));
  }
  const r = await vaultPlanExecutor(app, deps.hashes).execute(plans);
  return { created: r.created, updated: r.updated, skipped: r.skipped, errors: [...errors, ...r.errors.map((x) => ({ path: x.plan.path, message: x.message }))] };
}
