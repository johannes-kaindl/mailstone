# Entscheidungen in mailstone — das Warum

Verdichtete Design-Essenz zu den Regeln im Kern (`AGENTS.md`). Die Herleitungen (Specs und Pläne) liegen im Coding-Cockpit des Maintainers unter `_SDD/` (CORE-META-14, maintainer-lokal). Vor dem Übernehmen einer Altentscheidung gilt: Grund aufsuchen, messen, ob er heute trägt, Ergebnis melden.

## GitHub als Verteilweg

GitHub ist seit 2026-09-24 wieder der Verteilweg, `origin` auf Forgejo bleibt die Quelle. Vom 2026-09-06 bis 2026-09-24 war GitHub aufgegeben (Remote entfernt, `--no-github` fest im Script, Eintrag in `mirror_drift_check.AUSNAHMEN`); der Mirror trug damals ohnehin nicht (gemessen 2026-09-01: 42 min nach dem Push stand GitHub unverändert). Heute gilt der Dach-Standard (`../.claude/rules/release-und-store.md`): GitHub bekommt Branch und Tag nur über den Dual-Push von `release.mjs`. Das `github`-Remote steht und `npm run release` fährt ohne `--no-github`. Daneben bleibt der AnySource-Katalog ein Weg (mailstone ist dort gelistet).

## Ein verwaister Schlüsselbund-Eintrag wird bewusst nicht aufgeräumt (2026-09-03, M1-Nachlese)

Wer im Konten-Modal ein Geheimnis anlegt und dann abbricht, hinterlässt einen Eintrag ohne Konto. Ihn zu löschen hieße, in einem globalen Namensraum zu räumen (`app.secretStorage` gehört allen Plugins, die IDs vergibt der Nutzer); ein verwaister Eintrag kostet nichts, ein fälschlich gelöschter ein Passwort. Wortlaut und Folgen: `.claude/rules/secrets.md`.

## `hasCapability` und `model.validateTask` bleiben bei TaskNotes ungenutzt (2026-09-05)

Gemessen gegen TaskNotes 4.12.5 (die Version im Staging-Vault, am 2026-10-23 unverändert): `hasCapability("tasks.create")` liefert `false`, obwohl `api.tasks.create` funktioniert, und `validateTask` lehnt jede Erstellungs-Eingabe ab. Gelten die Messungen bei einer neueren TaskNotes-Version noch, ist erst nach einer neuen Messung zu entscheiden. Wortlaut: `.claude/rules/tasknotes.md`.

## `smoke:e2e` ist bewusst nicht Teil des Gates

Der Naht-Lauf gegen ein echt installiertes TaskNotes setzt ein Nachbarplugin voraus, das nicht jeder Klon hat; eine Pflichtstrecke darf nicht daran scheitern. Wortlaut: `.claude/rules/gui-smoke.md`.

## Der Aufräumbefehl löscht .eml, nie Notizen (2026-11-18)

Die Spec (§ 5) sagte „Löschen gibt es nicht (auch nicht `trashFile`)“. Johannes wünscht ausdrücklich, die Doppelung loszuwerden: die `.eml` neben der Notiz enthält alle personenbezogenen Daten im Klartext und hebelt jede Pseudonymisierung der Notiz aus. Deshalb gibt es `mail.removeEml` („Gespeicherte .eml-Dateien entfernen“) als eng gefasste Ausnahme:

- nur bei `saveEml: false` in der Palette (wer die `.eml` behalten will, findet den Befehl nicht);
- nur der Konventionspfad (`emlPathFor`), nie die Quelldatei eines Imports; die Vorschau sagt das ausdrücklich;
- nur eine `.eml`, deren Message-ID-Kopf zur `mail_id` ihrer Notiz passt (Probe je Datei in `src/obsidian/eml-probe.ts`, ohne vollen Parse); nicht passende oder unlesbare bleiben liegen, mit Grund in der Vorschau;
- nie eine Notiz: `trashEml` (`vault-notes.ts`) verweigert alles, was nicht auf `.eml` endet;
- über `app.fileManager.trashFile`, also nach der Papierkorb-Einstellung des Vaults (je nach Einstellung endgültig; die Vorschau sagt es);
- immer mit Vorschau. Was schon in einer Git-Historie des Vaults liegt, ist damit nicht weg, das ist Sache des Vaults.

