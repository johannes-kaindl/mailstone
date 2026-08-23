import { normalizePath, TFile, type App } from "obsidian";
import { parseEml } from "../core/mime/parse";
import { planMailNote, type NotePlan } from "../core/mirror/plan";
import type { MailProfile } from "../core/mirror/profile";
import { findMailNotes, vaultPlanExecutor, type ZoneHashStore } from "./vault-notes";

export interface ImportDeps { app: App; profile: MailProfile; hashes: ZoneHashStore; now: () => Date }

export async function importEmlFolder(deps: ImportDeps, folder: string): Promise<{ created: number; updated: number; skipped: NotePlan[]; errors: { path: string; message: string }[] }> {
  const { app, profile } = deps;
  const root = normalizePath(folder);
  const files = app.vault.getFiles().filter((f) => f.extension === "eml" && (f.path === root || f.path.startsWith(`${root}/`)));
  const index = findMailNotes(app, profile.idField);
  const taken = new Set(app.vault.getFiles().map((f) => f.path));
  const plans: NotePlan[] = []; const errors: { path: string; message: string }[] = [];
  const syncedAt = deps.now();
  for (const f of files) {
    try {
      const eml = new Uint8Array(await app.vault.readBinary(f));
      const mail = await parseEml(eml);
      const ex = index.get(mail.id);
      const existing = ex instanceof TFile ? { path: ex.path, content: await app.vault.read(ex), zoneHash: deps.hashes.get(mail.id) } : null;
      // Der Import ist der ausdrueckliche Wunsch des Nutzers — hier darf eine bestehende
      // Notiz aktualisiert werden (der Sync in M3 uebergibt allowUpdate: false).
      const plan = planMailNote({ mail, eml, profile, source: `import/${root}`, syncedAt, existing, takenPaths: taken, allowUpdate: true, linkFor: (id) => index.get(id)?.path.replace(/\.md$/, "") ?? null });
      if (plan.kind === "create") { taken.add(plan.path); taken.add(plan.emlPath); }
      plans.push(plan);
    } catch (e) { errors.push({ path: f.path, message: e instanceof Error ? e.message : String(e) }); }
  }
  const r = await vaultPlanExecutor(app, deps.hashes).execute(plans);
  return { created: r.created, updated: r.updated, skipped: r.skipped, errors: [...errors, ...r.errors.map((x) => ({ path: x.plan.path, message: x.message }))] };
}
