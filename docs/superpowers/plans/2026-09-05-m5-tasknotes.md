# M5 TaskNotes-Kopplung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aus einer Mail wird auf Nutzerbefehl eine TaskNotes-Aufgabe — optional, defensiv, ohne dass mailstone jemals eine Aufgaben-Datei schreibt oder eine angelegte Aufgabe wieder anfasst.

**Architecture:** Drei Schichten, wie im Repo üblich. `src/core/**` bleibt obsidian-frei und formuliert nur die *Absicht* (ein neues deklaratives Feld `createTask` im `MailCommandPlan`, genau wie `openUrl` bei `mail.replyExternal`); `src/obsidian/tasknotes-bridge.ts` liest die fremde API defensiv und führt aus; die adopt-Kette für den Posteingang lebt als pure Zustandsmaschine neben `src/core/inbox/actions.ts`.

**Tech Stack:** TypeScript, esbuild, vitest, Obsidian Plugin API 1.13, TaskNotes 4.12.5 (`app.plugins.plugins.tasknotes.api`).

**Spec:** `docs/superpowers/specs/2026-09-05-m5-tasknotes-design.md` — der Plan argumentiert aus der Spec; Executor lesen beides.

## Global Constraints

- **`src/core/**` ist obsidian-/DOM-/node-frei.** `npm run check:pure` verbietet dort auch `process` und `window`. Die TaskNotes-API wird **nie** aus `src/core/**` angefasst — nur die Absicht wird dort formuliert.
- **Volles Gate ist `npm run gate`**, nicht `npm test`. Es umfasst Lint, drei Typprüfungen, Unit, **Integration**, `check:pure`, Build und Bundle-Test.
- **Typen kopieren statt importieren** (PROF-OBS-09), mit Herkunftsstempel in Zeile 1: `// uebernommen aus <repo>/<pfad>, <YYYY-MM-DD>`.
- **Kein `\Seen`:** lesende Pfade nutzen `EXAMINE`/`BODY.PEEK`. M5 fasst IMAP nur über die vorhandenen Aktionen an, ändert daran nichts.
- **Texte nach `src/i18n/strings.ts`** (UI-STANDARD §10), kein Fachbegriff ohne Auflösung. Der `core`-Teil bleibt sprachfrei: englischer Fallback + `…Key`.
- **Keine absoluten Maintainer-Pfade in tracked `*.md`** (CORE-META-14, `scripts/check-no-abs-paths.mjs` läuft in `npm test`).
- **Nach jedem Push auf `origin` gehört `git push github main` dazu** — der Mirror trägt für dieses Repo nicht.
- **Vor jedem Zugriff auf ein laufendes Obsidian:** CDP-Lock des Dachs nehmen (`obsidian-cdp-lock.py acquire --label mailstone --intent … --exclusive focus --ttl 300`), unmittelbar nach dem Lauf `release`. Ist er belegt: `acquire` im 3–5-Sekunden-Takt pollen, nicht `status`.

---

## File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `src/core/api/tasknotes-api.ts` | **Neu.** Kopierte Typen der fremden API + `TASKNOTES_API_VERSION`. Kein Verhalten. | 1 |
| `src/obsidian/tasknotes-bridge.ts` | **Neu.** Defensives Lesen + Formprüfung + Aufruf von `tasks.create`. Einziger Ort, der TaskNotes anfasst. | 1, 5 |
| `src/core/commands/schema.ts` | **Ändern.** Neues `format: "date"` für Stringfelder. | 3 |
| `src/obsidian/modals/schema-form-modal.ts` | **Ändern.** Datumsfeld rendern. | 3 |
| `src/core/commands/types.ts` | **Ändern.** `MailCommandPlan.createTask?`, drei neue `CommandErrorCode`. | 4 |
| `src/core/commands/create-task.ts` | **Neu.** Der Deskriptor `CREATE_TASK_COMMAND` (pure). | 4 |
| `src/core/commands/mail-commands.ts` | **Ändern.** Deskriptor registrieren. | 4 |
| `src/core/commands/execute.ts` | **Ändern.** Port `createTask` in `CommandExecuteDeps`, Aufruf in `executeCommandPlan`. | 5 |
| `src/core/inbox/create-task-flow.ts` | **Neu.** Die adopt-Kette als pure Zustandsmaschine. | 6 |
| `src/core/settings.ts` | **Ändern.** `taskPreset` beim Anlegen anwenden. | 7 |
| `src/obsidian/settings-tab.ts` | **Ändern.** UI für `taskPreset`. | 7 |
| `scripts/gui-smoke.ts` | **Ändern.** T-Punkte härten, neue Prüfpunkte. | 8 |
| `scripts/e2e-crossplugin.ts` | **Neu.** Naht-Lauf gegen echtes TaskNotes. | 9 |

---

## Task 0: Sondierung — die Form von `taskData` messen

> **Warum das zuerst kommt:** Die Spec § 3 hält ausdrücklich offen, welche Form `tasks.create` verlangt, was es zurückgibt und ob es wirft. `tasks.create` hat arity 2, mehr ist nicht bekannt. Jede Zeile Feldübersetzung, die vor dieser Messung entsteht, ist möglicher toter Code — und ein Deskriptor, der auf einer geratenen Form baut, ist beim ersten echten Aufruf falsch. **Dies ist eine Messung, kein Feature; es entsteht kein Produktionscode.**

**Files:**
- Create: `scripts/probe-tasknotes-create.ts` (wird in Task 9 zum Naht-Lauf ausgebaut oder gelöscht)
- Modify: `docs/superpowers/specs/2026-09-05-m5-tasknotes-design.md` (§ 8 ergänzen)

**Interfaces:**
- Consumes: nichts
- Produces: die gemessene Form von `taskData`, der Rückgabewert von `tasks.create`, und wie der Notiz-Link getragen wird. Tasks 4 und 5 bauen darauf.

- [ ] **Step 1: TaskNotes im Staging-Vault installieren**

