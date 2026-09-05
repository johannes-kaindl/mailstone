# M5 — TaskNotes-Kopplung: Design

> **Verhältnis zur Haupt-Spec:** Ergänzung zu `2026-08-23-mailstone-design.md` § 4.2. Deren
> Festlegungen gelten weiter, **außer** wo § 7 dieser Datei ausdrücklich abweicht.
> Entschieden am 2026-09-05 (Johannes: vier Vorlagefragen; drei mit der Empfehlung beantwortet,
> eine gegen sie — der Posteingangs-Weg bleibt drin).

M5 koppelt mailstone an TaskNotes: aus einer Mail wird auf Nutzerbefehl eine Aufgabe. Die
Kopplung ist **optional und defensiv** — ohne TaskNotes fällt das Kommando ersatzlos weg, und
nichts bricht. Für Vaults ohne TaskNotes gibt es einen eigenständigen, viel kleineren Weg
(§ 5).

---

## 1. Zuschnitt

| Drin (M5) | Draußen |
|---|---|
| `src/obsidian/tasknotes-bridge.ts` — Erreichbarkeit + Formprüfung | Aufgaben ändern, abschließen, löschen |
| `mail.createTask` auf einer Mail-Notiz (Deskriptor-Rahmen) | Rückverweis Notiz → Aufgabe |
| Derselbe Befehl aus dem Posteingang, mit adopt-Kette | Status-/Prioritäts-Abbildung (§ 6) |
| Schmales Modal: Titel + Fälligkeit | Projekte, Kontexte, Tags, Wiederholung im Modal |
| `taskPreset` beleben (Settings-UI + Anwendung) | `parseNaturalLanguage` (§ 6, gemessen) |
| Naht-Lauf `npm run smoke:e2e` gegen echtes TaskNotes | TaskNotes als harte Abhängigkeit |

---

## 2. Die Brücke (`src/obsidian/tasknotes-bridge.ts`)

Nach den vier Konsumenten-Regeln der Dach-`REGISTRY.md` (§ Plugin-zu-Plugin, Muster-Referenz
`koda-agent/src/obsidian/retrieval.ts`):

1. **Bei jedem Aufruf frisch lesen**, nie beim Laden cachen — TaskNotes kann mitten in der
   Sitzung deaktiviert werden; der Zugriff ist nur ein Objekt-Lookup.
2. **Form prüfen, nicht Existenz.**
3. **Zwei Prüfstellen** — beim Anbieten des Kommandos und beim tatsächlichen Aufruf.
4. **Typen kopiert** nach `src/core/api/tasknotes-api.ts` mit Herkunftsstempel, nie importiert
   (PROF-OBS-09: zwei eigenständige Repos gehen kein Build-Coupling ein).

### 2.1 Was genau geprüft wird

```
api.apiVersion === 1                            // strikt
typeof api.tasks?.create   === "function"
typeof api.model?.config   === "function"
```

`model.validateTask` wird **gar nicht geprüft und nicht in `TaskNotesApiSubset` aufgenommen**
(Ruling Task 0, 2026-09-05, ersetzt eine ältere Fassung dieses Absatzes): gemessen erwartet es
ein vollständiges `TaskInfo` und meldet für **jede** Erstellungs-Eingabe `missing_required` für
`status`/`dateCreated`/`dateModified` — Felder, die `create()` selbst befüllt. Eingebaut hätte
es jeden Erstellungsversuch mit „ungültig" scheitern lassen, bei völlig intakter API. Details:
§ 8.1.

Der **strikte** Vergleich gegen die eigene Konstante ist bewusst gewählt und hat einen Preis,
der eingeplant gehört: bricht TaskNotes seinen Vertrag, verstummt mailstone, statt auf einer
Form zu arbeiten, die es nicht kennt (Präzedenzfall `llm-lab` ↔ `vault-rag`, zwei gemessene
`apiVersion`-Bumps). Für einen Aufruf, der nur im Moment des Klicks stattfindet, ist das die
richtige Hälfte — anders als bei `calendar-notes`, das seinen Spiegel einmal abliest und
einfriert, weil er fortlaufend ohne das Nachbarplugin funktionieren muss.

### 2.2 `hasCapability` wird nicht benutzt

⚠️ Gemessen am 2026-09-05 (TaskNotes 4.12.5, § 8):

```
api.hasCapability("tasks.create") === false     // bei funktionsfähigem api.tasks.create
api.hasCapability("tasks.write")  === true
```

