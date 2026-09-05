import { describe, it, expect } from "vitest";
import { validateInput, type ObjectSchema, emptyChoiceField, predeterminedInput } from "../../../src/core/commands/schema";

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

describe("format: date", () => {
  const schema = { type: "object" as const, properties: { due: { type: "string" as const, format: "date" as const } } };

  it("akzeptiert ein ISO-Datum", () => {
    expect(validateInput(schema, { due: "2026-12-24" }).ok).toBe(true);
  });

  it("akzeptiert den leeren String — Faelligkeit ist optional", () => {
    expect(validateInput(schema, { due: "" }).ok).toBe(true);
  });

  it("lehnt ein Datum in falscher Form ab", () => {
    const r = validateInput(schema, { due: "24.12.2026" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("due");
  });

  it("lehnt ein unmoegliches Datum ab", () => {
    expect(validateInput(schema, { due: "2026-02-31" }).ok).toBe(false);
  });
});

describe("emptyChoiceField", () => {
  it("nennt das Feld, dessen Auswahlliste leer ist", () => {
    expect(emptyChoiceField({ type: "object", properties: { name: { type: "string", enum: [] } } })).toBe("name");
  });

  it("liefert null, wenn die Liste Optionen hat", () => {
    expect(emptyChoiceField({ type: "object", properties: { name: { type: "string", enum: ["a"] } } })).toBeNull();
  });

  it("liefert null fuer ein Feld ganz ohne enum — ein freies Textfeld ist bedienbar", () => {
    expect(emptyChoiceField({ type: "object", properties: { titel: { type: "string" } } })).toBeNull();
  });

  it("liefert null fuer ein Schema ohne Felder — dafuer oeffnet der Ablauf ohnehin kein Formular", () => {
    expect(emptyChoiceField({ type: "object", properties: {} })).toBeNull();
  });
});

describe("predeterminedInput", () => {
  it("liefert den Wert, wenn ein Auswahlfeld genau EINE Option hat", () => {
    expect(predeterminedInput({ type: "object", properties: { name: { type: "string", enum: ["nur.pdf"] } } }))
      .toEqual({ name: "nur.pdf" });
  });

  it("liefert null bei zwei Optionen — da muss der Nutzer waehlen", () => {
    expect(predeterminedInput({ type: "object", properties: { name: { type: "string", enum: ["a", "b"] } } })).toBeNull();
  });

  it("liefert null, sobald EIN Feld eine Eingabe braucht — auch neben einer festen Auswahl", () => {
    expect(predeterminedInput({ type: "object", properties: {
      name: { type: "string", enum: ["nur.pdf"] },
      titel: { type: "string" },
    } })).toBeNull();
  });

  it("liefert null fuer ein Feld mit `default` — eine Vorbelegung ist ein Vorschlag, keine Festlegung", () => {
    expect(predeterminedInput({ type: "object", properties: { titel: { type: "string", default: "Betreff" } } })).toBeNull();
  });

  it("liefert null fuer einen Umschalter — false ist der Startwert, nicht die Entscheidung", () => {
    expect(predeterminedInput({ type: "object", properties: { flag: { type: "boolean" } } })).toBeNull();
  });

  it("liefert ein leeres Objekt fuer ein Schema ohne Felder", () => {
    expect(predeterminedInput({ type: "object", properties: {} })).toEqual({});
  });

  it("liefert null bei leerer Auswahlliste — den Fall faengt `emptyChoiceField` vorher ab", () => {
    expect(predeterminedInput({ type: "object", properties: { name: { type: "string", enum: [] } } })).toBeNull();
  });
});
