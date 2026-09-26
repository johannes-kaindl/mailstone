# AGENTS — mailstone

Mail als Vault-Notiz: ein **Server-Ordner** entscheidet als Allowlist, was Notiz wird; die
Message-ID ist die Identität, das `.eml` liegt als Treuefläche daneben. Dazu SMTP-Versand, den
`calendar-notes` als iMIP-Transport registriert. Spec:
`docs/superpowers/specs/2026-08-23-mailstone-design.md`, Pläne unter `docs/superpowers/plans/`,
Handproben-Protokoll `docs/SMOKE.md`.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in
> `_docs/CONVENTIONS.md` im Multi-Projekt-Workspace des Maintainers, `../../_docs` relativ zu
> diesem Repo — nicht Teil dieses Repos, ignorieren falls im Klon nicht vorhanden. Modell
> comply-or-explain.

- `src/core/**` ist obsidian-/DOM-/node-frei (`npm run check:pure` verbietet dort auch
  `process` und `window`). Sockets, Dateisystem und Secrets werden aus `src/obsidian/**`
  hineingereicht.
- Kit-Module nur über `npm run kit:sync` (Herkunfts-Header + `VENDOR.json`), nie von Hand:
  `src/vendor/kit` (obsidian-kit, pur), `src/vendor/kit-obsidian`, `src/vendor/code-kit`.
- `eslint.config.mjs`, `scripts/check-no-inline-disables.mjs` und
  `scripts/check-no-abs-paths.mjs` sind byte-identische Template-Kopien (Dach
  `tools/release-template/` bzw. `_docs/templates/scripts/`) — Änderungen gehören in die Quelle.
- **Volles Gate ist `npm run gate`**, und es ist mehr als `typecheck`: Lint, drei Typprüfungen,
  Unit, **Integration**, `check:pure`, Build und ein Bundle-Test. Wer nur `npm test` fährt,
  sieht die Integrationstests nicht — durch genau diese Lücke lag ein Bruch tagelang auf `main`.
- Desktop-only (`node:tls`/`node:net` via dynamischem Import in `src/obsidian/tls-transport.ts`,
  `isDesktopOnly: true`). `src/obsidian/node-sockets.d.ts` ist bewusst kein Modul.
- **GitHub ist wieder der Verteilweg (Rückkehr 2026-09-24), `origin` auf Forgejo bleibt die Quelle.** Das `github`-Remote steht, `npm run release` fährt ohne `--no-github`: `release.mjs` pusht Branch und Tag per Dual-Push zusätzlich nach GitHub, der Tag löst `release.yml` aus, und das GitHub-Release ist der Weg zum Community Store (Erst-Einreichung und Rescan macht Johannes im Developer Dashboard). Ein Push auf `origin` erreicht GitHub **nicht** von selbst — der Forgejo-Push-Mirror ist gelöscht, GitHub bekommt Branch und Tag nur über `release.mjs`; ein manuelles `git push github main` gehört nicht dazu. Daneben bleibt der AnySource-Katalog ein Weg (mailstone ist dort gelistet). *Chronik: vom 2026-09-06 bis 2026-09-24 war GitHub aufgegeben (Remote entfernt, `--no-github` fest im Script, Eintrag in `mirror_drift_check.AUSNAHMEN`); der Mirror trug damals ohnehin nicht (gemessen 2026-09-01: 42 min nach dem Push stand GitHub unverändert).* `.github/workflows/release.yml` ist eine byte-identische Template-Kopie (`tools/template_drift_check.py` bewacht sie).
- Dach-Regeln gelten: `../AGENTS.md` (Kit-first, Release über `../tools/release/`, Store-Flow,
  CDP-Lock vor jedem Zugriff auf ein laufendes Obsidian).

## Ein Sync-Lauf darf `\Seen` nie setzen

Lesende Pfade nutzen `EXAMINE` und `BODY.PEEK[…]`, nie `SELECT` oder `BODY[…]`. Das ist ein
Vertrag gegenüber dem Postfach des Nutzers, kein Implementierungsdetail: eine Mail, die
mailstone gespiegelt hat, muss im Mailprogramm weiterhin ungelesen aussehen — im Ordner
`Belege` steuert ein anderer Abholer (paperless-ngx) über genau dieses „ungelesen".

