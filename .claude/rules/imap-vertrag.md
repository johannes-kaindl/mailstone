---
paths:
  - "src/core/imap/**"
  - "src/core/sync/**"
  - "src/core/inbox/**"
  - "src/core/originals/**"
  - "src/core/thread/follow*.ts"
  - "tests/integration/fake-imap.test.ts"
---

# IMAP-Vertrag — lesen ohne `\Seen`

Gotchas zur Zusage, dass ein Sync-Lauf nie `\Seen` setzt. Der Vertrag selbst steht im Kern (`AGENTS.md` § Gotchas).

Das gilt auf **Konsumenten**-Ebene — der einzige Ort, der die schreibende Session als Typ
entgegennimmt. **Verdrahtet** (also `imapConnectWritable(...)` aufgerufen) wird sie an drei
Stellen in `src/main.ts` (Übernehmen, Archivieren, Aufgabe anlegen im Posteingangs-Panel), die
alle an `actions.ts` durchreichen, und seit A1 (Übernahme, 2026-11-18) an einer vierten, die **kein Klick** auslöst: `followCopyConnections` in `src/core/thread/follow-copy.ts` (Abschnitt unten). **Gefunden werden sie mit `grep -n "imapConnectWritable("`,
nicht über Zeilennummern** — die hier notierten wanderten seit M5 zweimal (zuletzt +27 Zeilen
durch die Versand-API), und eine veraltete Nummer schickt den nächsten Leser an die falsche
Stelle, ohne dass etwas fehlschlägt.

`SyncService` nimmt eine `ImapReadSession` entgegen; `select` steht ihm damit nicht zur
Verfügung, ein versehentliches `SELECT` im Sync-Pfad ist ein **Typfehler**. Wer den
schreibenden Einstieg an einer zweiten Stelle verwendet, öffnet den Vertrag dort — und trägt
die Stelle hier ein.

Auch der schreibende Pfad setzt **kein** `\Seen`: `UID MOVE` nimmt die Flags der Nachricht mit.
Eine Nebenwirkung hat er doch, und sie sei benannt: `SELECT` setzt den `\Recent`-Status für
andere Sitzungen zurück. Das trifft nur die kurze Aktions-Verbindung, nie den Sync, und
`\Recent` wertet keiner der beteiligten Wege aus.

**Gemessen wird der Vertrag am Kommandotext, nicht am Flag** (`tests/integration/fake-imap.test.ts`
seit 2026-09-03): der Fake-IMAP protokolliert jede empfangene Zeile, der Test prüft den ganzen
Dialog eines Sync-Laufs auf **Abwesenheit** von `SELECT` und `BODY[`. Ein `\Seen`-Vergleich wäre
hier der falsche Test — `EXAMINE` ist nach RFC 3501 § 6.3.2 read-only, ein RFC-treuer Server setzt
dort auch bei `BODY[]` keine Flags. Er bliebe also grün, während dieses Plugin seine Zusage bricht;
grün wäre dann die Zusage des *Servers*. Wer den Vertrag erweitert, erweitert diesen Test.

Der Message-ID-Abgleich läuft über `BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]` statt `ENVELOPE`
(Spec § 3.1): die Normalisierung dafür existiert seit M1, ein Adresslisten-Parser wäre Aufwand
ohne Ertrag.

**`fetchOriginal` (`src/core/originals/`, A6) ist ein weiterer lesender Konsument:** `imapConnect` (nie `imapConnectWritable`), `EXAMINE`, `UID SEARCH HEADER Message-ID` (`uidSearchHeader`, Wert über `quoteArg`; CR, LF, Nicht-ASCII und Leerzeichen senden gar kein Kommando) und `uidFetchBody` (`BODY.PEEK[]`). Er belegt den Busy-Guard wie `fetch.ts`, holt je Ordner höchstens fünf Kandidaten und verwirft jeden, dessen geparste Message-ID nicht passt (`verifyEml`: die Suche ist ein Teilstring-Treffer). Der Dialogtest in `tests/integration/fake-imap.test.ts` prüft auch seinen Lauf auf Abwesenheit von `SELECT` und `BODY[`.

**`runFollowUps` / `findFollowUps` (`src/core/thread/follow-run.ts`, `follow.ts`, A1) ist der dritte lesende Konsument:** `imapConnect` (nie `imapConnectWritable`), je Ordner `EXAMINE`, `UID SEARCH SINCE <dd-Mon-yyyy>` (`uidSearchSince`, Fenster `FOLLOW_WINDOW_DAYS` = 60) und `uidFetchThreadHeaders` (`BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)]`, ohne FLAGS, höchstens `MAX_FOLLOW_HEADERS` = 2000 je Ordner). Der Ablauf bekommt per Typ nur `examine`, `uidSearchSince` und `uidFetchThreadHeaders` (`FollowSession`), schreibt nichts in Vault oder Server und belegt den Busy-Guard wie `fetch.ts`. `uidFetchHeaders` und der Posteingang bleiben bei ihren vier Feldern (eigener Test). Der Dialogtest in `tests/integration/fake-imap.test.ts` prüft den Lauf gegen INBOX und Sent auf Abwesenheit von `SELECT`, `BODY[`, `COPY`, `STORE`, `MOVE`, `APPEND` und `EXPUNGE`.

