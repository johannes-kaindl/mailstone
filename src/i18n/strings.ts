import { defineStrings, pickLang, setLang } from "../vendor/code-kit/i18n";

const en = {
  "cmd.importEml.name": "Import .eml files from a vault folder",
  "import.done": "Imported {0} mails ({1} updated, {2} skipped, {3} errors)",
  "import.prompt.folder": "Vault folder containing .eml files",
  "settings.folder": "Notes folder", "settings.folder.desc": "Mail notes are created here, in a subfolder per year.",
  "settings.filename": "Filename template", "settings.filename.desc": "Placeholders: {date}, {time}, {slug}, {year}",
  "settings.language": "Language", "settings.language.auto": "Automatic",
  "settings.yearSubfolder": "Subfolder per year",
  "form.cancel": "Cancel",
  "form.submit": "OK",
};
const de: typeof en = {
  "cmd.importEml.name": ".eml-Dateien aus einem Vault-Ordner importieren",
  "import.done": "{0} Mails importiert ({1} aktualisiert, {2} übersprungen, {3} Fehler)",
  "import.prompt.folder": "Vault-Ordner mit .eml-Dateien",
  "settings.folder": "Notiz-Ordner", "settings.folder.desc": "Mail-Notizen entstehen hier, je Jahr ein Unterordner.",
  "settings.filename": "Dateinamen-Vorlage", "settings.filename.desc": "Platzhalter: {date}, {time}, {slug}, {year}",
  "settings.language": "Sprache", "settings.language.auto": "Automatisch",
  "settings.yearSubfolder": "Unterordner je Jahr",
  "form.cancel": "Abbrechen",
  "form.submit": "OK",
};

export function initI18n(raw: string): void { defineStrings({ en, de }); setLang(pickLang(raw)); }
