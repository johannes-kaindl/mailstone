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

// Die Pruefung selbst (validateInput, emptyChoiceField, predeterminedInput) liegt im Kit (code-kit `validate-input`; Herkunft: die
// lokale Fassung dieser Datei bis 0.9.0, die ihrerseits aus calendar-notes uebernommen war). Unterschiede, begruendet: das Kit
// meldet unbekannte Schema-Woerter benennbar (`unsupportedSchemaKeywords`) und liest `required`-Namen ohne Eintrag in `properties` als
// Schema-Fehler (`bad-schema`) statt als stilles Pflichtfeld; `integer` ist zusaetzlich erlaubt; unendliche Zahlen fallen durch;
// `date-time` prueft eine Uhrzeit, die es gibt (mailstone nutzt es nicht). Texte und Regeln fuer `date` (Tag, den es gibt; leer =
// nicht gesetzt), Leerraum-Pflichtfeld und leere/einzelne Auswahl sind unveraendert, sie stammen aus dieser Datei.
export { emptyChoiceField, inputIssues, predeterminedInput, validateInput, unsupportedSchemaKeywords, type ValidationIssue, type ValidationResult } from "../../vendor/code-kit/validate-input";

export const EMPTY_SCHEMA: ObjectSchema = { type: "object", properties: {} };
