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

**Was hier steht und warum — Stand nach der Abschluss-Fix-Welle (2026-09-02).** Ursprünglich
galt die ganze Verdrahtung als unit-untestbar. Das war zu weit gegriffen: nicht die
Plugin-Instanz ist unerreichbar, sondern nur `onload()`. Konstruktor plus direkt gesetzte
Felder genügen, und `tests/obsidian/main-cockpit.test.ts` belegt seither die Persistenz-Rundreise,
den manuellen Lauf, den Lauf-Zustand und `openSettings` **im Gate**.

Nicht unit-belegbar bleiben genau drei Dinge, und sie sind der Grund für diese Tabelle:
`registerView` und die Ribbon-Umstellung (der vendorte `Plugin`-Mock verwirft Titel und
Callback von `addRibbonIcon`), das `onLayoutReady`-Gate, und alles Sichtbare — ob ein Element
Pixel hat, wo es sitzt, ob eine Animation läuft. Für diese Punkte ist die Tabelle der
**einzige** Beleg; der GUI-Smoke-Treiber aus M4 überführt sie später in einen getrackten Lauf.

**Gefahren am 2026-09-02, Ergebnis: bestanden (10/10).** Obsidian **1.13.7**, Staging-Vault
`mailstone`, deployter Stand byte-identisch mit dem frisch gebauten Repo-Stand (`shasum` beider
`main.js` gleich) — der Punkt aus der Dach-Lesson „ein Smoke gegen den Produktiv-Vault misst den
installierten Stand". Kein Neustart der App: der Debug-Port hörte bereits, das mailstone-Fenster
wurde per `obsidian://open?vault=` als zusätzliches Fenster geöffnet, die **fünf fremden
Vault-Fenster** (`10_Pallas`, `80_Arbeit`, `anysource-sideloader`, `koda-agent` und ein
Einstellungen-Fenster) blieben unberührt. CDP-Lock durchgehend gehalten (`--exclusive focus`).
Der Treiber war einmalig (Scratchpad, nicht getrackt) — der getrackte GUI-Smoke ist M4.

| # | Prüfpunkt | Erwartung | Ergebnis |
|---|---|---|---|
| 1 | Sichtbarkeit beim Erstöffnen: rechte Seitenleiste einklappen, Obsidian neu laden, Ribbon-Symbol klicken | Leiste klappt auf, Cockpit ist sichtbar (kein 0×0-Blatt, REGISTRY §UI) | ✅ Leiste klappt auf, Cockpit **300×730 px** — kein 0×0-Blatt |
| 2 | Knopf-Position: „Alle synchronisieren" per `getBoundingClientRect()` prüfen | Knopf steht im Inhalt und ist sichtbar, nicht nur im DOM vorhanden | ✅ 146×30 px bei y=82, innerhalb der `view-content` (y 70–800) und im Viewport |
| 3 | Ribbon-Klick öffnet die Ansicht, startet **keinen** Lauf; Gegenprobe `sync-mailbox` in der Befehlspalette | Ribbon öffnet nur, Befehlspalette startet weiterhin einen Sync | ✅ Ribbon: `runState.account.at` unverändert (…502341 → …502341), Leaves 0 → 1. Palette: …502341 → …634634, `ok: true` |
| 4 | Genau ein View-Type prüfen (Konsole/Sidebar-Menü) | Nur `mailstone-cockpit` taucht auf (UI-STANDARD §1) | ✅ `viewByType` führt genau einen Treffer: `mailstone-cockpit` |
| 5 | Startup-Gate, beide Hälften: mit `openViewOnStartup: false` neu laden, dann in den Einstellungen einschalten und erneut neu laden | Ansicht bleibt zu (aus) / Ansicht öffnet sich (an) — beide Hälften gefahren | ✅ **aus:** nach `onLayoutReady`+2 s null Leaves, Leiste bleibt eingeklappt · **an:** 1 Leaf, Leiste offen, 300×730 px |
| 6 | Register überlebt den Neustart: Sync fahren, Zähler merken, Obsidian neu laden, Cockpit öffnen, danach `data.json` ansehen | Derselbe Stand steht da; `runState` liegt neben `settings`, `zoneHashes`, `uidCache` | ✅ „Zuletzt 06:36:42" vor und nach dem Neustart identisch; `data.json` führt `runState` neben `settings`, `zoneHashes`, `uidCache` |
| 7 | Kaputtes Register kippt den Start nicht: in `data.json` `"runState": "kaputt"` eintragen, neu laden | Plugin lädt, Cockpit zeigt „Noch nicht gelaufen", kein Fehler in der Konsole | ✅ `runState` wird zu `{}`, Cockpit zeigt „Noch nicht gelaufen", **0** Fehler/Warnungen im Konsolen-Mitschnitt über den Neustart hinweg |
| 8 | Kommandoname in der Palette nachsehen | „Mailstone: Seitenleiste öffnen" — nicht „Mailstone: Mailstone" (Fix-Welle 1, Befund 9) | ✅ „Mailstone: Seitenleiste öffnen" |
| 9 | `openTabById` gegen die echte API: erst die Einstellungen öffnen und dort „Darstellung" wählen, schließen, dann im leeren Cockpit „Einstellungen öffnen" klicken | Einstellungen öffnen sich auf dem **Mailstone**-Tab, nicht auf „Darstellung" (Fix-Welle 1, Befund 5) | ✅ Einstellungen öffnen auf **Mailstone** (erstes Feld „Sprache"), obwohl zuvor „Darstellung" aktiv war |
| 10 | Lauf-Anzeige: Sync über den Kopfknopf starten und währenddessen hinsehen | In der **Kopfzeile** dreht genau ein `loader`-Symbol (CSS-Animation, per Unit-Test nicht messbar), die Kontozeilen behalten Zustand und Zähler; danach ist das Symbol weg (Fix-Welle 1, Befund 4) | ✅ 48 Loader-Frames, **alle 48 in der Kopfzeile**, 0 in der Kontozeile, nie mehr als einer gleichzeitig, `animation-name: mailstone-spin`; Kontozeile behält `is-ok` und „Keine Änderungen"; danach ist das Symbol weg |

