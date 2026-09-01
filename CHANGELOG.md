# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### M3b — Vault-Kommandos (2026-09-01)
- Vier Kommandos auf einer Mail-Notiz, jedes mit Vorschau vor dem Schreiben:
  - `mail.rerender` — Nachrichtenabschnitt und abgeleitete Frontmatter-Felder aus der lokalen
    `.eml` neu bauen. Der einzige Weg zu `allowUpdate: true` außerhalb des Imports; `mail_source`
    und `mail_state` werden dabei aus der Notiz übernommen, nie neu bestimmt, und die `.eml` muss
    dieselbe `mail_id` tragen wie die Notiz (`eml-mismatch`, sonst überschriebe eine falsch
    benannte Datei die Notiz mit fremdem Inhalt)
- `mail.relink` — Message-IDs in `in_reply_to`/`references` zu Wikilinks, wo die Zielnotiz
    existiert; nur vorwärts, ein bestehender Wikilink wird nie zurückverwandelt. Ändert
    ausschließlich Frontmatter-Zeilen in-place (`mergeFrontmatterOnly`), Kommentare und
    Block-Skalare bleiben byte-identisch
- `mail.extractAttachment` — eine Anlage aus der `.eml` in den Anhangordner, Link in den
    freien Bereich der Notiz (nicht in die verwaltete Zone, dort überlebte er kein Re-Render)
- `mail.replyExternal` — `mailto:` mit `Re:`-Betreff und `In-Reply-To`; eine Ersatz-ID
    (`noid-…`) wird weggelassen statt erfunden
- Deskriptor-Rahmen (`core/commands/`): Mini-JSON-Schema mit Validator, Registry mit
  idempotenter Default-Befüllung, `executeCommandPlan` als einziger Schreibweg, geteilter
  Busy-Guard mit dem Sync. `CommandProbe`/`CommandContext` getrennt, damit `checkCallback`
  synchron bleibt; optionales `schemaFor(ctx)` macht die Anhangliste zum Dropdown
- Schutz gegen verlorene Schreibvorgänge: der Plan merkt sich den Stand, aus dem er gebaut
  wurde (`NotePlan.expectedContent`); ändert sich die Notiz, während die Vorschau offen steht,
  wird übersprungen statt überschrieben — mit einer Meldung, die den Ausweg nennt
- Fehlertexte für alle Kommando-Codes in EN und DE, abgesichert durch einen Paritätstest über
  den echten Kommando-Satz mit compilerdurchgesetzter Vollständigkeit über `CommandErrorCode`

### Behoben
- **Zwei Anhänge mit gleichem Dateinamen teilten sich einen Schlüssel** im Byte-Speicher des
  MIME-Parsers (`contentId ?? name`): die extrahierte Datei hätte den Namen des einen und den
  Inhalt des anderen getragen, und der erste wäre unerreichbar gewesen. Jede Anlage hat jetzt
  einen eindeutigen Schlüssel. Der Defekt lag seit M1 im Parser und war harmlos, bis M3b sein
  erster Konsument wurde
- Ein leeres Pflichtfeld kam durch die Schema-Validierung (`required` prüfte nur auf
  `undefined`)
- Ein Wurf zwischen Kommandopalette und Lesezugriff (gelöschte Notiz) wurde zur unbehandelten
  Rejection — das Kommando tat sichtbar nichts; jetzt eine übersetzte Meldung
- `unregister()` der calendar-notes-Brücke ruft die Instanz, die die Registrierung angenommen
  hat, und fängt einen Wurf des Nachbarn ab, statt ihn aus `onunload()` entkommen zu lassen
- Mehrzeiliges SMTP-Greeting (`220-`) ist jetzt getestet (Carry-over aus der M1-Nachlese)

### M3 — IMAP-Sync (2026-08-30)
- IMAP-Client (`core/imap/client.ts`): Zustandsautomat CAPABILITY -> AUTHENTICATE PLAIN
  (Fallback LOGIN) -> EXAMINE (read-only) -> UID SEARCH ALL -> UID FETCH -> LOGOUT, nur
  lesende Kommandos (`BODY.PEEK` statt `BODY`), jeder Netzwerkschritt unter `withTimeout`
