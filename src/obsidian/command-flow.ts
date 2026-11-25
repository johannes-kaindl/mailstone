import { TFile, normalizePath, type App } from "obsidian";
import { parseEml } from "../core/mime/parse";
import { emlPathFor, verifyEml } from "../core/commands/eml";
import { executeCommandPlan, type CommandExecuteDeps, type CommandExecuteResult } from "../core/commands/execute";
import { emptyChoiceField, predeterminedInput } from "../core/commands/schema";
import { VAULT_TARGET, schemaOf, type CommandContext, type CommandDescriptor, type CommandErrorCode, type CommandProbe, type ContextErrorCode, type MailNoteRef, type MailTarget } from "../core/commands/types";
import type { FetchOriginalRequest, FetchOriginalResult } from "../core/originals/fetch-original";
import type { MailProfile } from "../core/mirror/profile";
import { transformMail, type TransformPort } from "../core/transform/transform-mail";
import type { OriginalFacts } from "../core/transform/original-facts";
import type { RestorePort } from "../core/transform/restore";
import type { ParsedMail } from "../core/mime/types";
import { noMailText } from "./transform-text";
import { SchemaFormModal } from "./modals/schema-form-modal";
import { PlanPreviewModal } from "./modals/plan-preview-modal";
import { trTitle } from "./command-i18n";
import { probeEml } from "./eml-probe";
import { threadRefsFor } from "./thread-index";
import { findMailNotes, type ZoneHashStore } from "./vault-notes";
import { joinVaultPath, vaultDirname } from "../vendor/kit/vault-path";

export interface CommandFlowDeps {
  app: App;
  profile: () => MailProfile;
  hashes: ZoneHashStore;
  now: () => Date;
  /** Holt das Original einer Mail vom Server, wenn neben der Notiz keine brauchbare .eml liegt
   *  (A6). Fehlt die Dep (Mobile: `networkFeaturesAvailable()` ist false), meldet buildContext
   *  `original-desktop-only`. */
  fetchOriginal?: (req: FetchOriginalRequest) => Promise<FetchOriginalResult>;
  /** Pseudonymisieren (A5): der Port zum Plugin pseudonymizer. Gerufen wird er nur bei `profile.pseudonymize !== "off"`, mit `interactive: true`
   *  (ein Befehl ist die Handlung eines Menschen). Fehlt er bei eingeschaltetem Schalter, liefert `buildContext` nie die Klartext-Mail. */
  pseudonymize?: TransformPort;
  /** Rueckwandlung (A5, Schritt 5): kommt als `ctx.restore` bei jedem Kommando an, das etwas hinausgibt (`mail.replyExternal`). */
  restore?: RestorePort;
}

export type RunResult =
  | { kind: "cancelled" }
  | { kind: "done"; result: CommandExecuteResult }
  | { kind: "error"; code: ContextErrorCode; /** Argument fuer den Fehlertext, etwa die durchsuchten Ordner. */ detail?: string };

type ContextFailure = { ok: false; code: ContextErrorCode; detail?: string };

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

/** Die Vorpruefung fuer einen Befehl: die geoeffnete Mail-Notiz, sonst fuer einen vault-weiten Befehl (`scope: "vault"`) das leere
 *  Ziel. Ein vault-weiter Befehl steht so auch ohne Mail-Notiz in der Palette (vorher fand ihn nach dem Umstellen einer Einstellung
 *  niemand); ein notizgebundener fehlt weiter. */
export function commandProbe(app: App, profile: MailProfile, descriptor: CommandDescriptor): CommandProbe | null {
  return probeFor(app, profile) ?? (descriptor.scope === "vault" ? { profile, target: VAULT_TARGET, frontmatter: {} } : null);
}

async function loadNotes(app: App, profile: MailProfile, hashes: ZoneHashStore, withEmlProbe: boolean, withThreads: boolean): Promise<MailNoteRef[]> {
  const out: MailNoteRef[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const id: unknown = frontmatter[profile.idField];
    if (typeof id !== "string" || id === "") continue;
    const eml = withEmlProbe ? await probeEml(app, profile, f.path, id) : undefined;
    out.push({ mailId: id, path: f.path, content: await app.vault.cachedRead(f), frontmatter, zoneHash: hashes.get(id), ...(eml ? { eml } : {}), ...(withThreads ? { thread: threadRefsFor(app, profile, f.path, frontmatter) } : {}) });
  }
  return out;
}

/** Wer die Anhangzugriffe benutzt, ohne sie anzufordern, bekommt sie nicht als stillen
 *  Fehlwert (falscher Pfad, "nichts vorhanden"), sondern als Ausnahme — der Aufrufer faengt
 *  sie als `unexpected`. Ein Programmierfehler, kein Nutzerfehler. */
