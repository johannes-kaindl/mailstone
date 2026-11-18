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
alle an `actions.ts` durchreichen. **Gefunden werden sie mit `grep -n "imapConnectWritable("`,
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
