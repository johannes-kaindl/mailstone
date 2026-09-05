import { ButtonComponent, Modal, Setting, type App } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import { validateInput, type FieldSchema, type ObjectSchema } from "../../core/commands/schema";
import { trFieldDescription } from "../command-i18n";

/** `String(unknown)` faellt bei Objekten auf "[object Object]" zurueck (eslint
 *  no-base-to-string) — hier reichen die drei Formular-Wertarten. */
function scalarToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

// uebernommen aus calendar-notes/src/obsidian/command-modal.ts, 2026-08-30
/**
 * Rohwerte der Setting-Komponenten (Strings, bei Toggle boolean) auf die vom Schema
 * erwarteten Typen bringen. Leere OPTIONALE Felder fallen weg — ein leeres, nie
 * ausgefuelltes Feld soll nicht als ungueltiger Wert durch die Validierung fallen.
 * Leere PFLICHTfelder bleiben drin, damit `validateInput` sie bemaengeln kann.
 * Pure — ohne Modal testbar.
 */
export function parseFormValues(schema: ObjectSchema, raw: Record<string, unknown>): Record<string, unknown> {
  const required = new Set(schema.required ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    const v = raw[key];
    if (v === undefined) continue;
    if (field.type === "boolean") { out[key] = Boolean(v); continue; }
    if (field.type === "number") {
      const s = scalarToString(v).trim();
      if (s === "" && !required.has(key)) continue;
      out[key] = Number(s);
      continue;
    }
    if (field.type === "array") {
      const items = (typeof v === "string" ? v : "").split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
      if (items.length === 0 && !required.has(key)) continue;
      out[key] = items;
      continue;
    }
    const s = scalarToString(v);
    if (s === "" && !required.has(key)) continue;
    out[key] = s;
  }
  return out;
}

/**
 * Formular aus einem ObjectSchema. Ein `enum` wird zum Dropdown (so wird aus der
 * Anhangliste eine Auswahl), `format: "multiline"` und `type: "array"` werden zur TextArea,
 * `format: "date"` zu einem `input[type=date]` (Wert bleibt der ISO-String), alles andere
 * ein Textfeld. Aufloesung ueber `pick()`: `null` bei Abbruch.
 */
export class SchemaFormModal extends Modal {
  private readonly values: Record<string, unknown> = {};
  private settled = false;
  private resolveFn: (v: Record<string, unknown> | null) => void = () => undefined;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, private readonly heading: string, private readonly schema: ObjectSchema) {
    super(app);
  }

  pick(): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      this.resolveFn = resolve;
      this.open();
    });
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    for (const [key, field] of Object.entries(this.schema.properties)) this.renderField(key, field);
    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("form.cancel")).onClick(() => { this.close(); });
    new ButtonComponent(btns).setButtonText(t("form.submit")).setCta().onClick(() => { this.submit(); });
  }

  onClose(): void {
    this.contentEl.empty();
    this.settle(null);
  }

  private renderField(key: string, field: FieldSchema): void {
    const setting = new Setting(this.contentEl).setName(key);
    const desc = trFieldDescription(field);
    if (desc) setting.setDesc(desc);
    if (field.type === "boolean") {
      setting.addToggle((c) => c.onChange((v) => { this.values[key] = v; }));
      this.values[key] = false;
      return;
    }
    if (field.type === "string" && field.enum) {
      setting.addDropdown((c) => {
        for (const option of field.enum ?? []) c.addOption(option, option);
        this.values[key] = field.enum?.[0] ?? "";
        c.setValue(String(this.values[key]));
        c.onChange((v) => { this.values[key] = v; });
      });
      return;
    }
    if (field.type === "array" || (field.type === "string" && field.format === "multiline")) {
      setting.addTextArea((c) => c.onChange((v) => { this.values[key] = v; }));
      return;
    }
    if (field.type === "string" && field.format === "date") {
      setting.addText((c) => {
        c.inputEl.type = "date";
        c.onChange((v) => { this.values[key] = v; });
      });
      return;
    }
    setting.addText((c) => {
      // Analog zum enum-Zweig oben: `default` belegt values[key] UND die Komponente vor,
      // statt eines zweiten Uebergabewegs am Modal-Konstruktor (M5, mail.createTask).
      if (field.type === "string" && field.default !== undefined) {
        this.values[key] = field.default;
        c.setValue(field.default);
      }
      c.onChange((v) => { this.values[key] = v; });
    });
  }

  private submit(): void {
    const parsed = parseFormValues(this.schema, this.values);
    const check = validateInput(this.schema, parsed);
    if (!check.ok) {
      this.errorEl?.remove();
      this.errorEl = this.contentEl.createEl("p", { text: check.errors.join(" · "), cls: "mailstone-form-errors" });
      return;
    }
    this.settle(check.value);
    this.close();
  }

  private settle(v: Record<string, unknown> | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveFn(v);
  }
}