Der Staging-Vault liegt unter `$STAGING_VAULTS_DIR/mailstone`; der Pfad wird über `stagingVaultDir("mailstone")` aus `../tools/obsidian-cdp/vault.js` aufgelöst, **nie** selbst zusammengesetzt. TaskNotes aus dem Pallas-Vault dorthin kopieren:

```bash
node -e '
const {stagingVaultDir}=require("../tools/obsidian-cdp/vault.js");
console.log(stagingVaultDir("mailstone"));'
```

Dann `.obsidian/plugins/tasknotes/` (manifest.json, main.js, styles.css) aus dem vorhandenen Vault dorthin kopieren und in `.obsidian/community-plugins.json` eintragen.

- [ ] **Step 2: Sondierungsskript schreiben**

```ts
// Sondierung fuer M5 Task 0 — laeuft NUR gegen den Staging-Vault, nie gegen einen Produktivvault.
import { attachTo } from "../../tools/obsidian-cdp/cdp.js";

async function main(): Promise<void> {
  const cdp = await attachTo("workspace", 9222, "mailstone");
  if (!cdp) throw new Error("kein Fenster fuer den Staging-Vault mailstone");
  const out = await cdp.evaluate<unknown>(`
    const api = app.plugins.plugins["tasknotes"].api;
    const versuche = [
      { was: "minimal", data: { title: "M5-Sondierung minimal" } },
      { was: "mit due", data: { title: "M5-Sondierung mit due", due: "2026-12-24" } },
      { was: "mit dueDate", data: { title: "M5-Sondierung mit dueDate", dueDate: "2026-12-24" } },
      { was: "mit details", data: { title: "M5-Sondierung mit details", details: "[[Mail/2026/probe]]" } },
      { was: "leerer Titel", data: { title: "" } },
      { was: "unbekanntes Feld", data: { title: "M5-Sondierung Fremdfeld", gibtsNicht: 1 } },
    ];
    const ergebnisse = [];
    for (const v of versuche) {
      let validate = null;
      try { validate = api.model.validateTask ? await api.model.validateTask(v.data) : "keine validateTask"; }
      catch (e) { validate = "THROW: " + e.message; }
      let create = null;
      try { const r = await api.tasks.create(v.data); create = { typ: typeof r, wert: r }; }
      catch (e) { create = "THROW: " + e.name + ": " + e.message; }
      ergebnisse.push({ was: v.was, validate, create });
    }
    return ergebnisse;
  `);
  console.log(JSON.stringify(out, null, 2));
  cdp.close();
}
main().catch((e: Error) => { console.error("FEHLER:", e.message); process.exit(1); });
```

- [ ] **Step 3: Lock nehmen und messen**

```bash
for i in $(seq 1 400); do
  python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label mailstone \
    --intent "M5 Task 0: tasks.create-Form messen" --exclusive focus --ttl 300 && break
  sleep 5
done
npx esbuild scripts/probe-tasknotes-create.ts --bundle --platform=node --format=esm \
  --outfile=.probe.mjs --log-level=warning && node .probe.mjs
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
```

- [ ] **Step 4: Die angelegten Sondierungs-Aufgaben aus dem Staging-Vault löschen**

Sie sind Messrückstand, kein Fixture. Der Vault ist Wegwerfware, aber ein Rückstand verfälscht spätere Zählungen im Naht-Lauf.

- [ ] **Step 5: Befund in die Spec eintragen**

§ 8 der Spec bekommt einen Unterabschnitt „`tasks.create` — gemessene Form" mit: akzeptierten Feldnamen, Rückgabewert, Wurf- statt Wert-Verhalten, und wie der Notiz-Link getragen wird. **Der Satz „Nicht gemessen und nur mit echtem Aufruf messbar" wird dabei ersetzt, nicht ergänzt** — sonst behauptet die Spec weiter eine Lücke, die geschlossen ist.

- [ ] **Step 6: Commit**

```bash
git add scripts/probe-tasknotes-create.ts docs/superpowers/specs/2026-09-05-m5-tasknotes-design.md
git commit -m "docs(spec): tasks.create-Form gemessen, Luecke aus Paragraph 8 geschlossen"
```

---

## Task 1: Typen und Brücke — Erreichbarkeit und Formprüfung

**Files:**
- Create: `src/core/api/tasknotes-api.ts`
- Create: `src/obsidian/tasknotes-bridge.ts`
- Test: `tests/obsidian/tasknotes-bridge.test.ts`

**Interfaces:**
- Consumes: die in Task 0 gemessene Form.
- Produces: `readTaskNotesApi(app): TaskNotesApiSubset | null` und `TASKNOTES_API_VERSION = 1`. Tasks 4, 5 und 6 benutzen beides.

- [ ] **Step 1: Typen mit Herkunftsstempel anlegen**

`src/core/api/tasknotes-api.ts` — reine Typen, kein Verhalten, damit `check:pure` zufrieden ist:

```ts
// uebernommen aus tasknotes 4.12.5 (app.plugins.plugins.tasknotes.api), 2026-09-05
// Nur die Teilmenge, die mailstone braucht. Nicht importiert, sondern kopiert: zwei
// eigenstaendige Repos gehen kein Build-Coupling ein (PROF-OBS-09); die Versionsnummer
// ersetzt den Compiler.
export const TASKNOTES_API_VERSION = 1;

export interface TaskNotesDefaults {
  status: string;
  priority: string;
  taskTag: string;
}

export interface TaskNotesConfig {
  defaults: TaskNotesDefaults;
  fieldMapping: Record<string, string>;
}

/** Feldnamen nach der Messung aus Task 0 einsetzen. */
export interface TaskNotesTaskInput {
  title: string;
  due?: string;
}

export interface TaskNotesApiSubset {
  apiVersion: number;
  tasks: { create(data: TaskNotesTaskInput, opts?: unknown): Promise<unknown> };
  model: {
    config(): Promise<TaskNotesConfig> | TaskNotesConfig;
    validateTask?(data: TaskNotesTaskInput): Promise<unknown> | unknown;
  };
}
```

