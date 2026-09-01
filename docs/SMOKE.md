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

## Sent-Kopie (Nachtrag zu M2) — Live-Probe 2026-08-30

Der zweite Befund der M3-Live-Probe („kein Abbild im `Sent`-Ordner") ist behoben und ebenfalls am
echten Konto geprüft. `send()` legt die versandte Nachricht jetzt per `APPEND` im Ordner aus
`folders.sent` ab; der Default ist `"Sent"` und greift auch für bereits eingerichtete Konten (über
die Settings-Reparatur), ein leerer Wert schaltet die Kopie ab.

| Beobachtung | Ergebnis |
|---|---|
| Default am bestehenden Konto | `folders.sent` = `"Sent"`, ohne dass in `data.json` etwas stand |
| Versand | `{ok: true, messageId: …, sentCopy: "ok"}` |
| Ablage | Kopie im Ordner `Sent` gefunden (UID 294), Flag `\Seen` — sie erscheint nicht als ungelesen |

**Zwei Entwurfsentscheidungen, die dabei zählen:**

- **Ein Fehlschlag der Kopie macht den Versand nicht zum Fehlschlag.** Die Mail ist zugestellt; sie
  nachträglich als gescheitert zu melden, würde zu einem zweiten Sendeversuch verleiten. Der Ausgang
  steht deshalb als `sentCopy: "ok" | "failed" | "skipped"` im Ergebnis, nicht im `ok`.
- **Die Bytes gehen erst nach der Continuation raus.** `APPEND` kündigt die Größe an, der Server
  antwortet mit `+`, und erst dann folgt die Nachricht. Lehnt er stattdessen sofort ab (fehlender
  Ordner, volles Postfach), bleiben die Bytes ungeschrieben — sonst lägen sie herrenlos auf einer
  Leitung, die schon auf das nächste Kommando wartet. Drei Unit-Tests decken genau diese drei Wege ab.

## iMIP-Probe mit DMARC-Kontrolle (Echt-Versandtest ④, Punkt 3) — 2026-08-30

Letzter offener Punkt des Echt-Versandtests: eine Einladung (`METHOD:REQUEST`) an einen **fremden**
Empfänger schicken und prüfen, wie dessen Mailserver die Absender-Authentifizierung bewertet. Bis
zum 2026-09-05 steht DMARC für `jkaindl.de` auf `p=quarantine`; ein Fehlschlag wäre also sichtbar
im Spam gelandet statt stumm abgewiesen zu werden — deshalb das Zeitfenster.

Gefahren per CDP gegen ein laufendes Obsidian 1.13.7 (Staging-Vault `$STAGING_VAULTS_DIR/mailstone`,
deployter Stand byte-identisch mit dem frisch gebauten Repo-Stand). Empfänger war ein Google-Konto
des Maintainers — fremd im relevanten Sinn: eigene Domain, eigene DMARC-Auswertung, eigener
Spam-Filter. Das Passwort wurde nicht ausgelesen, es blieb im Renderer.

Der Versand lief über dieselbe Abbildung, die `buildMailTransport.send()` intern nimmt
(`imipToOutgoing` → `sendService.send`); der registrierte Transport selbst liegt in einer Closure
und ist von außen nicht greifbar. Übersprungen wurde damit nur `splitTransportId` (unit-getestet);
MIME-Bau, DKIM-Signatur durch den Server und SMTP-Einlieferung sind identisch.

**Ergebnis: bestanden.**

| Prüfpunkt | Beobachtung |
|---|---|
| Versand | `{ok: true, messageId: …@jkaindl.de, sentCopy: "ok"}` — die Sent-Kopie greift auch auf diesem Weg |
| Zustellung | Mail landete in der **INBOX**, nicht im Spam |
| SPF | `spf=pass` — `mail@jkaindl.de` über `mout-p-202.mailbox.org` (`2001:67c:2050:0:465::202`) als zulässiger Absender |
| DKIM | `dkim=pass header.i=@jkaindl.de header.s=MBO0001` — mailbox.org signiert die von mailstone gebaute Nachricht unverändert durch |
| DMARC | `dmarc=pass (p=QUARANTINE sp=QUARANTINE dis=NONE) header.from=jkaindl.de` |
| Bridge | `bridge.registered === true` gegen echtes calendar-notes 0.1.3 am laufenden System |

Maßgeblich ist der `ARC-Authentication-Results: i=1`-Block — die direkte Einlieferung von
mailbox.org an `mx.google.com`. Das Postfach leitet intern weiter, die späteren `i=2`/`i=3`-Blöcke
beschreiben diese Weiterleitung und nicht mehr den Versand.

**Der MIME-Bau übersteht den Transport unverfälscht.** Das ICS liegt zweimal in der Nachricht — als
`text/calendar; method=REQUEST` (quoted-printable) im `multipart/alternative` und als
`application/ics`-Anhang (base64). Beide dekodieren zum eingespeisten Original: CRLF-Zeilenenden
erhalten, keine Quoted-Printable-Doppelkodierung (`CN=Johannes Kaindl`, nicht `CN=3DJohannes`),
Parameter (`RSVP=TRUE`, `PARTSTAT=NEEDS-ACTION`) intakt. Das ist der Punkt, an dem ein selbst
gebauter MIME-Encoder üblicherweise scheitert.

**Was diese Probe nicht misst:** ob der Empfänger die Einladung als Kalender-Einladung *darstellt*
(Google zeigt bei `method=REQUEST` normalerweise eine Antwort-Karte) — geprüft wurde die
Authentifizierung, nicht die Darstellung. Und der `LOGIN`-Fallback bleibt weiter ungeprüft, weil
dieser Server `SASL-IR` kann (s. M3-Live-Probe).

---

## M3b-Live-Probe — die vier Vault-Kommandos (2026-09-01)

Gefahren gegen ein laufendes Obsidian **1.13.7** per CDP, Staging-Vault `mailstone`, Build vom
Branch `feat/m3b-mail-commands` (`66d599d`, deployt 16:42). Obsidian lief zu dem Zeitpunkt nicht;
gestartet mit `--remote-debugging-port=9222`, CDP-Lock gehalten (`--exclusive all`), zwei fremde
Vault-Fenster (`10_Pallas`, `80_Arbeit`) blieben unberührt. Der Treiber war einmalig
(Scratchpad, nicht getrackt) — ein getrackter GUI-Smoke ist M4.

| # | Prüfpunkt | Ergebnis |
|---|---|---|
| P0 | Plugin lädt, Kommandos registriert | ✅ mailstone 0.0.1, 6 Mail-Notizen im Vault |
| P1 | Vier Kommandos auf einer Mail-Notiz **mit** Anhängen | ✅ `extractAttachment, relink, replyExternal, rerender` |
| P1b | Drei auf einer Notiz **ohne** Anhänge | ✅ `extractAttachment` fällt zu Recht weg (`appliesTo` liest `attachments`) |
| P2 | Keines auf einer fremden Notiz (ohne `mail_id`) | ✅ keines anwendbar |
| P3 | `mail.rerender` ohne Änderung | ✅ keine Vorschau, keine Schreiboperation, „Nothing to change." |
| P4 | Eigener Text außerhalb der Zone überlebt ein Re-Render | ✅ Vorschau mit 1 Diff-Zeile, eigene Zeile steht danach unverändert |
| P5 | Von Hand geänderte Zone | ✅ `zone-edited`, Datei byte-identisch, erklärende Meldung |
| P6 | `mail.relink` macht aus der Message-ID einen Wikilink | ✅ `alt-001@mail.example.org` → `[[Mail/2026/2026-08-19-1000-termin]]` |
| P7 | `.eml` bleibt nach der Extraktion Treuefläche | ✅ 785 Bytes unverändert, beide Anhang-Nutzlasten drin |
| P8 | `mail.replyExternal` baut die `mailto:`-URL | ✅ `mailto:erika@example.org?subject=Re%3A%20Termin&in-reply-to=%3Calt-001%40mail.example.org%3E` |
| P9 | Kommando bei belegtem Busy-Guard | ✅ Vorschau erscheint, das **Schreiben** wird abgelehnt: „A synchronisation or another command is running." |
| P10a | Dropdown unterscheidet zwei gleichnamige Anhänge | ✅ `rechnung.pdf` / `rechnung.pdf (2)` |
| P10b | Die extrahierte Datei trägt den Inhalt des **gewählten** Anhangs | ✅ „rechnung.pdf (2)" gewählt → Datei enthält `RECHNUNG ZWEI` |
| P10c | Link steht in der Notiz, **vor** der verwalteten Zone | ✅ |
| P11 | Fremdschreiber während der offenen Vorschau | ✅ übersprungen statt überschrieben, fremde Zeile überlebt |
| P12 | Notiz verschwindet mitten im Ablauf | ✅ übersetzte Meldung statt stillem Nichts |
| P13 | Keine „0 Notizen geschrieben"-Meldung nach `mail.replyExternal` | ✅ keine Meldung |

### Die drei Prüfpunkte, die es ohne den Abschluss-Review nicht gäbe

**P10 belegt den Critical.** Der MIME-Parser keyte seinen Byte-Speicher mit `contentId ?? name`;
zwei nicht-inline Anhänge gleichen Namens teilten sich einen Eintrag. `find` lieferte die
Metadaten des ersten, `get` die **Bytes des zweiten** — die extrahierte Datei hätte den Namen des
einen und den Inhalt des anderen getragen, ohne Fehlermeldung, und der erste wäre unerreichbar
gewesen. Der Defekt lag seit M1 im Parser und war harmlos, weil M3b sein erster Konsument ist.
Die Fixture (`Import/dup-attachments.eml`, zwei `rechnung.pdf` mit unterscheidbarem Inhalt) liegt
im Staging-Vault und gehört in jeden künftigen Lauf — ein synthetisches Ein-Anhang-Fixture kann
diesen Fall nie zeigen.

**P11 belegt den Snapshot-Schutz.** Der Kommando-Plan entsteht **vor** den Modalen, der Busy-Guard
greift aber erst beim Schreiben; ein Sync-Tick, der während der offenen Vorschau durchläuft, wäre
sonst überschrieben worden. Gemessen wurde nicht mit einem echten Sync-Tick, sondern mit einem
**Fremdschreiber zur selben Stelle** — das ist dieselbe Ursache ohne Zeitabhängigkeit und damit die
belastbarere Probe. Die Meldung nennt den Grund und den Ausweg: „1 note(s) were skipped: they
changed while the preview was open, so nothing was overwritten. Run the command again if you still
want it applied."

**P12 belegt den Fehlerpfad.** Verschwindet die Notiz zwischen Palette und Lesezugriff, endete das
Kommando vorher in einer unbehandelten Rejection — sichtbar tat es nichts.

### Zwei Befunde über die Probe selbst, nicht über den Code

1. **P1 schlug zuerst fehl, und der Prüfpunkt war schuld.** „Vier Kommandos auf einer Mail-Notiz"
   gilt nur für eine Notiz **mit** Anhängen; `mail.extractAttachment` blendet sich über das
   Frontmatter-Feld `attachments` korrekt aus. Der Prüfpunkt ist entsprechend zweigeteilt.
2. **P9 und P11 maßen im ersten Anlauf nichts.** Die Zielnotiz steckte noch im `zone-edited`-Zustand
   aus P5, den der Lauf nicht zurückgesetzt hatte — beide Kommandos brachen also ab, bevor Guard
   oder Fremdschreiber überhaupt zum Tragen kamen, und die grüne Meldung sah wie ein Ergebnis aus.
   Seither steht vor beiden eine **Vorprobe**, die prüft, ob sich die Notiz überhaupt rendern lässt;
   ohne sie hätte der Lauf zwei Zusicherungen als geprüft geführt, die er nie berührt hat.

### Was diese Probe nicht misst

Kein echter Sync-Lauf gegen das Postfach (P11 ersetzt ihn durch den Fremdschreiber, P9 durch das
direkte Belegen des Guards). Ob `mail.replyExternal` tatsächlich ein Mailprogramm öffnet, wurde
nicht geprüft — `window.open` war abgefangen, um die URL zu messen; das Öffnen selbst ist
Betriebssystemsache. Die Oberfläche lief auf Englisch (`language: auto`); die deutschen Texte deckt
der i18n-Paritätstest ab, nicht dieser Lauf.

## M5-Handprobe — Verdrahtung (Ribbon, View-Registrierung, Startup-Gate, Register-Persistenz)

Nach Ruling A im SDD-Ledger (`task-5-brief.md`) ist die Verdrahtung selbst — `registerView`,
Ribbon-Umstellung, `onLayoutReady`-Gate — per Unit-Test in diesem Repo nicht belegbar (der
vendorte `Plugin`-Mock verwirft Ribbon-Titel und -Callback). Die sieben Prüfpunkte unten sind
deshalb der **einzige** Beleg dafür, nicht Beiwerk. Punkte 3–7 schließen zugleich die
Unit-Lücke aus Ruling A — der GUI-Smoke-Treiber aus M4 übernimmt sie später in einen
getrackten Lauf.

| # | Prüfpunkt | Erwartung | Ergebnis |
|---|---|---|---|
| 1 | Sichtbarkeit beim Erstöffnen: rechte Seitenleiste einklappen, Obsidian neu laden, Ribbon-Symbol klicken | Leiste klappt auf, Cockpit ist sichtbar (kein 0×0-Blatt, REGISTRY §UI) | |
| 2 | Knopf-Position: „Alle synchronisieren" per `getBoundingClientRect()` prüfen | Knopf steht im Inhalt und ist sichtbar, nicht nur im DOM vorhanden | |
| 3 | Ribbon-Klick öffnet die Ansicht, startet **keinen** Lauf; Gegenprobe `sync-mailbox` in der Befehlspalette | Ribbon öffnet nur, Befehlspalette startet weiterhin einen Sync | |
| 4 | Genau ein View-Type prüfen (Konsole/Sidebar-Menü) | Nur `mailstone-cockpit` taucht auf (UI-STANDARD §1) | |
| 5 | Startup-Gate, beide Hälften: mit `openViewOnStartup: false` neu laden, dann in den Einstellungen einschalten und erneut neu laden | Ansicht bleibt zu (aus) / Ansicht öffnet sich (an) — beide Hälften gefahren | |
| 6 | Register überlebt den Neustart: Sync fahren, Zähler merken, Obsidian neu laden, Cockpit öffnen, danach `data.json` ansehen | Derselbe Stand steht da; `runState` liegt neben `settings`, `zoneHashes`, `uidCache` | |
| 7 | Kaputtes Register kippt den Start nicht: in `data.json` `"runState": "kaputt"` eintragen, neu laden | Plugin lädt, Cockpit zeigt „Noch nicht gelaufen", kein Fehler in der Konsole | |
