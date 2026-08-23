# GUI-Smoke (manuell) — M1: .eml-Import

1. `OBSIDIAN_PLUGIN_DIR=<vault>/.obsidian/plugins/mailstone npm run deploy`, Plugin in Obsidian aktivieren.
2. Zwei Fixture-`.eml` (z. B. `multipart-alternative.eml`, `thread-reply.eml`) in einen Vault-Ordner `Import/` kopieren, Kommando „.eml-Dateien aus einem Vault-Ordner importieren" mit `Import` ausführen.
3. Prüfen: Notizen liegen unter `Mail/2026/…md`, das dazugehörige `.eml` liegt unter `Mail/2026/_eml/…eml`.
4. Backlink-Test: nach dem Import von `multipart-alternative.eml` (Vorgänger-Mail) `thread-reply.eml` importieren (oder Import ein zweites Mal laufen lassen) — `in_reply_to` der `thread-reply`-Notiz zeigt als Wikilink auf die Vorgänger-Notiz.
5. Settings-Tab öffnen: Sprache/Notiz-Ordner/Unterordner-je-Jahr/Dateinamen-Vorlage rendern und sind änderbar.

## Protokoll

| Datum | Stand | Ergebnis |
|---|---|---|
| 2026-08-23 | `4e85488` (M1 nach Final-Review-Fix-Welle) | **bestanden**, gefahren per CDP gegen Obsidian 1.13.7 (`--remote-debugging-port=9222`), Staging-Vault `$STAGING_VAULTS_DIR/mailstone` (Plugin per `vault-open`-IPC geöffnet, Trust-Dialog bestätigt, Community-Plugins eingeschaltet). 1. Import: 3 Notizen + 3 `.eml` unter `Mail/2026/`, Frontmatter vollständig (`mail_id`, `mail_source: import/Import`, `mail_state: live`, `date`/`time`, `from`/`to`, `references` als Strings). 2. Import: Notice „0 Mails importiert (1 aktualisiert, 2 übersprungen, 0 Fehler)", `in_reply_to`/`references` der Reply-Notiz zeigen als `[[Mail/2026/2026-08-19-1000-termin]]` auf die Vorgänger-Notiz. 3. Import: „0 aktualisiert, 3 übersprungen", mtime der Notiz unverändert (Idempotenz trotz neuem `mail_synced`-Zeitpunkt). `.eml` byte-identisch zur Quelle (549 B). `attachments` als Strings. Settings-Tab (deklarativ, 1.13) rendert Sprache/Notiz-Ordner/Unterordner je Jahr/Dateinamen-Vorlage. Offen für M4: getrackter Treiber (`scripts/gui-smoke.ts`, Skill `gui-smoke-setup`) statt Hand-Lauf. |
