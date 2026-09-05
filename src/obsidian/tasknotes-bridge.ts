// Bruecke zu TaskNotes. Muster: src/obsidian/calendar-notes-bridge.ts (koda-agent/
// src/obsidian/retrieval.ts als Ursprung). Bei JEDEM Aufruf frisch lesen — das
// Nachbarplugin kann mitten in der Sitzung deaktiviert werden.
import type { App } from "obsidian";
import { TASKNOTES_API_VERSION, type TaskNotesApiSubset } from "../core/api/tasknotes-api";

const PLUGIN_ID = "tasknotes";

/** `app.plugins` ist nicht Teil der offiziellen Obsidian-Typen — lokal nachgebildet, nur so
 *  weit wie hier gebraucht. */
interface AppWithPlugins {
  plugins?: { plugins?: Record<string, { api?: unknown } | undefined> };
}

function isTaskNotesApi(v: unknown): v is TaskNotesApiSubset {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const tasks = o.tasks as Record<string, unknown> | undefined;
  const model = o.model as Record<string, unknown> | undefined;
  // hasCapability wird bewusst NICHT gefragt. Gemessen am 2026-09-05 gegen 4.12.5:
  // hasCapability("tasks.create") === false, waehrend api.tasks.create funktioniert
  // (tasks.write sagt true). Die Capability-Strings sind nicht systematisch — jeder aus
  // einem Methodennamen abgeleitete String ist unzuverlaessig. typeof ist die haltbare
  // Pruefung. Details: docs/superpowers/specs/2026-09-05-m5-tasknotes-design.md Paragraph 2.2
  return (
    o.apiVersion === TASKNOTES_API_VERSION &&
    typeof tasks?.create === "function" &&
    typeof model?.config === "function"
  );
}

/** Defensives Lesen der fremden API. `null` heisst: Faehigkeit nicht anbieten. */
export function readTaskNotesApi(app: App): TaskNotesApiSubset | null {
  const api = (app as unknown as AppWithPlugins).plugins?.plugins?.[PLUGIN_ID]?.api;
  return isTaskNotesApi(api) ? api : null;
}
