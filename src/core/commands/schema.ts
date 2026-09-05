// uebernommen aus calendar-notes/src/core/commands/schema.ts, 2026-08-30
// Mini-JSON-Schema: flache Untermenge fuer Kommando-Eingaben. Drei Abweichungen von der
// Vorlage: (a) Fehlertexte englisch, weil mailstones core durchgehend sprachfrei ist;
// (b) `format: date` statt `date-time` — `mail.createTask` nimmt eine Faelligkeit als
// reines Datum entgegen (M5, 2026-09-05); (c) `default` auf dem string-Zweig — `mail.createTask`
// belegt das Titelfeld mit dem Betreff der Mail-Notiz vor (M5, 2026-09-05, Ruling zum Task-5-
// Brief). Kein zweiter Uebergabeweg: Startwerte kommen ausschliesslich ueber das Schema, nie
// ueber einen zusaetzlichen Modal-Parameter.
export type FieldSchema =
  | { type: "string"; format?: "email" | "uri" | "multiline" | "date"; enum?: string[]; minLength?: number; default?: string; description?: string; descriptionKey?: string }
  | { type: "number"; minimum?: number; maximum?: number; description?: string; descriptionKey?: string }
  | { type: "boolean"; description?: string; descriptionKey?: string }
  | { type: "array"; items: { type: "string"; format?: "email" }; description?: string; descriptionKey?: string };

export interface ObjectSchema {
  type: "object";
  properties: Record<string, FieldSchema>;
  required?: string[];
}

export type ValidationResult = { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] };

function checkFormat(field: string, format: "email" | "uri" | "multiline" | "date", value: string, errors: string[]): void {
  if (format === "email" && !value.includes("@")) errors.push(`${field}: not a valid e-mail address`);
  // Leer = nicht gesetzt; ein optionales Datum darf leer bleiben.
  if (format === "date" && value !== "" && !isIsoDate(value)) errors.push(`${field}: must be a date (YYYY-MM-DD)`);
}

/** YYYY-MM-DD und ein Datum, das es wirklich gibt — `2026-02-31` faellt durch. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function checkField(field: string, schema: FieldSchema, value: unknown, errors: string[]): void {
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") { errors.push(`${field}: must be a string`); return; }
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${field}: too short (min. ${schema.minLength})`);
      if (schema.enum && !schema.enum.includes(value)) errors.push(`${field}: must be one of [${schema.enum.join(", ")}]`);
      if (schema.format) checkFormat(field, schema.format, value, errors);
      break;
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) { errors.push(`${field}: must be a number`); return; }
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${field}: below minimum ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${field}: above maximum ${schema.maximum}`);
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") errors.push(`${field}: must be a boolean`);
      break;
    }
    case "array": {
      if (!Array.isArray(value)) { errors.push(`${field}: must be an array`); return; }
      value.forEach((item, i) => {
        if (typeof item !== "string") { errors.push(`${field}[${i}]: must be a string`); return; }
        if (schema.items.format) checkFormat(`${field}[${i}]`, schema.items.format, item, errors);
      });
      break;
    }
  }
}

export function validateInput(schema: ObjectSchema, input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["input is not an object"] };
  const o = input as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    const value = o[key];
    if (!Object.hasOwn(o, key) || value === undefined) { errors.push(`${key}: missing (required)`); continue; }
    // Ein String, der nur aus Whitespace besteht (oder leer ist), erfuellt die Pflicht nicht —
    // ohne minLength wuerde er sonst durchrutschen (M3b-Nachlese, Fund 4).
    if (typeof value === "string" && value.trim() === "") errors.push(`${key}: missing (required)`);
  }
  for (const [key, value] of Object.entries(o)) {
    const fieldSchema = schema.properties[key];
    if (!fieldSchema) { errors.push(`${key}: unknown field`); continue; }
    if (value === undefined) continue;
    checkField(key, fieldSchema, value, errors);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: o };
}

export const EMPTY_SCHEMA: ObjectSchema = { type: "object", properties: {} };