Ein Gate auf den naheliegenden String wäre ein **lautloser Totalausfall**: das Kommando
erschiene nie, bei völlig intakter API. Der allgemeine Befund dahinter — von `calendar-notes`
aus diesem Anlass verallgemeinert — ist schärfer als der Einzelfall: **die Capability-Strings
sind nicht systematisch, also ist jeder aus einem Methodennamen abgeleitete String
unzuverlässig**, auch künftige. Die Formprüfung über `typeof` ist die haltbare Variante. Der
Befund steht als Kommentar an der Prüfstelle, sonst baut ihn der nächste Leser wieder ein.

---

## 3. `mail.createTask` — der Notiz-Weg

Lebt vollständig im bestehenden Deskriptor-Rahmen (`src/core/commands/`): `appliesTo`, Schema,
`CommandContext`, Fehlercodes. `appliesTo` verlangt zusätzlich zur Mail-Notiz eine bestandene
Formprüfung (Prüfstelle 1).

**Modal:** Titel (aus dem Betreff vorbelegt) und Fälligkeit (optional, Datumsfeld). Mehr nicht.
Alles Weitere überlässt mailstone TaskNotes' eigenen Defaults — was dort besser bedienbar ist
als in einem Nachbau, und was jedes gespiegelte Feld als Bruchstelle gegen eine RC-API spart.

**Ablauf:** Formprüfung (Prüfstelle 2) → `taskData` bauen → `tasks.create(data)` → Notice mit
Ergebnis. Kein `validateTask`-Schritt mehr (Ruling Task 0, s. § 2.1/§ 8.1): ohne ihn gibt es
keinen Ausgang, der eine eigene Vorab-Diagnose bräuchte — Eingabeprüfung macht mailstones
eigenes Schema, ein Fehlschlag der fremden API kommt als `task-create-failed` zurück.

Die Form von `taskData` ist gemessen (§ 8.1, Task 0): einziges Pflichtfeld `title`, Fälligkeit
heißt `due` (nicht `dueDate`), unbekannte Felder werden ignoriert. Eine Feldübersetzung über
`catalog.fields()` ist damit nicht nötig — mailstone reicht die drei bekannten Felder direkt
durch.

**Der Link auf die Mail-Notiz** gehört zur Aufgabe und wird über `details` getragen (§ 8.1) —
ein Wikilink im Freitext-Rumpf, kein eigenes Link-Feld.

Neue Codes in `CommandErrorCode`: `tasknotes-unavailable`, `task-create-failed`. (`task-invalid`
entfällt — ohne `validateTask` gibt es keinen Ausgang mehr, der ihn erzeugt; ein Code ohne
Erzeuger ist toter Vertrag.)

**mailstone schreibt keine Task-Datei selbst** und fasst die Aufgabe nach dem Anlegen nie wieder
an. Kein Rückverweis von der Mail-Notiz auf die Aufgabe — das wäre ein zweiter Bestand mit
eigener Pflegepflicht.

---

## 4. Der Posteingangs-Weg — adopt-Kette

Liegt wie `mail.adopt` **außerhalb** des Deskriptor-Rahmens: der ist notiz-zentriert
(`MailTarget` trägt immer einen Pfad), eine Mail ohne Notiz hat keinen. Der Weg lebt neben
`src/core/inbox/actions.ts`.

```
adoptMessage(...)                  // UID MOVE in den Allowlist-Ordner
  → syncAccount(accountId)         // gezielt anstoßen, nicht aufs Intervall warten
  → pollUntil(Notiz zur Message-ID im Index, Frist)
  → Modal + tasks.create
```

**Der Beleg ist der Index-Treffer, nicht die Rückmeldung des Sync-Laufs.** Dieselbe Linie wie
M4s `UID MOVE`, das seinen Erfolg an `COPYUID` misst statt an der `OK`-Zeile: ein Lauf kann
fehlerfrei enden, ohne dass diese eine Notiz entstanden ist.

Der gezielte Sync ist der Grund, warum diese Kette überhaupt tragbar ist — das reguläre
Intervall kann Minuten entfernt sein, und ein Modal, das minutenlang wartet, ist kaputt.

**Reißt die Frist, bricht die Kette mit `sync-timeout` ab. Keine Aufgabe ohne Notiz.** Die
Übernahme selbst bleibt bestehen (sie ist auf dem Server passiert und nicht rückgängig zu
machen); die Notice sagt das ausdrücklich, damit niemand ein zweites Mal übernimmt.