**Seit M4 ist der Client nicht mehr rein lesend, sondern in zwei Typen geteilt** — und die
Grenze bewacht der Compiler, nicht die Aufmerksamkeit eines Reviewers:

| Einstieg | Typ | Kann | Wer nimmt ihn |
|---|---|---|---|
| `imapConnect` | `ImapReadSession` | `examine`, `uidSearchAll`, `uidFetchMessageIds`, `uidFetchHeaders`, `uidFetchBody`, `append` | Sync, Inbox-Liste |
| `imapConnectWritable` | `ImapWriteSession` | zusätzlich `select`, `uidMove` | **nur** `src/core/inbox/actions.ts` |

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

## `SecretComponent` ist ein Verweis, kein Passwortfeld

Obsidians natives Passwort-Feld bindet **nicht** ein Passwort, sondern einen
Schlüsselbund-Eintrag: `onChange` liefert die **ID** des gewählten Eintrags zurück, nie dessen
Wert. `account-modal.ts` speichert deshalb `account.secretId`. Bis diese Falle gefunden war,
schrieb jede Änderung die ID-Zeichenkette als Passwort, und der Server antwortete mit `535` —
unsichtbar, weil die Zeile befüllt aussah.

Zweiter, unabhängiger Obsidian-Bug an derselben Stelle: das native „Geheimnis hinzufügen"-Formular
scheitert **lautlos**, wenn die ID schon existiert (nur ein Hover-Tooltip, keine Notice). Ein
einmal gesetztes Passwort ist über die UI faktisch unveränderbar. Dasselbe Muster trat in
`calendar-notes` auf; es steht als Registry-Eintrag im Dach.

**Ein verwaister Schlüsselbund-Eintrag wird bewusst NICHT aufgeräumt** (entschieden 2026-09-03,
M1-Nachlese): Wer im Konten-Modal ein Geheimnis anlegt und dann *Abbrechen* drückt, hinterlässt
einen Eintrag ohne Konto — `SecretComponent` schreibt am Save/Cancel-Ausgang vorbei direkt in den
Speicher. Ihn beim Abbrechen zu löschen hieße, in einem **globalen** Namensraum zu räumen: die IDs
vergibt der Nutzer, `app.secretStorage` gehört allen Plugins, und dieselbe ID kann bereits an einem
anderen Konto oder Plugin hängen. Ein verwaister Eintrag kostet nichts; ein fälschlich gelöschter
kostet ein Passwort, das über die UI (s. o.) kaum wiederherzustellen ist.

## Ein Fehlschlag der Sent-Kopie ist kein Fehlschlag des Versands

`send()` legt die Nachricht nach erfolgreichem Versand per `APPEND` im Ordner aus `folders.sent`
ab. Scheitert das, bleibt `ok: true` — die Mail **ist** zugestellt, und sie als gescheitert zu
melden würde zu einem zweiten Sendeversuch verleiten. Der Ausgang steht getrennt als
`sentCopy: "ok" | "failed" | "skipped"` im Ergebnis.

Beim `APPEND` gehen die Bytes **erst nach der Continuation** (`+`) raus. Lehnt der Server vorher
ab (fehlender Ordner, volles Postfach), bleiben sie ungeschrieben — sonst lägen sie herrenlos auf
einer Leitung, die schon auf das nächste Kommando wartet.

## Anhänge werden nach Index adressiert, nicht nach Namen

Der MIME-Speicher darf nicht mit `contentId ?? name` keyen: zwei nicht-inline Anhänge gleichen
Namens teilen sich sonst einen Eintrag, und die extrahierte Datei trägt den Namen des einen und
den Inhalt des anderen — ohne Fehlermeldung. Der Defekt lag seit M1 im Parser und wurde erst
sichtbar, als M3b sein erster Konsument wurde. Fixture dafür: `Import/dup-attachments.eml`
(zwei `rechnung.pdf` mit unterscheidbarem Inhalt) — ein Ein-Anhang-Fixture kann diesen Fall
strukturell nie zeigen.

