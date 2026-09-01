import { describe, it, expect } from "vitest";
import { validateInput, type ObjectSchema } from "../../../src/core/commands/schema";

const schema: ObjectSchema = {
  type: "object",
  properties: {
    name: { type: "string", enum: ["a.pdf", "b.ics"] },
    count: { type: "number", minimum: 1 },
    flag: { type: "boolean" },
    list: { type: "array", items: { type: "string", format: "email" } },
  },
  required: ["name"],
};

describe("validateInput", () => {
  it("nimmt eine gueltige Eingabe an", () => {
    expect(validateInput(schema, { name: "a.pdf" })).toEqual({ ok: true, value: { name: "a.pdf" } });
  });

  it("meldet einen fehlenden Pflichtwert", () => {
    const r = validateInput(schema, {});
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.errors[0]).toContain("missing (required)");
  });

  it("meldet einen Wert ausserhalb des enum", () => {
    const r = validateInput(schema, { name: "c.txt" });
    expect(r.ok === false && r.errors[0]).toContain("must be one of");
  });

  it("meldet ein unbekanntes Feld statt es durchzulassen", () => {
    const r = validateInput(schema, { name: "a.pdf", nope: 1 });
    expect(r.ok === false && r.errors[0]).toContain("unknown field");
  });

  it("prueft Array-Elemente einzeln", () => {
    const r = validateInput(schema, { name: "a.pdf", list: ["ok@example.net", "kaputt"] });
    expect(r.ok === false && r.errors[0]).toContain("list[1]");
  });

  it("weist eine Nicht-Objekt-Eingabe ab", () => {
    expect(validateInput(schema, ["a"])).toEqual({ ok: false, errors: ["input is not an object"] });
  });

  it("weist einen leeren String bei einem Pflichtfeld ohne enum ab (Fund 4, M3b-Nachlese)", () => {
    const freitext: ObjectSchema = { type: "object", properties: { note: { type: "string" } }, required: ["note"] };
    const r = validateInput(freitext, { note: "" });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.errors[0]).toContain("missing (required)");
  });

  it("weist einen nur aus Whitespace bestehenden Pflichtwert ebenfalls ab", () => {
    const freitext: ObjectSchema = { type: "object", properties: { note: { type: "string" } }, required: ["note"] };
    const r = validateInput(freitext, { note: "   " });
    expect(r).toMatchObject({ ok: false });
  });

  it("nimmt einen nicht-leeren String bei einem Pflichtfeld ohne enum an", () => {
    const freitext: ObjectSchema = { type: "object", properties: { note: { type: "string" } }, required: ["note"] };
    expect(validateInput(freitext, { note: "x" })).toEqual({ ok: true, value: { note: "x" } });
  });
});