function anhangzugriffErlaubt(descriptor: CommandDescriptor): void {
  if (!descriptor.needs?.attachments) throw new Error(`${descriptor.id}: needs.attachments nicht deklariert`);
}

/** Die Mail zu einer Notiz: die .eml am Konventionspfad, wenn sie da ist, zu dieser Mail gehoert
 *  und sich lesen laesst; sonst das Original vom Server (A6). Die geholten Bytes werden nie in
 *  den Vault geschrieben. Ist die lokale .eml da, aber nicht brauchbar (`eml-mismatch`,
 *  `eml-unparseable`), und der Server liefert auch nichts oder kann nicht gefragt werden, bleibt
 *  es bei der lokalen Meldung; Busy und Netzfehler gehen vor, sie sind behebbar. */
async function loadOriginal(
  deps: CommandFlowDeps,
  profile: MailProfile,
  file: TFile,
  target: MailTarget,
): Promise<{ ok: true; mail: ParsedMail; facts?: OriginalFacts } | ContextFailure> {
  const { app } = deps;
  let local: CommandErrorCode | null = null;
  const emlFile = app.vault.getFileByPath(normalizePath(emlPathFor(profile, file.path)));
  if (emlFile) {
    let usable: ParsedMail | null = null;
    try {
      const parsed = await parseEml(new Uint8Array(await app.vault.readBinary(emlFile)));
      const check = verifyEml(parsed, target.mailId);
      if (check.ok) usable = parsed;
      else local = check.code;
    } catch {
      local = "eml-unparseable";
    }
    if (usable) return transformed(deps, profile, usable);
  }
  if (!deps.fetchOriginal) return { ok: false, code: local ?? "original-desktop-only" };
  const r = await deps.fetchOriginal({ mailId: target.mailId, source: target.source });
  if (!r.ok) {
    switch (r.code) {
      case "busy": return { ok: false, code: "busy" };
      case "original-not-found":
        return local ? { ok: false, code: local } : { ok: false, code: "original-not-found", detail: r.detail };
      case "original-unsearchable":
        return { ok: false, code: local ?? "original-unsearchable" };
      default: return { ok: false, code: `error.sync.${r.code}` };
    }
  }
  let parsed: ParsedMail;
  try {
    parsed = await parseEml(r.bytes);
  } catch {
    return { ok: false, code: "eml-unparseable" };
  }
  const check = verifyEml(parsed, target.mailId);
  return check.ok ? transformed(deps, profile, parsed) : { ok: false, code: check.code };
}

/** Pseudonymisieren (A5): nach jedem `parseEml` und der Pruefung gegen die Notiz geht die Mail durch denselben Transformer wie im Sync
 *  (hier mit `interactive: true`). Bei „Aus“ geschieht nichts. Wartet oder scheitert er, entsteht kein Kontext: nichts wird geschrieben. */
async function transformed(deps: CommandFlowDeps, profile: MailProfile, mail: ParsedMail): Promise<{ ok: true; mail: ParsedMail; facts?: OriginalFacts } | ContextFailure> {
  if (profile.pseudonymize === "off") return { ok: true, mail };
  const port: TransformPort = deps.pseudonymize ?? (() => Promise.resolve({ kind: "wait", reason: "not-ready", message: "no pseudonymizer port bound" }));
  const r = await transformMail(mail, profile, port, { interactive: true });
  if (r.kind === "mail") return { ok: true, mail: r.mail, facts: r.facts };
  const detail = noMailText(r);
  return { ok: false, code: r.kind === "wait" ? "error.command.pseudonymize-wait" : "error.command.pseudonymize-error", detail };
}