**Dieselbe Achse entscheidet, ob ein zweiter Extrakt eine zweite Datei anlegt** (seit
2026-09-05): liegt am unnummerierten Zielnamen bereits eine **byte-gleiche** Datei, wird sie
verlinkt statt kopiert, und der Plan trägt gar keinen Schreibvorgang mehr. Verglichen werden
die **Bytes**, nicht der Basename — ein Basename-Vergleich hätte genau die zwei gleichnamigen,
aber verschiedenen Anhänge oben zusammengeworfen und den zweiten unerreichbar gemacht. Die
Bytes der vorhandenen Datei löst `buildContext` vorab auf; ein Kommando bekommt sie nur mit
`needs: { attachments: true }`, sonst **wirft** der Zugriff (ein stiller Fehlwert wäre hier
nicht unterscheidbar von „nichts vorhanden").

## TaskNotes-Kopplung: eine deklarierte Abweichung von der Dach-REGISTRY

`mail.createTask` legt aus einer Mail-Notiz oder aus dem Posteingang eine Aufgabe im
Nachbarplugin TaskNotes an. Einziger Ort, der TaskNotes anfasst, ist die Brücke
`src/obsidian/tasknotes-bridge.ts` (`readTaskNotesApi`, `createTaskViaBridge`) — sie liest die
fremde API bei **jedem** Aufruf frisch (Muster: `src/obsidian/calendar-notes-bridge.ts`) und
wirft nie: ein Fehlschlag kommt als `{ ok: false, code: … }` zurück, nie als Exception.

**Das ruft `api.tasks.create` — die Dach-`REGISTRY.md` verbietet Fremdplugins genau das**
(Exemplar `calendar-notes`: nur `model`/`catalog` lesen). Die Abweichung ist von Johannes am
2026-09-05 entschieden, keine übersehene Regel. Die tragende Achse ist **nicht** „einmalig vs.
laufend", sondern **wer nach dem Aufruf die Wahrheit hält**: `calendar-notes` spiegelt
fortlaufend und müsste mit `tasks.*` einen Bestand führen, dessen Wahrheit anderswo liegt — das
ist Verwaltung und bleibt verboten. mailstone übergibt einmal und lässt los (kein Rückverweis,
kein späterer Zugriff auf die angelegte Aufgabe) — das ist Delegation an die Quelle, und genau
das verlangt die Dach-Regel. **Die Erlaubnis hängt an zwei Bedingungen, nicht an einer:** auch
auf ausdrücklichen Nutzerbefehl. Ein Automatismus, der ohne Zutun des Nutzers anlegt, wäre auch
dann Verwaltung, wenn er danach loslässt — deshalb legt der Sync **nie** eine Aufgabe an, nur
das Kommando und der Knopf im Posteingang tun das. Details, inkl. der mit `calendar-notes` abgestimmten
REGISTRY-Präzisierung: Spec `docs/superpowers/specs/2026-09-05-m5-tasknotes-design.md` § 7.

**Zwei Vorab-Prüfungen der fremden API bleiben bewusst ungenutzt, beide durch einen echten
Aufruf widerlegt** (TaskNotes 4.12.5, gemessen 2026-09-05, Spec § 8/§ 2.2):

- `hasCapability("tasks.create")` liefert `false`, während `api.tasks.create` existiert und
  anstandslos funktioniert (`tasks.write` meldet `true`). Ein Gate darauf wäre ein lautloser
  Totalausfall der Funktion gewesen. `isTaskNotesApi` prüft stattdessen `typeof tasks?.create
  === "function"`.
- `model.validateTask` verlangt ein vollständiges `TaskInfo` (`status`, `dateCreated`,
  `dateModified` gesetzt) und lehnt **jede** Erstellungs-Eingabe mit `missing_required` ab —
  auch die, mit denen `create()` klaglos eine Aufgabe anlegt. Es prüft den Zustand nach dem
  Anlegen, nicht die Eingabe davor, und ist deshalb für einen Vorab-Check ungeeignet.

**Wer `api.tasks.*` an einer zweiten Stelle verwendet, trägt sie hier ein** — bislang gilt:
`createTaskViaBridge` in `src/obsidian/tasknotes-bridge.ts` ist die einzige.

## Versand-API: eine deklarierte Abweichung vom Anbieter-Muster

`plugin.api` bietet fremden Plugins Mail-Versand an (`src/obsidian/plugin-api.ts`,
`createMailstoneApi`). Ein nicht gelistetes Plugin löst ein Bestätigungs-Modal aus; *„Senden und
immer erlauben"* trägt es in `settings.trustedSenders` ein, danach sendet es still. Spec:
`$VAULT/25_Coding/mailstone/_SDD/2026-09-06-versand-api-design.md`.

**Das Anbieter-Muster der Dach-`REGISTRY.md` sagt in Punkt (6) „kein Zustimmungs-Tor"** — mit der
Begründung, wer die API rufen könne, habe ohnehin vollen Vault-Zugriff. **Diese Begründung setzt
voraus, dass die API nichts anbietet, was der Aufrufer nicht ohnehin hätte.** Bei `vault-rag`
(Retrieval) und `local-image-generator` (lokale Bilderzeugung) trifft das zu. Hier nicht: die API
gibt Zugriff auf ein **authentifiziertes SMTP-Konto**, dessen Zugangsdaten im Schlüsselbund von
mailstone liegen — eine Rechteerweiterung, kein Convenience-Wrapper. Die tragende Achse von (6)
lautet deshalb präzisiert: **ein Tor ist überflüssig, wo die API nur bündelt, was der Aufrufer
schon darf — und nötig, wo sie ihm etwas Neues gibt.**

⚠️ **`callerId` ist eine Selbstauskunft, keine Authentifizierung.** Obsidian kennt keinen
Aufrufer-Kontext; jedes Plugin kann dort alles eintragen. Die Vertrauensliste schützt vor
**Versehen** und schafft **Sichtbarkeit** — sie ist **kein Sicherheits-Perimeter**. Ein
bösartiges Desktop-Plugin hat vollen Node-Zugriff und spricht SMTP selbst; dagegen schützt hier
nichts, und die API soll auch nicht so beschrieben werden. Wer das später „absichert", optimiert
an der falschen Stelle.

**Zwei Namen, die nicht verwechselt werden dürfen:** `folders.allowlist` ist der **Server-Ordner**,
der entscheidet, was Notiz wird — der Kernbegriff der Architektur. Die Plugin-Liste heißt
`trustedSenders`, in Texten „vertraute Plugins". Das Wort „Allowlist" wird dafür nie verwendet.

**Wer die API an einer zweiten Stelle exponiert, trägt sie hier ein** — bislang gilt:
`createMailstoneApi` in `src/obsidian/plugin-api.ts` ist die einzige.

**Der bestehende iMIP-Weg läuft unverändert weiter** (`registerMailTransport` bei
`calendar-notes`) und geht **nicht** durch die Bestätigung — sonst würde eine heute
funktionierende, im Echtbetrieb belegte Funktion plötzlich Modals werfen. Bewacht wird das als
**Unit-Test** in `tests/obsidian/calendar-notes-bridge.test.ts`, nicht im GUI-Smoke:
`CalendarNotesBridge` exponiert nur `tryRegister`/`unregister`/`registered`, ein GUI-Prüfpunkt
hätte gar keinen Zugriff auf den Transport. Der Test sichert zweierlei — der Transport ruft
`sendService.send` direkt, und die Bridge importiert `plugin-api` nicht. ⓘ Die zweite Hälfte
prüft Importzeilen als Text und sieht deshalb **keine dynamischen** Importe; die Grenze steht im
Testkommentar.

## UI-Abweichungen

Deklaration nach `UI-STANDARD.md` §1a — von einem verbindlichen §8-Baustein abzuweichen ist
erlaubt, stillschweigend abzuweichen nicht.

- **endpoint-list** — Grund: `taskPresetGroup` in `src/obsidian/settings-tab.ts` ist ein
  schlichter Schlüssel/Wert-Editor für `taskPreset` (zwei Textfelder je Zeile), keine
  Provider-Endpunkte. Der Kit-Baustein `buildEndpointList` ist auf Endpunkte zugeschnitten (URL +
  Schlüssel + Modell-Dropdown + Probe + Presets) und in mailstone nicht vendort — ihn für zwei
  Textfelder zu importieren wäre semantisch falsch und zöge unbenutzten Ballast (Modell-Cache,
  Erreichbarkeitsprobe) mit. Struktur ist trotzdem dieselbe native `SettingDefinitionList`
  (Add/Delete, `emptyState`) wie bei den Konten, nicht neu erfunden.
  gilt-solange: `src/obsidian/settings-tab.ts` enthaelt-nicht `from "../vendor/kit-obsidian/endpoint-list"`.

## Was Unit-Tests hier nicht belegen können

`onload()` ist nicht erreichbar, die Plugin-Instanz sehr wohl (Konstruktor plus gesetzte Felder
genügen — `tests/obsidian/main-cockpit.test.ts`). Außerhalb bleiben genau drei Dinge, und für
sie ist `docs/SMOKE.md` der einzige Beleg: `registerView` und die Ribbon-Umstellung (der
vendorte `Plugin`-Mock verwirft Titel **und** Callback von `addRibbonIcon`), das
`onLayoutReady`-Gate, und alles Sichtbare — ob ein Element Pixel hat, wo ein Knopf sitzt, ob
eine Animation läuft. Dafür gibt es seit M4 den getrackten Treiber `npm run smoke:gui`
(`scripts/gui-smoke.ts`, 24 Prüfpunkte gegen ein **laufendes** Obsidian, Stand Versand-API) — er braucht
den CDP-Lock des Dachs und ein offenes Fenster für den Staging-Vault, das Protokoll steht in
`docs/SMOKE.md`.

**Seit M5 gibt es einen zweiten, getrackten Treiber: `npm run smoke:e2e`**
(`scripts/e2e-crossplugin.ts`). `smoke:gui` prüft mailstones Hälfte der TaskNotes-Kopplung
gegen einen Stub auf `app.plugins.plugins.tasknotes` — TaskNotes selbst kennt mailstone dabei
gar nicht. `smoke:e2e` ist der Naht-Lauf gegen ein **echt installiertes** TaskNotes im
Staging-Vault: er belegt, dass eine Aufgabe wirklich als Datei im Vault ankommt, mit welcher
Feldform, und ob ein Fehlschlag als Wert oder als Ausnahme zurückkommt (Spec § 8.1/§ 9). Er
setzt dieses zweite Plugin voraus und ist deshalb **bewusst nicht Teil von `gate` oder
`smoke:gui`** — eine Pflichtstrecke darf nicht an einem Nachbarplugin scheitern, das nicht
jeder Klon hat. Wer ihn ins Gate zieht, macht das Gate von einer Voraussetzung abhängig, die
dort nicht hingehört.

## Nutzer-Doku und README-Bilder

`docs/README.md` ist der Doku-Index (Diátaxis, nur Quadranten mit Inhalt), `docs/getting-started.md` und `docs/how-to/troubleshooting.md` sind die zwei Pflichtteile. Alles andere unter `docs/` (`SMOKE.md`, datierte Notizen, `superpowers/`) ist Maintainer-Material und wird aus der README nicht verlinkt. Die Symptomtexte im Troubleshooting sind wörtliche Strings aus `src/i18n/strings.ts`: wer dort einen Text ändert, zieht die Doku mit (CORE-META-18).

Die README-Bilder entstehen mit `npm run shots` in einer Zweitinstanz, der Vertrag steht in `docs/images/README.md`. Zwei Dinge daran sind gesetzt statt gemessen (Konto und Laufzustand im Seitenpanel), weil ein Sync ein echtes Postfach braucht — der Vertrag nennt sie.
