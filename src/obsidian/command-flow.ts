import { TFile, normalizePath, type App } from "obsidian";
import { parseEml } from "../core/mime/parse";
import { emlPathFor, verifyEml } from "../core/commands/eml";
import { executeCommandPlan, type CommandExecuteDeps, type CommandExecuteResult } from "../core/commands/execute";
import { schemaOf, type CommandContext, type CommandDescriptor, type CommandErrorCode, type CommandProbe, type MailNoteRef, type MailTarget } from "../core/commands/types";
import type { MailProfile } from "../core/mirror/profile";
import { SchemaFormModal } from "./modals/schema-form-modal";
import { PlanPreviewModal } from "./modals/plan-preview-modal";
import { trTitle } from "./command-i18n";
import { findMailNotes, type ZoneHashStore } from "./vault-notes";

export interface CommandFlowDeps {
  app: App;
  profile: () => MailProfile;
  hashes: ZoneHashStore;
  now: () => Date;
}

export type RunResult =
  | { kind: "cancelled" }
  | { kind: "done"; result: CommandExecuteResult }
  | { kind: "error"; code: CommandErrorCode };

/** Die Notiz als Kommando-Ziel — oder null, wenn sie keine Mail-Notiz ist. Herkunft und
 *  Zustand duerfen fehlen (Altbestand aus einem Import vor M3); die Kommandos reichen dann
 *  weiter, was dasteht, und erfinden nichts. */
export function mailTargetFor(profile: MailProfile, path: string, frontmatter: Record<string, unknown>): MailTarget | null {
  const id = frontmatter[profile.idField];
  if (typeof id !== "string" || id === "") return null;
  const source = frontmatter[profile.sourceField];
  const state = frontmatter[profile.stateField];
  return {
    mailId: id,
    path,
    source: typeof source === "string" ? source : "",
    state: typeof state === "string" ? state : null,
  };
}

/** Synchrone Vorpruefung fuer `checkCallback` — s. Task-Kommentar im Plan. */
export function probeFor(app: App, profile: MailProfile): CommandProbe | null {
  const file = app.workspace.getActiveFile();
  if (!file || file.extension !== "md") return null;
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const target = mailTargetFor(profile, file.path, frontmatter);
  return target ? { profile, target, frontmatter } : null;
}

async function loadNotes(app: App, profile: MailProfile, hashes: ZoneHashStore): Promise<MailNoteRef[]> {
  const out: MailNoteRef[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const id: unknown = frontmatter[profile.idField];
    if (typeof id !== "string" || id === "") continue;
    out.push({ mailId: id, path: f.path, content: await app.vault.cachedRead(f), frontmatter, zoneHash: hashes.get(id) });
  }
  return out;
}

/** Wer die Anhangzugriffe benutzt, ohne sie anzufordern, bekommt sie nicht als stillen
 *  Fehlwert (falscher Pfad, "nichts vorhanden"), sondern als Ausnahme — der Aufrufer faengt
 *  sie als `unexpected`. Ein Programmierfehler, kein Nutzerfehler. */
function anhangzugriffErlaubt(descriptor: CommandDescriptor): void {
  if (!descriptor.needs?.attachments) throw new Error(`${descriptor.id}: needs.attachments nicht deklariert`);
}