### Zwei Sachen, die die Tabelle so nicht hergibt

**Punkt 10 war ohne Sampler nicht messbar.** Ein Sync-Lauf gegen den leeren Allowlist-Ordner ist
in **unter einer Sekunde** durch — eine Stichprobe „schau während des Laufs hin" trifft den
Loader mit hoher Wahrscheinlichkeit nicht und meldet dann fälschlich, es drehe sich nichts.
Gemessen wurde deshalb mit einem 20-ms-Sampler, der über den ganzen Lauf Position, Anzahl und
`animation-name` jedes `svg` mitschreibt. Erst das trennt die drei Aussagen sauber, die der
Prüfpunkt verlangt: **wo** (48/48 Frames in `.mailstone-cockpit-head`, 0 in der Kontozeile — genau
der Befund aus Fix-Welle 1), **wie viele** (nie mehr als einer) und **ob es sich bewegt**
(`mailstone-spin`, nicht nur ein statisches Icon mit Loader-Klasse).

**Ein „reload" ist erst belegt, wenn der alte Renderer nachweislich weg ist.** Der erste Versuch
meldete das Fenster nach einem einzigen Pollschritt als „wieder da" — schnell genug, um den
Verdacht zu wecken, dass noch der *alte* Renderer antwortete und die Messung damit gar keinen
Neustart gesehen hätte. Jeder der fünf Neustarts setzt seither vorher `window.__probeMarker` und
gilt erst als vollzogen, wenn der Marker **weg** und das Plugin wieder geladen ist. Das ist
dieselbe Trennung von Mutation und Wartephase, die die Dach-Doku für `pollUntil` beschreibt — hier
für den Prüfling selbst.

---

## M4 — getrackter GUI-Smoke-Treiber (2026-09-02)

`npm run smoke:gui` fährt die zehn Punkte der M5-Handprobe seither selbst
(`scripts/gui-smoke.ts`, zwölf Prüfpunkte — V3 und V5 zerfallen in je zwei Hälften, weil
beide eine Gegenprobe brauchen). Erfüllt CORE-TEST-02 (b): der Hand-Lauf darüber existierte
genau einmal und wäre beim nächsten Mal wieder Handarbeit gewesen.

**Ergebnis: 12/12 grün** gegen Obsidian 1.13.7, Staging-Vault `mailstone`, deployter Stand
`0.2.0`. `data.json` byte-gleich zurückgeschrieben, keine Testnotizen, kein Testkonto und
keine Rettungskopie übrig.

