# Vorarbeit: Muster aus dem früheren IMAP-Connector-Entwurf

**Datum:** 2026-08-23 · **Quelle:** ein älterer Spezifikations-Entwurf für ein reines IMAP-Lese-Plugin (Analyse-Session 2026-08-21, anderer Kontext, nie implementiert). Der Entwurf selbst liegt nicht in diesem Repo; hier stehen nur die **Muster und Entscheidungen**, die mailstone übernimmt oder bewusst anders trifft. Keine Werte aus dem Ursprungskontext.

## Übernommen

| # | Muster | Begründung (aus dem Entwurf) |
|---|---|---|
| E2 | **Ein IMAP-Ordner auf dem Server ist die Allowlist.** Was dort liegt, wird Vault-Notiz. Die Geste ist „Mail dorthin verschieben" — von jedem Client aus, auch per Sieve. | Der Zustand „gehört in den Vault" existiert genau einmal, auf dem Server. Ein Obsidian-Befehl, der in den Vault schreibt, wäre eine zweite Wahrheit. Die Geste sitzt dort, wo man die Mail ohnehin liest. |
| E3 | Mail-Notizen sind gewöhnliche `.md`. Keine eigene Dateiendung. | Obsidian indiziert nur `.md` im Metadata-Cache — eigene Endung hieße keine Bases, Backlinks, Suche, Embeds. |
| E4/E11 | **Zwei Artefakte:** `.md` = Integrationsfläche (Body als Markdown, `## Nachricht` als echte Überschrift für `![[…#Nachricht]]`), `.eml` byte-identisch daneben = Treuefläche + Regenerierungsquelle + Container für Inline-Bilder. | Ein Artefakt kann nicht zugleich maximal integriert und maximal originalgetreu sein. `cid:`-Bilder nie als Dateien extrahieren, nie als data-URI ins Markdown; Anzeige über eine read-only `.eml`-View. |
| E5 | **Read-only auf Protokollebene:** Sync öffnet mit `EXAMINE`, holt mit `BODY.PEEK[]` (setzt kein `\Seen`). | Eine Konvention ist keine Garantie. Prüfbar: nach dem Sync sind Mails in anderen Clients unverändert ungelesen. |
| E6 | **`Message-ID` ist die Identität**, nicht UID+Ordner. Index `Message-ID → Pfad` aus dem Metadata-Cache, abgeleitet und wegwerfbar. | UIDs sind pro Ordner und sterben beim Verschieben / `UIDVALIDITY`-Reset. Optional zusätzlich `OBJECTID`/`EMAILID`, falls der Server es anbietet. |
| E9 | **Fences + deklarierte Schlüsselliste.** Generierte Zone zwischen `%% …:begin %%`/`%% …:end %%`; im Frontmatter überschreibt das Plugin nur eine feste Liste abgeleiteter Keys. Alles andere gehört dem Nutzer. | Sonst ist die Notiz ein Betrachter statt ein Knoten. Gleiches Muster wie calendar-notes' verwalteter Body-Block + `fields`-Mapping. |
| — | **Merge-Regeln:** nur Zone zwischen Fences ersetzen; unbekannte Keys byte-identisch erhalten; Frontmatter nach Schlüssel parsen, nie nach Position (Linter sortiert um); fehlende Fences oder abweichender Hash → **melden, nicht überschreiben**; Re-Render nie automatisch, Sync legt nur Neues an. | Ein Plugin, das ungefragt in vorhandene Notizen schreibt, zerstört das Vertrauen in den Vault. |
| — | **Verwaiste Notizen** (Mail nicht mehr im Allowlist-Ordner) → `entkoppelt: true`, **nie löschen**. | Zero-Broken-Links; die `.eml` bleibt die Quelle. |
| E10 | **Kein Vollsync.** Nur der Allowlist-Ordner wird zu Notizen. | Technisch (Index-Last), rechtlich, konzeptionell (sonst Mailclient-Nachbau). |
| — | **Abhängigkeitsrichtung als Spezifikation:** MIME-Parsing und Rendering kennen weder IMAP noch Obsidian; dort sitzen die Bugs (Zeichensätze, QP, Multipart-Grenzen, TNEF), dort muss ohne Netz in ms getestet werden. | Deckt sich mit calendar-notes' `src/core/**`-Schnitt (`check-pure.mjs`). |
| — | **Dateiname:** `<YYYY-MM-DD>-<HHmm>-<betreff-slug>.md`, Slug 60 Zeichen, `re-/aw-/fwd-/wg-` entfernt, Kollisionen `-2`. Dateiname ist kein Identitätsmerkmal. | `Message-ID` taugt nicht für Dateinamen. |
| — | **Anhänge** bleiben in der `.eml`; Frontmatter führt Name/Typ/Größe; Extraktion nur auf Befehl pro Datei. `winmail.dat` erkennen, nicht auspacken. | Ein 20-MB-PDF gehört nicht ungefragt in den Vault. |
| — | **Threads:** `In-Reply-To`/`References` → Wikilink **nur wenn das Ziel existiert**, sonst String; Befehl „Threads neu verknüpfen". | Zero-Broken-Links. |
| — | **Reconnect mit Backoff ist Normalfall**, kein Fehler (Timeouts, VPN, Suspend). | |
| — | **Bibliotheken:** `postal-mime` (ESM, kein Node-Stack; nicht `mailparser`), `turndown` (Blockquotes als `>` erhalten, Trackingpixel/Layout-Tabellen raus, Signaturen behalten; bei `multipart/alternative` gewinnt `text/plain` nur wenn substanziell — Heuristik kalibrieren), IMAP-Client hinter eigenem schmalen Interface (`imapflow` nur mit Bundle-/Lizenz-Prüfung; Read-only-Subset notfalls selbst, schwierig ist der Response-Parser, nicht das Protokoll). | |
| — | **Fixture-Korpus, ausschließlich synthetisch:** Zeichensätze (UTF-8, ISO-8859-1 QP, Windows-1252 base64, RFC-2047 gemischt/gesplitteter Umlaut, Header-Folding, 8bit ohne charset), Struktur (alternative voll/leer/Stub-Plain, mixed mit Anhängen, related inline, nested, kaputte Boundary, no-body, TNEF), Threads/Identität (root/reply/branch, fehlende/doppelte Message-ID, Sonderzeichen-/leerer/300-Zeichen-Betreff), Zeitzonen (UTC/CEST/negativ/unparsbar). Snapshot-Tests fürs Rendering; Merge-Regeln jede einzeln getestet. | |
| — | **Keine echte Mail im Repo** — nicht als Fixture, Branch, Debug-Artefakt, Doku-Beispiel, Commit-Body, Screenshot. Fehler werden **nachgebaut**, nicht kopiert. Auch keine echten `Message-ID`s oder `Received`-Ketten (tragen Hostnamen und Zeitstempel). Passwort nie loggen, `LOGIN`-Zeile in Protokoll-Logs maskieren. | |
| — | **Phasenprinzip:** riskanteste Annahme zuerst — und die ist nicht technisch, sondern verhaltensbezogen: *wird die Verschiebe-Geste tatsächlich ausgeführt?* Renderer offline (aus `.eml`-Export) vor IMAP-Code. | |