- [ ] **Step 2: Den failing test schreiben**

`tests/obsidian/tasknotes-bridge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { readTaskNotesApi } from "../../src/obsidian/tasknotes-bridge";

function appMit(api: unknown): App {
  return { plugins: { plugins: { tasknotes: { api } } } } as unknown as App;
}

const gueltig = {
  apiVersion: 1,
  tasks: { create: () => Promise.resolve({}) },
  model: { config: () => ({ defaults: { status: "open", priority: "normal", taskTag: "task" }, fieldMapping: {} }) },
};

describe("readTaskNotesApi", () => {
  it("liefert die API, wenn Version und Form stimmen", () => {
    expect(readTaskNotesApi(appMit(gueltig))).not.toBeNull();
  });

  it("liefert null, wenn TaskNotes fehlt", () => {
    expect(readTaskNotesApi({ plugins: { plugins: {} } } as unknown as App)).toBeNull();
  });

  it("liefert null bei fremder apiVersion — strikt, nicht groesser-gleich", () => {
    expect(readTaskNotesApi(appMit({ ...gueltig, apiVersion: 2 }))).toBeNull();
  });

  it("liefert null, wenn tasks.create fehlt", () => {
    expect(readTaskNotesApi(appMit({ ...gueltig, tasks: {} }))).toBeNull();
  });

  it("liefert null, wenn model.config fehlt", () => {
    expect(readTaskNotesApi(appMit({ ...gueltig, model: {} }))).toBeNull();
  });

  // Regressionstest zum Messbefund vom 2026-09-05: hasCapability("tasks.create") liefert
  // FALSE, obwohl api.tasks.create existiert und funktioniert. Wer das als Gate einbaut,
  // erzeugt einen lautlosen Totalausfall — das Kommando erschiene nie.
  it("ignoriert hasCapability vollstaendig", () => {
    const mitFalscherCapability = { ...gueltig, hasCapability: (c: string) => c !== "tasks.create" };
    expect(readTaskNotesApi(appMit(mitFalscherCapability))).not.toBeNull();
  });

  it("akzeptiert eine API ohne optionales validateTask", () => {
    expect(readTaskNotesApi(appMit({ ...gueltig, model: { config: gueltig.model.config } }))).not.toBeNull();
  });
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/obsidian/tasknotes-bridge.test.ts`
Expected: FAIL — `readTaskNotesApi` existiert nicht.

- [ ] **Step 4: Brücke implementieren**

`src/obsidian/tasknotes-bridge.ts`:

```ts
// Bruecke zu TaskNotes. Muster: src/obsidian/calendar-notes-bridge.ts (koda-agent/
// src/obsidian/retrieval.ts als Ursprung). Bei JEDEM Aufruf frisch lesen — das
// Nachbarplugin kann mitten in der Sitzung deaktiviert werden.
import type { App } from "obsidian";
import { TASKNOTES_API_VERSION, type TaskNotesApiSubset } from "../core/api/tasknotes-api";

const PLUGIN_ID = "tasknotes";

interface AppWithPlugins {
  plugins?: { plugins?: Record<string, { api?: unknown } | undefined> };
}

function isTaskNotesApi(v: unknown): v is TaskNotesApiSubset {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const tasks = o.tasks as Record<string, unknown> | undefined;
  const model = o.model as Record<string, unknown> | undefined;
  // hasCapability wird bewusst NICHT gefragt. Gemessen am 2026-09-05 gegen 4.12.5:
  // hasCapability("tasks.create") === false, waehrend api.tasks.create funktioniert
  // (tasks.write sagt true). Die Capability-Strings sind nicht systematisch — jeder aus
  // einem Methodennamen abgeleitete String ist unzuverlaessig. typeof ist die haltbare
  // Pruefung. Details: docs/superpowers/specs/2026-09-05-m5-tasknotes-design.md Paragraph 2.2
  return (
    o.apiVersion === TASKNOTES_API_VERSION &&
    typeof tasks?.create === "function" &&
    typeof model?.config === "function"
  );
}

/** Defensives Lesen der fremden API. `null` heisst: Faehigkeit nicht anbieten. */
export function readTaskNotesApi(app: App): TaskNotesApiSubset | null {
  const api = (app as unknown as AppWithPlugins).plugins?.plugins?.[PLUGIN_ID]?.api;
  return isTaskNotesApi(api) ? api : null;
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `npx vitest run tests/obsidian/tasknotes-bridge.test.ts`
Expected: PASS, 7 Tests.

- [ ] **Step 6: `check:pure` prüfen**

Run: `npm run check:pure`
Expected: OK — `src/core/api/tasknotes-api.ts` enthält nur Typen und eine Konstante.

- [ ] **Step 7: Commit**

```bash
git add src/core/api/tasknotes-api.ts src/obsidian/tasknotes-bridge.ts tests/obsidian/tasknotes-bridge.test.ts
git commit -m "feat(tasknotes): defensive Bruecke mit strikter Formpruefung"
```

---

## Task 2: `format: "date"` im Schema und im Formular

> Der Kopfkommentar von `src/core/commands/schema.ts` sagt heute: *„kein Format `date-time` — kein mailstone-Kommando nimmt ein Datum entgegen."* `mail.createTask` ist das erste. **Der Kommentar wird mitgezogen** — sonst behauptet die Datei etwas Falsches über sich selbst.

**Files:**
- Modify: `src/core/commands/schema.ts`
- Modify: `src/obsidian/modals/schema-form-modal.ts`
- Test: `tests/core/commands/schema.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `{ type: "string"; format: "date" }` als Feldschema; leerer String bleibt zulässig (Fälligkeit ist optional).

- [ ] **Step 1: Den failing test schreiben**

An `tests/core/commands/schema.test.ts` anhängen:

