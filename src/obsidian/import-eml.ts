import { normalizePath, TFile, type App } from "obsidian";
import { isInFolder } from "../vendor/code-kit/folder-scope";
import type { BusyGuard } from "../vendor/code-kit/busy-guard";
import { parseEml } from "../core/mime/parse";
import type { ParsedMail } from "../core/mime/types";
import { assignRunPaths, planMailNote, type ExistingNote, type NotePlan } from "../core/mirror/plan";
import type { MailProfile } from "../core/mirror/profile";
import { threadNotes } from "./thread-index";
import { threadExtrasForRun } from "../core/thread/for-run";
import type { OriginalFacts } from "../core/transform/original-facts";
import { transformMail, type TransformPort } from "../core/transform/transform-mail";
import { notePathFor, type AttachmentResolver, type AttachmentTargets } from "../core/mirror/attachments";
import { effectiveSaveAttachments } from "../core/mirror/profile";
import { findMailNotes, vaultPlanExecutor, type ZoneHashStore } from "./vault-notes";
import { errorMessage } from "../vendor/kit/error-message";

export interface ImportDeps {
  app: App; profile: MailProfile; hashes: ZoneHashStore; now: () => Date;
  /** Mail-ID -> Werte aus der Original-Mail (A5, Schritt 1); noch ohne Erzeuger, der Transformer liefert sie spaeter. */
  facts?: ReadonlyMap<string, OriginalFacts>;
  /** Pseudonymisieren (A5): der Port zum Plugin pseudonymizer. Gerufen wird er nur bei `profile.pseudonymize !== "off"`, mit `interactive: true`
   *  (der Import ist ein Befehl eines Menschen). Fehlt er bei eingeschaltetem Schalter, wartet jede Mail: es entsteht nie Klartext. */
  pseudonymize?: TransformPort;
  /** Der Busy-Guard des Plugins (derselbe wie im Sync): der Import laeuft nur, wenn er ihn bekommt. Sonst legte er neben einem Sync-Lauf
   *  mit offenem Pruefenster (Index vor dem Fenster gelesen) eine zweite Notiz derselben Mail an. Ohne die Dep gibt es keinen Riegel. */
  busy?: BusyGuard;
  /** Anhaenge in den Anhangordner (A6): legt je Import einen Resolver an. Gerufen nur bei `effectiveSaveAttachments`; ohne die Dep bleibt die Einstellung wirkungslos. */
  attachments?: () => AttachmentResolver;
}

/** Eine Mail, die der Import nicht geschrieben hat, weil der Pseudonymizer sie zurueckstellt (Quelldatei bleibt unberuehrt). */
export interface HeldMail { path: string; kind: "wait"; reason: string; message: string }

export interface ImportResult { created: number; updated: number; skipped: NotePlan[]; errors: { path: string; message: string }[]; held: HeldMail[]; busy: boolean }

export async function importEmlFolder(deps: ImportDeps, folder: string): Promise<ImportResult> {
  if (deps.busy && !deps.busy.tryAcquire()) return { created: 0, updated: 0, skipped: [], errors: [], held: [], busy: true };
  try {
    return await importLocked(deps, folder);
  } finally {
    deps.busy?.release();
  }
}