## Bewusst anders in mailstone

| Entwurf | mailstone | Grund |
|---|---|---|
| Kein Senden, kein Verwalten, ein Konto | **Senden** (authentifizierter SMTP, iMIP-Transport für calendar-notes), **Verwalten per Kommando** (Verschieben/Archivieren; nie Löschen als Regel oder Massenaktion), **Mehrkonto** perspektivisch | Anderer Kontext: Store-Software, Transport-Vertrag mit calendar-notes, Betriebsvorgaben aus `2026-08-23-anforderungen-aus-mailbox-org-betrieb.md`. |
| Electron `safeStorage` + eigene Datei außerhalb des Vaults | `app.secretStorage` (Obsidian ≥ 1.11.4) + `SecretComponent` | Store-konform, identische Settings-UX mit calendar-notes. |
| Read-only absolut (`EXAMINE` überall) | `EXAMINE`/`PEEK` im **Sync-Pfad**; Kommandos öffnen bewusst mit `SELECT` | Trennung „Sync liest, nur Kommandos schreiben" — schärfer, nicht lockerer. |
| „Anheften"-Befehl verworfen | View + Kommando „in den Vault übernehmen" = **MOVE auf dem Server** in den Allowlist-Ordner | Der Befehl schreibt nicht in den Vault, er löst die Geste aus; E2 bleibt gewahrt. |
| Ablage `30_Mails/<Jahr>/` + `_eml/` | offen — Vault-seitige Konvention, Schema-Typ `mail` anlegen bevor die erste Notiz entsteht | Ein Plugin, das sich sein Frontmatter selbst ausdenkt, ist Silent Drift. |

## Offene Punkte, die der Entwurf schon kannte

- Uhrzeit im Frontmatter vs. Vault-Konvention `YYYY-MM-DD` → typ-spezifisches Feld `zeitpunkt` (ISO-8601) neben `datum`.
- Linter sortiert Frontmatter und setzt `created`/`updated` → eigenes Feld `sync_stand`; Mail-Ordner aus dem Linter ausnehmen.
- Dürfen `.eml` ins Vault-Git? Entwurf: nein (Kopie, nicht Original; Datenschutz).
- Reihenfolge `## Notizen` vor `## Nachricht` — erst im Gebrauch prüfen.
- Post-Login-`CAPABILITY` prüfen: `OBJECTID`, `CONDSTORE`/`QRESYNC`, `SORT`/`THREAD`/`ESEARCH`.