export async function buildContext(
  deps: CommandFlowDeps,
  descriptor: CommandDescriptor,
  file: TFile | null,
): Promise<{ ok: true; ctx: CommandContext } | ContextFailure> {
  const { app } = deps;
  const profile = deps.profile();
  const fileFrontmatter = file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter ?? {} : {};
  const noteTarget = file instanceof TFile ? mailTargetFor(profile, file.path, fileFrontmatter) : null;
  // Ein vault-weiter Befehl laeuft auch ohne Mail-Notiz: dann mit leerem Ziel, ohne Inhalt und ohne Frontmatter der aktiven Datei.
  const vaultOnly = noteTarget === null && descriptor.scope === "vault" && !descriptor.needs?.eml;
  if (!noteTarget && !vaultOnly) return { ok: false, code: "not-applicable" };
  const target = noteTarget ?? VAULT_TARGET;
  const frontmatter = noteTarget ? fileFrontmatter : {};

  // findMailNotes() macht denselben Scan (getMarkdownFiles + Metadata-Cache-Frontmatter) wie
  // ein hier eigens geschriebener Index es taete — nur der Wert ist ein anderer (Pfad ohne
  // ".md" statt TFile), deshalb hier abgeleitet statt dupliziert (Fix-Runde 1, Finding 1).
  const index = new Map<string, string>();
  for (const [id, f] of findMailNotes(app, profile.idField)) index.set(id, f.path.replace(/\.md$/, ""));

  const attachmentPaths = new Map<string, string>();
  const vorhandeneAnhaenge = new Map<string, { path: string; data: Uint8Array }>();
  let mail: ParsedMail | undefined;
  let facts: OriginalFacts | undefined;
  if (descriptor.needs?.eml && file instanceof TFile) {
    const loaded = await loadOriginal(deps, profile, file, target);
    if (!loaded.ok) return loaded;
    const parsed = loaded.mail;
    mail = parsed;
    facts = loaded.facts;
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
        const blank = joinVaultPath(vaultDirname(frei), a.name);
        if (blank === frei) continue;
        const da = app.vault.getFileByPath(normalizePath(blank));
        if (da) vorhandeneAnhaenge.set(a.name, { path: blank, data: new Uint8Array(await app.vault.readBinary(da)) });
      }
    }
  }

  const notes = descriptor.needs?.allNotes ? await loadNotes(app, profile, deps.hashes, descriptor.needs.emlProbe === true, descriptor.needs.threads === true) : undefined;

  return {
    ok: true,
    ctx: {
      now: deps.now(),
      profile,
      target,
      frontmatter,
      content: noteTarget && file instanceof TFile ? await app.vault.read(file) : "",
      zoneHash: noteTarget ? deps.hashes.get(target.mailId) : null,
      linkFor: (id) => index.get(id) ?? null,
      attachmentPathFor: (name) => {
        anhangzugriffErlaubt(descriptor);
        const pfad = attachmentPaths.get(name);
        // Kein Rueckfall auf den nackten Namen: der waere vault-RELATIV und schriebe die Anlage
        // in die Wurzel statt in den Anhangordner — ein stiller Fehlwert derselben Bauart, die
        // der Guard eine Zeile darueber ausschliesst. Unerreichbar, solange der Name aus
        // `nonInlineAttachments` stammt; genau deshalb soll ein kuenftiger zweiter Aufrufer
        // laut scheitern statt woanders hin zu schreiben.
        if (pfad === undefined) throw new Error(`${descriptor.id}: kein aufgeloester Anhangpfad fuer "${name}"`);
        return pfad;
      },
      existingAttachment: (name) => {
        anhangzugriffErlaubt(descriptor);
        return vorhandeneAnhaenge.get(name) ?? null;
      },
      ...(mail ? { mail } : {}),
      ...(facts ? { facts } : {}),
      ...(deps.restore ? { restore: deps.restore } : {}),
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
  if (!built.ok) return { kind: "error", code: built.code, ...(built.detail !== undefined ? { detail: built.detail } : {}) };
  const ctx = built.ctx;
  if (!descriptor.appliesTo(ctx)) return { kind: "error", code: "not-applicable" };

  const schema = schemaOf(descriptor, ctx);
  // Ein Auswahlfeld ohne Option macht das Formular unbedienbar — kein Eintrag im Dropdown, und
  // jeder Absendeversuch scheitert an `must be one of []`. Statt es zu zeigen und den Nutzer in
  // eine Sackgasse laufen zu lassen, wird hier abgebrochen (M3b-Nachlese, geparkter Befund 2;
  // entschieden am 2026-09-05).
  if (emptyChoiceField(schema) !== null) return { kind: "error", code: "no-choices" };

  // Dieselbe Achse eine Stufe weiter: steht die Eingabe schon fest (nur Auswahlfelder mit je
  // GENAU einer Option — der Normalfall bei einer Mail mit einem Anhang), gibt es nichts zu
  // fragen, und das Formular bleibt zu. Bestaetigt wird weiterhin in der Vorschau, es geht also
  // keine Zustimmung verloren, nur ein Klick ohne Inhalt. Ein Schema ohne Felder faellt in
  // denselben Zweig ({} ist festgelegt) — das war vorher die eigene `length > 0`-Bedingung.
  let input = predeterminedInput(schema);
  if (input === null) {
    const picked = await new SchemaFormModal(deps.app, trTitle(descriptor), schema).pick();
    if (!picked) return { kind: "cancelled" };
    input = picked;
  }

  const planned = descriptor.plan(input, ctx);
  if (!planned.ok) return { kind: "error", code: planned.hintKey ?? planned.code };

  const go = await new PlanPreviewModal(deps.app, planned.plan).confirm();
  if (!go) return { kind: "cancelled" };

  return { kind: "done", result: await executeCommandPlan(planned.plan, execute) };
}