Ohne `.eml` holt `buildContext` das Original bei Bedarf vom Server (`fetchOriginal`, nur lesend, nur Desktop) und schreibt es nie in den Vault. Mails ohne Message-ID (`noid-…`) behalten die `.eml` auch bei `saveEml: false`, weil sie auf dem Server nicht auffindbar sind.

## Der Sync verlinkt ältere Notizen nach (2026-11-18, eine Ausnahme von Merge-Regel 5)

Merge-Regel 5 (Spec § 2.2) sagt: Sync legt nur Neues an und setzt `mail_state`. Gemessen im Arbeits-Vault: Helpdesk-Bestätigungen kamen vier Tage vor ihren Bezugsmails, danach standen in `in_reply_to` und `references` rohe IDs, obwohl die Zielnotizen existierten; bis zum nächsten *Relink threads* von Hand blieb das so. Entscheidung (Johannes, 2026-11-18): ein Sync-Lauf darf das nachholen, eng begrenzt.

- **Was:** nach dem Anlegen ersetzt der Lauf in **bestehenden** Mail-Notizen die rohe ID durch den Wikilink, in `in_reply_to` und `references`, sonst in keinem Feld.
- **Nur für IDs, deren Notiz dieser Lauf angelegt hat.** Eine rohe ID auf eine Mail ohne Notiz oder auf eine, die ein früherer Lauf angelegt hat, bleibt roh (dafür gibt es `mail.relink`). Nie ein Selbstverweis.
- **Derselbe Weg wie `mail.relink`** (`relinkNotePlan`): zeilenweise ins Frontmatter, die Zone bleibt Byte für Byte stehen, der gespeicherte Zone-Hash bleibt; geschrieben über den `PlanExecutor` mit `expectedContent`, also nur, wenn die Datei noch den gelesenen Inhalt hat. Keine Vorschau (es ist ein Sync).
- **Kein Mailinhalt ändert sich**, deshalb bleibt der Grund der Regel (die Zone gehört dem Nutzer, kein automatischer Re-Render) unberührt. Ein Fehlschlag bei einer Notiz bricht den Lauf nicht ab und zählt als Fehler.

Wer diese Ausnahme erweitert (weitere Felder, IDs früherer Läufe, die Zone), ändert Merge-Regel 5 und braucht eine neue Entscheidung.

## Ausnahmen von Dach-Regeln

Zwei Abweichungen von der Dach-`REGISTRY.md` sind bewusst und mit Begründung in den Pfadregeln festgehalten: der Aufruf von `api.tasks.create` am Fremdplugin TaskNotes (`.claude/rules/tasknotes.md`, entschieden von Johannes 2026-09-05) und das Zustimmungs-Tor der Versand-API (`.claude/rules/versand-api.md`).

## Erste Schreibstelle auf dem Server: COPY für Vorgang-Folgen (2026-11-18)

Entschieden von Johannes selbst am 2026-11-18 (Klickfrage, Weg 1 der Entscheidungs-Task zu A1): Folge-Mails eines Vorgangs, den der Vault schon kennt, legt der Sync per IMAP `UID COPY` in den Allowlist-Ordner. Weg 2 (Folge-Mails direkt aus INBOX und Gesendet lesen und als zweite Quelle mit eigener `mail_source` führen) ist verworfen.

**Grund.** Der ganze Sync hängt an der einen Ordnerwahrheit: Detach, Reattach, UID-Cache, Zählung. Eine zweite Quelle bräuchte für INBOX und Gesendet eigene Detach-Regeln, weil eine archivierte Antwort sonst als „detached“ erschiene, obwohl sie gewollt ist; sie wäre eine zweite Wahrheit. Mit COPY bleibt der Allowlist-Ordner die einzige: was dort liegt, ist Notiz, was ihn verlässt, wird abgelöst, und die Mail bleibt im Posteingang und in Gesendet sichtbar.

**Was das kostet, und was dafür gilt.**