**Der Treiber hängt an nichts Fremdem.** Er legt sich ein Testkonto auf `127.0.0.1` an und
stellt seine Gegenstellen selbst her: einen **toten Port** (sofortiges `ECONNREFUSED`, für
„hat ein Lauf stattgefunden?") und einen **Schweige-Server**, der die Verbindung annimmt und
nie antwortet — der Lauf hängt dann lange genug, um die Lauf-Anzeige abzutasten, und ein
`close()` beendet ihn sofort statt nach 30 s. Ein *erfolgreicher* Sync ist bewusst nicht
herstellbar: `Account["imap"]["tls"]` kennt nur `implicit`/`starttls`, der getrackte
Fake-IMAP spricht kein TLS, und den Typ dafür aufzuweichen wäre der falsche Preis. Für die
Verdrahtung genügt, dass ein Lauf *stattfindet*.

### Die Gegenprobe (CORE-TEST-02) — und was sie im Treiber fand

Ein grüner Smoke beweist nichts, solange er nie rot war. Ausgebaut wurde der
Kopfzeilen-Indikator (`cockpit-panel.ts:104`, Befund 4 der Abschluss-Fix-Welle).

| Lauf | Ergebnis |
|---|---|
| mit Fix | 12/12 grün |
| Fix ausgebaut | **11/12 — genau V10 rot**, kein anderer Punkt fällt mit |
| Fix zurück | 12/12 grün |

Die rote Zeile nannte dabei den Klartext des Prüflings mit (CORE-TEST-14): „Synchronisiert…"
stand in der Kopfzeile, der Lauf lief also — es fehlte allein das Symbol. Genau der
ausgebaute Defekt, ohne Rätselraten.

**Sechs von sieben Auffälligkeiten der ersten Läufe lagen im Werkzeug, nicht im Prüfling** —
das ist die eigentliche Leistung dieser Runde und deckt sich mit dem, was der Skill für den
ersten Lauf vorhersagt. Der Reihe nach, weil jede eine eigene Lehre trägt:

1. **`persist()` schreibt nichts.** Der Treiber rief die Persister-Funktion ohne Argument;
   sie erwartet den ganzen Zustand (`main.ts:404`). Einstellungen wirkten im Speicher und
   überlebten keinen Neustart — V5b war rot bei intaktem Prüfling. Richtig ist
   `saveSettings()`, die Methode, die auch der Settings-Tab nimmt.
2. **Ungültige Geheimnis-ID.** `secretId` war `mailstone:<id>`; erlaubt sind nur
   Kleinbuchstaben, Zahlen und Bindestriche (`secretIdFor` bildet `mailstone-<id>`). Ohne
   hinterlegtes Passwort bricht jeder Lauf **vor** dem Verbindungsaufbau ab — die
   Gegenstelle wurde nie erreicht, und die Lauf-Anzeige war nur Millisekunden da.
3. **Der aktive Einstellungs-Tab steht nicht im Workspace-Renderer.** Ab Obsidian 1.13 sind
   die Einstellungen ein eigenes **Fenster**; `app.setting.activeTab` ist dort `null`. V9 las
   damit nicht den Tab, sondern die Abwesenheit des Modals.
4. **Der CTA-Griff traf Obsidians eigenen Knopf.** „Der erste Knopf in der Ansicht, der nicht
   `sync-all` ist" war der `view-action` im Kopf der Leaf. Einstieg gehört über einen
   plugin-eigenen Anker — hier `.mailstone-cockpit-empty`.
5. **Ohne Fokus drosselt Chromium die Timer auf etwa einen Tick pro Sekunde.** Die Abtastung
   in V10 lieferte 7 statt 133 Proben, und die Sidebar wurde mit **24 statt 300 px** gemessen —
   beide Male blieb der Punkt **grün** und maß das Falsche. `requireVisible` gehört nicht nur
   an den Anfang, sondern **nach jeden Neustart**: der Fokus überlebt ihn nicht zuverlässig.
   Seither ist auch „zu wenige Proben" ein roter Ausgang statt eines stillen.
6. **Der erste Prüfpunkt maß den Stand von vorhin.** Obsidian hält `main.js` im Speicher; ein
   frisches `npm run deploy` wirkt erst nach einem Plugin-Neuladen. In der ersten Gegenprobe
   blieb V10 deshalb grün, obwohl der geprüfte Fix ausgebaut war — der Smoke prüfte den alten
   Build. Der Treiber lädt das Plugin jetzt zu Beginn neu.
7. **Das Aufräumen maß zu früh und ließ den Testzustand stehen.** Der Vergleich meldete
   „byte-gleich", während das Plugin seinen Speicherstand beim Entladen noch einmal
   darüberschrieb: das absichtlich kaputt gesetzte Register aus V7 (`runState: "kaputt"`)
   blieb im Vault liegen. Richtige Reihenfolge ist **abschalten → Datei herstellen →
   einschalten**, dann vergleichen.

Nummer 5 und 6 sind dieselbe Familie wie die Nachlese der Handprobe darüber: eine Messung am
Übergang, die den gemeinten Zustand nie gesehen hat — und deren Fehlerausgang **grün** ist.

### Was der Treiber nicht abdeckt

Postfach-Logik (dafür `tests/integration/` gegen den Fake-IMAP über einen echten Socket) und
alles, was ein Urteil verlangt: ob die Anordnung gefällt, ob eine Meldung verständlich ist.
Dafür bleibt die Hand-Runde.

## M4 Task 10 — Posteingang im GUI-Smoke, Fake-IMAP kann SELECT und UID MOVE (2026-09-03)

**Baseline war 12/12 grün** (Abschnitt „M4 — getrackter GUI-Smoke-Treiber" oben, 2026-09-02,
gegen den deployten Branch-Stand). Dazu gekommen: drei Punkte für den Posteingangs-Tab,
`npm run smoke:gui` fährt jetzt fünfzehn.

- **V11** Inbox-Tab existiert, ist klickbar, zeigt seinen Inhalt (Inbox-Panel sichtbar,
  Cockpit-Panel `is-hidden`).
- **V12** bei leerem Ordner erscheint der Empty-State (`.mailstone-inbox-empty`) mit einem
  sichtbaren Handlungsangebot (CTA „Einstellungen öffnen").
- **V13** die Tab-Wahl übersteht einen Wechsel hin und zurück — Beleg für das „mount-once"-
  Muster: eine selbst gesetzte Marke am Panel-`div` überlebt Cockpit→Inbox→Cockpit→Inbox,
  also wurde das Element nie neu gebaut.

Alle drei prüfen Verdrahtung, keine Postfach-Logik — dieselbe Grenze wie V1–V10. Sie brauchen
keine IMAP-Gegenstelle: das Panel lädt erst nach einem Refresh-Klick, den kein Punkt auslöst,
darum ist die Inbox in jedem frischen View-Zustand „leer" — genau der Zustand, den V12 zeigen
soll.

**Fake-IMAP (`scripts/fake-imap.mjs`) erweitert um `SELECT` (wie `EXAMINE`, aber
`[READ-WRITE]`) und `UID MOVE <uid> <mailbox>` (`OK [COPYUID 1 <uid> 1] Move completed`, UID
verschwindet aus `MAILS`).** Manuell gegen einen echten Socket geprüft (`SELECT` → `[UIDVALIDITY
4242] … [READ-WRITE] done`; `UID MOVE 7 Vault` → UID 7 verschwindet aus der nächsten `UID
SEARCH ALL`; `UID MOVE 999 Vault` → `NO [NONEXISTENT]`), zusätzlich `npm run test:integration`
grün (2 Testdateien, 3 Tests — die vorhandenen `fake-imap.test.ts`-Fälle decken `SELECT`/`UID
MOVE` selbst nicht ab, das ist eine bekannte Lücke, kein neuer Befund dieser Runde). Ohne diese
Erweiterung wäre der GUI-Smoke für die drei neuen Punkte blind gewesen — er hätte grün melden
können, ohne dass je ein `MOVE` stattfand; der GUI-Smoke selbst spricht aber gar kein IMAP (er
prüft nur DOM-Verdrahtung, s. o.), die Erweiterung sichert also strukturell den schreibenden
Server-Pfad ab, nicht diesen konkreten Lauf.

### Ergebnis: 15/15 grün

Gegen Obsidian 1.13.7, Staging-Vault `mailstone`, deployter Stand `0.2.0`, `shasum -a 1`
zwischen gebauter und deployter `main.js` vorab geprüft. `data.json` byte-gleich
zurückgeschrieben.

### Gegenprobe (CORE-TEST-02)

Inbox-Panel aus der Panel-Liste in `mailstone-view.ts` genommen (`buildHubInto(this.contentEl,
[cockpit], "cockpit")` statt `[cockpit, inbox]`), neu deployt (`shasum` bestätigt den neuen
Stand), erneut gefahren:

| Lauf | Ergebnis |
|---|---|
| intakt | 15/15 grün |
| Inbox-Panel ausgebaut | **12/15 — genau V11, V12, V13 rot** („Inbox-Tab nicht im DOM"), kein anderer Punkt fällt mit |
| zurückgebaut | 15/15 grün |

**Review-Befund, Fix-Runde 1 (2026-09-03): die grobe Gegenprobe oben belegt Kopplung, nicht
Trennschärfe.** Alle drei Punkte hängen zusammen am Inbox-Panel — das zeigt nicht, dass jeder
seine eigene Zusage prüft. Zwei gezieltere Gegenproben, je eine pro Zusage, Panel bleibt dabei
intakt; jede einzeln gefahren und danach vollständig zurückgebaut (`git diff` leer), bevor die
nächste kam:

- **V12 gezielt (nur den CTA-Knopf ausgebaut):** `inbox-panel.ts`, den `createEl("button", …
  cta …)`-Zweig im Empty-State entfernt (Empty-State-Absatz bleibt, CTA fehlt). Neu deployt
  (`shasum` bestätigt), gefahren: **14/15 — genau V12 rot** (`CTA da: false`), V11 und V13
  blieben grün.
- **V13 gezielt (mount-once selbst gebrochen, nicht das Panel):** `src/vendor/kit-obsidian/hub.ts`
  (vendorte Kit-Datei, nur für diese Probe temporär angefasst und exakt zurückgebaut — kein
  Re-Vendoring, kein bleibender Diff), `setTab()` so geändert, dass der Ziel-Tab beim Wechsel
  ein **frisches** `<div>` bekommt und `panel.mount()` erneut aufgerufen wird, statt nur
  `is-hidden` umzublenden — die Panel-Instanz und ihr Host bleiben dieselben, nur die
  DOM-Identität wechselt. Neu deployt (`shasum` bestätigt), gefahren: **14/15 — genau V13 rot**
  (Marke nach Hin-und-zurück nicht mehr da, weil das Div ausgetauscht wurde), V11 und V12
  blieben grün. (Ein erster Lauf dieser Probe zeigte zusätzlich V10 rot mit der bekannten
  Fokus-Drossel-Meldung „nur 15 Proben in 2,5 s" — ein Refokus-Ausrutscher, keine Folge der
  Änderung; ein sofortiger zweiter Lauf zeigte wieder nur V13 rot.)
- Danach `hub.ts` exakt zurückgebaut (`git diff` leer), neu deployt, `shasum` bestätigt: **15/15
  grün** — das ist die letzte, zählende Messung.

Damit ist belegt: V11 hängt an der bloßen Existenz/Sichtbarkeit des Panels (die grobe Probe
oben ist seine eigene Gegenprobe, da die beiden gezielten Proben zeigen, dass V12 und V13
unabhängig auslösen), V12 an seinem eigenen CTA, V13 an der DOM-Identität des Panel-Divs — drei
verschiedene Zusagen, kein Punkt, der nur zusammen mit den anderen auslöst.

### Störung durch einen fremden Lock-Doppelerwerb — und wie sie behandelt wurde

Der CDP-Lock wurde beim ersten Erwerb (`07:18:05 UTC` / `09:18:05` CEST) zeitgleich mit einer
Nachbar-Session (`vim-dojo`) vergeben — ein bekannter Nicht-Atomaritätsfehler im Lock-Skript,
gemeldet über den Koordinator. Die Nachbar-Session fuhr in der Minute danach Fokus-Klicks gegen
Port 9222. Der erste 15/15-Lauf dieser Runde fiel in dieses Fenster und wurde deshalb
**verworfen, ohne gewertet zu werden** — nicht wegen eines roten Punkts, sondern weil er nicht
belegt war. Alle drei oben genannten Läufe (intakt → kaputt → intakt) wurden danach neu
gefahren, vollständig zwischen `07:22:47` und `07:29:26 UTC`, außerhalb des gemeldeten Fensters
`09:18:05–09:18:59 CEST` — deshalb zählen sie.
