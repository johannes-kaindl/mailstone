import { describe, it, expect } from "vitest";
import { parseFormValues, SchemaFormModal } from "../../src/obsidian/modals/schema-form-modal";
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

/** Alle Komponenten unterhalb eines Fake-Elements — der Mock kennt kein querySelector.
 *  Ueber den DOM-Baum statt ueber `Setting.__last`: die Test-Affordanz des Mocks steht nicht
 *  in Obsidians Typen, und `typecheck:test` prueft gegen die echten. */
function komponenten(el: unknown): any[] {
  const out: any[] = [];
  const gehe = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (n.__component) out.push(n.__component);
    for (const k of n.children ?? []) gehe(k);
  };
  gehe(el);
  return out;
}

const knoepfe = (el: unknown): any[] => komponenten(el).filter((c) => "clickCB" in c);
const eingabe = (el: unknown): any => komponenten(el).find((c) => typeof c.getValue === "function");

/** Formular oeffnen. Absenden ist ein zweiter Schritt: `submit()` schliesst das Modal, und
 *  `onClose` leert `contentEl` — wer die Komponente danach sucht, findet nichts mehr. */
function formular(schema: ObjectSchema): { fertig: Promise<Record<string, unknown> | null>; wurzel: unknown } {
  const modal = new SchemaFormModal({} as never, "Titel", schema);
  const fertig = modal.pick();
  return { fertig, wurzel: (modal as unknown as { contentEl: unknown }).contentEl };
}

/** Absenden, ohne eine einzige Eingabe gemacht zu haben — was dann herauskommt, ist genau
 *  das, was `default` vorbelegt hat. */
function absenden(f: { wurzel: unknown }): void {
  knoepfe(f.wurzel).find((b) => b.ctaSet)?.clickCB?.();
}

// Der `default`-Zweig fuer `format: "date"` und `multiline` kam mit dem M5-Abschluss dazu und
// war ungetestet — kein Kommando nimmt ihn derzeit (das einzige Datumsfeld, `due` in
// mail.createTask, traegt keinen Default). Ein unerreichter Pfad ohne Test faellt beim ERSTEN
// echten Konsumenten auf und sieht dann nach dessen Fehler aus.
describe("SchemaFormModal ehrt `default` im ganzen string-Zweig", () => {
  it("belegt ein Datumsfeld vor — im Wert UND sichtbar in der Komponente", async () => {
    const schema: ObjectSchema = { type: "object", properties: { due: { type: "string", format: "date", default: "2026-09-09" } } };
    const f = formular(schema);
    expect(eingabe(f.wurzel)?.getValue()).toBe("2026-09-09");
    absenden(f);
    await expect(f.fertig).resolves.toEqual({ due: "2026-09-09" });
  });

  it("belegt ein Mehrzeilenfeld vor", async () => {
    const schema: ObjectSchema = { type: "object", properties: { note: { type: "string", format: "multiline", default: "Erste Zeile" } } };
    const f = formular(schema);
    expect(eingabe(f.wurzel)?.getValue()).toBe("Erste Zeile");
    absenden(f);
    await expect(f.fertig).resolves.toEqual({ note: "Erste Zeile" });
  });

  it("laesst ein Datumsfeld OHNE default leer — die Vorbelegung ist nicht der Normalfall", async () => {
    const schema: ObjectSchema = { type: "object", properties: { due: { type: "string", format: "date" } } };
    const f = formular(schema);
    expect(eingabe(f.wurzel)?.getValue()).toBe("");
    absenden(f);
    await expect(f.fertig).resolves.toEqual({});
  });
});
