import { describe, it, expect } from "vitest";
import { en, de } from "../../src/i18n/strings";
import { errorKey } from "../../src/obsidian/command-i18n";
import { MAIL_COMMANDS } from "../../src/core/commands/mail-commands";
import type { CommandErrorCode } from "../../src/core/commands/types";

// `satisfies readonly CommandErrorCode[]` catches a typo or a retired code (an element that
// is not a valid CommandErrorCode). It does NOT catch the opposite drift — a code added to
// the union in src/core/commands/types.ts and never added here — so that direction is closed
// separately below (Fix-Runde 1, Finding 2).
const COMMAND_ERROR_CODES = [
  "busy", "invalid-input", "not-applicable", "eml-missing", "eml-unparseable", "eml-mismatch",
  "original-not-found", "original-unsearchable", "original-desktop-only",
  "fences-missing", "zone-edited", "frontmatter-unparseable", "attachment-missing",
  "no-recipient", "tasknotes-unavailable", "task-create-failed", "no-choices", "nothing-to-do", "write-failed", "unexpected",
] as const satisfies readonly CommandErrorCode[];

// Exhaustiveness in the other direction: if MissingCodes is non-empty (a union member is
// missing from COMMAND_ERROR_CODES above), ExhaustiveCheck becomes a tuple NAMING the missing
// code(s), and the `true` assigned to it below no longer type-checks — the build breaks
// instead of the test staying green while its own coverage silently rots.
type MissingCodes = Exclude<CommandErrorCode, (typeof COMMAND_ERROR_CODES)[number]>;
type ExhaustiveCheck = [MissingCodes] extends [never] ? true : ["COMMAND_ERROR_CODES is missing:", MissingCodes];
// eslint doesn't run over tests/ (repo convention, see tests/helpers/memory-vault.ts) — this
// assignment exists purely for the compiler, not to be read at runtime.
const _allCommandErrorCodesCovered: ExhaustiveCheck = true;
void _allCommandErrorCodesCovered;

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

  it("errorKey: Kommando-Codes liegen unter error.command.*, ein Netzfehler ist schon der volle Schluessel", () => {
    expect(errorKey("eml-mismatch")).toBe("error.command.eml-mismatch");
    expect(errorKey("error.sync.auth")).toBe("error.sync.auth");
  });

  it.each(dicts)("%s kennt jeden Netzfehler-Schluessel, den der Originalabruf durchreicht", (_lang, dict) => {
    for (const code of ["auth", "connect", "tls", "timeout", "closed", "protocol", "tls-required", "no-secret"]) expect(dict[errorKey(`error.sync.${code}`)], code).toBeTruthy();
  });

  it("original-not-found traegt die Ordnerliste als {0}", () => {
    for (const dict of [en, de]) expect(dict["error.command.original-not-found"]).toContain("{0}");
  });

  it("hat in beiden Sprachen dieselben Schluessel", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });
});

describe("Hinweis-Schluessel der Kommandos", () => {
  it.each(dicts)("%s kennt den Hinweis, den mail.recomputeThreads bei ausgeschaltetem Vorgang gibt", (_lang, dict) => {
    expect(dict["error.command.thread-field-off"]).toBeTruthy();
    expect(errorKey("error.command.thread-field-off")).toBe("error.command.thread-field-off");
  });
});
