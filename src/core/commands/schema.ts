// uebernommen aus calendar-notes/src/core/commands/schema.ts, 2026-08-30
// Mini-JSON-Schema: flache Untermenge fuer Kommando-Eingaben. Zwei Abweichungen von der
// Vorlage: (a) Fehlertexte englisch, weil mailstones core durchgehend sprachfrei ist;
// (b) kein Format "date-time" — kein mailstone-Kommando nimmt ein Datum entgegen.
export type FieldSchema =
  | { type: "string"; format?: "email" | "uri" | "multiline"; enum?: string[]; minLength?: number; description?: string; descriptionKey?: string }
  | { type: "number"; minimum?: number; maximum?: number; description?: string; descriptionKey?: string }
  | { type: "boolean"; description?: string; descriptionKey?: string }
  | { type: "array"; items: { type: "string"; format?: "email" }; description?: string; descriptionKey?: string };

export interface ObjectSchema {
  type: "object";
  properties: Record<string, FieldSchema>;
  required?: string[];
}

export type ValidationResult = { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] };

function checkFormat(field: string, format: "email" | "uri" | "multiline", value: string, errors: string[]): void {
  if (format === "email" && !value.includes("@")) errors.push(`${field}: not a valid e-mail address`);
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