- Message-ID-Abgleich statt ENVELOPE (`BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]`), bewusste
  Abweichung von der Spec (Begründung siehe Task-Brief), UID→Message-ID-Cache pro
  `<konto>/<ordner>/<UIDVALIDITY>` (`core/sync/uid-cache.ts`)
- `planSync` (`core/mirror/apply.ts`): `create`/`reattach`/`detach` aus Server- gegen
  Vault-Stand, `SyncService` (`core/sync/service.ts`) fährt einen Lauf pro Konto über
  Busy-Guard, Emitter (`synced`/`changed`) und `PlanExecutor`
- Verdrahtung ins Plugin: Kommando, Ribbon, Intervall-Trigger und Statusleiste; Passwort-
  fehlt-Hinweis in der Konten-Zeile, Debug-Schalter für den IMAP-Dialog
- Fake-IMAP-Server + Integrationstest (`scripts/fake-imap.mjs`,
  `tests/integration/fake-imap.test.ts`) gegen den echten Node-Socket-Transport — spricht nur
  das vom Client benutzte Kommando-Subset, kein TLS, ausschließlich `127.0.0.1`
- `IDLE` bleibt V1.1, nicht Teil dieses Meilensteins
- **Live-Probe gegen ein echtes Postfach steht noch aus** — Sync ist gegen den Fake-IMAP-
  Server über einen echten Socket getestet (Kindprozess, echtes TCP), aber noch nicht gegen
  einen echten mailbox.org-Server gefahren; folgt separat

### M2 — Transport (2026-08-23)
- SMTP-Client (`core/smtp/client.ts`): EHLO/AUTH/MAIL/RCPT/DATA, `smtpProbe` für den Verbindungstest
- `tls-transport.ts`: echter Node-TCP/TLS-Socket hinter `Platform.isDesktop`, STARTTLS-Upgrade mit
  aktiver Zertifikatsprüfung, Connect-Timeout, `close()` mit Fallback auf `destroy()`, Schutz vor
  STARTTLS-Buffer-Injection (CVE-2011-0411-Klasse)
- `SendService` + iMIP-Anbindung (`core/send/service.ts`, `core/send/imip.ts`): Konto-/Identitäts-
  Auflösung, MIME-Bau, Versand über den Socket-Transport, `tls-required`-Guard vor jedem Connect
- Konten-UI (`AccountModal`, deklarativer Settings-Tab): IMAP/SMTP/Identitäten/Ordner/Sync, Secrets
  über `SecretComponent` (nie in `data.json`), Verbindungstest
- calendar-notes-Brücke (`calendar-notes-bridge.ts`): registriert mailstone als `MailTransport` an
  der öffentlichen API des Nachbar-Plugins, robust gegen Ablehnung/Exceptions/Nachbar-Reload
- Fake-SMTP-Server + Integrationstest (`tests/integration`) gegen den echten Transport
- Sicherheits-Härtungen: STARTTLS-Buffer-Injection-Schutz, Connect-Timeout, symmetrischer
  `tls-required`-Guard vor jedem Verbindungsversuch (Service UND Konto-Test), strengere
  `repairAccount`-Validierung (tls/port)

### M1 — Gerüst + Formate (2026-08-23)
- Repo-Gerüst aus calendar-notes (Gate, Vendor-Kit, esbuild-Builtin-Plugin, Lint 0 Warnings, check:pure)
- `.eml` → `ParsedMail` (postal-mime), synthetischer Fixture-Korpus
- Rendering Mail → Markdown/Frontmatter/Dateiname (turndown, Mapping-Profil)
- Merge-Regeln für Re-Render: Fences, Zone-Hash, abgeleitete Keys zeilenweise in-place, melden statt überschreiben
- MIME-Builder für Versand (QP, RFC 2047, multipart/alternative + text/calendar), Header-Injection-Härtung
- Settings (Konten/Identitäten/Profil), NotePlan + Vault-Executor, Kommando „Import .eml files from a vault folder", deklarativer Settings-Tab, i18n EN/DE
- minAppVersion 1.13.0