---

## 5. `taskPreset` — der Weg ohne TaskNotes

`taskPreset` steht seit M1 in `MailstoneSettings` und im Default — und wird an **null** Stellen
gelesen oder geschrieben. M5 belebt das tote Feld:

- Settings-UI zum Pflegen des Presets (Default bleibt leer).
- Beim **ersten** Anlegen einer Mail-Notiz wird es ins Frontmatter mitgeschrieben
  (`profile.onCreate`-Pfad), danach ist es Nutzer-Feld.
- **Keine Logik darauf.** Die Kommandos berühren diese Felder nie; auswertbar ist es in Bases.

Das ist bewusst kein Aufgaben-System, sondern eine Anschlussstelle für das, was der Nutzer
ohnehin in seinem Vault fährt.

---

## 6. Was nicht gebaut wird — mit Gründen

| Nicht gebaut | Grund |
|---|---|
| **`parseNaturalLanguage`** | Gemessen (§ 8): deutsche Zeitangaben werden **nicht** erkannt, aber Zahlen im Betreff werden zu Terminen. „Rechnung 3/2026 faellig 15.03." → Titel verstümmelt zu „Rechnung faellig 15.03.", dazu `scheduledDate: 2026-03-01` aus der **Rechnungsnummer**. Ein Nutzen von null gegen einen stillen Datenfehler, der plausibel aussieht. |
| **Status-/Prioritäts-Abbildung** | Existiert bei `calendar-notes` nur, weil dort ein **fremder** VTODO-Zustand auf den TaskNotes-Statusraum geworfen wird. Eine **neue** Aufgabe bekommt den Default-Status; die Partition über `isCompleted`, die `order`-Sortierung und die Nachbarschaftsregel für `low`/`high` brauchen wir nicht. |
| **Feldübersetzung auf Vorrat** | Siehe § 3 — erst messen, dann bauen. |
| **Aufgaben ändern/abschließen/löschen** | Das wäre Verwaltung eines fremden Bestands (§ 7). |
| **Rückverweis Notiz → Aufgabe** | Zweiter Bestand mit eigener Pflegepflicht, ohne Gegenwert. |
| **TaskNotes als Abhängigkeit** | Store-Software: ein Nachbar-Tool wird nur registriert, wenn es vorhanden ist (Dach-`AGENTS.md`). |

---

## 7. Die Abweichung von der REGISTRY — deklariert, nicht beiläufig

Die Dach-`REGISTRY.md` führt seit dem 2026-09-03 (Exemplar `calendar-notes`) die Regel:

> Nur `model`/`catalog` lesen, nie `api.tasks.*` — sonst verwaltet das eigene Plugin fremde
> Aufgaben, und die Zuständigkeitsgrenze aus der Dach-`AGENTS.md` fällt.

**mailstone ruft `api.tasks.create`.** Das ist eine bewusste Abweichung, von Johannes am
2026-09-05 entschieden, und sie wird an der Quelle präzisiert statt hier stillschweigend
gebrochen.

**Die tragende Achse ist nicht „einmalig vs. laufend", sondern: wer nach dem Aufruf die
Wahrheit hält.** `calendar-notes` spiegelt fortlaufend und müsste mit `tasks.*` einen Bestand
führen, dessen Wahrheit anderswo liegt — das ist Verwaltung. mailstone übergibt einmal und
lässt los: danach besitzt TaskNotes die Aufgabe vollständig, es gibt nicht einmal einen
Rückverweis. Das ist **Delegation an die Quelle** — genau das, was die Dach-Regel verlangt.

Die Achse „einmalig" wäre die schlechtere Formulierung, weil sie den nächsten Leser einlädt,
„ich rufe ja nur selten" als Freibrief zu lesen. Der Vorschlag kam von `calendar-notes` selbst
(Abstimmung am 2026-09-05).

