# mailstone — Design-Spec

**Datum:** 2026-08-23 · **Status:** vom Maintainer im Brainstorming abgenommen (Abschnitte 1–2 explizit, 3–4 autonom nach Richtungsfreigabe) · **Pfad:** architektonisch (neues Plugin)
**Grundlagen:** `docs/2026-08-22-anforderungen-aus-calendar-notes.md` (Transport-Vertrag v1), `docs/2026-08-23-anforderungen-aus-mailbox-org-betrieb.md` (Betriebsvorgaben des Zielpostfachs), `docs/2026-08-23-vorarbeit-imap-connector-muster.md` (übernommene Muster eines älteren Lese-Plugin-Entwurfs), `calendar-notes` als Schablone (`docs/superpowers/specs/2026-08-22-calendar-notes-design.md` dort).

---

## 0. Problem, Wert, Zuschnitt

**Problem.** E-Mail ist für den Nutzer eine tägliche Handlungsquelle, lebt aber außerhalb des Vaults. Der Zielbetrieb (Betriebsdoc § 5) hat den Posteingang serverseitig bereits zur *Liste offener Entscheidungen* gefiltert — strukturgleich mit einer Aufgabenliste. Ein Plugin, das diese Liste in Obsidian zeigt und einzelne Mails zu vollwertigen Vault-Knoten macht (Backlinks, Bases, Embeds), setzt die serverseitige Arbeit fort statt sie zu duplizieren. Zweitens wartet `calendar-notes` auf einen registrierten Mail-Transport für iMIP-Einladungen (Vertrag v1 liegt als Code vor).

**Drei Säulen — und was V1 davon ist.**

| Säule | V1 | Später |
|---|---|---|
| **A — Posteingang als Handlungsliste** | Allowlist-Sync (Server-Ordner → Notiz + `.eml`), Live-View des Posteingangs, Kommandos Übernehmen/Archivieren/Re-Render/Threads/Anhang, Mail → TaskNotes-Aufgabe (optional, defensiv) | IMAP `SEARCH` in der View, `IDLE`, Absender → Kontakt-Notiz via `calendar-notes` |
| **B — Versand** | **B-klein:** SMTP-Versand *nur* als Transport für `calendar-notes` (iMIP) + „extern antworten" (`mailto:`); Datenmodell für B-mittel vorbereitet (`OutgoingMessage`, Identitäten) | **B-mittel:** Antworten aus Notiz/View mit Identitäts-Auswahl, `APPEND` in Gesendet |
| **C — Sieve-Spiegel** | Nicht-Ziel | ManageSieve lesen/versionieren/Schreiben per Kommando — erst wenn Regelwerk (③) und Login (④) existieren |

**Bauart (Store-Recherche, REGISTRY):** IMAP/SMTP sind kein HTTP → `node:tls` → **desktop-only**. Netzwerk + Credentials kosten im Store-Review nichts, `child_process` kostet immer → kein lokaler MTA, kein `sendmail`/`msmtp`. Versand ausschließlich über den authentifizierten SMTP des Anbieters (DMARC `p=quarantine`, später `reject`).

**Nicht-Ziele V1** (aus Betriebsdoc § 3/§ 10 und Vorarbeit): keine clientseitige Regel-Engine neben Sieve, kein automatisches Verschieben beim Abruf, kein Vollsync, **kein Löschen** durch Regel oder Massenaktion (G6), keine zweite Kontaktverwaltung, keine Kalenderfunktionen (auch kein `.ics`-Viewer), kein Mailclient-Nachbau (Verfassen mit Anhängen/HTML), kein OAuth, kein Autoconfig-Discovery, keine Migrations-/Aufräum-Automatik über den Bestand, kein Mobile.

**Zuständigkeiten:** Aufgaben → TaskNotes (Konsument seiner JS-API), Kontakte/Termine → `calendar-notes` (Lese-API), Retrieval → `vault-rag` (nicht berührt). mailstone besitzt: Postfach-Zugriff, Mail-Notiz, Versand-Transport.

**Öffentlichkeitsgrenze:** Das Repo ist öffentlich (Store). Doku und Fixtures tragen Muster statt Werte — keine realen Adressen, Domains, Hostnamen (außer Anbieter-Endpunkten als Default-Beispiel), keine echten `Message-ID`s oder `Received`-Ketten. `*.eml` ist in `.gitignore` global dicht; die einzige Ausnahme ist `tests/fixtures/**/*.eml` und enthält ausschließlich synthetische Mails.

---

## 1. Architektur

### 1.1 Schnitt

