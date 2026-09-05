import { describe, it, expect, vi } from "vitest";
import type { App } from "obsidian";
import { readTaskNotesApi, createTaskViaBridge } from "../../src/obsidian/tasknotes-bridge";

function appMit(api: unknown): App {
  return { plugins: { plugins: { tasknotes: { api } } } } as unknown as App;
}

const gueltig = {
  apiVersion: 1,
  tasks: { create: () => Promise.resolve({}) },
  model: { config: () => ({ defaults: { status: "open", priority: "normal", taskTag: "task" }, fieldMapping: {} }) },
};

describe("readTaskNotesApi", () => {
  it("liefert die API, wenn Version und Form stimmen", () => {
    expect(readTaskNotesApi(appMit(gueltig))).not.toBeNull();
  });

  it("liefert null, wenn TaskNotes fehlt", () => {
    expect(readTaskNotesApi({ plugins: { plugins: {} } } as unknown as App)).toBeNull();
  });

  it("liefert null bei fremder apiVersion — strikt, nicht groesser-gleich", () => {
    expect(readTaskNotesApi(appMit({ ...gueltig, apiVersion: 2 }))).toBeNull();
  });

  it("liefert null, wenn tasks.create fehlt", () => {
    expect(readTaskNotesApi(appMit({ ...gueltig, tasks: {} }))).toBeNull();
  });

  it("liefert null, wenn model.config fehlt", () => {
    expect(readTaskNotesApi(appMit({ ...gueltig, model: {} }))).toBeNull();
  });

  // Regressionstest zum Messbefund vom 2026-09-05: hasCapability("tasks.create") liefert
  // FALSE, obwohl api.tasks.create existiert und funktioniert. Wer das als Gate einbaut,
  // erzeugt einen lautlosen Totalausfall — das Kommando erschiene nie.
  it("ignoriert hasCapability vollstaendig", () => {
    const mitFalscherCapability = { ...gueltig, hasCapability: (c: string) => c !== "tasks.create" };
    expect(readTaskNotesApi(appMit(mitFalscherCapability))).not.toBeNull();
  });

  // Ruling 1 (2026-09-05): validateTask ist kein Teil des Formvertrags mehr — weder Pflicht
  // noch Ausschluss. Eine API mit validateTask muss genauso akzeptiert werden wie eine ohne.
  it("akzeptiert eine API mit ueberzaehligem model.validateTask genauso wie eine ohne", () => {
    const mitValidateTask = {
      ...gueltig,
      model: { ...gueltig.model, validateTask: () => ({ valid: false, errors: ["missing_required"] }) },
    };
    expect(readTaskNotesApi(appMit(mitValidateTask))).not.toBeNull();
    expect(readTaskNotesApi(appMit(gueltig))).not.toBeNull();
  });
});

const req = { title: "Angebot pruefen", due: "2026-12-24" as string | null, noteLink: "Mail/2026/x" };

describe("createTaskViaBridge", () => {
  it("legt die Aufgabe an und liefert den Pfad aus dem Rueckgabewert", async () => {
    const create = vi.fn(async () => ({ title: req.title, path: "TaskNotes/Tasks/x.md" }));
    const app = appMit({ ...gueltig, tasks: { create } });
    const r = await createTaskViaBridge(app, req);
    expect(r).toEqual({ ok: true, path: "TaskNotes/Tasks/x.md" });
    expect(create).toHaveBeenCalledWith({ title: req.title, due: req.due, details: `[[${req.noteLink}]]` });
  });

  it("laesst due weg, wenn keine Faelligkeit gesetzt ist", async () => {
    const create = vi.fn(async () => ({ path: "TaskNotes/Tasks/x.md" }));
    const app = appMit({ ...gueltig, tasks: { create } });
    await createTaskViaBridge(app, { ...req, due: null });
    expect(create).toHaveBeenCalledWith({ title: req.title, details: `[[${req.noteLink}]]` });
  });

  it("meldet tasknotes-unavailable, wenn die API fehlt", async () => {
    const r = await createTaskViaBridge({ plugins: { plugins: {} } } as unknown as App, req);
    expect(r).toEqual({ ok: false, code: "tasknotes-unavailable" });
  });

  it("meldet tasknotes-unavailable, wenn die API zwischen Anbieten und Aufruf verschwindet — die zweite Formpruefung greift", async () => {
    // Zuerst als vorhanden gelesen (Pruefstelle 1 haette das Kommando angeboten) —
    // beim eigentlichen Aufruf ist das Plugin bereits deaktiviert.
    const appDamals = appMit(gueltig);
    expect(readTaskNotesApi(appDamals)).not.toBeNull();
    const appJetzt = { plugins: { plugins: {} } } as unknown as App;
    const r = await createTaskViaBridge(appJetzt, req);
    expect(r).toEqual({ ok: false, code: "tasknotes-unavailable" });
  });

  it("meldet task-create-failed, wenn tasks.create wirft", async () => {
    const app = appMit({ ...gueltig, tasks: { create: vi.fn(async () => { throw new Error("Title is required"); }) } });
    const r = await createTaskViaBridge(app, req);
    expect(r).toEqual({ ok: false, code: "task-create-failed" });
  });

  it("liefert einen leeren Pfad, wenn der Rueckgabewert keinen traegt, statt zu werfen", async () => {
    const app = appMit({ ...gueltig, tasks: { create: vi.fn(async () => ({})) } });
    const r = await createTaskViaBridge(app, req);
    expect(r).toEqual({ ok: true, path: "" });
  });
});
