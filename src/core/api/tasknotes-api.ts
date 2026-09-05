// uebernommen aus tasknotes 4.12.5 (app.plugins.plugins.tasknotes.api), 2026-09-05
// Nur die Teilmenge, die mailstone braucht. Nicht importiert, sondern kopiert: zwei
// eigenstaendige Repos gehen kein Build-Coupling ein (PROF-OBS-09); die Versionsnummer
// ersetzt den Compiler.
//
// model.validateTask ist bewusst NICHT Teil dieser Teilmenge (Ruling Task 0, 2026-09-05):
// gemessen erwartet es ein vollstaendiges TaskInfo und meldet fuer JEDE Erstellungs-Eingabe
// missing_required fuer status/dateCreated/dateModified, die create() selbst befuellt. Es ist
// fuer eine Vorab-Validierung von Erstellungs-Auftraegen ungeeignet, nicht nur additiv.
export const TASKNOTES_API_VERSION = 1;

export interface TaskNotesDefaults {
  status: string;
  priority: string;
  taskTag: string;
}

export interface TaskNotesConfig {
  defaults: TaskNotesDefaults;
  fieldMapping: Record<string, string>;
}

/**
 * Feldform gemessen gegen TaskNotes 4.12.5 (Task 0, 2026-09-05): einziges Pflichtfeld ist
 * `title`. Faelligkeit heisst `due` (String YYYY-MM-DD) — NICHT `dueDate`; dieser Feldname
 * wird von TaskNotes stillschweigend ignoriert, statt einen Fehler zu werfen. `details` ist
 * ein Freitext-Rumpf und der Trageplatz fuer den Rueckverweis auf die Mail-Notiz (kein
 * eigenes Link-Feld vorhanden).
 */
export interface TaskNotesTaskInput {
  title: string;
  /** ISO-Datum. Heisst `due`, NICHT `dueDate` (gemessen 2026-09-05). */
  due?: string;
  /** Rumpf der Aufgabe — hier traegt mailstone den Link auf die Mail-Notiz. */
  details?: string;
}

export interface TaskNotesApiSubset {
  apiVersion: number;
  tasks: { create(data: TaskNotesTaskInput, opts?: unknown): Promise<unknown> };
  model: {
    config(): Promise<TaskNotesConfig> | TaskNotesConfig;
  };
}