```ts
describe("format: date", () => {
  const schema = { type: "object" as const, properties: { due: { type: "string" as const, format: "date" as const } } };

  it("akzeptiert ein ISO-Datum", () => {
    expect(validateInput(schema, { due: "2026-12-24" }).ok).toBe(true);
  });

  it("akzeptiert den leeren String — Faelligkeit ist optional", () => {
    expect(validateInput(schema, { due: "" }).ok).toBe(true);
  });

  it("lehnt ein Datum in falscher Form ab", () => {
    const r = validateInput(schema, { due: "24.12.2026" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("due");
  });

  it("lehnt ein unmoegliches Datum ab", () => {
    expect(validateInput(schema, { due: "2026-02-31" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/commands/schema.test.ts`
Expected: FAIL — `format: "date"` ist kein zulässiger Wert (Typfehler bzw. der falsche Wert wird akzeptiert).

- [ ] **Step 3: Schema erweitern**

In `src/core/commands/schema.ts` den Union-Zweig ergänzen — `format?: "email" | "uri" | "multiline" | "date"` — und in `checkFormat`:

```ts
function checkFormat(field: string, format: "email" | "uri" | "multiline" | "date", value: string, errors: string[]): void {
  if (format === "email" && !value.includes("@")) errors.push(`${field}: not a valid e-mail address`);
  // Leer = nicht gesetzt; ein optionales Datum darf leer bleiben.
  if (format === "date" && value !== "" && !isIsoDate(value)) errors.push(`${field}: must be a date (YYYY-MM-DD)`);
}

/** YYYY-MM-DD und ein Datum, das es wirklich gibt — `2026-02-31` faellt durch. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
```

Und den Kopfkommentar der Datei korrigieren: aus „(b) kein Format `date-time` — kein mailstone-Kommando nimmt ein Datum entgegen" wird „(b) `format: date` statt `date-time` — `mail.createTask` nimmt eine Fälligkeit als reines Datum entgegen (M5, 2026-09-05)."

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/core/commands/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Datumsfeld im Formular rendern**

In `src/obsidian/modals/schema-form-modal.ts` den String-Zweig um `format === "date"` erweitern: ein `input[type=date]` statt eines Textfelds; der Wert bleibt der ISO-String, den das Schema erwartet.

- [ ] **Step 6: Gate laufen lassen**

Run: `npm run gate`
Expected: grün.

- [ ] **Step 7: Commit**

```bash
git add src/core/commands/schema.ts src/obsidian/modals/schema-form-modal.ts tests/core/commands/schema.test.ts
git commit -m "feat(schema): Format date fuer optionale Faelligkeiten"
```

---

## Task 3: Plan-Feld und Fehlercodes

**Files:**
- Modify: `src/core/commands/types.ts`
- Test: keine eigenen — die Typen werden in Task 4 und 5 belegt.

**Interfaces:**
- Produces: `MailCommandPlan.createTask?: { title: string; due: string | null; noteLink: string }` und die Codes `tasknotes-unavailable`, `task-invalid`, `task-create-failed`.

- [ ] **Step 1: Feld und Codes ergänzen**

In `CommandErrorCode` nach `"no-recipient"` einfügen:

```ts
  | "tasknotes-unavailable"    // TaskNotes fehlt oder die Formpruefung ist durchgefallen
  | "task-invalid"             // model.validateTask hat die Eingabe abgelehnt
  | "task-create-failed"       // tasks.create hat abgelehnt oder geworfen
```

In `MailCommandPlan` nach `openUrl`:

```ts
  /** Absicht: eine TaskNotes-Aufgabe anlegen (mail.createTask). Analog zu `openUrl` — der
   *  Kern formuliert nur, ausgefuehrt wird in der Obsidian-Schicht, weil src/core/** die
   *  fremde API nicht anfassen darf. Feldnamen nach der Messung aus Task 0. */
  createTask?: { title: string; due: string | null; noteLink: string };
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck && npm run typecheck:test`
Expected: grün (die Felder sind optional, nichts Bestehendes bricht).

- [ ] **Step 3: Commit**

```bash
git add src/core/commands/types.ts
git commit -m "feat(commands): Plan-Feld createTask und drei Fehlercodes"
```

---

## Task 4: Der Deskriptor `mail.createTask` (pure)

**Files:**
- Create: `src/core/commands/create-task.ts`
- Modify: `src/core/commands/mail-commands.ts`
- Test: `tests/core/commands/create-task.test.ts`

**Interfaces:**
- Consumes: `MailCommandPlan.createTask` aus Task 3, `fmKeyFor` aus `../mirror/profile`.
- Produces: `CREATE_TASK_COMMAND: CommandDescriptor` mit `id: "mail.createTask"`.

- [ ] **Step 1: Den failing test schreiben**

`tests/core/commands/create-task.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CREATE_TASK_COMMAND } from "../../../src/core/commands/create-task";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { CommandContext } from "../../../src/core/commands/types";

const profile = defaultMailProfile();

function ctx(fm: Record<string, unknown>, mailId = "a@x"): CommandContext {
  return {
    now: new Date("2026-09-05T08:00:00Z"), profile,
    target: { mailId, path: "Mail/2026/x.md", source: "acc/Vault", state: "live" },
    content: "", frontmatter: { mail_id: mailId, ...fm }, zoneHash: null,
    linkFor: () => null, attachmentPathFor: (n) => `Anhaenge/${n}`,
  };
}

describe("CREATE_TASK_COMMAND", () => {
  it("uebernimmt den Betreff als Titel", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "Angebot pruefen", due: "" }, ctx({ subject: "Angebot pruefen" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.createTask?.title).toBe("Angebot pruefen");
  });

  it("traegt die Faelligkeit als ISO-Datum ein", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "X", due: "2026-12-24" }, ctx({ subject: "X" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.createTask?.due).toBe("2026-12-24");
  });

  it("macht aus einer leeren Faelligkeit null, nicht den leeren String", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "X", due: "" }, ctx({ subject: "X" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.createTask?.due).toBeNull();
  });

  it("verlinkt die Mail-Notiz ueber ihren Pfad", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "X", due: "" }, ctx({ subject: "X" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.createTask?.noteLink).toContain("Mail/2026/x");
  });

  it("schreibt NICHTS ins Vault", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "X", due: "" }, ctx({ subject: "X" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.notes).toEqual([]);
      expect(r.plan.diff).toEqual([]);
      expect(r.plan.attachment).toBeUndefined();
    }
  });

  it("lehnt einen leeren Titel ab", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "   ", due: "" }, ctx({ subject: "X" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid-input");
  });

  it("lehnt ein Datum in falscher Form ab", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "X", due: "24.12.2026" }, ctx({ subject: "X" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid-input");
  });

  it("gilt fuer jede Mail-Notiz — die TaskNotes-Pruefung sitzt in der Obsidian-Schicht", () => {
    expect(CREATE_TASK_COMMAND.appliesTo({ profile, target: ctx({}).target, frontmatter: { mail_id: "a@x" } })).toBe(true);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/commands/create-task.test.ts`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 3: Deskriptor implementieren**