export async function buildContext(
  deps: CommandFlowDeps,
  descriptor: CommandDescriptor,
  file: TFile | null,
): Promise<{ ok: true; ctx: CommandContext } | { ok: false; code: CommandErrorCode }> {
  const { app } = deps;
  const profile = deps.profile();
  if (!(file instanceof TFile)) return { ok: false, code: "not-applicable" };
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const target = mailTargetFor(profile, file.path, frontmatter);
  if (!target) return { ok: false, code: "not-applicable" };

  // findMailNotes() macht denselben Scan (getMarkdownFiles + Metadata-Cache-Frontmatter) wie
  // ein hier eigens geschriebener Index es taete — nur der Wert ist ein anderer (Pfad ohne
  // ".md" statt TFile), deshalb hier abgeleitet statt dupliziert (Fix-Runde 1, Finding 1).
  const index = new Map<string, string>();
  for (const [id, f] of findMailNotes(app, profile.idField)) index.set(id, f.path.replace(/\.md$/, ""));

  const attachmentPaths = new Map<string, string>();
  const vorhandeneAnhaenge = new Map<string, { path: string; data: Uint8Array }>();
  let mail: Awaited<ReturnType<typeof parseEml>> | undefined;
  if (descriptor.needs?.eml) {
    const emlFile = app.vault.getAbstractFileByPath(normalizePath(emlPathFor(profile, file.path)));
    if (!(emlFile instanceof TFile)) return { ok: false, code: "eml-missing" };
    let parsed: Awaited<ReturnType<typeof parseEml>>;
    try {
      parsed = await parseEml(new Uint8Array(await app.vault.readBinary(emlFile)));
    } catch {
      return { ok: false, code: "eml-unparseable" };
    }
    const check = verifyEml(parsed, target.mailId);
    if (!check.ok) return { ok: false, code: check.code };
    mail = parsed;
    // getAvailablePathForAttachment ist async, `plan()` ist synchron — also hier aufloesen.
    // Nur fuer Kommandos, die es DEKLARIEREN: `mail.rerender` ruft attachmentPathFor nie, zahlte
    // die Vault-Zugriffe aber mit (M3b-Nachlese, geparkter Befund 5).
    if (descriptor.needs.attachments) {
      for (const a of parsed.attachments.filter((x) => !x.inline)) {
        const frei = await app.fileManager.getAvailablePathForAttachment(a.name, file.path);
        attachmentPaths.set(a.name, frei);
        // Weicht Obsidian auf "<stamm> 1" aus, liegt am blanken Namen bereits eine Datei. Deren
        // Bytes braucht `plan()`, um zu entscheiden, ob es DIESELBE Anlage ist (dann wird sie
        // verlinkt) oder eine gleichnamige andere (dann entsteht die zweite Datei).
        const blank = `${frei.slice(0, frei.lastIndexOf("/") + 1)}${a.name}`;
        if (blank === frei) continue;
        const da = app.vault.getAbstractFileByPath(normalizePath(blank));
        if (da instanceof TFile) vorhandeneAnhaenge.set(a.name, { path: blank, data: new Uint8Array(await app.vault.readBinary(da)) });
      }
    }
  }

  const notes = descriptor.needs?.allNotes ? await loadNotes(app, profile, deps.hashes) : undefined;

  return {
    ok: true,
    ctx: {
      now: deps.now(),
      profile,
      target,
      frontmatter,
      content: await app.vault.read(file),
      zoneHash: deps.hashes.get(target.mailId),
      linkFor: (id) => index.get(id) ?? null,
      attachmentPathFor: (name) => {
        anhangzugriffErlaubt(descriptor);
        return attachmentPaths.get(name) ?? `${name}`;
      },
      existingAttachment: (name) => {
        anhangzugriffErlaubt(descriptor);
        return vorhandeneAnhaenge.get(name) ?? null;
      },
      ...(mail ? { mail } : {}),
      ...(notes ? { notes } : {}),
    },
  };
}

/**
 * Die volle Kette: Kontext bauen → (Formular, falls das Schema Felder hat) → Plan →
 * Vorschau → ausfuehren. Jeder Abbruch durch den Nutzer ist `cancelled`, kein Fehler.
 */
export async function runCommand(
  deps: CommandFlowDeps,
  execute: CommandExecuteDeps,
  descriptor: CommandDescriptor,
  // Fix-Runde 1, Important 1 (Task 6): Default bleibt das bisherige Verhalten (Befehlspalette
  // liest die aktive Notiz), aber ein Aufrufer, dessen "aktive View" keine FileView ist —
  // z. B. ein Klick im Posteingang, waehrend die MailstoneView den Hauptbereich haelt —, kann
  // die Ziel-Notiz explizit uebergeben, statt sich auf Obsidians "zuletzt aktive Datei"-
  // Fallback zu verlassen. `buildContext` nimmt die Datei ohnehin schon als Parameter.
  file: TFile | null = deps.app.workspace.getActiveFile(),
): Promise<RunResult> {
  const built = await buildContext(deps, descriptor, file);
  if (!built.ok) return { kind: "error", code: built.code };
  const ctx = built.ctx;
  if (!descriptor.appliesTo(ctx)) return { kind: "error", code: "not-applicable" };

  const schema = schemaOf(descriptor, ctx);
  let input: Record<string, unknown> = {};
  if (Object.keys(schema.properties).length > 0) {
    const picked = await new SchemaFormModal(deps.app, trTitle(descriptor), schema).pick();
    if (!picked) return { kind: "cancelled" };
    input = picked;
  }

  const planned = descriptor.plan(input, ctx);
  if (!planned.ok) return { kind: "error", code: planned.code };

  const go = await new PlanPreviewModal(deps.app, planned.plan).confirm();
  if (!go) return { kind: "cancelled" };

  return { kind: "done", result: await executeCommandPlan(planned.plan, execute) };
}
