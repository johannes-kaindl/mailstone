---
paths:
  - "src/obsidian/tasknotes-bridge.ts"
  - "src/core/api/tasknotes-api.ts"
  - "src/core/commands/create-task.ts"
  - "src/core/inbox/create-task-flow.ts"
  - "scripts/e2e-crossplugin.ts"
---

# TaskNotes-Kopplung — eine deklarierte Abweichung von der Dach-REGISTRY

Gotchas zur Kopplung an das Nachbarplugin TaskNotes.

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
REGISTRY-Präzisierung: Spec Vault-Cockpit `_SDD/2026-09-05-m5-tasknotes-design.md` § 7.

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