⚠️ **Beim Gegenlesen kam eine zweite Bedingung dazu, und sie schließt eine echte Lücke.** Die
Achse prüft nur die *Nachher*-Beziehung und schweigt darüber, **wer den Aufruf auslöst**. Ein
Plugin, das bei **jeder eingehenden Mail automatisch** eine Aufgabe anlegt und danach loslässt,
ginge nach der reinen Wahrheits-Achse durch — und befüllt fortlaufend fremden Bestand, über den
niemand entschieden hat. Erlaubt ist die Delegation deshalb nur **auf ausdrücklichen
Nutzerbefehl**; beide Hälften sind nötig. mailstone erfüllt das (`mail.createTask` ist ein
Kommando bzw. ein Knopf, nie ein Automatismus — der Sync legt **nie** eine Aufgabe an), aber die
Regel trug es vorher nicht, und der nächste Leser hat nur die Regel.

**Ablageort — erledigt am 2026-09-05:** REGISTRY-Zeile präzisiert (Dach `26004e4`), LESSONS-Eintrag
geschrieben (`_docs` `603341f`). Eine repo-lokale `AGENTS.md` reicht nicht — Nachbar-Sessions sehen nur die
workspace-weit injizierten Dateien (LESSON vom 2026-09-04, `koda-agent`). **Die Formulierung
wird `calendar-notes` vor dem Commit gezeigt**, wie am 2026-09-05 zugesagt.

---

## 8. Messanhang — TaskNotes 4.12.5, gemessen 2026-09-05

Rein lesend über CDP (`Runtime.evaluate`), `api.tasks.create` wurde dabei **nicht** aufgerufen.
Ergänzt `calendar-notes/docs/tasknotes-api.md` (Stand 2026-09-03), das `api.tasks.*`
ausdrücklich ausspart.

**Versionsfelder — zwei nebeneinander:**

```
api.apiVersion              1            (number, eigenes Feld am api-Objekt)
api.model.info()            { packageName: "@tasknotes/model",
                              specVersion: "0.3.0-rc.3", runtimeApiVersion: 1 }
```

**Capabilities:**

| String | Antwort |
|---|---|
| `catalog.read` | `true` |
| `model.read` | `true` |
| `tasks.read` | `true` |
| `tasks.write` | `true` |
| `tasks.create` | **`false`** — obwohl `api.tasks.create` existiert und funktioniert |

**Flächen:** `api.tasks` trägt 25 Methoden (`create`, `update`, `patch`, `delete`, `complete`,
…) — für M5 zählt allein `create` (arity 2). `api.model`: `info`, `config`, `validateTask`
(arity 1), `validatePatch`. `api.catalog`: u. a. `statuses`, `priorities`, `fields`,
`writableFields`. `config().defaults` = `{ status: "open", priority: "normal", taskTag: "task" }`
— deckungsgleich mit dem Befund vom 03.09.

**`parseNaturalLanguage` (arity 1), an echten Betreff-Formen:**

| Eingabe | Ergebnis |
|---|---|
| `Angebot pruefen bis Freitag` | unverändert, **kein** Datumsfeld |
| `morgen 14 Uhr` | unverändert, **kein** Datumsfeld |
| `AW: Kuendigung zum 31.12. bestaetigen` | unverändert, **kein** Datumsfeld |
| `Re: Angebot Nr. 4711` | unverändert |
| `Rechnung 3/2026 faellig 15.03.` | `title: "Rechnung faellig 15.03."`, `scheduledDate: "2026-03-01"` |

Ungeprüft: ob eine Spracheinstellung die deutsche Erkennung aktiviert. Der letzte Fall bliebe
davon unberührt — das ist Zahlenerkennung, keine Sprachfrage.

### 8.1 `tasks.create` — gemessene Form (Task 0, echter Aufruf gegen den Staging-Vault)

Gemessen mit `scripts/probe-tasknotes-create.ts` gegen TaskNotes 4.12.5 im Staging-Vault
`mailstone` (sechs Aufrufe, danach wieder gelöscht — Messrückstand, kein Fixture).

**Akzeptierte Feldnamen:** `title` (einziges Pflichtfeld), `due` (String `YYYY-MM-DD`,
akzeptiert und im Ergebnis unverändert übernommen), `details` (Freitext-String, unverändert
übernommen — **das ist der Träger für den Notiz-Link**, s. u.). `dueDate` wird **nicht**
erkannt: der Aufruf wirft nicht, das Feld erscheint aber nirgends im Ergebnis — es verschwindet
kommentarlos. Fälligkeit heißt also `due`, nicht `dueDate`.

**Unbekannte Felder** (`gibtsNicht: 1`) werden **stillschweigend ignoriert** — kein Fehler, keine
Aufnahme ins Frontmatter, keine Auffälligkeit im Rückgabewert.