```
src/core/            obsidian-/node-/DOM-frei — erzwungen durch scripts/check-pure.mjs (aus calendar-notes)
  imap/              commands.ts (Builder), parser.ts (Response-Parser: Literale, Klammerlisten, Atome),
                     client.ts (Zustandsautomat über Transport-Interface), types.ts
  smtp/              client.ts (EHLO/STARTTLS-Entscheid/AUTH PLAIN/MAIL/RCPT/DATA), dotstuff.ts
  mime/              parse.ts (postal-mime → Mail), build.ts (OutgoingMessage → RFC-5322-Bytes),
                     headers.ts (RFC 2047 encode/decode-Hilfen, Message-ID-Normalisierung)
  render/            body.ts (Mail → Markdown, turndown-Regeln), frontmatter.ts, filename.ts (Slug)
  mirror/            profile.ts (Feld-Mapping), plan.ts (NotePlan), apply.ts (Server×Vault → NotePlan[])
  merge/             fences.ts, derived-keys.ts, hash.ts, merge.ts (Regeln + Konfliktcodes)
  commands/          types.ts, registry.ts, schema.ts (aus calendar-notes kopiert), mail-commands.ts
  send/              outgoing.ts (OutgoingMessage, Validierung gegen Identitäten), imip.ts (ImipMessage → OutgoingMessage)
  api/               calendar-notes-transport.ts (Typen kopiert, Herkunftsstempel), tasknotes-api.ts (Typen kopiert)
  sync/              service.ts, busy.ts, events.ts (aus calendar-notes kopiert), execute.ts, errors.ts
  settings.ts        Typen, Defaults, Migration
src/obsidian/        tls-transport.ts, vault-notes.ts (PlanExecutor), secrets.ts, settings-tab.ts, modals/,
                     view/ (ItemView), command-flow.ts, command-i18n.ts, execute-i18n.ts,
                     calendar-notes-bridge.ts, tasknotes-bridge.ts, plugin-host.ts (DI-Fabrik), notifier.ts
src/i18n/strings.ts  EN kanonisch + DE
src/vendor/          kit, kit-obsidian, code-kit (VENDOR.json, tools/sync-kit.sh) — aus calendar-notes
src/main.ts          nur Verdrahtung + addCommand
```

**Regeln:** `src/core/**` importiert weder `obsidian` noch Node noch DOM-Globals; Bibliotheken in `core` sind nur `postal-mime` (pures ESM, nutzt `TextDecoder`) und `turndown`. `turndown` greift zur Laufzeit auf `document` zu (im Renderer vorhanden); für Vitest (`environment: "node"`) wird `@mixmark-io/domino` gebraucht, im esbuild-Bundle wird `@mixmark-io/domino` auf einen leeren Stub gealiast (Renderer hat `document`). `check-pure` scannt nur eigene Quellen — die Library-interne `document`-Nutzung ist erlaubt; ein eigener `render/`-Aufruf reicht turndown kein `document` durch.

**Node-Builtins:** `Platform.isDesktop`-guarded `await import("node:tls")` (einzige Form, die beide Store-Scan-Regeln besteht) in `src/obsidian/tls-transport.ts`, plus esbuild-Plugin `node-builtin-require` (Vorlage `vault-rag/esbuild.config.mjs`, Herkunftsstempel; mailstone ist n=3 → Kit-Kandidat im nächsten drift-audit) und ein Bundle-Guard-Test (`tests/bundle.test.ts`: `main.js` enthält kein `import("node:`). Die Transport-Schnittstelle liegt in `core`:

