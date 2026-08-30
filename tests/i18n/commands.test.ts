import { describe, it, expect } from "vitest";
import { en, de } from "../../src/i18n/strings";
import { MAIL_COMMANDS } from "../../src/core/commands/mail-commands";

const COMMAND_ERROR_CODES = [
  "busy", "invalid-input", "not-applicable", "eml-missing", "eml-unparseable", "eml-mismatch",
  "fences-missing", "zone-edited", "frontmatter-unparseable", "attachment-missing",
  "no-recipient", "nothing-to-do", "write-failed",
] as const;

const dicts: [string, Record<string, string>][] = [["en", en], ["de", de]];

describe("i18n-Paritaet der Kommandos", () => {
  it.each(dicts)("%s kennt Titel und Beschreibung jedes registrierten Kommandos", (_lang, dict) => {
    for (const c of MAIL_COMMANDS) {
      expect(dict[c.titleKey], `${c.id}: titleKey`).toBeTruthy();
      expect(dict[c.descriptionKey], `${c.id}: descriptionKey`).toBeTruthy();
    }
  });

  it.each(dicts)("%s kennt jede Zusammenfassung", (_lang, dict) => {
    for (const c of MAIL_COMMANDS) expect(dict[`plan.${c.id}.summary`], `${c.id}: summary`).toBeTruthy();
  });

  it.each(dicts)("%s kennt jeden Fehlercode", (_lang, dict) => {
    for (const code of COMMAND_ERROR_CODES) expect(dict[`error.command.${code}`], code).toBeTruthy();
  });

  it("hat in beiden Sprachen dieselben Schluessel", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });
});
