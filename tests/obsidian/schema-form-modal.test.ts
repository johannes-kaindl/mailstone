import { describe, it, expect } from "vitest";
import { parseFormValues, SchemaFormModal } from "../../src/obsidian/modals/schema-form-modal";
import { Setting } from "obsidian";
import type { ObjectSchema } from "../../src/core/commands/schema";

const schema: ObjectSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    note: { type: "string", format: "multiline" },
    count: { type: "number" },
    flag: { type: "boolean" },
    list: { type: "array", items: { type: "string" } },
  },
  required: ["name"],
};

describe("parseFormValues", () => {
  it("laesst leere optionale Felder weg", () => {
    expect(parseFormValues(schema, { name: "a", note: "", count: "" })).toEqual({ name: "a" });
  });
  it("behaelt ein leeres PFLICHTfeld, damit die Validierung es bemaengeln kann", () => {
    expect(parseFormValues(schema, { name: "" })).toEqual({ name: "" });
  });
  it("wandelt Zahlen", () => {
    expect(parseFormValues(schema, { name: "a", count: "3" })).toEqual({ name: "a", count: 3 });
  });
  it("macht aus Zeilen eine Liste und wirft Leerzeilen weg", () => {
    expect(parseFormValues(schema, { name: "a", list: "x\n\n y \n" })).toEqual({ name: "a", list: ["x", "y"] });
  });
  it("nimmt einen Toggle als boolean", () => {
    expect(parseFormValues(schema, { name: "a", flag: true })).toEqual({ name: "a", flag: true });
  });
  it("uebergeht Rohwerte, die im Schema nicht vorkommen", () => {
    expect(parseFormValues(schema, { name: "a", fremd: "x" })).toEqual({ name: "a" });
  });
});

/** Alle Knopf-Komponenten unterhalb eines Fake-Elements — der Mock kennt kein querySelector. */
function knoepfe(el: any): any[] {
  const out: any[] = [];
  const gehe = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (n.__component && typeof n.__component.clickCB !== "undefined") out.push(n.__component);
    for (const k of n.children ?? []) gehe(k);
  };
  gehe(el);
  return out;
}

/** Formular oeffnen und SOFORT absenden — ohne eine einzige Eingabe. Was dann herauskommt,
 *  ist genau das, was `default` vorbelegt hat. */
function sofortAbsenden(schema: ObjectSchema): Promise<Record<string, unknown> | null> {
  const modal = new SchemaFormModal({} as never, "Titel", schema);
  const p = modal.pick();
  const cta = knoepfe((modal as unknown as { contentEl: unknown }).contentEl).find((b) => b.ctaSet);
  cta?.clickCB?.();
  return p;
}

// Der `default`-Zweig fuer `format: "date"` und `multiline` kam mit dem M5-Abschluss dazu und
// war ungetestet — kein Kommando nimmt ihn derzeit (das einzige Datumsfeld, `due` in
// mail.createTask, traegt keinen Default). Ein unerreichter Pfad ohne Test faellt beim ERSTEN
// echten Konsumenten auf und sieht dann nach dessen Fehler aus.
describe("SchemaFormModal ehrt `default` im ganzen string-Zweig", () => {
  it("belegt ein Datumsfeld vor — im Wert UND sichtbar in der Komponente", async () => {
    const schema: ObjectSchema = { type: "object", properties: { due: { type: "string", format: "date", default: "2026-09-09" } } };
    const p = sofortAbsenden(schema);
    expect(Setting.__last?.components[0]?.getValue()).toBe("2026-09-09");
    await expect(p).resolves.toEqual({ due: "2026-09-09" });
  });

  it("belegt ein Mehrzeilenfeld vor", async () => {
    const schema: ObjectSchema = { type: "object", properties: { note: { type: "string", format: "multiline", default: "Erste Zeile" } } };
    const p = sofortAbsenden(schema);
    expect(Setting.__last?.components[0]?.getValue()).toBe("Erste Zeile");
    await expect(p).resolves.toEqual({ note: "Erste Zeile" });
  });

  it("laesst ein Datumsfeld OHNE default leer — die Vorbelegung ist nicht der Normalfall", async () => {
    const schema: ObjectSchema = { type: "object", properties: { due: { type: "string", format: "date" } } };
    await expect(sofortAbsenden(schema)).resolves.toEqual({});
  });
});