`src/core/commands/create-task.ts` — Muster ist `reply.ts`. Das Schema trägt `title` (`minLength: 1`, required) und `due` (`format: "date"`, optional). `plan()` validiert über `validateInput`, liest den Betreff über `fmKeyFor(ctx.profile, "subject")` als Vorbelegung, baut `createTask` und gibt `diff: []`, `notes: []` zurück.

**`appliesTo` prüft TaskNotes NICHT** — `src/core/**` darf die fremde API nicht kennen. Prüfstelle 1 sitzt in der Obsidian-Schicht (Task 5).

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/core/commands/create-task.test.ts`
Expected: PASS, 8 Tests.

- [ ] **Step 5: Deskriptor registrieren**

In `src/core/commands/mail-commands.ts` importieren und ans Ende von `MAIL_COMMANDS` setzen (Reihenfolge = Anzeigereihenfolge).

- [ ] **Step 6: `check:pure` und Gate**

Run: `npm run check:pure && npm run gate`
Expected: grün.

- [ ] **Step 7: Commit**

```bash
git add src/core/commands/create-task.ts src/core/commands/mail-commands.ts tests/core/commands/create-task.test.ts
git commit -m "feat(commands): mail.createTask als reiner Deskriptor"
```

---

## Task 5: Port, Ausführung und Verdrahtung

**Files:**
- Modify: `src/core/commands/execute.ts`
- Modify: `src/obsidian/tasknotes-bridge.ts`
- Modify: `src/main.ts`, `src/obsidian/command-flow.ts`
- Modify: `src/i18n/strings.ts`
- Test: `tests/core/commands/execute.test.ts`, `tests/obsidian/tasknotes-bridge.test.ts`

**Interfaces:**
- Consumes: `MailCommandPlan.createTask` (Task 3), `readTaskNotesApi` (Task 1).
- Produces: Port `createTask(req): Promise<{ ok: true } | { ok: false; code: CommandErrorCode }>` in `CommandExecuteDeps`; `createTaskViaBridge(app, req)` in der Brücke.

- [ ] **Step 1: Den failing test für den Port schreiben**

An `tests/core/commands/execute.test.ts` anhängen — mindestens diese vier Fälle:

```ts
describe("createTask im Plan", () => {
  it("ruft den Port mit den Plandaten", async () => { /* Spy-Port, erwartet title/due/noteLink */ });
  it("meldet task-create-failed, wenn der Port ablehnt", async () => { /* Port liefert ok:false */ });
  it("meldet task-create-failed, wenn der Port wirft", async () => { /* Fehler sind Werte, Spec Paragraph 5 */ });
  it("gibt den Busy-Guard auch dann frei, wenn der Port wirft", async () => { /* finally-Zweig */ });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/commands/execute.test.ts`
Expected: FAIL — `createTask` ist kein Feld von `CommandExecuteDeps`.

- [ ] **Step 3: Port in `execute.ts` ergänzen**

`CommandExecuteDeps` bekommt:

```ts
  /** Legt eine Aufgabe im Nachbarplugin an. Async, anders als openExternal: der Aufruf
   *  geht ueber eine fremde API und kann fehlschlagen. */
  createTask(req: { title: string; due: string | null; noteLink: string }): Promise<{ ok: true } | { ok: false; code: CommandErrorCode }>;
```

In `executeCommandPlan` **nach** den Notizen und **vor** `openUrl`:

```ts
    if (plan.createTask) {
      const t = await deps.createTask(plan.createTask);
      if (!t.ok) return { ok: false, code: t.code };
    }
```

Das umgebende `try/catch` macht aus einem werfenden Port bereits einen Wert; ergänze im `catch` nichts Neues — `write-failed` wäre hier der falsche Code, deshalb wirft die Brücke selbst nicht (Step 4).

- [ ] **Step 4: `createTaskViaBridge` in der Brücke implementieren**

```ts
/** Fuehrt die Absicht aus. Wirft NIE — die Zusage gehoert der Seite, die sie gibt, nicht
 *  jedem Aufrufer einzeln (REGISTRY, Anbieter-Muster). Prueft die Form ein zweites Mal:
 *  zwischen dem Anbieten des Kommandos und diesem Aufruf liegt beliebig viel Zeit. */
export async function createTaskViaBridge(
  app: App,
  req: { title: string; due: string | null; noteLink: string },
): Promise<{ ok: true } | { ok: false; code: "tasknotes-unavailable" | "task-invalid" | "task-create-failed" }> {
  const api = readTaskNotesApi(app);
  if (!api) return { ok: false, code: "tasknotes-unavailable" };
  const data = buildTaskInput(req); // Feldnamen aus der Messung in Task 0
  try {
    if (typeof api.model.validateTask === "function") {
      const v = await api.model.validateTask(data);
      if (istAblehnung(v)) return { ok: false, code: "task-invalid" };
    }
    await api.tasks.create(data);
    return { ok: true };
  } catch {
    return { ok: false, code: "task-create-failed" };
  }
}
```

- [ ] **Step 5: Tests für die Brücke ergänzen**

Vier Fälle: Erfolg; `tasknotes-unavailable` wenn die API fehlt; `task-invalid` wenn `validateTask` ablehnt; `task-create-failed` wenn `create` wirft. Dazu einer, der belegt, dass die **zweite** Formprüfung greift (API verschwindet zwischen Anbieten und Aufruf).

- [ ] **Step 6: Prüfstelle 1 verdrahten**

In der Obsidian-Schicht, die Kommandos anbietet (`src/obsidian/command-flow.ts` / `src/main.ts`): `mail.createTask` wird nur angeboten, wenn `readTaskNotesApi(app) !== null`. Fällt die Prüfung durch, **fehlt das Kommando** — es erscheint nicht ausgegraut.

- [ ] **Step 7: Texte nach `src/i18n/strings.ts`**

`cmd.mail.createTask.title`, `cmd.mail.createTask.desc`, `plan.mail.createTask.summary` sowie Notice-Texte für die drei neuen Fehlercodes — deutsch und englisch, kein Fachbegriff ohne Auflösung.

- [ ] **Step 8: Gate**

Run: `npm run gate`
Expected: grün.

- [ ] **Step 9: Commit**

```bash
git add src/core/commands/execute.ts src/obsidian/tasknotes-bridge.ts src/main.ts src/obsidian/command-flow.ts src/i18n/strings.ts tests/
git commit -m "feat(tasknotes): Port, Ausfuehrung und zwei Pruefstellen"
```

---

## Task 6: Der Posteingangs-Weg — adopt-Kette

> Die Kette lebt **neben** dem Deskriptor-Rahmen, wie `adoptMessage`/`archiveMessage`: eine Mail ohne Notiz hat keinen `MailTarget`-Pfad. Der Beleg für „die Notiz ist da" ist der Index-Treffer, **nicht** die Rückmeldung des Sync-Laufs — ein Lauf kann fehlerfrei enden, ohne dass genau diese Notiz entstanden ist.

**Files:**
- Create: `src/core/inbox/create-task-flow.ts`
- Test: `tests/core/inbox/create-task-flow.test.ts`
- Modify: `src/obsidian/views/inbox-panel.ts`, `src/obsidian/views/inbox-host.ts`

**Interfaces:**
- Consumes: `adoptMessage` + `InboxActionDeps` aus `./actions`, `SyncService.syncAccount`.
- Produces: `createTaskFromInbox(deps, req): Promise<CreateTaskFlowResult>`.

- [ ] **Step 1: Den failing test schreiben**

`tests/core/inbox/create-task-flow.test.ts` — die Kette hat fünf Ausgänge, jeder bekommt einen Test:

```ts
describe("createTaskFromInbox", () => {
  it("uebernimmt, synct gezielt und meldet erst dann die Notiz", async () => { /* Happy path */ });
  it("bricht ab, wenn das Uebernehmen scheitert — ohne zu synchronisieren", async () => { /* adopt: ok:false */ });
  it("meldet sync-timeout, wenn die Notiz binnen der Frist nicht erscheint", async () => { /* pollUntil laeuft aus */ });
  it("meldet, dass die Uebernahme BESTEHEN BLEIBT, wenn die Frist reisst", async () => { /* adopted: true im Ergebnis */ });
  it("stoesst den Sync gezielt fuer das Konto an, nicht syncAll", async () => { /* Spy auf syncAccount */ });
});
```

Der vierte Test ist der wichtige: die Übernahme ist auf dem Server passiert und **nicht rückgängig zu machen**. Wer das Ergebnis nur als Fehlschlag meldet, verleitet zum zweiten Übernehmen.

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/inbox/create-task-flow.test.ts`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 3: Die Kette implementieren**

```ts
export type CreateTaskFlowResult =
  | { ok: true; notePath: string }
  | { ok: false; code: InboxActionCode | "sync-timeout"; detail: string; adopted: boolean };

export interface CreateTaskFlowDeps extends InboxActionDeps {
  syncAccount(accountId: string): Promise<unknown>;
  /** Notizpfad zur Message-ID, oder null. Synchron aus dem Index. */
  notePathFor(mailId: string): string | null;
  /** Wartet, bis `pruefen` true liefert oder die Frist reisst. */
  pollUntil(pruefen: () => boolean, fristMs: number): Promise<boolean>;
}
```

Ablauf: `adoptMessage` → bei Fehlschlag `adopted: false` zurück → `syncAccount` → `pollUntil(() => notePathFor(mailId) !== null, 30_000)` → bei Ablauf `sync-timeout` mit `adopted: true`.

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/core/inbox/create-task-flow.test.ts`
Expected: PASS, 5 Tests.

- [ ] **Step 5: Im Posteingang verdrahten**

In `src/obsidian/views/inbox-panel.ts` eine dritte Aktion je Zeile — **nur** wenn `readTaskNotesApi(app) !== null`. Nach erfolgreicher Kette dasselbe Modal wie im Notiz-Weg. Bei `sync-timeout` sagt die Notice ausdrücklich, dass die Mail übernommen wurde und die Aufgabe fehlt.

- [ ] **Step 6: Gate**

Run: `npm run gate`
Expected: grün.

- [ ] **Step 7: Commit**

```bash
git add src/core/inbox/create-task-flow.ts src/obsidian/views/ tests/core/inbox/create-task-flow.test.ts
git commit -m "feat(inbox): Aufgabe aus dem Posteingang mit belegter adopt-Kette"
```

---

## Task 7: `taskPreset` beleben

> Das Feld steht seit M1 in `MailstoneSettings` und im Default — und wird an **null** Stellen gelesen oder geschrieben (gemessen 2026-09-05). Es ist der Weg für Vaults **ohne** TaskNotes.

**Files:**
- Modify: `src/core/settings.ts` bzw. der `onCreate`-Pfad in `src/core/mirror/`
- Modify: `src/obsidian/settings-tab.ts`
- Test: `tests/core/mirror/` (beim vorhandenen `onCreate`-Test)

**Interfaces:**
- Consumes: `MailstoneSettings.taskPreset`.
- Produces: nichts für andere Tasks.

- [ ] **Step 1: Den failing test schreiben**

```ts
describe("taskPreset", () => {
  it("schreibt die Preset-Felder beim ERSTEN Anlegen ins Frontmatter", () => { /* create-Plan traegt status: open */ });
  it("fasst sie bei einem spaeteren Lauf nicht wieder an", () => { /* update-Plan laesst sie unberuehrt */ });
  it("ueberschreibt einen vom Nutzer geaenderten Wert nicht", () => { /* Nutzer hat status: done gesetzt */ });
  it("tut bei leerem Preset gar nichts", () => { /* Default */ });
});
```

Der dritte Test trägt die Zusage „danach Nutzer-Feld".

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Expected: FAIL — das Preset wird nirgends angewandt.

- [ ] **Step 3: Preset im `onCreate`-Pfad anwenden**

Nur im `create`-Zweig, nie im `update`-Zweig. **Keine Logik darauf** — die Kommandos berühren diese Felder nie.

- [ ] **Step 4: Tests laufen lassen**

Expected: PASS, 4 Tests.

- [ ] **Step 5: Settings-UI ergänzen**

In `src/obsidian/settings-tab.ts` ein Feld zum Pflegen des Presets, nach dem UI-STANDARD (Obsidian-native Komponenten, Theme-CSS-Variablen). Erklärtext nach §10 in `src/i18n/strings.ts`; Default bleibt leer.

- [ ] **Step 6: Gate**

Run: `npm run gate`
Expected: grün.

- [ ] **Step 7: Commit**

```bash
git add src/core/ src/obsidian/settings-tab.ts src/i18n/strings.ts tests/
git commit -m "feat(settings): taskPreset belebt — der Weg ohne TaskNotes"
```

---

## Task 8: GUI-Smoke — Baseline, Härtung, neue Prüfpunkte

> ⚠️ **Reihenfolge ist hier der Inhalt.** Wer den Prüfling umbaut, braucht eine Baseline: ein grüner Lauf danach ist ohne festgehaltenen Lauf davor nicht von „anders grün" zu unterscheiden (Lesson 2026-08-18, `apple-health`).

**Files:**
- Modify: `scripts/gui-smoke.ts`
- Modify: `docs/SMOKE.md`

- [ ] **Step 1: Baseline festhalten**

```bash
for i in $(seq 1 400); do
  python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label mailstone \
    --intent "M5 Task 8: GUI-Smoke Baseline" --exclusive focus --ttl 300 && break
  sleep 5
done
npm run smoke:gui 2>&1 | tee /tmp/m5-smoke-baseline.txt
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
```

Erwartet: 15/15 wie im Stand vom 2026-09-03. Weicht das ab, **erst** klären — nicht überbauen.

- [ ] **Step 2: Bestehende T-Punkte härten**

Jeder Prüfpunkt, der „TaskNotes ist nicht da" voraussetzt, muss diesen Zustand **herstellen** (`disablePlugin` und danach zurück), nicht annehmen. Sonst macht Task 9 sie still ungültig, sobald er TaskNotes echt installiert — der gemessene Fall aus `epub-exporter` (2026-09-02): ein Prüfpunkt lief gegen ein echtes Plugin und wurde rot, aussehend wie ein Produktfehler.

- [ ] **Step 3: Neue Prüfpunkte mit Stub-API**

Mindestens: (a) ohne TaskNotes fehlt das Kommando; (b) mit Stub-API erscheint es; (c) das Modal zeigt Titel und Fälligkeit; (d) nach Bestätigung wird `tasks.create` am Stub gerufen; (e) der Posteingang zeigt die dritte Aktion nur mit TaskNotes.

- [ ] **Step 4: Gegenprobe je Prüfpunkt**

Jeder neue Prüfpunkt wird **einzeln** rot gemacht (Zusage brechen, rot sehen, zurück). Ein Prüfpunkt ohne Gegenprobe bewacht womöglich nichts (Lesson 2026-08-15, `vault-rag`).

- [ ] **Step 5: Lauf gegen die Baseline halten**

Run: `npm run smoke:gui` (mit Lock)
Expected: 15 alte + 5 neue grün, und die 15 alten aus demselben Grund wie in der Baseline.

- [ ] **Step 6: `docs/SMOKE.md` nachziehen und committen**

```bash
git add scripts/gui-smoke.ts docs/SMOKE.md
git commit -m "test(smoke): fuenf Pruefpunkte fuer M5, T-Punkte gehaertet"
```

---

## Task 9: Naht-Lauf gegen echtes TaskNotes

> Beide Halbe-Seite-Smokes prüfen mit Stubs je ihre Hälfte — **die Grenze selbst prüft dann niemand** (gemessener Preis, `llm-lab` 2026-08-24). Dieser Lauf ist die einzige Stelle, die belegt, dass die Aufgabe wirklich im Vault ankommt.

**Files:**
- Create: `scripts/e2e-crossplugin.ts` (baut auf `scripts/probe-tasknotes-create.ts` aus Task 0 auf)
- Modify: `package.json` (`"smoke:e2e"`), `docs/SMOKE.md`, `README.md`

- [ ] **Step 1: Skript schreiben**

Setzt ein echt installiertes TaskNotes im Staging-Vault voraus (Task 0, Step 1). Prüfpunkte: (a) das Kommando erscheint; (b) `tasks.create` wird mit den erwarteten Feldern gerufen; (c) **die Aufgabe liegt danach wirklich als Datei im Vault**, mit Titel und Fälligkeit; (d) der Notiz-Link ist darin auffindbar; (e) ein Fehlschlag kommt als **Wert** zurück, nicht als Ausnahme; (f) ohne TaskNotes fehlt das Kommando (`disablePlugin`, danach zurück).

Der Spy auf `api.tasks.create` **wrappt und reicht durch**, ersetzt nicht — sonst prüft der Lauf wieder nur die eigene Hälfte.

- [ ] **Step 2: In `package.json` eintragen**

```json
"smoke:e2e": "esbuild scripts/e2e-crossplugin.ts --bundle --platform=node --format=esm --outfile=.e2e.mjs --log-level=warning && node .e2e.mjs"
```

**Nicht** in `gate` und **nicht** in `smoke:gui` aufnehmen — der Lauf setzt ein zweites Plugin voraus und gehört deshalb nicht in die Pflichtstrecke.

- [ ] **Step 3: Lauf fahren (mit Lock)**

Expected: alle Prüfpunkte grün. Weicht die gemessene Form von dem ab, was Task 0 ergeben hat, **ist Task 0 die Wahrheit und der Code zieht nach** — nicht umgekehrt.

- [ ] **Step 4: Gegenprobe**

Mindestens Prüfpunkt (c) und (e) einzeln rot machen.

- [ ] **Step 5: Sondierungsskript aufräumen**

`scripts/probe-tasknotes-create.ts` löschen, falls es nicht in `e2e-crossplugin.ts` aufgegangen ist. Ein Messskript, das niemand mehr fährt, sieht beim nächsten Leser wie ein Werkzeug aus.

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e-crossplugin.ts package.json docs/SMOKE.md README.md
git rm --ignore-unmatch scripts/probe-tasknotes-create.ts
git commit -m "test(e2e): Naht-Lauf gegen echt installiertes TaskNotes"
```

---

## Task 10: Die Abweichung dokumentieren — mit Rückkopplung an `calendar-notes`

> ⚠️ **Diese Task hat eine Zusage an eine andere Session: die Formulierung geht vor dem Commit an `calendar-notes` zurück** (zugesagt am 2026-09-05). Sie ist keine Formalie — die REGISTRY-Zeile ist deren Exemplar, und wir präzisieren sie.

**Files:**
- Modify: `../REGISTRY.md` (Dach), `../../_docs/LESSONS.md`, `AGENTS.md`, `CHANGELOG.md`

- [ ] **Step 1: Die Präzisierung formulieren**

Achse ist **wer nach dem Aufruf die Wahrheit hält**, nicht „einmalig vs. laufend" — sonst liest der nächste Leser „ich rufe ja nur selten" als Freibrief. Kern: *Wer fortlaufend spiegelt, führt mit `tasks.*` einen Bestand, dessen Wahrheit anderswo liegt — das ist Verwaltung und bleibt verboten. Wer einmal übergibt und losläßt (kein Rückverweis, kein späterer Zugriff), delegiert an die Quelle — das ist erlaubt und von der Dach-Regel sogar verlangt.*

- [ ] **Step 2: Formulierung an `calendar-notes` schicken und Antwort abwarten**

`ListAgents`, dann `SendMessage`. **Nicht committen, bevor die Antwort da ist.** Kommt keine (Session beendet), wird das im Commit vermerkt: „`calendar-notes` nicht erreichbar, Formulierung ohne Gegenlesen".

- [ ] **Step 3: REGISTRY-Zeile ergänzen**

In `../REGISTRY.md`, § Plugin-zu-Plugin, an der Zeile „Ein Fremdplugin OHNE Vertrag als Datenquelle konsumieren" — die Präzisierung mit Datum, beiden Exemplaren (`calendar-notes` spiegelnd, `mailstone` delegierend) und dem `hasCapability`-Messbefund.

- [ ] **Step 4: LESSONS-Eintrag schreiben**

In `../../_docs/LESSONS.md` § 🟢 Aktiv. **Form beachten: Regel unter 500 Zeichen, Status ist nur der Enum-Wert.** Inhalt: die Achse „wer hält die Wahrheit" plus der `hasCapability`-Befund als eigenständige Warnung (aus einem Methodennamen abgeleitete Capability-Strings sind unzuverlässig).

- [ ] **Step 5: Repo-Doku nachziehen**

`AGENTS.md` bekommt einen Abschnitt zur TaskNotes-Kopplung (wo die Brücke sitzt, dass `hasCapability` bewusst ungenutzt bleibt, dass eine zweite Verwendungsstelle von `tasks.*` hier einzutragen ist). `CHANGELOG.md` unter `## [Unreleased]`.

- [ ] **Step 6: Commit und Push auf BEIDE Remotes**

```bash
git add AGENTS.md CHANGELOG.md && git commit -m "docs(tasknotes): Abweichung und hasCapability-Befund festhalten"
git push origin main && git push github main
git ls-remote github main   # verifizieren — der Mirror traegt hier nicht
```

Dach und `_docs` sind **eigene Repos** und werden dort separat committet und gepusht.

---

## Self-Review

**Spec-Abdeckung:** § 2 Brücke → Task 1; § 2.1 Formprüfung → Task 1; § 2.2 `hasCapability` → Task 1 (Regressionstest) + Task 10 (LESSONS); § 3 Notiz-Weg → Tasks 2–5; § 3 offene `taskData`-Form → **Task 0**; § 4 adopt-Kette → Task 6; § 5 `taskPreset` → Task 7; § 6 Nicht-Ziele → keine Task (korrekt); § 7 Abweichung → Task 10; § 8 Messanhang → Task 0 ergänzt ihn; § 9 Belege → Tasks 8 und 9.

**Offene Abhängigkeit, bewusst so gebaut:** Tasks 1, 4 und 5 tragen die Feldnamen aus Task 0. Deshalb steht Task 0 vorn und deshalb sagt Task 9 Step 3 ausdrücklich, dass die Messung die Wahrheit ist und der Code nachzieht.

**Typkonsistenz geprüft:** `readTaskNotesApi` (T1) → `createTaskViaBridge` (T5) → Port `createTask` in `CommandExecuteDeps` (T5) → Planfeld `createTask` (T3) → `CREATE_TASK_COMMAND` (T4). Die Feldnamen `title` / `due` / `noteLink` sind in allen fünf Stellen dieselben; `due` ist durchgehend `string | null` (nie `""`).
