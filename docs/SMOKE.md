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

## Fake-SMTP (M2 Task 7) — headless statt GUI

`scripts/fake-smtp.mjs` ist ein Maintainer-Skript (`node scripts/fake-smtp.mjs`, Port per
`PORT`-Env, Ausgabeordner per `FAKE_SMTP_DIR`-Env, Default `.fake-smtp/`, gitignored): kein TLS,
`AUTH PLAIN` akzeptiert jeden Inhalt, jede empfangene Nachricht landet als `<n>.eml` im
Ausgabeordner. Nur ueber `smtp.tls==="none"` + Loopback-Host (`127.0.0.1`/`::1`/`localhost`)
erreichbar — die Settings-UI bietet `"none"` nie an, das gilt nur fuer ein von Hand in `data.json`
gesetztes Test-Konto.

Der End-to-End-Beweis laeuft **headless** statt per GUI-Smoke: `tests/integration/fake-smtp.test.ts`
(`npm run test:integration`) startet `scripts/fake-smtp.mjs` als echten Kindprozess, verbindet mit
dem echten `nodeSocketTransport()` (kein Fake-Transport) ueber `createSendService`, sendet eine
Testmail und prueft `{ok:true}` sowie den Inhalt der geschriebenen `.eml`-Datei (`Subject:` und
`From:`). Letzter Lauf 2026-08-23: **bestanden**, 1 Test, ~50–70 ms. Ein manueller GUI-Lauf
(Kommando „Test-Mail an mich selbst senden" gegen ein laufendes Obsidian mit `data.json`-Konto auf
`127.0.0.1:2525`/`tls:"none"`) ist für M4 offen (getrackter CDP-Treiber statt Hand-Lauf, s. Tabelle
oben).
| 2026-08-23 | `6659083` (M2 nach Final-Review-Fix-Welle) | **bestanden** (M2-Transport-Probe, CDP gegen Obsidian 1.13.7, Staging-Vault mit mailstone + echtem calendar-notes 0.1.3): beide Plugins geladen; **Brücke registriert** (`bridge.registered === true` — die Gegenseite lieferte `{ok:true}`, unsere Bridge setzt das Flag nur dann); Test-Konto (`smtp 127.0.0.1:2525, tls none` → loopback-Guard + `allowInsecureAuth`-Pfad) per CDP angelegt, App-Passwort über `app.secretStorage` gesetzt und zurückgelesen; Kommando „Test-Mail an mich selbst senden" → Notice „Test-Mail gesendet (Message-ID …@example.net)", Fake-SMTP empfing die Mail (`From: Test <mail@example.net>`, `Subject: Mailstone test`, RFC-5322-Date, Message-ID mit Identitäts-Domain). Einladungsweg Ende-zu-Ende (cn → Transport) folgt beim calendar-notes-Rollout, wenn ein DAV-Konto existiert. |