```ts
interface SocketTransport {
  connect(opts: { host: string; port: number; tls: "implicit" | "starttls" | "none"; timeoutMs: number }): Promise<void>;
  upgradeTls(): Promise<void>;           // STARTTLS
  write(data: Uint8Array | string): Promise<void>;
  readLine(): Promise<string>;           // CRLF-terminiert, ohne CRLF
  readBytes(n: number): Promise<Uint8Array>;   // IMAP-Literale
  close(): Promise<void>;
  readonly closed: boolean;
}
```
Tests stellen `FakeSocketTransport` mit aufgezeichneten Server-Dialogen bereit (zeilenbasiertes Gegenstück zu calendar-notes' `fakeTransport(routes)`).

**Manifest:** `id: "mailstone"`, `name: "Mailstone"`, `isDesktopOnly: true`, `minAppVersion: "1.13.0"` — ursprünglich 1.11.4 (`app.secretStorage`), angehoben in M1 (2026-08-23), weil der Settings-Tab die **deklarative** `getSettingDefinitions()`-API nutzt (Store-Scanner-Regel `settings-tab/prefer-setting-definitions` ohne Override; calendar-notes fährt dieselbe Untergrenze). `authorUrl: https://github.com/johannes-kaindl`.

### 1.2 Kit-first-Übernahmen (Fundus, nicht Inspiration)

Aus `calendar-notes` byte-identisch oder mit Herkunftsstempel kopiert: `scripts/check-pure.mjs`, `core/commands/{types,registry,schema}.ts`, `core/sync/{busy,events}.ts`, `obsidian/secrets.ts` (`obsidianSecretStore`, `MemorySecretStore`), Settings-Tab-Kontenblock mit `SecretComponent`, `command-flow.ts`/`command-i18n.ts`/`execute-i18n.ts`, `SchemaFormModal`/`PlanPreviewModal`, `vendor/` + `tools/sync-kit.sh`, `tests/__mocks__/obsidian.ts` + `tests/setup.ts`, `vitest.config.ts`, `esbuild.config.mjs`-Gerüst, `package.json`-Scripts inkl. `gate`, Release-Delegation `node ../tools/release/release.mjs`, `eslint.config.mjs` (Template-Vendoring) + `eslint.overrides.mjs` + `scripts/check-no-inline-disables.mjs`. Aus `vault-rag`: esbuild-Plugin `node-builtin-require`. Aus dem Kit (vendored): i18n-Engine, `withTimeout`, `mergeSettings`.

---

## 2. Datenmodell

### 2.1 Konten, Identitäten, Secrets

```ts
interface Account {
  id: string; label: string;
  imap: { host: string; port: number; tls: "implicit" | "starttls" };   // Default 993/implicit
  smtp: { host: string; port: number; tls: "implicit" | "starttls" };   // Default 465/implicit
  username: string;
  secretId: string;                      // "mailstone-<account-id>" → app.secretStorage
  identities: Identity[];                // nur manuell gepflegt — der Server liefert keine sendefähige Liste
  defaultIdentityId: string;
  folders: { inbox: string; allowlist: string; archive: string; sent?: string };  // Defaults INBOX / Vault / Archive — entsprechen der ③-Ordnerstruktur des Zielpostfachs (Nachtrag im Betriebsdoc); vom Nutzer änderbar
  sync: { enabled: boolean; intervalMin: number };                       // Default true / 5
}
interface Identity { id: string; address: string; name: string; }
```
- Ein Konto = ein Secret (App-Passwort); IMAP und SMTP nutzen es gemeinsam, ohne daran zu *binden* (getrennte `username`-Override-Felder sind V1.1, falls je nötig).
- Fehlt das Secret → Konto pausiert mit `skippedReason: "no-secret"`, kein Fehler-Spam (calendar-notes-Muster).
- Settings-UI: Hilfetext am Passwortfeld *„App-Passwort des Anbieters, nicht das Kontopasswort (2FA)"*; Identitäten als Liste mit Default-Markierung; Hinweis, dass Catch-All-/Alias-Kennungen ohne Sendeberechtigung hier nicht hingehören. „Verbindung prüfen"-Button (IMAP `CAPABILITY`+`LOGIN`+`LOGOUT`, SMTP `EHLO`+`AUTH`+`QUIT`, Ergebnis als Codes).
- Mehrkonto im Modell und in der UI ab V1 (Settings-Muster fertig); der Allowlist-Sync läuft pro Konto.

### 2.2 Die Mail-Notiz

Zwei Artefakte pro Mail: `<name>.md` (Integrationsfläche) und `<name>.eml` (Treuefläche, byte-identisch, Regenerierungsquelle, Container für Inline-Bilder).

**Ablage:** Setting `notesFolder` (Default `Mail`), Unterordner nach Jahr (`Mail/2026/`), `.eml` in `Mail/2026/_eml/`. Dateiname-Template `{date}-{time}-{slug}` (Slug: lowercase, transliteriert, ≤ 60 Zeichen, `re-/aw-/fwd-/wg-` entfernt, Kollision `-2`). Der Dateiname ist kein Identitätsmerkmal.

**Identität:** normalisierte `Message-ID` (ohne `<>`, getrimmt). Fehlt sie: `sha256(Date+From+Subject)[:32]` mit Präfix `noid-`. Index `mail_id → TFile` ausschließlich aus dem Metadata-Cache, abgeleitet, nie persistiert.

**Frontmatter über Mapping-Profil** (`mirror/profile.ts`, calendar-notes-Muster): Identitätsfelder fest, alle anderen über `fields: Record<serverField, fmKey | null>` abbildbar, `onCreate` für einmalige Keys.

```yaml
mail_id: "CAF7x9abc123@mail.example.org"       # fest
mail_source: "privat/Vault"                   # <konto-id>/<allowlist-ordner>, fest
mail_state: live                              # live | detached (nicht mehr im Allowlist-Ordner); nie gelöscht
mail_synced: "2026-08-23T15:00:00+02:00"
# gemappt (Default-Profil):
type: mail                                    # onCreate
title: "Termin geändert: Quartalsreview"
date: 2026-08-23                              # YYYY-MM-DD (Vault-Konvention)
time: "14:32"                                 # getrennt, damit `date` konventionskonform bleibt
from: "Erika Beispiel <erika@example.org>"
to: ["mail@example.net"]
cc: []
subject: "Termin geändert: Quartalsreview"
in_reply_to: "[[2026-08-20-0915-quartalsreview]]"   # Wikilink nur wenn Ziel existiert, sonst String
references: []
attachments: ["einladung.ics (text/calendar, 2.8 KB)"]     # Strings, nicht Objekte — der leichte Frontmatter-Serialisierer (Kit yaml_lite) kennt keine Objektlisten; `mail.extractAttachment` liest Anhänge aus der .eml, nie aus diesem Feld
```
Abgeleitete Schlüssel = genau die Profil-Keys + `mail_*`; alles andere gehört dem Nutzer (auch leer, auch unbekannt). `created`/`updated` setzt das Plugin nie.

**Body:**
```markdown
## Notizen
(frei — wird nie angefasst)

%% mailstone:begin %%
## Nachricht
…Markdown aus text/plain oder turndown(text/html)…
%% mailstone:end %%
```
`## Nachricht` ist echte Überschrift (`![[…#Nachricht]]`). `cid:`-Bilder → Platzhalter `(Inline-Bild: name)`, nie data-URI, nie extrahiert. Zitatebenen bleiben `>`. Bei `multipart/alternative` gewinnt `text/plain`, wenn nicht leer und ≥ 10 % der HTML-Textlänge (kalibrierbar). Zone-Hash (sha256 der Zone) im Plugin-Zustand (`data.json`, Map `mail_id → hash`), nicht im Frontmatter.

**Merge-Regeln** (Prioritätsreihenfolge; Verletzung → `{ok:false, code}` und **kein Schreibvorgang**):
1. Nur die Zone zwischen den Fences wird ersetzt; Außenbereich byte-identisch. Fence-Marker, die im Mailtext selbst vorkommen, werden beim Rendern neutralisiert; der Ende-Marker wird vom Ende her gesucht.
2. Frontmatter: nur abgeleitete Keys, und zwar **zeilenweise in-place** im rohen Frontmatter-Text (kein Re-Serialisieren des Ganzen) — unbekannte Keys, Kommentare, verschachtelte Maps und Block-Scalars bleibt byte-identisch; Parsing nach Schlüssel, nie nach Position. Ein abgeleiteter Key, der als mehrzeiliger Block-Scalar vorliegt → `frontmatter-unparseable`.
3. Fehlende Fences → `fences-missing`. 4. Hash ≠ gespeichert → `zone-edited`. 5. Re-Render nie automatisch; Sync legt nur Neues an und setzt `mail_state` (`PlanInput.allowUpdate=false`); nur das Import-/Re-Render-Kommando darf bestehende Notizen aktualisieren. `mail_synced` ist ein **volatiler** Key: ändert sich sonst nichts, wird er nicht neu gestempelt (Idempotenz).

**Verwaiste Notizen** (`mail_id` nicht mehr im Allowlist-Ordner) → `mail_state: detached`; nie löschen. **Anhänge** bleiben in der `.eml`; Frontmatter führt Name/Typ/Größe; Extraktion nur per Kommando, eine Datei, in den Obsidian-Anhangordner. `winmail.dat` wird erkannt und geführt, nicht ausgepackt.

---

## 3. Sync, Kommandos, Versand

### 3.1 Allowlist-Sync (`core/sync/service.ts` + `core/mirror`)

Pro Konto, pro Lauf eine Verbindung:
1. `connect` → Greeting → `CAPABILITY` (merken: `MOVE`, `UIDPLUS`, `CONDSTORE`, `OBJECTID`, `IDLE`, `AUTH=PLAIN`) → `AUTHENTICATE PLAIN` (Fallback `LOGIN`).
2. `EXAMINE <allowlist>` (read-only) → `UID SEARCH ALL` → für UIDs ohne bekannte Message-ID: `UID FETCH BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]` → Header durch `normalizeMessageId` → Abgleich gegen Index. ⚠️ **Geändert in M3 (2026-08-30), ursprünglich stand hier `UID FETCH (ENVELOPE BODYSTRUCTURE)`.** Zwei Gründe: `ENVELOPE` verlangt einen vollständigen Parser für verschachtelte Adresslisten, dessen einziger Ertrag hier ein einzelner Header wäre, und `BODYSTRUCTURE` wird gar nicht gebraucht (der Anlagen-Bestand kommt ohnehin aus der geparsten `.eml`). Der wichtigere Grund kam aus dem Abschluss-Review: `ENVELOPE` liefert die Message-ID in der **Interpretation des Servers**, während `normalizeMessageId` denselben Rohstring normalisiert, aus dem später beim Parsen des Bodys die `mail.id` entsteht. Der Abgleich Cache ↔ Notiz ↔ Mail läuft so über **eine** Normalisierung statt über zwei Quellen, die auseinanderlaufen können — in einem Modul, dessen teuerster Fehler ein falscher ID-Abgleich ist. Beide Kommandos sind `PEEK`-sicher.
   *UID→Message-ID-Cache* in `data.json` pro `<konto>/<ordner>/<UIDVALIDITY>`, damit nicht jeder Lauf alle Envelopes holt; bei `UIDVALIDITY`-Wechsel verworfen.
3. Neu: `UID FETCH BODY.PEEK[]` → Bytes → `mime/parse` → `render` → `NotePlan create` (`.md` + `.eml`).
4. Bekannt, aber `mail_state: detached` und wieder im Ordner → `NotePlan reattach`. Bekannt `live`, aber nicht mehr im Ordner → `NotePlan detach`.
5. `LOGOUT`. Pläne ausführen nur über `vaultPlanExecutor` (`vault.create`, `vault.createBinary`, `fileManager.processFrontMatter`); existierende Notiz → Merge-Regeln.

Trigger: Intervall (`intervalMin`, Default 5) + Kommando/Ribbon „Synchronisieren". `IDLE` ist V1.1. Busy-Guard (`tryAcquire/release`) teilt sich Sync und Kommando-Ausführung; Emitter `synced`/`changed` für View und Statusleiste. Fehler sind Werte (`SyncErrorCode`: `connect`, `tls`, `auth`, `no-secret`, `folder-missing`, `protocol`, `timeout`), übersetzt erst in `src/obsidian/execute-i18n.ts`. Jeder Netz-Schritt unter `withTimeout` (Kit).

### 3.2 Kommandos (`core/commands/mail-commands.ts`)

Deskriptoren `{id, kind, title/titleKey, description/descriptionKey, schema, appliesTo(ctx), plan(input, ctx)}`; Ausführung `executeCommandPlan(plan)` mit Busy-Guard; UI-Kette `SchemaFormModal → PlanPreviewModal → execute` (calendar-notes). ⚠️ **Ergänzt in M3b (2026-08-31):** `CommandDescriptor` trägt zusätzlich ein optionales `schemaFor(ctx)` — eine Abweichung von der calendar-notes-Vorlage, die nur das statische `schema` kennt. Gebraucht wird es für `mail.extractAttachment`: die Anhangliste existiert erst, nachdem die `.eml` geparst wurde, ist beim Erstellen eines festen `schema` also noch nicht bekannt; `schemaFor(ctx)` liefert sie kontextabhängig als `enum` nach — und genau das macht aus dem Formularfeld ein Dropdown statt eines Freitextfelds. Ohne `schemaFor` gilt weiterhin `schema` (`schemaOf()` in `core/commands/types.ts` wählt zwischen beiden).

| Kommando | Ziel | Server | Vault |
|---|---|---|---|
| `mail.adopt` „In den Vault übernehmen" | Mail in View (`kind: "message"`) | `SELECT <inbox>` · `UID MOVE → allowlist` (Fallback `UID COPY` + `UID STORE +FLAGS \Deleted` + `UID EXPUNGE`) | keiner; anschließend Sync anstoßen |
| `mail.archive` | Mail in View oder Mail-Notiz (`kind: "message" \| "note"`) | `UID MOVE → archive` | Notiz wird beim nächsten Sync `detached` |
| `mail.rerender` | Mail-Notiz | — | Zone + abgeleitete Keys aus lokaler `.eml` neu (Merge-Regeln) |
| `mail.relink` „Threads neu verknüpfen" | alle Mail-Notizen | — | `in_reply_to`/`references` → Wikilinks wo Ziel existiert |
| `mail.extractAttachment` | Mail-Notiz + Auswahl | — | eine Datei in den Anhangordner, Link in die Notiz |
| `mail.replyExternal` | Notiz/View | — | `mailto:` mit `subject=Re: …`, `In-Reply-To` (B-klein) |
| `mail.createTask` | Notiz/View, nur wenn TaskNotes-API erreichbar | — | TaskNotes legt die Aufgabe an (§ 4.2) |

Kein `mail.delete`, keine Massenaktion mit Vorauswahl. Kommandos öffnen mit `SELECT`; Sync nur mit `EXAMINE`. Server-Kommandos laufen über eine kurze eigene Verbindung (connect → Aktion → logout), nicht über die Sync-Verbindung. Ein MOVE, dessen Quell-UID nicht mehr existiert (Mail wurde anderswo verschoben) → `{ok:false, code:"gone"}` mit Hinweis „erneut synchronisieren".

⚠️ **Nachgetragen (2026-08-31):** `mail.replyExternal` stand in der Tabelle oben von Anfang an als Vault-Kommando, war aber nie einem Meilenstein zugeordnet — § 6 führt es unter M4. Tatsächlich gebaut wurde es in M3b, zusammen mit `mail.rerender`, `mail.relink` und `mail.extractAttachment` auf demselben Deskriptor-Rahmen. `mail.createTask` bleibt wie geplant M5.

### 3.3 Versand (`core/send`, `core/smtp`, `core/mime/build.ts`)

```ts
interface OutgoingMessage {
  from: string;                 // Identity-ID; unbekannt → {ok:false, code:"unknown-identity"}; nie Fallback auf eine To-Adresse
  to: string[]; cc?: string[]; bcc?: string[];
  subject: string; text: string; html?: string;
  calendar?: { method: "REQUEST" | "CANCEL" | "REPLY"; ics: string };
  attachments?: { name: string; type: string; data: Uint8Array }[];   // V1 ungenutzt (B-mittel)
  inReplyTo?: string; references?: string[];
}
send(accountId, msg): Promise<{ ok: true; messageId: string } | { ok: false; code: SendErrorCode }>
```
- `ImipMessage` (Vertrag) → `OutgoingMessage` 1:1 (`from` = Account-ID aus `accounts()` ↔ Identity-ID; `text`; `calendar`).
- MIME-Builder: `multipart/alternative` mit `text/plain; charset=utf-8` und — falls `calendar` — `text/calendar; method=<M>; charset=utf-8` (+ optional `invite.ics` als Anhang); RFC-2047-kodierte Header, `Message-ID: <uuid@host-der-identity>`, `Date`, `MIME-Version`, `In-Reply-To`/`References`; 7-bit-sichere Kodierung (`quoted-printable` bzw. `base64`).
- SMTP: nur der konfigurierte Anbieter-SMTP; 465 implizit TLS oder 587 `STARTTLS` (Klartext-Auth ohne TLS wird verweigert: `code:"tls-required"`); `AUTH PLAIN`; Dot-Stuffing; `RCPT`-Ablehnungen einzeln als Codes.
- Nach Erfolg `APPEND` in `folders.sent` (Fehler dabei nicht fatal: `ok:true` + Notice). ⚠️ **Präzisiert 2026-08-30:** ursprünglich „falls gesetzt" — gemeint war Opt-in, gebaut ist jetzt **Opt-out**. `folders.sent` trägt den Default `"Sent"` (auch für bestehende Konten, über die Settings-Reparatur); ein leerer Wert schaltet die Kopie ab. Anlass ist die M3-Live-Probe: nach zwei zugestellten Testmails war der `Sent`-Ordner leer, und ein Nutzer, der seine gesendete Mail im Webmail sucht, findet sie dann nirgends. Ein Vorgang, dessen Fehlen man erst merkt, wenn man ihn braucht, gehört nicht hinter einen Schalter, den niemand kennt.

### 3.4 Brücke zu `calendar-notes` (`src/obsidian/calendar-notes-bridge.ts`)

In `onload` nach dem Aufbau des Transports und erneut bei `layout-ready` sowie beim Aktivieren anderer Plugins: `app.plugins.plugins["calendar-notes"]?.api` **frisch lesen**, `version === 1` und `typeof registerMailTransport === "function"` prüfen, dann `registerMailTransport({ id: "mailstone", label, accounts, send })`; `onunload` → `unregisterMailTransport("mailstone")`. `accounts()` liefert alle Identitäten aller Konten als `{ id: "<konto>/<identity>", address, label }`; `send()` routet über die Konto-ID. Fehlt `calendar-notes`: stiller No-Op. Typen kopiert (`core/api/calendar-notes-transport.ts`, Herkunftsstempel), nie importiert.

---

## 4. View und TaskNotes

### 4.1 Live-View (`src/obsidian/view/`, `ItemView`, Typ `mailstone-inbox`)

Schlank in V1: Kontowahl (falls > 1), Liste des `folders.inbox` (`UID FETCH ENVELOPE FLAGS` der letzten *N* UIDs, Default 100, „mehr laden"), Zeile = Absender · Betreff · Datum · Anhang-Marker · Badge, falls bereits als Notiz im Vault (Index-Treffer); Vorschau-Panel lädt Body erst beim Öffnen (`BODY.PEEK[]`, kein `\Seen`), gerendert über denselben `render/`-Pfad (Markdown im `MarkdownRenderer`). Aktionen: Übernehmen, Archivieren, extern antworten, Aufgabe erstellen (falls TaskNotes), Notiz öffnen (falls vorhanden). Kein Ordnerbaum, keine Suche (V1.1: IMAP `SEARCH` serverseitig). Die View schreibt **nie** eine Datei. Aktualisierung: beim Öffnen, per Button und nach `synced`/`changed`. Fokus-/Tastaturbedienung: Pfeile + Enter, Kommandos auch über die Command-Palette bei fokussierter Zeile. UI-STANDARD: Obsidian-native Komponenten, Theme-CSS-Variablen, eine Frontend-Schicht.

### 4.2 TaskNotes — optional, defensiv, zur Quelle (`src/obsidian/tasknotes-bridge.ts`)

Befund (TaskNotes 4.12.3): JS-API am Plugin-Objekt `app.plugins.plugins.tasknotes.api` mit `apiVersion = 1`, `tasks.create(taskData, opts)`, `model.config()` (fieldMapping, statuses, priorities, defaults, taskIdentification, userFields), `model.validateTask()`, `catalog.statuses()/priorities()`, `parseNaturalLanguage()`. Keine HTTP-API, kein Token nötig.

- **Erreichbarkeit** (Registry-Konsumenten-Regeln 1–4): bei jedem Aufruf frisch lesen; Form prüfen (`apiVersion === 1`, `typeof api.tasks?.create === "function"`, `typeof api.model?.config === "function"`); zwei Prüfstellen (Anbieten des Kommandos/Buttons und tatsächlicher Aufruf); Typen kopiert (`core/api/tasknotes-api.ts`, Herkunftsstempel).
- **`mail.createTask`:** `model.config()` lesen → Formular (Titel vorbelegt mit Betreff; Status/Priorität aus `catalog`, Defaults aus `config.defaults`; Fälligkeit; Projekte/Kontexte) → `model.validateTask(data)` → `tasks.create(data)`; Task erhält Link auf die Mail-Notiz (existiert sie noch nicht, wird zuerst `mail.adopt` ausgeführt und ein Sync abgewartet; schlägt einer der Schritte fehl, bricht das Kommando mit Code ab — keine Task ohne Notiz). mailstone schreibt **keine** Task-Datei selbst. Fällt die Form-Prüfung durch, fehlt das Kommando — nichts bricht.
- **Ohne TaskNotes — „Basic":** einstellbares Frontmatter-Preset (`taskPreset: Record<string,string|number|boolean>`, Default leer; Beispiel `{ status: "open" }`), das beim ersten Anlegen einer Mail-Notiz mitgeschrieben wird (`onCreate`, danach Nutzer-Feld). Keine Logik darauf; auswertbar in Bases. Die Kommandos berühren diese Felder nie.

---

## 5. Fehlerbehandlung, Sicherheit

- Alle Netz-/Protokollfehler sind Werte mit Codes; Notices über `Notifier` (übersetzt in `src/obsidian/`). Kein Stacktrace-Spam, kein wiederholtes Notice bei dauerhaftem Fehler (Backoff: nach 3 Fehlläufen Intervall ×4, Reset bei Erfolg).
- Secrets nur in `app.secretStorage`; Passwort nie loggen; Protokoll-Debug-Log (opt-in, Setting `debugLog`) maskiert `AUTHENTICATE`/`LOGIN`-Zeilen und loggt keine Body-Inhalte.
- TLS: Zertifikatsprüfung ist **nicht** abschaltbar. Klartext-Auth ohne TLS verweigert.
- **Lesen setzt nie `\Seen`:** überall `BODY.PEEK[]`, Sync nur mit `EXAMINE`. Das ist seit dem ③-Nachtrag ein Vertrag, keine Hygiene — der Ordner `Belege` (Keyword `$beleg`) wird von einem anderen Abholer (paperless-ngx, Teilprojekt ⑤) über „ungelesen“ gesteuert; ein Plugin, das beim Anzeigen `\Seen` setzt, bricht diesen Weg. Die View zeigt `$beleg`/Flags nur an.
- Reconnect ist kein Fehler: jeder Lauf baut eine frische Verbindung, abgebrochene Läufe werden beim nächsten Tick wiederholt; kein Teilzustand — `NotePlan[]` wird erst nach vollständigem Abruf ausgeführt.
- Vault-Schreibgarantien: Merge-Regeln (§ 2.2), Busy-Guard, Schreiben nur über den Executor, Löschen gibt es nicht (auch nicht `trashFile`).
- Datenschutz Repo: keine echte Mail, kein echter Header in Fixtures/Doku/Commit/Screenshot; Fehlerfälle werden nachgebaut, nicht kopiert.

---

## 6. Tests, Staging, Meilensteine, Release

**Tests (vitest, `environment: "node"`, Obsidian-Mock nur als `resolve.alias` → `tests/__mocks__/obsidian.ts`, vendored Kit-Mock):**
- `core/imap`: Parser gegen Fixture-Dialoge (`tests/fixtures/imap/*.txt`: Greeting, CAPABILITY, EXAMINE, SEARCH, FETCH mit Literalen/verschachtelten BODYSTRUCTUREs, MOVE, Fehlerantworten `NO`/`BAD`, untagged `* BYE`); Client gegen `FakeSocketTransport` (Skript-Dialoge).
- `core/smtp` + `mime/build`: Dialog-Fixtures; Golden-Files der erzeugten MIME-Bytes (iMIP-REQUEST mit `text/calendar; method=REQUEST`, Umlaut-Betreff RFC 2047, Dot-Stuffing).
- `core/mime/parse` + `render`: synthetischer `.eml`-Korpus (`tests/fixtures/eml/`, Liste aus der Vorarbeit: Zeichensätze, Struktur, Threads/Identität, Zeitzonen, `winmail.dat`), Snapshot-Tests fürs Markdown.
- `core/merge`: jede Regel einzeln (Außenbereich byte-identisch, unbekannte Keys erhalten, Linter-Umsortierung ≠ Manipulation, fehlende Fences → kein Schreiben, Hash-Abweichung → kein Schreiben, Idempotenz).
- `core/mirror`: Plan-Erzeugung (create/detach/reattach/skip), UIDVALIDITY-Wechsel, fehlende Message-ID.
- `core/send`: Identitätsprüfung, ImipMessage-Abbildung. `obsidian/*-bridge`: Form-Prüfung (halb initialisiertes Objekt, falsche Version, fehlende Methode).
- `tests/bundle.test.ts`: Bundle-Guard für `import("node:`.
- Integration (opt-in, `test:integration`): gegen einen lokalen Fake-Server aus den Dialog-Fixtures (`scripts/mail-server.ts`: TCP/TLS-Server, der den Skript-Dialog fährt) — **nie gegen das echte Postfach**. Ein manueller Prüfschritt gegen das echte Konto nach ④ ist in `docs/SMOKE.md` dokumentiert: nach dem Sync sind die Mails in anderen Clients ungelesen; eine gesendete Test-Einladung kommt bei einem fremden Empfänger mit `dmarc=pass` an.
- GUI-Smoke (`scripts/gui-smoke.ts` über `tools/obsidian-cdp/`, Skill `gui-smoke-setup`): Settings-Tab rendert, Konto anlegbar, View öffnet und zeigt Fake-Liste (Fake-Server), `mail.adopt` → Notiz + `.eml` im Fixture-Vault, Merge-Konflikt wird gemeldet, `api`-Fläche der calendar-notes-Registrierung (`registerMailTransport` wurde aufgerufen — über ein Stub-Plugin-Objekt im Renderer), TaskNotes-Bridge mit Stub-API. Baseline vor jedem Umbau festhalten.

**Meilensteine** (jeder für sich nützlich, riskanteste Annahme zuerst — hier: MIME/Render offline, bevor Netz existiert; B vor A, weil B eine wartende Gegenstelle hat und ohne Ordnermodell auskommt):

| M | Inhalt | Ergebnis |
|---|---|---|
| **M1 Gerüst + Formate** | Repo-Gerüst aus calendar-notes (Scripts, Vendor, Lint, Tests, check-pure, esbuild mit Builtin-Plugin), `mime/parse`, `mime/build`, `render`, `merge`, Fixture-Korpus, Settings-Typen | `npm run gate` grün; Kommando „Ordner mit `.eml` importieren" (offline) erzeugt Notizen |
| **M2 Transport** | `smtp`, `send`, `tls-transport`, Secrets, Settings-Tab (Konten/Identitäten/„Verbindung prüfen"), `calendar-notes-bridge`, Fake-SMTP-Server | calendar-notes kann über mailstone eine Einladung verschicken (Fake); Store-Lint grün |
| **M3 IMAP + Allowlist-Sync** | `imap` (Parser/Client), `mirror`, `sync`, Busy/Emitter, Statusleiste, Kommandos `rerender`/`relink`/`extractAttachment` | Mail im Allowlist-Ordner (Fake-Server) wird Notiz + `.eml`; Entkoppeln funktioniert |
| **M4 View + Server-Kommandos** | `ItemView`, `mail.adopt`, `mail.archive`, `mail.replyExternal`, GUI-Smoke | Posteingang in Obsidian; Übernehmen = MOVE |
| **M5 TaskNotes** | `tasknotes-bridge`, `mail.createTask`, Basic-Preset | Aufgabe aus Mail, ohne TaskNotes stiller Wegfall |
| **M6 Release** | README mit Shots (Skill `readme-shots`), CHANGELOG, `versions.json`, Release-Delegation, Erst-Release, Dashboard-Einreichung (Maintainer) | Store-Review „passed", 0 Warnings |

Abhängigkeiten nach außen: App-Passwort (④) für jeden Test gegen das echte Postfach; Allowlist-Ordnername aus ③ (bis dahin Setting mit Platzhalter, Fake-Server nutzt `Vault`).

**Release/Store:** Release-Infra über Skill `plugin-release-setup` (zentrales `tools/release/`, `release.yml`-Vendoring, `versions.json`), Remotes legt die Repo-Session an (Forgejo `origin`, GitHub-Mirror). `npm run lint` = Store-Scanner-Vorschau, Zero Warnings vor Tag. Nach `npm run release`: Rescan im Developer Dashboard anstoßen (Maintainer).

---

## 7. Offene Punkte (mit Eigentümer)

| Punkt | Eigentümer | Wann |
|---|---|---|
| ~~Name des Allowlist-Ordners~~ — **entschieden: `Vault`** (existiert, leer, oberste Ebene, keine Sieve-Regel); Archiv `Archive`; sechs flache Ordner (`Listen`, `Systempost`, `Belege`, `Fremd`, `Vault`, `Archive`) + Standardordner | ③ erledigt 2026-08-23 | — |
| App-Passwort → erster echter Login/Versand (ManageSieve-Login mit App-Passwort ist laut ③-Nachtrag bereits gemessen: funktioniert) | mailbox-org-④ | offen |
| Vault-Schema: Typ `mail` in `_types/` anlegen, Linter-Ausnahme für den Mail-Ordner, `.eml` aus dem Vault-Git ausnehmen | Maintainer (Vault) | vor M3-Nutzung |
| Reihenfolge `## Notizen` vor `## Nachricht` | Gebrauch | nach M3 |
| `IDLE`, IMAP `SEARCH` in der View, Absender → Kontakt via `calendar-notes`, B-mittel | V1.1+ | nach Nutzung |