- Es ist die erste Stelle, an der ein **Sync-Lauf ohne Klick** auf dem Server schreibt. (Geschrieben hat Mailstone schon vorher: `UID MOVE` der Posteingangs-Aktionen auf Klick, `APPEND` der Sent-Kopie beim Versand. Neu ist, dass es der automatische Lauf tut.) Der Eintrag steht in `.claude/rules/imap-vertrag.md`; README, README.de und der Einstellungstext sagen es deutlich.
- **Standardmäßig aus, auch für bestehende Installationen:** `account.sync.followThreads` gilt nur, wenn `true` gespeichert ist (`loadSettings` liest alles andere als aus). Die Einstellung hängt am **Konto**, nicht am Profil: geschrieben wird auf einem bestimmten Server, und `sync.enabled`, Intervall und Ordner liegen ebenfalls am Konto.
- Der Lese-Sync bleibt lesend (`imapConnect`, `ImapReadSession`, `EXAMINE`, `BODY.PEEK`). Die schreibende Verbindung entsteht nur im Schritt vor dem Lauf, nur bei eingeschalteter Einstellung und erst, wenn nach dem Abgleich etwas zu kopieren bleibt. `uidCopy` gehört zur `ImapWriteSession`; der Compiler hält es vom Lese-Sync fern.
- Kein `SELECT`: COPY ist nach RFC 3501 § 6.4.7 im ausgewählten Zustand erlaubt, auch nach `EXAMINE`; die Quelle ändert sich nicht, `SELECT` würde `\Recent` für andere Sitzungen zurücksetzen. Das Muster der Posteingangs-Aktionen (`SELECT` + `UID MOVE`) passt dort, weil MOVE die Quelle verändert. Ob ein echter Server COPY nach EXAMINE annimmt, ist am Fake nicht zu messen und wird beim ersten Lauf am echten Postfach geprüft; lehnt er ab, zählt das als Fehler, und `SELECT` auf der kurzen Verbindung wäre der Ausweg.
- Keine Doppelkopie: vor dem COPY sucht der Schritt die Message-ID im Allowlist-Ordner (`UID SEARCH HEADER`, Treffer genau geprüft, weil die Suche ein Teilstring-Treffer ist). Dieselbe Mail in INBOX und Gesendet zählt einmal; eine Mail ohne Message-ID oder mit einer ID, die SEARCH nicht tragen darf, wird nicht kopiert, weil sie sich nicht abgleichen ließe.
- **Nur mit wirksamem Folgen-Feld (Nachtrag, gleicher Tag).** Die Stopp-Markierung „Diesem Vorgang nicht mehr folgen“ liegt im Frontmatter-Feld `profile.followField`. Ist es leer oder unbrauchbar (`effectiveFollowField` ist `""`), kann der Schritt gestoppte Vorgänge nicht erkennen; er würde sie trotzdem kopieren, also auf dem Server schreiben gegen den Willen des Nutzers. Dann läuft der Schritt nicht (keine Verbindung), der Lese-Sync läuft normal, eine Log-Zeile sagt warum, und das Konten-Modal zeigt unter dem Schalter einen Hinweis. Die Sperre gilt vor jedem anderen Kriterium.
- Höchstens 50 Kopien je Lauf und Konto (`MAX_FOLLOW_COPIES_PER_RUN`), älteste zuerst; ein COPY-Fehler hält den Lauf nicht an, er zählt als Fehler. Die `UIDVALIDITY` wird zwischen Lesen und Schreiben verglichen, weil sich die UIDs sonst auf andere Mails beziehen könnten.
- Gebaut und getestet nur gegen den Fake-IMAP und Unit-Mocks. Der erste Lauf am echten Postfach geschieht mit Johannes (Handover, Vorher-nachher-Zählung des Ordners).

**Folgen für Nutzer.** Die Mails liegen auf dem Server doppelt (Kontingent). Eine Kopie behält die Flags des Originals: Eine ungelesene Mail ist im Allowlist-Ordner ebenfalls ungelesen, und alles, was diesen Ordner sonst beobachtet (ein anderes Werkzeug, eine Mailregel), sieht die Kopien als neue Post. Das ist der Grund, warum der Schalter aus ist und die Einstellung es im Text sagt. Wer eine Kopie aus dem Ordner verschiebt, löst die Notiz ab wie gewohnt.
