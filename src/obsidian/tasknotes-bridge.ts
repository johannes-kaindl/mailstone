// Bruecke zu TaskNotes. Muster: src/obsidian/calendar-notes-bridge.ts (koda-agent/
// src/obsidian/retrieval.ts als Ursprung). Bei JEDEM Aufruf frisch lesen — das
// Nachbarplugin kann mitten in der Sitzung deaktiviert werden.
import type { App } from "obsidian";
import { TASKNOTES_API_VERSION, type TaskNotesApiSubset, type TaskNotesTaskInput } from "../core/api/tasknotes-api";

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

/** Baut die Eingabe fuer `tasks.create` aus dem Plan (Feldnamen aus der Messung, Spec § 8.1):
 *  `due` statt `dueDate`, der Notiz-Link geht als Wikilink in `details` — TaskNotes hat kein
 *  eigenes Link-Feld und rendert `details` als Aufgaben-Rumpf. */
function buildTaskInput(req: { title: string; due: string | null; noteLink: string }): TaskNotesTaskInput {
  return {
    title: req.title,
    ...(req.due !== null ? { due: req.due } : {}),
    details: `[[${req.noteLink}]]`,
  };
}

/** `tasks.create` liefert das volle Task-Objekt (kein Promise-Wrapper), aber nie ein eigenes
 *  `id`-Feld — `path` ist die brauchbare Identitaet fuer eine Erfolgs-Notice (Spec § 8.1). */
function pathOf(result: unknown): string {
  if (result !== null && typeof result === "object" && "path" in result) {
    const p = (result as Record<string, unknown>).path;
    if (typeof p === "string") return p;
  }
  return "";
}

/** Fuehrt die Absicht aus. Wirft NIE — die Zusage gehoert der Seite, die sie gibt, nicht
 *  jedem Aufrufer einzeln (REGISTRY, Anbieter-Muster). Liest die API und prueft ihre Form ein
 *  ZWEITES Mal: zwischen dem Anbieten des Kommandos (Pruefstelle 1, s. main.ts) und diesem
 *  Aufruf liegt beliebig viel Zeit, in der das Nachbarplugin deaktiviert worden sein kann.
 *  Kein `validateTask`-Schritt (Ruling Task 0, s. Spec § 2.1/§ 8.1): gemessen erwartet es ein
 *  vollstaendiges TaskInfo und meldet fuer jede gueltige Erstellungs-Eingabe missing_required —
 *  ein Fehlschlag von `tasks.create` selbst kommt als task-create-failed zurueck. */
export async function createTaskViaBridge(
  app: App,
  req: { title: string; due: string | null; noteLink: string },
): Promise<{ ok: true; path: string } | { ok: false; code: "tasknotes-unavailable" | "task-create-failed" }> {
  const api = readTaskNotesApi(app);
  if (!api) return { ok: false, code: "tasknotes-unavailable" };
  try {
    const result = await api.tasks.create(buildTaskInput(req));
    return { ok: true, path: pathOf(result) };
  } catch {
    return { ok: false, code: "task-create-failed" };
  }
}
