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

## M3-Live-Probe — Allowlist-Sync gegen ein echtes Postfach (2026-08-30)

Erste Probe von M3 am **echten mailbox.org-Konto**, gefahren per CDP gegen ein laufendes
Obsidian 1.13.7 (`--remote-debugging-port=9222`), Staging-Vault `$STAGING_VAULTS_DIR/mailstone`,
Stand `714845e` (Branch `feat/m3-imap-sync`, PR #1). Anders als die Handover-Vorlage vorsah wurden
**keine bestehenden Mails** angefasst: die Probe verschickte sich zwei eigene Testnachrichten
(`M3-Live-Probe A/B`) ueber das Kommando aus M2 und arbeitete nur mit diesen; das Passwort wurde
nie ausgelesen, sondern blieb im Renderer (`app.secretStorage` → IMAP-Dialog, Rueckgabe nur
Server-Antworten). Aufgeraeumt: beide Testmails liegen im Papierkorb, `Vault` ist wieder leer.

**Ergebnis: bestanden.**

| Schritt | Beobachtung |
|---|---|
| Ordner `Vault` | existierte bereits, leer. `LIST` zeigt ihn neben `Archive`, `Junk`, `Trash`, `Drafts`, `Sent` |
| Server-Capabilities | `SASL-IR` **vorhanden** — der `AUTHENTICATE PLAIN`-Pfad mit Initial-Response greift; der `LOGIN`-Fallback aus der Fix-Welle wird von diesem Server also **nicht** geprueft. Ausserdem `MOVE`, `UIDPLUS`, `IDLE`, `CONDSTORE` (relevant fuer M4) |
| Sync (1. Lauf) | Notice „2 new, 0 reattached, 0 detached (0 errors)", Statusleiste „Mailstone: 2 notes · last sync 14:48:34". Zwei Notizen unter `Mail/2026/` + zwei `.eml` unter `Mail/2026/_eml/`, Frontmatter `mail_source: account/Vault`, `mail_state: live`, `mail_id` = die Message-ID des Versands |
| Fremde Notizen | die drei Altnotizen aus dem M1-Import (`mail_source: import/Import`) blieben **unveraendert** auf `live` — der `source`-Riegel aus `planSync` haelt am echten Bestand |
| Ablösen | Mail A per `UID MOVE` aus `Vault` gezogen, Sync → Notice „0 new, 0 reattached, 1 detached (0 errors)", `mail_state: detached`, Notiz und Mailtext erhalten |
| Wieder-Verbinden | Mail A zurueck nach `Vault` (neue UID), Sync → „0 new, 1 reattached, 0 detached", `mail_state: live`, **keine zweite Notiz** (Dateizahl im Ordner unveraendert 6 → 6) |
| Nur-lesend | nach drei Sync-Laeufen mit vollstaendigem Body-Abruf trugen beide Mails **kein `\Seen`** (`UID FETCH (FLAGS)` → `($NotJunk NotJunk)` bzw. `(\Recent $NotJunk NotJunk)`). `EXAMINE` meldet zusaetzlich `[PERMANENTFLAGS ()] Read-only mailbox` — der Server selbst bestaetigt, dass die Session nichts aendern kann |

### Zwei Befunde, die nur die Live-Probe zeigen konnte

**1. `fileManager.processFrontMatter` re-serialisiert das ganze Frontmatter.** Beim ersten
`setState`-Schreibvorgang wurde `to: [mail@jkaindl.de]` (Flow-Liste, wie das Plugin sie anlegt) zu
einer Block-Liste umgeschrieben:

```diff
-to: [mail@jkaindl.de]
+to:
+  - mail@jkaindl.de
```

Kein Datenverlust, und **einmalig**: der zweite Zustandswechsel aenderte nur noch `mail_state`,
sonst nichts (`diff` ueber beide Staende belegt es). Trotzdem widerlegt der Befund eine Annahme,
die bisher in der Dach-`REGISTRY.md` steht — dort heisst es sinngemaess, wer
`fileManager.processFrontMatter` nutzen koenne, habe das Re-Serialisierungs-Problem nicht. Das gilt
so nicht: die API normalisiert die Schreibweise des gesamten Blocks. Fuer Notizen, die das Plugin
selbst anlegt, ist das kosmetisch; sobald ein Nutzer eigene Felder mit bewusster Formatierung
(Block-Scalars, Kommentare) ergaenzt, ist es keins mehr. Gehoert in der REGISTRY korrigiert.

**2. Kein Sent-Ordner-Abbild beim Versand.** Nach zwei erfolgreich zugestellten Testmails fand
`UID SEARCH` im Ordner `Sent` **keine** Kopie. `Account.folders.sent` existiert im Settings-Typ und
ist ungenutzt — wer im Webmail nachsieht, findet seine ueber mailstone verschickte Mail nirgends.
Das ist kein M3-Fehler (Versand ist M2), aber ein Verhalten, das ein Nutzer anders erwartet.
Vorgemerkt fuer die Nachlese.