| Wer nimmt `imapConnectWritable` | Wann | Was die Sitzung tut | Ausgelöst durch |
|---|---|---|---|
| `src/main.ts` → `src/core/inbox/actions.ts` (drei Stellen) | Übernehmen, Archivieren, Aufgabe anlegen | `select`, `uidMove` | Klick des Nutzers |
| `followCopyConnections` in `src/core/thread/follow-copy.ts`, gerufen von `src/core/sync/service.ts` | nur mit `account.sync.followThreads` (Standard **aus**), wirksamem Folgen-Feld und nur, wenn es etwas zu kopieren gibt | `examine`, `uidCopy` (kein `select`) | der Sync-Lauf selbst, ohne Klick |

**`copyFollowUps` (`src/core/thread/follow-copy.ts`, A1-Übernahme, Entscheidung Johannes 2026-11-18) ist die erste Schreibstelle, die ein Sync-Lauf ohne Klick auslöst.** Der Ablauf läuft vor dem Allowlist-Lauf eines Kontos und nur bei `account.sync.followThreads` (Konto-Einstellung, Standard aus, auch für bestehende Installationen) **und nur, wenn das Folgen-Feld wirkt** (`effectiveFollowField(profile) !== ""`: nicht leer, kein verwaltetes Feld, lesbar, keine Kollision mit dem Vorgangsfeld). Ohne wirksames Feld ließe sich die Stopp-Markierung „Diesem Vorgang nicht mehr folgen“ nicht lesen, und ein beendeter Vorgang würde gegen den Willen des Nutzers auf dem Server kopiert; `SyncService.run` überspringt den Schritt dann ganz (keine Verbindung, kein Zugriff auf `deps.follow.context`), der Lese-Sync läuft normal weiter, und die Log-Zeile `follow-copy: skipped …` macht es unterscheidbar (Test in `tests/core/sync/service.test.ts`). Gefunden und abgeglichen wird **lesend** mit `imapConnect`: `findFollowUps` über INBOX und Gesendet, dann `EXAMINE` auf den Allowlist-Ordner und je Kandidat `UID SEARCH HEADER Message-ID` mit genauer Prüfung der Treffer (`uidFetchMessageIds`; die Suche ist ein Teilstring-Treffer). Das ist der Doppelkopie-Riegel: eine Mail, deren Message-ID schon im Allowlist-Ordner liegt, wird nicht noch einmal kopiert. Erst wenn danach etwas zu kopieren bleibt (höchstens `MAX_FOLLOW_COPIES_PER_RUN` = 50, älteste zuerst), entsteht die schreibende Verbindung `imapConnectWritable`. Sie öffnet die Quelle mit **`EXAMINE`, nicht `SELECT`** (RFC 3501 § 6.4.7: COPY ist im ausgewählten Zustand erlaubt, auch nach EXAMINE; die Quelle ändert sich nicht), prüft, dass die `UIDVALIDITY` noch die der lesenden Sitzung ist (sonst meinen die UIDs andere Mails: nichts wird kopiert, die Mails zählen als Fehler), und sendet `UID COPY <uid> "<Allowlist>"` über `uidCopy` (`ImapWriteSession`, Zielname über `encodeMailbox`, `NO`/`BAD` als Wert; mit UIDPLUS belegt erst `[COPYUID]`, dass etwas kopiert wurde, sonst `gone`). Ein abgelehntes COPY zählt als Fehler im Lauf und hält ihn nicht an. Mails ohne Message-ID (`noid-…`) oder mit einer ID, die SEARCH nicht tragen darf, werden nie kopiert: ohne Abgleich gäbe es Doppel. **Ob ein echter Server COPY nach EXAMINE annimmt, ist am Fake nicht messbar und wird beim ersten Lauf am echten Postfach mit Johannes geprüft; lehnt er ab, kommt das als `BAD`/`NO` zurück und zählt als Fehler. Ein `SELECT` auf der kurzen schreibenden Verbindung wäre dann der Weg, wie bei den Posteingangs-Aktionen.**

Der Lese-Sync (`SyncService.run`) bleibt bei `imapConnect` und `ImapReadSession`; `uidCopy` steht ihm als Typ nicht zur Verfügung (Test mit `@ts-expect-error` in `tests/core/imap/client.test.ts`). Auch dieser Schreibpfad setzt kein `\Seen`: die Kopie behält die Flags des Originals (eine ungelesene Mail ist im Allowlist-Ordner ebenfalls ungelesen; wer den Ordner sonst beobachtet, sieht die Kopien als neue Post). Der Dialogtest `kopiert mit eingeschaltetem Folgen …` in `tests/integration/fake-imap.test.ts` prüft beide Läufe (kopieren, dann nichts doppelt) auf Abwesenheit von `SELECT`, `STORE`, `EXPUNGE`, `MOVE`, `APPEND` und `BODY[`; der Test `ausgeschaltet (Standard) …` prüft, dass ohne die Einstellung genau eine Verbindung und kein `COPY` entsteht. Der Dialogtest der lesenden Konsumenten oben (`runFollowUps`, `fetchOriginal`) prüft weiter auf Abwesenheit von `COPY`.
