import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { readTaskNotesApi } from "../../src/obsidian/tasknotes-bridge";

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