async function importLocked(deps: ImportDeps, folder: string): Promise<ImportResult> {
  const { app, profile } = deps;
  const root = normalizePath(folder);
  const files = app.vault.getFiles().filter((f) => f.extension === "eml" && isInFolder(f.path, root, { self: true }));
  const index = findMailNotes(app, profile.idField);
  const taken = new Set(app.vault.getFiles().map((f) => f.path));
  const errors: { path: string; message: string }[] = [];
  const held: HeldMail[] = [];
  const facts = new Map(deps.facts ?? []);
  const syncedAt = deps.now();
  // Erster Durchgang: alle Dateien lesen und parsen, damit die Pfade der neuen Notizen VOR dem
  // Rendern feststehen (Verweise auf Mails desselben Imports, B1 Welle 36).
  const items: { mail: ParsedMail; eml: Uint8Array; existing: ExistingNote | null }[] = [];
  for (const f of files) {
    try {
      let eml = new Uint8Array(await app.vault.readBinary(f));
      const parsed = await parseEml(eml);
      let mail = parsed;
      if (profile.pseudonymize !== "off") {
        // Eine Mail, die wartet oder scheitert, wird gar nicht erst geplant: keine halbe Notiz.
        const port: TransformPort = deps.pseudonymize ?? (() => Promise.resolve({ kind: "wait", reason: "not-ready", message: "no pseudonymizer port bound" }));
        const r = await transformMail(parsed, profile, port, { interactive: true });
        if (r.kind === "wait") { held.push({ path: f.path, kind: "wait", reason: r.reason, message: r.message }); continue; }
        if (r.kind === "error") { errors.push({ path: f.path, message: `pseudonymize: ${r.reason}: ${r.message}` }); continue; }
        mail = r.mail;
        facts.set(mail.id, r.facts);
        // Die Quell-Bytes sind Klartext; bei eingeschaltetem Schalter schreibt kein Plan eine .eml, also reisen sie nicht mit.
        eml = new Uint8Array(0);
      }
      const ex = index.get(mail.id);
      const existing = ex instanceof TFile ? { path: ex.path, content: await app.vault.read(ex), zoneHash: deps.hashes.get(mail.id) } : null;
      items.push({ mail, eml, existing });
    } catch (e) { errors.push({ path: f.path, message: errorMessage(e) }); }
  }
  const fresh = items.filter((i) => !i.existing);
  const run = assignRunPaths(profile, fresh.map((i) => i.mail), taken);
  const pathsOf = new Map(fresh.map((item, i) => [item, run.paths[i]!]));
  const linkFor = (id: string): string | null => run.targets.get(id) ?? index.get(id)?.path.replace(/\.md$/, "") ?? null;
  const extras = threadExtrasForRun(profile, fresh.map((i) => i.mail), run.targets, () => threadNotes(app, profile), facts);
  // Anhaenge (A6): nur fuer neue Notizen; eine bestehende wird nicht neu gerendert, ihre Anhaenge bleiben, wie sie sind.
  const attachmentTargets = new Map<string, AttachmentTargets>();
  if (effectiveSaveAttachments(profile) && deps.attachments) {
    const resolve = deps.attachments();
    for (const item of fresh) {
      if (!item.mail.attachments.some((a) => !a.inline)) continue;
      try { attachmentTargets.set(item.mail.id, await resolve(item.mail, notePathFor(profile, item.mail))); }
      catch (e) { errors.push({ path: item.mail.id, message: `attachments: ${errorMessage(e)}` }); }
    }
  }
  const plans: NotePlan[] = [];
  for (const item of items) {
    const { mail, eml, existing } = item;
    // Der Import ist der ausdrueckliche Wunsch des Nutzers — hier darf eine bestehende
    // Notiz aktualisiert werden (der Sync in M3 uebergibt allowUpdate: false).
    const paths = pathsOf.get(item);
    plans.push(planMailNote({ mail, eml, profile, source: `import/${root}`, syncedAt, existing, takenPaths: taken, allowUpdate: true, linkFor, ...(facts.has(mail.id) ? { facts: facts.get(mail.id)! } : {}), ...(paths ? { paths } : {}), ...(extras.has(mail.id) ? { createExtra: extras.get(mail.id)! } : {}), ...(attachmentTargets.has(mail.id) ? { attachmentTargets: attachmentTargets.get(mail.id)! } : {}) }));
  }
  const r = await vaultPlanExecutor(app, deps.hashes).execute(plans);
  return { created: r.created, updated: r.updated, skipped: r.skipped, errors: [...errors, ...r.errors.map((x) => ({ path: x.plan.path, message: x.message }))], held, busy: false };
}
