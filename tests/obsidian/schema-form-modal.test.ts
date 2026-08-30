import { describe, it, expect } from "vitest";
import { parseFormValues } from "../../src/obsidian/modals/schema-form-modal";
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
