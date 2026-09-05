import { normalizePath, TFile, type App } from "obsidian";
import type { NotePlan } from "../core/mirror/plan";
import type { PlanExecutionResult, PlanExecutor, ZoneHashStore } from "../core/mirror/execute";
import type { MailIndex } from "../core/mirror/apply";
import type { MailProfile } from "../core/mirror/profile";
import { setFrontmatterField } from "../core/merge/merge";
import { normalizeMessageId } from "../core/mime/headers";

export type { PlanExecutionResult, PlanExecutor, ZoneHashStore };

async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = normalizePath(path).split("/");
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (await app.vault.adapter.exists(cur)) continue;
    try {
      await app.vault.createFolder(cur);
    } catch (e) {
      // Zwischen `exists` und `createFolder` kann ein anderer Vorgang denselben Ordner angelegt
      // haben — Sync und Kommandos laufen nebeneinander. Der Wurf des Nachbarn ist dann kein
      // Fehler, sein Ergebnis ist genau das gewuenschte. Geprueft wird die Wirkung, nicht der
      // Fehlertext: der ist nicht Teil der API und je nach Obsidian-Version anders formuliert.
      if (!(await app.vault.adapter.exists(cur))) throw e;
    }
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
            // Zeilenweise statt ueber `fileManager.processFrontMatter`: die API liest den Block
            // als YAML und schreibt ihn komplett neu — Kommentare gehen dabei verloren und die
            // Formatierung fremder Felder wird umgeschrieben (an einem echten Postfach gemessen,
            // M3-Nachlese 2026-08-30). Dieselbe Zurueckhaltung uebt der Rest des Moduls schon.
            const vorher = await app.vault.read(f);
            const gesetzt = setFrontmatterField({ existing: vorher, key: p.stateField, value: p.state });
            if (gesetzt.ok) {
              if (gesetzt.changed) await app.vault.modify(f, gesetzt.content);
            } else {
              // Rueckfall fuer den einen Fall, den der zeilenweise Weg nicht kann: das Feld liegt
              // als Block-Skalar vor. Dann ist eine Re-Serialisierung besser als ein stiller
              // Nicht-Schreibvorgang — der Zustand einer Notiz darf nicht an ihrer Formatierung
              // haengenbleiben.
              await app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
                fm[p.stateField] = p.state;
              });
            }
            // Gezaehlt wird der ausgefuehrte Plan, nicht der Schreibvorgang: steht der Zustand
            // schon richtig, ist der Plan trotzdem erledigt.
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

/** Gezielte Suche fuer EINE Message-ID, mit Abbruch beim Treffer — anders als `mailIndex()`
 *  baut sie keinen vollstaendigen Index auf. Gedacht fuer Aufrufer wie das Polling in
 *  `create-task-flow.ts` (Task 6), das in kurzem Takt wiederholt nach genau einer ID sucht;
 *  ein voller `mailIndex()`-Aufbau pro Tick waere bei 1s-Takt und 30s-Frist bis zu 31 volle
 *  Vault-Scans auf dem UI-Thread (dasselbe Muster wie `fetch.ts:50`, dort schon einmal
 *  behoben). Normalisiert BEIDE Seiten (Fix-Runde 1, Minor 5): eine von Hand mit spitzen
 *  Klammern geschriebene `mail_id` im Frontmatter traf sonst nie, obwohl `imVault` im
 *  Posteingang (das denselben Weg ueber `normalizeKnownIds` geht) sie als vorhanden zeigt. */
export function findNotePathForMailId(app: App, profile: MailProfile, mailId: string): string | null {
  const gesucht = normalizeMessageId(mailId) ?? mailId;
  for (const f of app.vault.getMarkdownFiles()) {
    const id: unknown = app.metadataCache.getFileCache(f)?.frontmatter?.[profile.idField];
    if (typeof id !== "string" || !id) continue;
    if ((normalizeMessageId(id) ?? id) === gesucht) return f.path;
  }
  return null;
}