**Rückgabewert von `tasks.create`:** ein `object` (kein Promise-Wrapper, kein Boolean) — das
vollständige, von TaskNotes selbst befüllte Task-Objekt:

```
{ title, status: "open", priority: "normal", scheduled: "<heute>",
  due?: "<falls gesetzt>", dateCreated, dateModified, tags: ["task"],
  path: "TaskNotes/Tasks/<title>.md", archived: false, details: "<falls gesetzt>" }
```

Es gibt **kein eigenes `id`-Feld.** Die brauchbare Identität für einen Rückverweis ist
`path` — der vault-relative Pfad zur angelegten Notiz. Ein Wikilink auf die Aufgabe baut sich
daraus direkt (`path` ohne `.md`-Endung als Zielnotiz).

**Wurf- vs. Wert-Verhalten:** `tasks.create` liefert bei gültiger Eingabe immer einen Wert,
wirft aber bei **leerem Titel** synchron: `Error: Failed to create task: Title is required`
(Name `Error`, keine eigene Fehlerklasse). Die Brücke braucht also **beides** — try/catch für
den Titel-Fall, keine zusätzliche Ergebnisprüfung für alles andere, weil ein erfolgreicher aber
"leerer" Rückgabewert (`null`/`undefined`/`false`) nicht beobachtet wurde.

**Notiz-Link:** kein eigenes Feld dafür — `details` ist der Trageplatz. Ein Wikilink hineingegeben
(`details: "[[Mail/2026/probe]]"`) kommt unverändert im Rückgabewert und in der erzeugten Notiz
an; TaskNotes rendert `details` als Aufgaben-Beschreibung/Notizkörper.

**`model.validateTask` ist für Erstellung ungeeignet, nicht nur additiv:** gegen **jede** der
sechs `taskData`-Formen — auch die, mit denen `create()` anstandslos eine Aufgabe anlegte —
meldete `validateTask` dieselben drei `missing_required`-Fehler (`status`, `dateCreated`,
`dateModified`). Es prüft offenbar die Form eines **vollständigen** `TaskInfo`-Datensatzes, nicht
die eines Erstellungs-Auftrags — `create()` füllt diese drei Felder selbst mit sinnvollen
Defaults, bevor `validateTask` sie je sähe. Für M5 folgt daraus: **`validateTask` vor einem
`create()`-Aufruf ist nutzlos** (es würde jede gültige Eingabe als ungültig melden) und bleibt
nur für den in § 2.1 vorgesehenen Formcheck relevant (Existenz der Funktion), nicht als
Vorab-Validierung von Nutzereingaben. Einzige Ausnahme im leeren-Titel-Fall: dort meldet
`validateTask` zusätzlich `title is required` — dieselbe Diagnose, die `create()` ohnehin per
Wurf liefert.

---

## 9. Belege

**Unit** — die pure Hälfte: Formprüfung (inkl. der `hasCapability`-Falle als Regressionstest),
Aufbau von `taskData`, die adopt-Kette als Zustandsautomat mit allen Fehlerausgängen.

**GUI-Smoke** — Prüfpunkte mit Stub-API in `scripts/gui-smoke.ts`. ⚠️ Deren T-Punkte werden im
selben Zug **gehärtet**: Zustand herstellen (`disablePlugin` und zurück), nicht voraussetzen.
Sonst macht der Naht-Lauf sie still ungültig, sobald er TaskNotes echt installiert — der
gemessene Fall aus `epub-exporter` (2026-09-02).

**Naht-Lauf** — `scripts/e2e-crossplugin.ts`, `npm run smoke:e2e`, bewusst **nicht** Teil von
`gate` oder `smoke:gui`. Er setzt ein echt installiertes TaskNotes im Staging-Vault voraus und
ist die einzige Stelle, die belegen kann, dass die Aufgabe wirklich im Vault ankommt, welche
Form `taskData` verlangt und ob ein Fehlschlag als Wert oder als Ausnahme zurückkommt. Der Spy
auf der Anbieter-Methode **wrappt und reicht durch**, ersetzt nicht — sonst prüft er wieder nur
die eigene Hälfte.

**Baseline:** Vor dem Umbau der bestehenden Smoke-Punkte wird ein Lauf festgehalten. Wer den
Prüfling umbaut, kann „grün" sonst nicht von „anders grün" unterscheiden (Lesson 2026-08-18,
`apple-health`).
