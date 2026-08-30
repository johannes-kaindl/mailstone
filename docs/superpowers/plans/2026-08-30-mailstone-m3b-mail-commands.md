# mailstone M3b — Vault-Kommandos · Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Mail-Notiz im Vault bekommt vier ausdrückliche Nutzer-Kommandos — sie aus ihrer lokalen `.eml` neu rendern (`mail.rerender`), Thread-Bezüge zu Wikilinks machen (`mail.relink`), einen Anhang in den Vault holen (`mail.extractAttachment`) und im externen Mailclient beantworten (`mail.replyExternal`) — jedes mit Vorschau vor dem Schreiben und ohne dass der Hintergrund-Sync dabei ins Gehege kommt.

**Architecture:** Ein Kommando ist ein **Deskriptor** (`{id, schema, appliesTo(probe), plan(input, ctx)}`) in `src/core/commands/`, der aus einem `CommandContext` einen `MailCommandPlan` erzeugt — einen Wert, der noch nichts geschrieben hat. Geschrieben wird ausschließlich in `executeCommandPlan()`, und zwar über den schon vorhandenen `PlanExecutor` aus M1/M3: die Notiz-Änderungen sind gewöhnliche `NotePlan`, es gibt keinen zweiten Schreibweg in den Vault. Die Obsidian-Schicht baut den Kontext, zeigt Formular und Vorschau und übersetzt Codes in Sätze.

**Tech Stack:** wie M1–M3; keine neuen Laufzeit-Abhängigkeiten. Mini-JSON-Schema (flache Untermenge, kein `ajv`) als Übernahme aus `calendar-notes`.

**Spec:** `docs/superpowers/specs/2026-08-23-mailstone-design.md` (§ 2.2 Die Mail-Notiz samt Merge-Regeln, § 3.2 Kommandos, § 5 Fehlerbehandlung)

**Vorgänger:** `docs/superpowers/plans/2026-08-30-mailstone-m3-imap-sync.md` (Sync, `core/mirror`, `BusyGuard`, `PlanExecutor` — dieser Plan baut direkt darauf auf)

**Nicht in diesem Plan:** die **Server**-Kommandos `mail.adopt`/`mail.archive` (sie brauchen eine schreibende IMAP-Verbindung mit `SELECT`/`UID MOVE` — das ist M4, zusammen mit der View), `mail.createTask` (M5, hängt an der TaskNotes-API) und jede Massenaktion mit Vorauswahl (Spec § 3.2 schließt sie ausdrücklich aus). Der Rahmen, den dieser Plan baut, ist so geschnitten, dass M4 seine zwei Kommandos nur noch als Deskriptoren dazulegt.

## Global Constraints

- Alle Constraints aus M1–M3 gelten weiter. Insbesondere:
  - `src/core/**` bleibt frei von `obsidian`-, Node- und DOM-Imports (`npm run check:pure`). Alles, was der Vault weiß oder kann, kommt als Port in den Kontext bzw. in die Executor-Deps.
  - Keine Inline-ESLint-disables (`scripts/check-no-inline-disables.mjs`); repo-eigene Regeln nur in `eslint.overrides.mjs`.
  - Übernahme aus einem Nachbar-Repo bekommt in Zeile 1 den Herkunftsstempel `// uebernommen aus <repo>/<pfad>, 2026-08-30` (Dach-`AGENTS.md`, Kit-first Punkt 1).
  - Conventional Commits; ein Commit pro Task-Ende.
  - `src/core/**`-Kommentare bleiben ASCII (Repo-Konvention: `uebernommen`, `faellig`); Markdown-Dokumente tragen Umlaute.
- **Kein Kommando schreibt ohne Bestätigung.** Zwischen `plan()` und `executeCommandPlan()` steht immer eine Vorschau. Das ist keine Höflichkeit, sondern die Gegenprobe zu Merge-Regel 5 der Spec § 2.2: `mail.rerender` ist der einzige Weg zu `allowUpdate: true` außerhalb des Import-Kommandos, also der einzige Weg, auf dem das Plugin eine bestehende Notiz überschreibt.
- **Der Busy-Guard ist geteilt.** `executeCommandPlan()` nimmt denselben `BusyGuard` wie der `SyncService` (`src/core/sync/busy.ts`, `MailstonePlugin.busy`). Läuft ein Sync, liefert ein Kommando `{ok:false, code:"busy"}` — und umgekehrt.
- **Fehler sind Werte.** Jede Kern-Funktion liefert `{ok:false, code}` statt zu werfen; übersetzt wird erst in `src/obsidian` über `error.command.<code>`. Kein `throw` als Kontrollfluss.
- **Die Zone ist tabu, außer für `mail.rerender`.** `relink`, `extractAttachment` und `replyExternal` fassen den Bereich zwischen `%% mailstone:begin %%` und `%% mailstone:end %%` nicht an.
- **`mail_source` und `mail_state` sind für Kommandos schreibgeschützt.** Ein Kommando übernimmt beide unverändert aus der Notiz. Begründung in Task 3 — sie wiegt schwerer, als sie aussieht.
- **i18n:** Kern trägt Schlüssel plus englischen Fallback-Text, übersetzt wird in `src/obsidian/command-i18n.ts`. Neue Keys kommen in `src/i18n/strings.ts` in **EN und DE**; Task 8 sichert das mit einem Paritätstest über den echten Kommando-Satz ab.
- **UI:** `UI-STANDARD.md` § 8 gilt. Für Bestätigungsdialoge ist das Confirm-Modal verbindlich (Cancel links, Bestätigen rechts im `modal-button-container`, `mod-cta` bei nicht-destruktiven Aktionen) — das vendorte `src/vendor/kit-obsidian/confirm.ts` ist da, die Vorschau in Task 7 folgt derselben Knopf-Grammatik.
- Der Meilenstein gilt als erledigt, wenn `npm run gate` grün ist **und** die Live-Probe aus Task 9 in `docs/SMOKE.md` protokolliert ist.

---

## Dateistruktur (M3b, neu bzw. geändert)

```
src/core/commands/schema.ts          Mini-JSON-Schema + validateInput      (Übernahme calendar-notes)
src/core/commands/types.ts           CommandContext, MailCommandPlan, CommandDescriptor, CommandErrorCode
src/core/commands/registry.ts        registerCommands / ensureDefaultCommands / commandsFor  (Übernahme)
src/core/commands/execute.ts         executeCommandPlan(plan, deps) — Busy-Guard, Ports, Reihenfolge
src/core/commands/diff.ts            diffFrontmatter(before, after) für die Vorschau-Tabelle
src/core/commands/eml.ts             emlPathFor(profile, notePath) + verifyEml(mail, expectedId)
src/core/commands/zone.ts            keepZoneHash(content, stored) — Hash-Umgang ohne Zonenaenderung
src/core/commands/rerender.ts        RERENDER_COMMAND
src/core/commands/relink.ts          relinkOne / relinkValues (pure) + RELINK_COMMAND
src/core/commands/extract.ts         attachmentLink (pure) + EXTRACT_ATTACHMENT_COMMAND
src/core/commands/reply.ts           buildMailtoUrl (pure) + REPLY_EXTERNAL_COMMAND
src/core/commands/mail-commands.ts   MAIL_COMMANDS = [rerender, relink, extract, reply]
src/core/merge/merge.ts              + mergeFrontmatterOnly(existing, values)   (nutzt readFm/rewriteFm)
src/core/mime/headers.ts             + addressOf(formatted)  (Umkehrung zu formatAddress)
src/obsidian/command-i18n.ts         tr / trTitle / trDescription / trPlan / trSchema (Übernahme)
src/obsidian/command-flow.ts         contextFor(app, …) + runCommand(...)  — Kontext bauen, Kette fahren
src/obsidian/modals/schema-form-modal.ts   Formular aus ObjectSchema
src/obsidian/modals/plan-preview-modal.ts  Zusammenfassung + Diff-Tabelle + Ausführen/Abbrechen
src/obsidian/vault-notes.ts          + writeAttachment(app) (Binärdatei anlegen, Ordner sicherstellen)
src/main.ts                          + ensureDefaultCommands() + ein addCommand je Deskriptor
src/i18n/strings.ts                  + cmd.*/plan.*/error.command.*/form.* Keys (EN kanonisch + DE)
tests/helpers/memory-vault.ts        + fileManager.getAvailablePathForAttachment
tests/core/commands/*.test.ts · tests/obsidian/command-flow.test.ts · tests/i18n/commands.test.ts
```

### Warum der Plan nicht der `CommandPlan` aus calendar-notes ist

Der Deskriptor-Rahmen wird übernommen, der **Plan-Typ nicht**. `calendar-notes`' `CommandPlan` trägt `newRaw`, `hrefForPut`, `etag`, `contentType` — jedes Feld ein CalDAV-PUT. mailstones Kommandos schreiben in den Vault, und dafür existiert seit M1 bereits ein Plan-Typ, der die Merge-Regeln kennt: `NotePlan`. `MailCommandPlan` ist deshalb eine dünne Hülle um `NotePlan[]` plus zwei Sonderfälle, die keine Notiz sind (eine Binärdatei, eine zu öffnende URL). Der Ertrag ist konkret: die Kommandos erben `zone-edited`, `fences-missing` und `frontmatter-unparseable` samt Verhalten, statt eine zweite Fassung davon zu bauen.

---

## Task 1: Kommando-Rahmen — Schema, Typen, Registry

**Files:**
- Create: `src/core/commands/schema.ts`
- Create: `src/core/commands/types.ts`
- Create: `src/core/commands/registry.ts`
- Create: `src/core/commands/mail-commands.ts`
- Test: `tests/core/commands/schema.test.ts`, `tests/core/commands/registry.test.ts`

**Interfaces:**
- Consumes: `MailProfile` (`src/core/mirror/profile.ts`), `NotePlan` (`src/core/mirror/plan.ts`), `ParsedMail` (`src/core/mime/types.ts`)
- Produces: `ObjectSchema`, `FieldSchema`, `validateInput(schema, input)`, `CommandProbe`, `CommandContext`, `MailTarget`, `MailNoteRef`, `MailCommandPlan`, `PlanResult`, `CommandErrorCode`, `CommandDescriptor`, `registerCommands`, `ensureDefaultCommands`, `resetCommands`, `commandRegistry`, `findCommand`, `commandsFor`, `schemaOf(descriptor, ctx)`, `MAIL_COMMANDS`

`src/core/commands/schema.ts` ist eine Übernahme aus `calendar-notes/src/core/commands/schema.ts` mit **zwei Abweichungen**, die im Kopfkommentar stehen müssen: die Fehlertexte sind englisch (mailstones Kern ist durchgehend englisch/sprachfrei — vgl. `FENCE_MARKER_REPLACEMENT` in `core/render/body.ts`), und das Format `date-time` entfällt samt seiner Regex, weil kein mailstone-Kommando ein Datum entgegennimmt. Der Rest bleibt Zeile für Zeile gleich, damit die spätere Kit-Extraktion (REGISTRY-Zeile „Schreib-Kommandos als Deskriptoren mit JSON-Schema", bisher n=1) zwei vergleichbare Instanzen vorfindet.

- [ ] **Step 1: Schema-Modul anlegen**

```typescript
// uebernommen aus calendar-notes/src/core/commands/schema.ts, 2026-08-30
// Mini-JSON-Schema: flache Untermenge fuer Kommando-Eingaben. Zwei Abweichungen von der
// Vorlage: (a) Fehlertexte englisch, weil mailstones core durchgehend sprachfrei ist;
// (b) kein Format "date-time" — kein mailstone-Kommando nimmt ein Datum entgegen.
export type FieldSchema =
  | { type: "string"; format?: "email" | "uri" | "multiline"; enum?: string[]; minLength?: number; description?: string; descriptionKey?: string }
  | { type: "number"; minimum?: number; maximum?: number; description?: string; descriptionKey?: string }
  | { type: "boolean"; description?: string; descriptionKey?: string }
  | { type: "array"; items: { type: "string"; format?: "email" }; description?: string; descriptionKey?: string };

export interface ObjectSchema {
  type: "object";
  properties: Record<string, FieldSchema>;
  required?: string[];
}

export type ValidationResult = { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] };

function checkFormat(field: string, format: "email" | "uri" | "multiline", value: string, errors: string[]): void {
  if (format === "email" && !value.includes("@")) errors.push(`${field}: not a valid e-mail address`);
}

function checkField(field: string, schema: FieldSchema, value: unknown, errors: string[]): void {
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") { errors.push(`${field}: must be a string`); return; }
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${field}: too short (min. ${schema.minLength})`);
      if (schema.enum && !schema.enum.includes(value)) errors.push(`${field}: must be one of [${schema.enum.join(", ")}]`);
      if (schema.format) checkFormat(field, schema.format, value, errors);
      break;
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) { errors.push(`${field}: must be a number`); return; }
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${field}: below minimum ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${field}: above maximum ${schema.maximum}`);
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") errors.push(`${field}: must be a boolean`);
      break;
    }
    case "array": {
      if (!Array.isArray(value)) { errors.push(`${field}: must be an array`); return; }
      value.forEach((item, i) => {
        if (typeof item !== "string") { errors.push(`${field}[${i}]: must be a string`); return; }
        if (schema.items.format) checkFormat(`${field}[${i}]`, schema.items.format, item, errors);
      });
      break;
    }
  }
}

export function validateInput(schema: ObjectSchema, input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["input is not an object"] };
  const o = input as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(o, key) || o[key] === undefined) errors.push(`${key}: missing (required)`);
  }
  for (const [key, value] of Object.entries(o)) {
    const fieldSchema = schema.properties[key];
    if (!fieldSchema) { errors.push(`${key}: unknown field`); continue; }
    if (value === undefined) continue;
    checkField(key, fieldSchema, value, errors);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: o };
}

export const EMPTY_SCHEMA: ObjectSchema = { type: "object", properties: {} };
```

- [ ] **Step 2: Typen anlegen**

```typescript
import type { ParsedMail } from "../mime/types";
import type { NotePlan } from "../mirror/plan";
import type { MailProfile } from "../mirror/profile";
import type { ObjectSchema } from "./schema";
import { EMPTY_SCHEMA } from "./schema";

export type CommandErrorCode =
  | "busy"                     // Sync oder ein anderes Kommando haelt den Guard
  | "invalid-input"            // Schema-Validierung fehlgeschlagen
  | "not-applicable"           // appliesTo() sagt nein (Doppelpruefung vor dem Ausfuehren)
  | "eml-missing"              // keine .eml am Konventionspfad
  | "eml-unparseable"          // parseEml hat geworfen
  | "eml-mismatch"             // die .eml gehoert zu einer ANDEREN Mail als die Notiz
  | "fences-missing"           // Zone fehlt (Merge-Regel 3)
  | "zone-edited"              // Zone von Hand geaendert (Merge-Regel 4)
  | "frontmatter-unparseable"  // verwalteter Key liegt als Block-Skalar vor (Merge-Regel 2)
  | "attachment-missing"       // gewaehlter Anhang liegt nicht in der .eml
  | "no-recipient"             // keine Absenderadresse zum Antworten
  | "nothing-to-do"            // Plan waere leer — nichts zu schreiben
  | "write-failed";            // Schreibvorgang gescheitert

/** Die Notiz, auf die ein Kommando wirkt. */
export interface MailTarget {
  mailId: string;
  path: string;
  /** Wert von `profile.sourceField` — wird von Kommandos NIE geaendert, nur weitergereicht. */
  source: string;
  /** Wert von `profile.stateField` (`live` | `detached` | null bei Altbestand). */
  state: string | null;
}

/** Eine Mail-Notiz samt Inhalt — nur Kommandos mit `needs.allNotes` bekommen die Liste.
 *  `frontmatter` kommt aus dem Metadata-Cache (nicht aus dem yaml_lite-Parser: der Cache ist
 *  Obsidians eigene Lesart und kennt Formen, die yaml_lite nicht kennt); `zoneHash` ist der
 *  GESPEICHERTE Hash aus dem Plugin-Zustand, null wenn keiner vorliegt. */
export interface MailNoteRef {
  mailId: string;
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  zoneHash: string | null;
}

/**
 * Was `appliesTo()` braucht — und nur das. Synchron aus dem Metadata-Cache zu haben.
 * `checkCallback` laeuft bei JEDEM Oeffnen der Kommandopalette fuer JEDES registrierte
 * Kommando und muss synchron antworten; dort die Notiz zu lesen, eine .eml zu parsen und
 * Anhangpfade aufzuloesen waere unverhaeltnismaessig. Der volle Kontext entsteht erst,
 * wenn das Kommando wirklich laeuft (s. src/obsidian/command-flow.ts).
 */
export interface CommandProbe {
  profile: MailProfile;
  target: MailTarget;
  /** Frontmatter der Zielnotiz aus dem Metadata-Cache. */
  frontmatter: Record<string, unknown>;
}

export interface CommandContext extends CommandProbe {
  now: Date;
  /** Roher Inhalt der Zielnotiz. */
  content: string;
  /** Gespeicherter Zone-Hash der Zielnotiz (null = unbekannt, z. B. Altbestand). */
  zoneHash: string | null;
  /** mail_id -> Notizpfad OHNE Endung; null, wenn es die Notiz nicht gibt. */
  linkFor(id: string): string | null;
  /** Zielpfad fuer eine Anlage im Anhangordner des Vaults (Port: getAvailablePathForAttachment). */
  attachmentPathFor(name: string): string;
  /** Nur gefuellt bei `needs.eml` — geparste und gegen `target.mailId` geprueft (s. eml.ts). */
  mail?: ParsedMail;
  /** Nur gefuellt bei `needs.allNotes`. */
  notes?: readonly MailNoteRef[];
}

export interface MailCommandPlan {
  commandId: string;
  mailId: string;
  /** ENGLISCHER Fallback-Text, aus denselben Argumenten komponiert wie `summaryArgs`. */
  summary: string;
  summaryKey: string;
  summaryArgs: (string | number)[];
  diff: { field: string; before?: string; after?: string }[];
  /** Notiz-Schreibvorgaenge — ausgefuehrt vom vorhandenen PlanExecutor aus M1/M3. */
  notes: NotePlan[];
  /** Genau eine Binaerdatei (mail.extractAttachment). */
  attachment?: { path: string; data: Uint8Array };
  /** Extern zu oeffnende URL (mail.replyExternal). */
  openUrl?: string;
}

export type PlanResult = { ok: true; plan: MailCommandPlan } | { ok: false; code: CommandErrorCode };

export interface CommandDescriptor {
  id: string;
  /** ENGLISCHER Fallback + i18n-Key; aufgeloest erst in src/obsidian/command-i18n.ts. */
  title: string;
  titleKey: string;
  description: string;
  descriptionKey: string;
  schema: ObjectSchema;
  /** Kontextabhaengiges Schema — Abweichung von calendar-notes, gebraucht fuer die
   *  Anhangliste als enum. Default ist `schema`; s. schemaOf(). */
  schemaFor?(ctx: CommandContext): ObjectSchema;
  /** Was `plan()` braucht. Die Obsidian-Schicht laedt NUR das — eine .eml zu parsen oder
   *  jede Mail-Notiz zu lesen kostet, und `appliesTo()` laeuft bei JEDEM Oeffnen der
   *  Kommandopalette (checkCallback). */
  needs?: { eml?: true; allNotes?: true };
  /** Bekommt bewusst nur den `CommandProbe`, nicht den vollen Kontext — s. dort. */
  appliesTo(probe: CommandProbe): boolean;
  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult;
}

/** Das wirksame Schema eines Deskriptors in DIESEM Kontext. */
export function schemaOf(descriptor: CommandDescriptor, ctx: CommandContext): ObjectSchema {
  return descriptor.schemaFor ? descriptor.schemaFor(ctx) : descriptor.schema;
}

export { EMPTY_SCHEMA };
```

- [ ] **Step 3: Registry anlegen**

```typescript
// uebernommen aus calendar-notes/src/core/commands/registry.ts, 2026-08-30
// Kommandos registrieren sich als Arrays (keine Seiteneffekte beim Import); der Aufrufer
// (src/main.ts oder ein Test) baut das Register per ensureDefaultCommands() auf.
import { MAIL_COMMANDS } from "./mail-commands";
import type { CommandDescriptor, CommandProbe } from "./types";

let registered: CommandDescriptor[] = [];

export function registerCommands(cmds: CommandDescriptor[]): void {
  const seen = new Set(registered.map((c) => c.id));
  for (const c of cmds) {
    if (seen.has(c.id)) throw new Error(`Doppelte Kommando-ID: ${c.id}`);
    seen.add(c.id);
  }
  registered = [...registered, ...cmds];
}

/** Befuellt die Registry mit dem eingebauten Satz — IDEMPOTENT. Ein blindes
 *  registerCommands([...]) wuerfe beim zweiten Aufruf (Plugin-Reload im selben Prozess);
 *  und wer den Aufruf ganz vergisst, bekommt eine leere Registry und Kommandos, die es
 *  nirgends gibt (der Fall, den calendar-notes 2026-08-23 erst im GUI-Smoke bemerkte). */
export function ensureDefaultCommands(): void {
  const ids = new Set(registered.map((c) => c.id));
  const missing = MAIL_COMMANDS.filter((c) => !ids.has(c.id));
  if (missing.length > 0) registerCommands(missing);
}

export function resetCommands(): void {
  registered = [];
}

export function commandRegistry(): CommandDescriptor[] {
  return [...registered];
}

export function findCommand(id: string): CommandDescriptor | undefined {
  return registered.find((c) => c.id === id);
}

export function commandsFor(probe: CommandProbe): CommandDescriptor[] {
  return registered.filter((c) => c.appliesTo(probe));
}
```

- [ ] **Step 4: Leeres Kommando-Bündel anlegen (wird in Task 3–6 gefüllt)**

```typescript
import type { CommandDescriptor } from "./types";

/** Der eingebaute Kommando-Satz. Reihenfolge = Anzeigereihenfolge. */
export const MAIL_COMMANDS: CommandDescriptor[] = [];
```

- [ ] **Step 5: Tests schreiben**

`tests/core/commands/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateInput, type ObjectSchema } from "../../../src/core/commands/schema";

const schema: ObjectSchema = {
  type: "object",
  properties: {
    name: { type: "string", enum: ["a.pdf", "b.ics"] },
    count: { type: "number", minimum: 1 },
    flag: { type: "boolean" },
    list: { type: "array", items: { type: "string", format: "email" } },
  },
  required: ["name"],
};

describe("validateInput", () => {
  it("nimmt eine gueltige Eingabe an", () => {
    expect(validateInput(schema, { name: "a.pdf" })).toEqual({ ok: true, value: { name: "a.pdf" } });
  });

  it("meldet einen fehlenden Pflichtwert", () => {
    const r = validateInput(schema, {});
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.errors[0]).toContain("missing (required)");
  });

  it("meldet einen Wert ausserhalb des enum", () => {
    const r = validateInput(schema, { name: "c.txt" });
    expect(r.ok === false && r.errors[0]).toContain("must be one of");
  });

  it("meldet ein unbekanntes Feld statt es durchzulassen", () => {
    const r = validateInput(schema, { name: "a.pdf", nope: 1 });
    expect(r.ok === false && r.errors[0]).toContain("unknown field");
  });

  it("prueft Array-Elemente einzeln", () => {
    const r = validateInput(schema, { name: "a.pdf", list: ["ok@example.net", "kaputt"] });
    expect(r.ok === false && r.errors[0]).toContain("list[1]");
  });

  it("weist eine Nicht-Objekt-Eingabe ab", () => {
    expect(validateInput(schema, ["a"])).toEqual({ ok: false, errors: ["input is not an object"] });
  });
});
```

`tests/core/commands/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { registerCommands, resetCommands, commandRegistry, findCommand, commandsFor } from "../../../src/core/commands/registry";
import { EMPTY_SCHEMA, type CommandDescriptor, type CommandProbe } from "../../../src/core/commands/types";

function descriptor(id: string, applies: boolean): CommandDescriptor {
  return {
    id, title: id, titleKey: `cmd.${id}.title`, description: "", descriptionKey: `cmd.${id}.desc`,
    schema: EMPTY_SCHEMA,
    appliesTo: () => applies,
    plan: () => ({ ok: false, code: "nothing-to-do" }),
  };
}

const probe = {} as CommandProbe;

describe("Kommando-Registry", () => {
  beforeEach(() => { resetCommands(); });

  it("registriert und findet ein Kommando", () => {
    registerCommands([descriptor("mail.x", true)]);
    expect(findCommand("mail.x")?.id).toBe("mail.x");
    expect(commandRegistry()).toHaveLength(1);
  });

  it("wirft bei doppelter ID", () => {
    registerCommands([descriptor("mail.x", true)]);
    expect(() => { registerCommands([descriptor("mail.x", true)]); }).toThrow(/Doppelte Kommando-ID/);
  });

  it("commandsFor filtert ueber appliesTo", () => {
    registerCommands([descriptor("mail.ja", true), descriptor("mail.nein", false)]);
    expect(commandsFor(probe).map((c) => c.id)).toEqual(["mail.ja"]);
  });

  it("commandRegistry liefert eine Kopie, kein Handle auf den Zustand", () => {
    registerCommands([descriptor("mail.x", true)]);
    commandRegistry().pop();
    expect(commandRegistry()).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Tests laufen lassen**

Run: `npx vitest run tests/core/commands`
Expected: PASS (10 Tests).

- [ ] **Step 7: check:pure und Typecheck**

Run: `npm run check:pure && npm run typecheck && npm run typecheck:test`
Expected: beide grün — `src/core/commands/**` importiert nichts aus `obsidian`/Node.

- [ ] **Step 8: Commit**

```bash
git add src/core/commands tests/core/commands
git commit -m "feat(commands): Deskriptor-Rahmen mit Mini-JSON-Schema und Registry"
```

---

## Task 2: Ausführung — `executeCommandPlan` mit Busy-Guard und Ports

**Files:**
- Create: `src/core/commands/execute.ts`
- Test: `tests/core/commands/execute.test.ts`

**Interfaces:**
- Consumes: `MailCommandPlan`, `CommandErrorCode` (Task 1), `BusyGuard` (`src/core/sync/busy.ts`), `PlanExecutor`/`PlanExecutionResult` (`src/core/mirror/execute.ts`)
- Produces: `CommandExecuteDeps`, `CommandExecuteResult`, `executeCommandPlan(plan, deps)`

Die Reihenfolge im Erfolgsfall ist **Anhang zuerst, dann Notizen, dann URL** — und das ist keine Geschmacksfrage: `mail.extractAttachment` schreibt einen Wikilink in die Notiz, der auf die Datei zeigt. Liefe es andersherum und der Schreibvorgang der Datei scheiterte, stünde ein toter Link in der Notiz und Obsidian böte an, die Datei anzulegen.

- [ ] **Step 1: Test schreiben (schlägt fehl, das Modul gibt es noch nicht)**

```typescript
import { describe, it, expect, vi } from "vitest";
import { executeCommandPlan, type CommandExecuteDeps } from "../../../src/core/commands/execute";
import { createBusyGuard } from "../../../src/core/sync/busy";
import type { MailCommandPlan } from "../../../src/core/commands/types";
import type { NotePlan } from "../../../src/core/mirror/plan";

const update: NotePlan = { kind: "update", path: "Mail/2026/x.md", content: "neu", mailId: "a@x", zoneHash: "h" };

function plan(over: Partial<MailCommandPlan> = {}): MailCommandPlan {
  return {
    commandId: "mail.rerender", mailId: "a@x",
    summary: "Note re-rendered", summaryKey: "plan.mail.rerender.summary", summaryArgs: [],
    diff: [], notes: [update], ...over,
  };
}

function deps(over: Partial<CommandExecuteDeps> = {}): CommandExecuteDeps {
  return {
    busy: createBusyGuard(),
    notes: { execute: vi.fn(async () => ({ created: 0, updated: 1, skipped: [], stateChanged: 0, errors: [] })) },
    writeAttachment: vi.fn(async () => undefined),
    openExternal: vi.fn(),
    ...over,
  };
}

describe("executeCommandPlan", () => {
  it("fuehrt die Notiz-Plaene ueber den PlanExecutor aus", async () => {
    const d = deps();
    const r = await executeCommandPlan(plan(), d);
    expect(r).toMatchObject({ ok: true, updated: 1 });
    expect(d.notes.execute).toHaveBeenCalledWith([update]);
  });

  it("bricht ab, wenn der Busy-Guard belegt ist — und schreibt nichts", async () => {
    const busy = createBusyGuard();
    busy.tryAcquire();
    const d = deps({ busy });
    expect(await executeCommandPlan(plan(), d)).toEqual({ ok: false, code: "busy" });
    expect(d.notes.execute).not.toHaveBeenCalled();
  });

  it("gibt den Guard auch frei, wenn der Executor wirft", async () => {
    const busy = createBusyGuard();
    const d = deps({ busy, notes: { execute: vi.fn(async () => { throw new Error("kaputt"); }) } });
    expect(await executeCommandPlan(plan(), d)).toEqual({ ok: false, code: "write-failed" });
    expect(busy.isBusy()).toBe(false);
  });

  it("schreibt den Anhang VOR den Notizen", async () => {
    const order: string[] = [];
    const d = deps({
      writeAttachment: vi.fn(async () => { order.push("attachment"); }),
      notes: { execute: vi.fn(async () => { order.push("notes"); return { created: 0, updated: 1, skipped: [], stateChanged: 0, errors: [] }; }) },
    });
    const r = await executeCommandPlan(plan({ attachment: { path: "Anhaenge/a.pdf", data: new Uint8Array([1]) } }), d);
    expect(order).toEqual(["attachment", "notes"]);
    expect(r).toMatchObject({ ok: true, attachmentPath: "Anhaenge/a.pdf" });
  });

  it("laesst die Notizen unberuehrt, wenn der Anhang nicht geschrieben werden kann", async () => {
    const d = deps({ writeAttachment: vi.fn(async () => { throw new Error("voll"); }) });
    expect(await executeCommandPlan(plan({ attachment: { path: "Anhaenge/a.pdf", data: new Uint8Array([1]) } }), d)).toEqual({ ok: false, code: "write-failed" });
    expect(d.notes.execute).not.toHaveBeenCalled();
  });

  it("oeffnet die URL erst nach den Schreibvorgaengen", async () => {
    const order: string[] = [];
    const d = deps({
      openExternal: vi.fn(() => { order.push("open"); }),
      notes: { execute: vi.fn(async () => { order.push("notes"); return { created: 0, updated: 0, skipped: [], stateChanged: 0, errors: [] }; }) },
    });
    await executeCommandPlan(plan({ notes: [], openUrl: "mailto:a@example.net" }), d);
    expect(order).toEqual(["notes", "open"]);
  });

  it("meldet einen Fehler aus dem PlanExecutor als write-failed", async () => {
    const d = deps({ notes: { execute: vi.fn(async () => ({ created: 0, updated: 0, skipped: [], stateChanged: 0, errors: [{ plan: update, message: "kaputt" }] })) } });
    expect(await executeCommandPlan(plan(), d)).toEqual({ ok: false, code: "write-failed" });
  });

  it("reicht uebersprungene Plaene durch, statt sie als Fehler zu melden", async () => {
    const skipped: NotePlan = { kind: "skip", path: "Mail/2026/x.md", mailId: "a@x", reason: "zone-edited" };
    const d = deps({ notes: { execute: vi.fn(async () => ({ created: 0, updated: 0, skipped: [skipped], stateChanged: 0, errors: [] })) } });
    const r = await executeCommandPlan(plan(), d);
    expect(r).toMatchObject({ ok: true, skipped: [skipped] });
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/commands/execute.test.ts`
Expected: FAIL — `Failed to resolve import "…/src/core/commands/execute"`.

- [ ] **Step 3: Modul schreiben**

```typescript
import type { BusyGuard } from "../sync/busy";
import type { PlanExecutor } from "../mirror/execute";
import type { NotePlan } from "../mirror/plan";
import type { CommandErrorCode, MailCommandPlan } from "./types";

export interface CommandExecuteDeps {
  /** Derselbe Guard wie im SyncService — ein laufender Sync und ein Kommando schliessen
   *  einander aus, egal wer zuerst kam. */
  busy: BusyGuard;
  notes: PlanExecutor;
  writeAttachment(path: string, data: Uint8Array): Promise<void>;
  openExternal(url: string): void;
}

export type CommandExecuteResult =
  | { ok: true; created: number; updated: number; stateChanged: number; skipped: NotePlan[]; attachmentPath?: string }
  | { ok: false; code: CommandErrorCode };

/**
 * Der EINZIGE Ort, an dem ein Kommando etwas schreibt. Reihenfolge: Anhang, Notizen, URL —
 * s. Task-Kommentar im Plan (ein toter Wikilink ist schlimmer als ein nicht extrahierter
 * Anhang). Der Guard wird im finally freigegeben, auch wenn ein Port wirft.
 */
export async function executeCommandPlan(plan: MailCommandPlan, deps: CommandExecuteDeps): Promise<CommandExecuteResult> {
  if (!deps.busy.tryAcquire()) return { ok: false, code: "busy" };
  try {
    if (plan.attachment) {
      await deps.writeAttachment(plan.attachment.path, plan.attachment.data);
    }
    const r = await deps.notes.execute(plan.notes);
    if (r.errors.length > 0) return { ok: false, code: "write-failed" };
    if (plan.openUrl) deps.openExternal(plan.openUrl);
    return {
      ok: true,
      created: r.created,
      updated: r.updated,
      stateChanged: r.stateChanged,
      skipped: r.skipped,
      ...(plan.attachment ? { attachmentPath: plan.attachment.path } : {}),
    };
  } catch {
    // Fehler sind Werte (Spec § 5): ein werfender Port wird zum Code, nicht zum Stacktrace.
    return { ok: false, code: "write-failed" };
  } finally {
    deps.busy.release();
  }
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/core/commands/execute.test.ts`
Expected: PASS (8 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/commands/execute.ts tests/core/commands/execute.test.ts
git commit -m "feat(commands): executeCommandPlan mit geteiltem Busy-Guard"
```

---

## Task 3: `mail.rerender` — Notiz aus der lokalen `.eml` neu bauen

**Files:**
- Create: `src/core/commands/eml.ts`
- Create: `src/core/commands/diff.ts`
- Create: `src/core/commands/rerender.ts`
- Modify: `src/core/commands/mail-commands.ts`
- Test: `tests/core/commands/eml.test.ts`, `tests/core/commands/rerender.test.ts`

**Interfaces:**
- Consumes: `CommandContext`, `PlanResult`, `CommandDescriptor` (Task 1); `buildDerivedFrontmatter` (`core/render/frontmatter.ts`), `renderMessageBlock` (`core/render/body.ts`), `mergeNote` (`core/merge/merge.ts`), `splitBody`/`zoneHash` (`core/merge/fences.ts`), `managedKeys` (`core/mirror/profile.ts`)
- Produces: `emlPathFor(profile, notePath)`, `verifyEml(mail, expectedId)`, `diffFrontmatter(before, after, keys)`, `RERENDER_COMMAND`

**Zwei Dinge, die dieses Kommando nicht anfasst — und warum das der wichtigste Satz dieses Tasks ist.**

`mail_source` und `mail_state` werden aus der Notiz übernommen, nie neu bestimmt. Bei `mail_state` ist es offensichtlich (eine abgelöste Notiz darf durch ein Re-Render nicht wieder `live` heißen). Bei `mail_source` ist es der teurere Fall: `planSync()` in `core/mirror/apply.ts` prüft `entry.source !== input.source` und lässt jede Notiz mit fremder Herkunft in Ruhe. Würde `mail.rerender` die Herkunft neu setzen — etwa auf einen Import-Wert —, wäre die Notiz für ihren Sync-Lauf ab sofort unsichtbar: sie bekäme nie wieder `detached`, wenn die Mail den Allowlist-Ordner verlässt. Der Schaden entstünde still und fiele erst Wochen später auf.

**Wie die `.eml` gefunden wird.** Über die Ablagekonvention aus Spec § 2.2, relativ zum **tatsächlichen** Ort der Notiz: `Mail/2026/x.md` → `Mail/2026/_eml/x.eml`. Das deckt auch `yearSubfolder: false` ab, weil die Formel den Profil-Ordner gar nicht braucht. Sie bricht, wenn der Nutzer die Notiz verschoben oder umbenannt hat — dann meldet das Kommando `eml-missing` statt zu raten. **Gefunden ist nicht geprüft:** die geparste `.eml` muss dieselbe `mail_id` tragen wie die Notiz, sonst `eml-mismatch`. Ohne diesen Riegel würde eine falsch benannte Datei die Notiz mit dem Inhalt einer fremden Mail überschreiben — und das ist genau der Vorgang, der laut Merge-Regel 5 sonst nirgends erlaubt ist.

- [ ] **Step 1: Tests für `eml.ts` und `diff.ts` schreiben**

`tests/core/commands/eml.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { emlPathFor, verifyEml } from "../../../src/core/commands/eml";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { ParsedMail } from "../../../src/core/mime/types";

const profile = defaultMailProfile();
const mail = { id: "a@x" } as ParsedMail;

describe("emlPathFor", () => {
  it("legt die .eml in den _eml-Unterordner NEBEN der Notiz", () => {
    expect(emlPathFor(profile, "Mail/2026/2026-08-30-1432-test.md")).toBe("Mail/2026/_eml/2026-08-30-1432-test.eml");
  });

  it("kommt ohne Jahres-Unterordner aus (yearSubfolder: false)", () => {
    expect(emlPathFor(profile, "Mail/test.md")).toBe("Mail/_eml/test.eml");
  });

  it("respektiert einen abweichenden emlSubfolder aus dem Profil", () => {
    expect(emlPathFor({ ...profile, emlSubfolder: "roh" }, "Mail/2026/t.md")).toBe("Mail/2026/roh/t.eml");
  });

  it("kommt mit einer Notiz im Vault-Wurzelverzeichnis zurecht", () => {
    expect(emlPathFor(profile, "t.md")).toBe("_eml/t.eml");
  });
});

describe("verifyEml", () => {
  it("nimmt eine .eml mit passender Message-ID an", () => {
    expect(verifyEml(mail, "a@x")).toEqual({ ok: true });
  });

  it("weist eine .eml ab, die zu einer anderen Mail gehoert", () => {
    expect(verifyEml(mail, "b@x")).toEqual({ ok: false, code: "eml-mismatch" });
  });
});
```

`tests/core/commands/diff.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { diffFrontmatter } from "../../../src/core/commands/diff";

describe("diffFrontmatter", () => {
  it("meldet nur die Keys, die sich unterscheiden", () => {
    const rows = diffFrontmatter({ subject: "alt", from: "a@x" }, { subject: "neu", from: "a@x" }, ["subject", "from"]);
    expect(rows).toEqual([{ field: "subject", before: "alt", after: "neu" }]);
  });

  it("formatiert Listen als Aufzaehlung", () => {
    const rows = diffFrontmatter({ to: ["a@x"] }, { to: ["a@x", "b@x"] }, ["to"]);
    expect(rows).toEqual([{ field: "to", before: "a@x", after: "a@x, b@x" }]);
  });

  it("laesst before weg, wenn der Key vorher gar nicht da war", () => {
    expect(diffFrontmatter({}, { cc: [] }, ["cc"])).toEqual([{ field: "cc", after: "" }]);
  });

  it("beruecksichtigt nur die uebergebenen Keys", () => {
    expect(diffFrontmatter({ eigenes: "a" }, { eigenes: "b" } as never, ["subject"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/commands/eml.test.ts tests/core/commands/diff.test.ts`
Expected: FAIL — beide Module fehlen.

- [ ] **Step 3: `eml.ts` und `diff.ts` schreiben**

```typescript
// src/core/commands/eml.ts
import type { ParsedMail } from "../mime/types";
import type { MailProfile } from "../mirror/profile";
import type { CommandErrorCode } from "./types";

/**
 * Konventionspfad der .eml zu einer Mail-Notiz: der `_eml`-Unterordner NEBEN der Notiz
 * (Spec § 2.2). Bewusst relativ zum tatsaechlichen Ort der Notiz statt ueber
 * `profile.folder` — so stimmt er auch bei `yearSubfolder: false` und bei einer
 * Ordnerumbenennung, solange Notiz und .eml zusammen umgezogen sind.
 */
export function emlPathFor(profile: MailProfile, notePath: string): string {
  const cut = notePath.lastIndexOf("/");
  const dir = cut < 0 ? "" : notePath.slice(0, cut);
  const base = (cut < 0 ? notePath : notePath.slice(cut + 1)).replace(/\.md$/, "");
  const folder = dir ? `${dir}/${profile.emlSubfolder}` : profile.emlSubfolder;
  return `${folder}/${base}.eml`;
}

/**
 * Die gefundene Datei muss zur Notiz gehoeren. Ohne diese Probe wuerde eine falsch
 * benannte .eml die Notiz mit dem Inhalt einer fremden Mail ueberschreiben — der einzige
 * Schreibvorgang im Plugin, der eine bestehende Notiz ueberhaupt ersetzen darf.
 */
export function verifyEml(mail: ParsedMail, expectedId: string): { ok: true } | { ok: false; code: CommandErrorCode } {
  return mail.id === expectedId ? { ok: true } : { ok: false, code: "eml-mismatch" };
}
```

```typescript
// src/core/commands/diff.ts
import type { FmVal } from "../mirror/profile";

function show(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (v === undefined || v === null) return "";
  return String(v);
}

/**
 * Zeilen fuer die Vorschau-Tabelle: je verwaltetem Key ein Vorher/Nachher, aber nur wo sich
 * etwas unterscheidet. `before` fehlt, wenn der Key in der Notiz noch gar nicht vorkam —
 * das Modal zeigt dafuer "—".
 */
export function diffFrontmatter(
  before: Record<string, unknown>,
  after: Record<string, FmVal>,
  keys: readonly string[],
): { field: string; before?: string; after?: string }[] {
  const rows: { field: string; before?: string; after?: string }[] = [];
  for (const k of keys) {
    if (!Object.hasOwn(after, k)) continue;
    const a = show(after[k]);
    if (!Object.hasOwn(before, k)) { rows.push({ field: k, after: a }); continue; }
    const b = show(before[k]);
    if (b !== a) rows.push({ field: k, before: b, after: a });
  }
  return rows;
}
```

- [ ] **Step 4: Test für `rerender.ts` schreiben**

`tests/core/commands/rerender.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { RERENDER_COMMAND } from "../../../src/core/commands/rerender";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import { buildDerivedFrontmatter } from "../../../src/core/render/frontmatter";
import { renderMessageBlock } from "../../../src/core/render/body";
import { newNote } from "../../../src/core/merge/merge";
import type { CommandContext } from "../../../src/core/commands/types";
import type { ParsedMail } from "../../../src/core/mime/types";

const profile = defaultMailProfile();
const NOW = new Date("2026-08-30T22:00:00Z");

function mail(over: Partial<ParsedMail> = {}): ParsedMail {
  return {
    id: "a@x", messageIdRaw: "<a@x>", inReplyTo: null, references: [],
    from: { name: "Erika", address: "erika@example.org" }, to: [], cc: [],
    subject: "Quartalsreview", date: new Date("2026-08-29T08:00:00Z"),
    text: "Hallo", html: null, attachments: [], attachmentData: new Map(), rawSize: 10,
    ...over,
  };
}

/** Baut eine Notiz so, wie der Sync sie angelegt haette — mit denselben Kern-Funktionen. */
function noteFor(m: ParsedMail, state: "live" | "detached" = "live", source = "acc/Vault") {
  const derived = buildDerivedFrontmatter(profile, { mail: m, source, state, syncedAt: NOW, linkFor: () => null });
  return newNote(derived, profile.onCreate, renderMessageBlock(m));
}

function ctxFor(m: ParsedMail, note: { content: string; zoneHash: string }, over: Partial<CommandContext> = {}): CommandContext {
  return {
    now: NOW, profile,
    target: { mailId: "a@x", path: "Mail/2026/x.md", source: "acc/Vault", state: "live" },
    content: note.content,
    frontmatter: { mail_id: "a@x", mail_source: "acc/Vault", mail_state: "live", subject: "Quartalsreview" },
    zoneHash: note.zoneHash,
    linkFor: () => null,
    attachmentPathFor: (n) => `Anhaenge/${n}`,
    mail: m,
    ...over,
  };
}

describe("mail.rerender", () => {
  it("ist anwendbar, sobald eine Mail-Notiz das Ziel ist", () => {
    const m = mail();
    expect(RERENDER_COMMAND.appliesTo(ctxFor(m, noteFor(m)))).toBe(true);
  });

  it("verlangt die .eml (needs.eml) und meldet eml-missing ohne sie", () => {
    const m = mail();
    expect(RERENDER_COMMAND.needs?.eml).toBe(true);
    const ctx = ctxFor(m, noteFor(m));
    delete ctx.mail;
    expect(RERENDER_COMMAND.plan({}, ctx)).toEqual({ ok: false, code: "eml-missing" });
  });

  it("plant ein update, wenn die .eml einen neuen Betreff traegt", () => {
    const alt = mail();
    const note = noteFor(alt);
    const neu = mail({ subject: "Quartalsreview (verschoben)" });
    const r = RERENDER_COMMAND.plan({}, ctxFor(neu, note));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.notes).toHaveLength(1);
    expect(r.plan.notes[0]).toMatchObject({ kind: "update", path: "Mail/2026/x.md", mailId: "a@x" });
    expect(r.plan.diff).toContainEqual({ field: "subject", before: "Quartalsreview", after: "Quartalsreview (verschoben)" });
  });

  it("laesst mail_state unveraendert — eine abgeloeste Notiz wird nicht wieder live", () => {
    const m = mail();
    const note = noteFor(m, "detached");
    const ctx = ctxFor(mail({ subject: "neu" }), note, {
      target: { mailId: "a@x", path: "Mail/2026/x.md", source: "acc/Vault", state: "detached" },
      frontmatter: { mail_id: "a@x", mail_source: "acc/Vault", mail_state: "detached" },
    });
    const r = RERENDER_COMMAND.plan({}, ctx);
    expect(r.ok && r.plan.notes[0]?.kind).toBe("update");
    expect(r.ok && (r.plan.notes[0] as { content: string }).content).toContain("mail_state: detached");
  });

  it("uebernimmt mail_source aus der Notiz, statt sie neu zu bestimmen", () => {
    const m = mail();
    const note = noteFor(m, "live", "zweitkonto/Vault");
    const ctx = ctxFor(mail({ subject: "neu" }), note, {
      target: { mailId: "a@x", path: "Mail/2026/x.md", source: "zweitkonto/Vault", state: "live" },
      frontmatter: { mail_id: "a@x", mail_source: "zweitkonto/Vault", mail_state: "live" },
    });
    const r = RERENDER_COMMAND.plan({}, ctx);
    expect(r.ok && (r.plan.notes[0] as { content: string }).content).toContain("mail_source: zweitkonto/Vault");
  });

  it("meldet zone-edited, wenn die Zone von Hand geaendert wurde", () => {
    const m = mail();
    const note = noteFor(m);
    const ctx = ctxFor(mail({ subject: "neu" }), note, { zoneHash: "fremder-hash" });
    expect(RERENDER_COMMAND.plan({}, ctx)).toEqual({ ok: false, code: "zone-edited" });
  });

  it("meldet fences-missing, wenn die verwaltete Zone fehlt", () => {
    const m = mail();
    const ctx = ctxFor(m, { content: "---\nmail_id: a@x\n---\nnur Text", zoneHash: null });
    expect(RERENDER_COMMAND.plan({}, ctx)).toEqual({ ok: false, code: "fences-missing" });
  });

  it("meldet nothing-to-do, wenn sich nichts geaendert hat", () => {
    const m = mail();
    expect(RERENDER_COMMAND.plan({}, ctxFor(m, noteFor(m)))).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("weist eine Eingabe zurueck, die das leere Schema nicht kennt", () => {
    const m = mail();
    expect(RERENDER_COMMAND.plan({ egal: 1 }, ctxFor(m, noteFor(m)))).toEqual({ ok: false, code: "invalid-input" });
  });
});
```

- [ ] **Step 5: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/commands/rerender.test.ts`
Expected: FAIL — `RERENDER_COMMAND` existiert nicht.

- [ ] **Step 6: `rerender.ts` schreiben**

```typescript
import { mergeNote } from "../merge/merge";
import { renderMessageBlock } from "../render/body";
import { buildDerivedFrontmatter } from "../render/frontmatter";
import { managedKeys } from "../mirror/profile";
import { diffFrontmatter } from "./diff";
import { EMPTY_SCHEMA, type CommandContext, type CommandDescriptor, type CommandProbe, type PlanResult } from "./types";
import { validateInput } from "./schema";

/**
 * Der einzige Weg zu `allowUpdate: true` ausserhalb des Import-Kommandos (Spec § 2.2,
 * Merge-Regel 5) — deshalb laeuft er ueber `mergeNote()` mit dem gespeicherten Zone-Hash:
 * eine von Hand geaenderte Zone fuehrt zu `zone-edited` und es wird NICHTS geschrieben.
 *
 * `mail_source` und `mail_state` kommen unveraendert aus der Notiz. Beim Zustand ist das
 * offensichtlich; bei der Herkunft ist es der teurere Fall: `planSync()` haelt Notizen mit
 * fremder `source` in Ruhe — ein hier neu gesetzter Wert wuerde die Notiz dauerhaft aus
 * ihrem eigenen Sync-Lauf herausdrehen.
 */
export const RERENDER_COMMAND: CommandDescriptor = {
  id: "mail.rerender",
  title: "Re-render note from its .eml",
  titleKey: "cmd.mail.rerender.title",
  description: "Rebuilds the message zone and the derived front matter keys from the .eml stored next to the note. Anything you wrote outside the zone stays untouched.",
  descriptionKey: "cmd.mail.rerender.desc",
  schema: EMPTY_SCHEMA,
  needs: { eml: true },

  appliesTo(probe: CommandProbe): boolean {
    return probe.target.mailId !== "";
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    if (!validateInput(EMPTY_SCHEMA, input).ok) return { ok: false, code: "invalid-input" };
    const mail = ctx.mail;
    if (!mail) return { ok: false, code: "eml-missing" };

    const p = ctx.profile;
    const derived = buildDerivedFrontmatter(p, {
      mail,
      source: ctx.target.source,
      state: ctx.target.state === "detached" ? "detached" : "live",
      syncedAt: ctx.now,
      linkFor: ctx.linkFor,
    });
    const block = renderMessageBlock(mail);
    const r = mergeNote({
      existing: ctx.content,
      derived,
      managed: managedKeys(p),
      block,
      expectedZoneHash: ctx.zoneHash,
      volatileKeys: [p.syncedField],
    });
    if (!r.ok) return { ok: false, code: r.code };
    if (!r.changed) return { ok: false, code: "nothing-to-do" };

    // `mail_synced` steht in jedem Re-Render neu und saehe in der Tabelle wie eine Aenderung
    // aus, die der Nutzer zu verantworten haette — es ist der Zeitstempel des Vorgangs selbst.
    const keys = managedKeys(p).filter((k) => k !== p.syncedField);
    const diff = diffFrontmatter(ctx.frontmatter, derived, keys);
    const changedFields = diff.length;
    return {
      ok: true,
      plan: {
        commandId: "mail.rerender",
        mailId: ctx.target.mailId,
        summary: `Re-render note: ${changedFields} field(s) change, message body rebuilt`,
        summaryKey: "plan.mail.rerender.summary",
        summaryArgs: [changedFields],
        diff,
        notes: [{ kind: "update", path: ctx.target.path, content: r.content, mailId: ctx.target.mailId, zoneHash: r.zoneHash }],
      },
    };
  },
};
```

- [ ] **Step 7: Kommando registrieren**

```typescript
// src/core/commands/mail-commands.ts
import { RERENDER_COMMAND } from "./rerender";
import type { CommandDescriptor } from "./types";

/** Der eingebaute Kommando-Satz. Reihenfolge = Anzeigereihenfolge. */
export const MAIL_COMMANDS: CommandDescriptor[] = [RERENDER_COMMAND];
```

- [ ] **Step 8: Tests laufen lassen**

Run: `npx vitest run tests/core/commands`
Expected: PASS (alle bisherigen plus 15 neue).

- [ ] **Step 9: Commit**

```bash
git add src/core/commands tests/core/commands
git commit -m "feat(commands): mail.rerender mit .eml-Verifikation und Merge-Regeln"
```

---

## Task 4: `mail.relink` — Thread-Bezüge zu Wikilinks

**Files:**
- Modify: `src/core/merge/merge.ts` (neue Export-Funktion `mergeFrontmatterOnly`)
- Create: `src/core/commands/zone.ts`
- Create: `src/core/commands/relink.ts`
- Modify: `src/core/commands/mail-commands.ts`
- Test: `tests/core/merge/merge.test.ts` (erweitern), `tests/core/commands/relink.test.ts`

**Interfaces:**
- Consumes: `readFm`/`rewriteFm` (modulintern in `merge.ts`), `fmKeyFor` (`core/mirror/profile.ts`), `MailNoteRef`, `CommandContext`
- Produces: `mergeFrontmatterOnly({existing, values})`, `keepZoneHash(content, stored)` (`zone.ts`, auch von Task 5 benutzt), `relinkOne(value, linkFor)`, `relinkValues(frontmatter, keys, linkFor)`, `RELINK_COMMAND`

**Vier Entscheidungen, die dieser Task festlegt:**

1. **Nur vorwärts.** Ein String, der als `mail_id` einer existierenden Notiz erkannt wird, wird zu `[[pfad]]`. Ein bestehender Wikilink wird **nie** zurückverwandelt, auch wenn sein Ziel verschwunden ist — die Rück-Richtung bräuchte die Message-ID, und die steht dann nirgends mehr im Frontmatter. Verschwindet eine Zielnotiz, bleibt ein toter Wikilink stehen; taucht sie wieder auf, greift er von selbst wieder. Das ist genau die Formulierung der Spec (§ 3.2: „→ Wikilinks wo Ziel existiert"), und sie ist bewusst einseitig.
2. **Ohne `.eml`.** Die Quelle sind die Frontmatter-Werte, nicht die Nachricht — sonst müsste ein Lauf über 500 Notizen 500 Dateien parsen. `needs` trägt deshalb nur `allNotes`.
3. **Der Zone-Hash wird nicht angefasst.** Der Plan trägt den **gespeicherten** Hash weiter, nicht den frisch berechneten. Der Unterschied ist folgenreich: `vaultPlanExecutor` schreibt bei jedem `update` den Hash in den Store, und ein frisch berechneter Hash würde eine bestehende `zone-edited`-Sperre stillschweigend aufheben — eine von Hand geänderte Zone wäre danach wieder überschreibbar, ohne dass jemand zugestimmt hat. Nur wenn gar kein Hash gespeichert ist (Altbestand), wird der aus dem Inhalt berechnete genommen.
4. **Notizen ohne Zone werden übersprungen** (`fences-missing`), statt nur ihr Frontmatter zu ändern. Eine Notiz ohne Fences ist nach Merge-Regel 3 nicht mehr verwaltbar; sie halb anzufassen erzeugt einen Zwischenzustand, den niemand erwartet.

Das Kommando startet wie die anderen von einer aktiven Mail-Notiz aus, wirkt aber auf alle. Ein zweiter Kontexttyp „kein Ziel" wäre der Alternativentwurf gewesen; er kostet im Rahmen mehr, als er hier einbringt.

- [ ] **Step 1: Test für `mergeFrontmatterOnly` schreiben (an `tests/core/merge/merge.test.ts` anhängen)**

```typescript
describe("mergeFrontmatterOnly", () => {
  const note = [
    "---",
    "mail_id: a@x",
    "in_reply_to: b@x",
    "references:",
    "  - c@x",
    "eigenes: bleibt",
    "# ein Kommentar",
    "---",
    "## Notizen",
    "",
    "%% mailstone:begin %%",
    "## Nachricht",
    "Hallo",
    "%% mailstone:end %%",
    "",
  ].join("\n");

  it("ersetzt einen einzelnen Key und laesst den Rest byte-identisch", () => {
    const r = mergeFrontmatterOnly({ existing: note, values: { in_reply_to: "[[Mail/2026/b]]" } });
    expect(r).toMatchObject({ ok: true, changed: true });
    if (!r.ok) return;
    expect(r.content).toContain("in_reply_to: \"[[Mail/2026/b]]\"");
    expect(r.content).toContain("eigenes: bleibt");
    expect(r.content).toContain("# ein Kommentar");
    expect(r.content).toContain("%% mailstone:begin %%");
  });

  it("laesst die Zone unangetastet", () => {
    const r = mergeFrontmatterOnly({ existing: note, values: { in_reply_to: "[[Mail/2026/b]]" } });
    expect(r.ok && r.content.slice(r.content.indexOf("## Notizen"))).toBe(note.slice(note.indexOf("## Notizen")));
  });

  it("legt keinen Key an, den es im Frontmatter nicht gibt", () => {
    const r = mergeFrontmatterOnly({ existing: note, values: { cc: ["x@y"] } });
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(r.ok && r.content).toBe(note);
  });

  it("meldet changed: false, wenn der Wert schon stimmt", () => {
    expect(mergeFrontmatterOnly({ existing: note, values: { in_reply_to: "b@x" } })).toMatchObject({ ok: true, changed: false });
  });

  it("meldet frontmatter-unparseable bei einem Block-Skalar", () => {
    const mitBlock = "---\nin_reply_to: |\n  mehrzeilig\n---\ntext";
    expect(mergeFrontmatterOnly({ existing: mitBlock, values: { in_reply_to: "x" } })).toEqual({ ok: false, code: "frontmatter-unparseable" });
  });

  it("meldet frontmatter-unparseable, wenn der Block nicht geschlossen ist", () => {
    expect(mergeFrontmatterOnly({ existing: "---\nmail_id: a@x\nohne Ende", values: { mail_id: "b" } })).toEqual({ ok: false, code: "frontmatter-unparseable" });
  });

  it("laesst eine Notiz ohne Frontmatter unveraendert", () => {
    expect(mergeFrontmatterOnly({ existing: "nur Text", values: { mail_id: "a" } })).toEqual({ ok: true, content: "nur Text", changed: false });
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/merge/merge.test.ts`
Expected: FAIL — `mergeFrontmatterOnly is not exported`.

- [ ] **Step 3: `mergeFrontmatterOnly` in `src/core/merge/merge.ts` ergänzen (unterhalb von `mergeNote`)**

```typescript
/**
 * Aendert AUSSCHLIESSLICH bestehende Frontmatter-Keys und laesst den Body Byte fuer Byte
 * stehen — auch die verwaltete Zone. Fuer Kommandos, die am Inhalt der Nachricht nichts zu
 * suchen haben (mail.relink). Bewusst OHNE Zone-Hash-Pruefung: wer die Zone nicht anfasst,
 * darf an einer von Hand geaenderten Zone nicht scheitern.
 *
 * Keys, die im Frontmatter nicht vorkommen, werden ignoriert statt angelegt: ein Kommando,
 * das `in_reply_to` setzt, soll es dort, wo es die Mail nie gab, auch nicht erfinden.
 */
export function mergeFrontmatterOnly(input: { existing: string; values: Record<string, FmVal> }):
  | { ok: true; content: string; changed: boolean }
  | { ok: false; code: MergeErrorCode } {
  const doc = readFm(input.existing);
  if (!doc) {
    if (input.existing.startsWith("---")) return { ok: false, code: "frontmatter-unparseable" };
    return { ok: true, content: input.existing, changed: false };
  }
  const managed = Object.keys(input.values).filter((k) => doc.entries.has(k));
  if (managed.length === 0) return { ok: true, content: input.existing, changed: false };
  const raw = rewriteFm(doc, input.values, managed, new Set());
  if (raw === null) return { ok: false, code: "frontmatter-unparseable" };
  const body = input.existing.slice(doc.open.length + doc.raw.length + doc.close.length);
  const content = `${doc.open}${raw}${doc.close}${body}`;
  return { ok: true, content, changed: content !== input.existing };
}
```

- [ ] **Step 3b: `src/core/commands/zone.ts` anlegen**

Zwei Kommandos schreiben eine Notiz, ohne ihre Zone anzufassen (`mail.relink`, `mail.extractAttachment`) und brauchen dafür denselben Hash-Umgang. Er liegt deshalb einmal für beide hier statt als Kopie in jedem Kommando.

```typescript
import { splitBody, zoneHash } from "../merge/fences";

/**
 * Der Zone-Hash, den ein NotePlan tragen soll, wenn das Kommando die Zone NICHT aendert:
 * der GESPEICHERTE Wert. `vaultPlanExecutor` schreibt bei jedem `update` den Hash des Plans
 * in den Zustand — ein frisch berechneter wuerde eine bestehende `zone-edited`-Sperre
 * stillschweigend aufheben, und eine von Hand geaenderte Zone waere danach wieder
 * ueberschreibbar, ohne dass jemand zugestimmt hat.
 *
 * Nur wenn gar kein Hash gespeichert ist (Altbestand, Import vor M1), wird er aus dem
 * Inhalt berechnet. `null` = die Notiz hat keine Zone und keinen gespeicherten Hash; der
 * Aufrufer laesst sie dann in Ruhe (Merge-Regel 3).
 */
export function keepZoneHash(content: string, stored: string | null): string | null {
  if (stored !== null) return stored;
  const { block } = splitBody(content);
  return block === null ? null : zoneHash(block);
}
```

- [ ] **Step 4: Test für `relink.ts` schreiben**

`tests/core/commands/relink.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { relinkOne, relinkValues, RELINK_COMMAND } from "../../../src/core/commands/relink";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { CommandContext, MailNoteRef } from "../../../src/core/commands/types";

const profile = defaultMailProfile();
const NOW = new Date("2026-08-30T22:00:00Z");
const ZONE = "%% mailstone:begin %%\n## Nachricht\nHallo\n%% mailstone:end %%\n";

function note(mailId: string, fm: Record<string, unknown>, zoneHash: string | null = "h"): MailNoteRef {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : String(v)}`);
  return { mailId, path: `Mail/2026/${mailId}.md`, frontmatter: { mail_id: mailId, ...fm }, zoneHash,
    content: `---\nmail_id: ${mailId}\n${lines.join("\n")}\n---\n\n${ZONE}` };
}

const links: Record<string, string> = { "b@x": "Mail/2026/b@x", "c@x": "Mail/2026/c@x" };
const linkFor = (id: string): string | null => links[id] ?? null;

function ctx(notes: MailNoteRef[]): CommandContext {
  return {
    now: NOW, profile,
    target: { mailId: "a@x", path: "Mail/2026/a@x.md", source: "acc/Vault", state: "live" },
    content: notes[0]?.content ?? "", frontmatter: notes[0]?.frontmatter ?? {}, zoneHash: "h",
    linkFor, attachmentPathFor: (n) => `Anhaenge/${n}`, notes,
  };
}

describe("relinkOne", () => {
  it("macht aus einer bekannten Message-ID einen Wikilink", () => {
    expect(relinkOne("b@x", linkFor)).toBe("[[Mail/2026/b@x]]");
  });
  it("laesst eine unbekannte ID stehen", () => {
    expect(relinkOne("unbekannt@x", linkFor)).toBe("unbekannt@x");
  });
  it("fasst einen bestehenden Wikilink nicht an — auch nicht, wenn das Ziel fehlt", () => {
    expect(relinkOne("[[Mail/2026/geloescht]]", linkFor)).toBe("[[Mail/2026/geloescht]]");
  });
  it("laesst einen leeren Wert leer", () => {
    expect(relinkOne("", linkFor)).toBe("");
  });
});

describe("relinkValues", () => {
  it("verlinkt in_reply_to und references gemeinsam", () => {
    const out = relinkValues({ in_reply_to: "b@x", references: ["c@x", "weg@x"] }, ["in_reply_to", "references"], linkFor);
    expect(out).toEqual({ in_reply_to: "[[Mail/2026/b@x]]", references: ["[[Mail/2026/c@x]]", "weg@x"] });
  });
  it("liefert null, wenn sich nichts aendert", () => {
    expect(relinkValues({ in_reply_to: "[[Mail/2026/b@x]]" }, ["in_reply_to", "references"], linkFor)).toBeNull();
  });
  it("uebergeht Werte, die weder String noch String-Liste sind", () => {
    expect(relinkValues({ in_reply_to: 42 }, ["in_reply_to"], linkFor)).toBeNull();
  });
});

describe("mail.relink", () => {
  it("braucht alle Notizen, aber keine .eml", () => {
    expect(RELINK_COMMAND.needs).toEqual({ allNotes: true });
  });

  it("plant je betroffener Notiz ein update", () => {
    const r = RELINK_COMMAND.plan({}, ctx([note("a@x", { in_reply_to: "b@x" }), note("d@x", { in_reply_to: "unbekannt@x" })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.notes).toHaveLength(1);
    expect(r.plan.notes[0]).toMatchObject({ kind: "update", path: "Mail/2026/a@x.md", mailId: "a@x" });
    expect(r.plan.summaryArgs).toEqual([1]);
  });

  it("traegt den GESPEICHERTEN Zone-Hash weiter, statt ihn neu zu berechnen", () => {
    const r = RELINK_COMMAND.plan({}, ctx([note("a@x", { in_reply_to: "b@x" }, "gespeicherter-hash")]));
    expect(r.ok && (r.plan.notes[0] as { zoneHash: string }).zoneHash).toBe("gespeicherter-hash");
  });

  it("ueberspringt eine Notiz ohne Fences", () => {
    const ohne: MailNoteRef = { mailId: "a@x", path: "Mail/2026/a@x.md", zoneHash: null,
      frontmatter: { mail_id: "a@x", in_reply_to: "b@x" }, content: "---\nmail_id: a@x\nin_reply_to: b@x\n---\nnur Text" };
    expect(RELINK_COMMAND.plan({}, ctx([ohne]))).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("meldet nothing-to-do, wenn alles schon verlinkt ist", () => {
    expect(RELINK_COMMAND.plan({}, ctx([note("a@x", { in_reply_to: "[[Mail/2026/b@x]]" })]))).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("zeigt hoechstens 20 Diff-Zeilen, zaehlt aber alle", () => {
    const viele = Array.from({ length: 25 }, (_, i) => note(`m${i}@x`, { in_reply_to: "b@x" }));
    const r = RELINK_COMMAND.plan({}, ctx(viele));
    expect(r.ok && r.plan.notes).toHaveLength(25);
    expect(r.ok && r.plan.diff).toHaveLength(20);
    expect(r.ok && r.plan.summaryArgs).toEqual([25]);
  });
});
```

- [ ] **Step 5: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/commands/relink.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 6: `relink.ts` schreiben**

```typescript
import { mergeFrontmatterOnly } from "../merge/merge";
import { fmKeyFor, type FmVal } from "../mirror/profile";
import { keepZoneHash } from "./zone";
import type { NotePlan } from "../mirror/plan";
import { validateInput } from "./schema";
import { EMPTY_SCHEMA, type CommandContext, type CommandDescriptor, type CommandProbe, type PlanResult } from "./types";

/** Ein Frontmatter-Wert, der schon ein Wikilink ist, bleibt einer — die Rueckrichtung
 *  braeuchte die Message-ID, und die steht dann nirgends mehr. */
function isWikilink(v: string): boolean {
  return v.startsWith("[[") && v.endsWith("]]");
}

export function relinkOne(value: string, linkFor: (id: string) => string | null): string {
  if (value === "" || isWikilink(value)) return value;
  const target = linkFor(value);
  return target ? `[[${target}]]` : value;
}

/** Die geaenderten Keys — oder null, wenn dieser Aufruf nichts zu tun hat. */
export function relinkValues(
  frontmatter: Record<string, unknown>,
  keys: readonly string[],
  linkFor: (id: string) => string | null,
): Record<string, FmVal> | null {
  const out: Record<string, FmVal> = {};
  for (const k of keys) {
    const v = frontmatter[k];
    if (typeof v === "string") {
      const neu = relinkOne(v, linkFor);
      if (neu !== v) out[k] = neu;
    } else if (Array.isArray(v) && v.every((x): x is string => typeof x === "string")) {
      const neu = v.map((x) => relinkOne(x, linkFor));
      if (neu.some((x, i) => x !== v[i])) out[k] = neu;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

const MAX_DIFF_ROWS = 20;

export const RELINK_COMMAND: CommandDescriptor = {
  id: "mail.relink",
  title: "Relink threads",
  titleKey: "cmd.mail.relink.title",
  description: "Turns the message ids in in_reply_to and references into wikilinks wherever the target note exists. Runs across all mail notes; existing wikilinks are left alone.",
  descriptionKey: "cmd.mail.relink.desc",
  schema: EMPTY_SCHEMA,
  needs: { allNotes: true },

  appliesTo(probe: CommandProbe): boolean {
    return probe.target.mailId !== "";
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    if (!validateInput(EMPTY_SCHEMA, input).ok) return { ok: false, code: "invalid-input" };
    const keys = [fmKeyFor(ctx.profile, "in_reply_to"), fmKeyFor(ctx.profile, "references")]
      .filter((k): k is string => k !== null);
    if (keys.length === 0) return { ok: false, code: "nothing-to-do" };

    const notes: NotePlan[] = [];
    const diff: { field: string; before?: string; after?: string }[] = [];
    for (const ref of ctx.notes ?? []) {
      const values = relinkValues(ref.frontmatter, keys, ctx.linkFor);
      if (!values) continue;
      const hash = keepZoneHash(ref.content, ref.zoneHash);
      if (hash === null) continue; // Notiz ohne Zone: Merge-Regel 3, nicht halb anfassen
      const merged = mergeFrontmatterOnly({ existing: ref.content, values });
      if (!merged.ok || !merged.changed) continue;
      notes.push({ kind: "update", path: ref.path, content: merged.content, mailId: ref.mailId, zoneHash: hash });
      if (diff.length < MAX_DIFF_ROWS) {
        const k = Object.keys(values)[0] as string;
        diff.push({ field: ref.path, before: String(ref.frontmatter[k] ?? ""), after: String(values[k] ?? "") });
      }
    }
    if (notes.length === 0) return { ok: false, code: "nothing-to-do" };

    return {
      ok: true,
      plan: {
        commandId: "mail.relink",
        mailId: ctx.target.mailId,
        summary: `Relink threads: ${notes.length} note(s) get new wikilinks`,
        summaryKey: "plan.mail.relink.summary",
        summaryArgs: [notes.length],
        diff,
        notes,
      },
    };
  },
};
```

- [ ] **Step 7: Kommando registrieren**

```typescript
// src/core/commands/mail-commands.ts
import { RELINK_COMMAND } from "./relink";
import { RERENDER_COMMAND } from "./rerender";
import type { CommandDescriptor } from "./types";

export const MAIL_COMMANDS: CommandDescriptor[] = [RERENDER_COMMAND, RELINK_COMMAND];
```

- [ ] **Step 8: Tests laufen lassen**

Run: `npx vitest run tests/core`
Expected: PASS.

- [ ] **Step 9: Mutations-Gegenprobe (Pflicht, nicht optional)**

Die Zusicherung aus Punkt 3 ist genau die Sorte, die ein grüner Test nicht belegt — sie hängt an einem Wert, der auch zufällig stimmen kann. Also einmal kaputtmachen:

```bash
# in zone.ts die erste Zeile von keepZoneHash() entfernen, sodass IMMER neu berechnet wird:
#   -  if (stored !== null) return stored;
npx vitest run tests/core/commands/relink.test.ts
```
Expected: FAIL bei „traegt den GESPEICHERTEN Zone-Hash weiter". Danach zurückbauen und erneut laufen lassen: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/core/commands src/core/merge/merge.ts tests/core
git commit -m "feat(commands): mail.relink mit frontmatter-only-Merge"
```

---

## Task 5: `mail.extractAttachment` — eine Datei aus der `.eml` in den Vault

**Files:**
- Create: `src/core/commands/extract.ts`
- Modify: `src/core/commands/mail-commands.ts`
- Test: `tests/core/commands/extract.test.ts`

**Interfaces:**
- Consumes: `keepZoneHash` (`core/commands/zone.ts`, aus Task 4), `BLOCK_BEGIN` (`core/merge/fences.ts`), `schemaOf`, `validateInput`
- Produces: `attachmentLink(path, type)`, `insertAttachmentLink(content, link)`, `EXTRACT_ATTACHMENT_COMMAND`

**Drei Festlegungen:**

1. **Das Schema ist kontextabhängig.** `schemaFor(ctx)` liefert die Anhangnamen als `enum` — dadurch wird aus dem Formular ein Dropdown mit genau den Dateien, die in dieser Mail stecken, und `validateInput` weist eine erfundene Auswahl ab, bevor irgendetwas passiert. Das ist der Grund, warum `CommandDescriptor` gegenüber der `calendar-notes`-Vorlage um `schemaFor` erweitert wurde.
2. **`appliesTo` liest das Frontmatter-Feld `attachments`, das Extrahieren liest die `.eml`.** Spec § 2.2 sagt ausdrücklich, `mail.extractAttachment` lese Anhänge „aus der .eml, nie aus diesem Feld" — das gilt für die Daten. Für die Frage, ob das Kommando in der Palette überhaupt erscheint, ist das Feld die richtige Quelle: `appliesTo` läuft bei jedem Öffnen der Palette, und dafür eine `.eml` zu parsen wäre absurd. Die Daten kommen weiterhin ausschließlich aus `ctx.mail.attachmentData`.
3. **Zweimal extrahieren legt zwei Dateien an.** `attachmentPathFor` ist `getAvailablePathForAttachment` und weicht Kollisionen aus, also entsteht beim zweiten Mal `bild 1.png`. Eine Deduplizierung müsste Dateiinhalte vergleichen und wäre teurer als der Fehler, den sie verhindert — die Vorschau nennt den Zielpfad, der Nutzer sieht es vorher.

Der Link wird **vor** die verwaltete Zone gesetzt, in den freien Bereich. In der Zone wäre er beim nächsten `mail.rerender` weg.

- [ ] **Step 1: Test schreiben**

`tests/core/commands/extract.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { attachmentLink, insertAttachmentLink, EXTRACT_ATTACHMENT_COMMAND } from "../../../src/core/commands/extract";
import { schemaOf, type CommandContext } from "../../../src/core/commands/types";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { ParsedMail } from "../../../src/core/mime/types";

const profile = defaultMailProfile();
const NOW = new Date("2026-08-30T22:00:00Z");
const NOTE = "---\nmail_id: a@x\nattachments:\n  - \"einladung.ics (text/calendar, 2.8 KB)\"\n---\n## Notizen\n\n%% mailstone:begin %%\n## Nachricht\nHallo\n%% mailstone:end %%\n";

function mail(): ParsedMail {
  return {
    id: "a@x", messageIdRaw: "<a@x>", inReplyTo: null, references: [],
    from: { name: "E", address: "e@example.org" }, to: [], cc: [],
    subject: "Termin", date: new Date("2026-08-29T08:00:00Z"), text: "Hallo", html: null,
    attachments: [
      { name: "einladung.ics", type: "text/calendar", size: 2800, inline: false },
      { name: "logo.png", type: "image/png", size: 100, contentId: "logo@cid", inline: true },
    ],
    attachmentData: new Map([["einladung.ics", new Uint8Array([66, 69])], ["logo@cid", new Uint8Array([1])]]),
    rawSize: 3000,
  };
}

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    now: NOW, profile,
    target: { mailId: "a@x", path: "Mail/2026/x.md", source: "acc/Vault", state: "live" },
    content: NOTE,
    frontmatter: { mail_id: "a@x", attachments: ["einladung.ics (text/calendar, 2.8 KB)"] },
    zoneHash: "gespeichert",
    linkFor: () => null,
    attachmentPathFor: (n) => `Anhaenge/${n}`,
    mail: mail(),
    ...over,
  };
}

describe("attachmentLink", () => {
  it("bettet Bilder ein", () => {
    expect(attachmentLink("Anhaenge/b.png", "image/png")).toBe("![[Anhaenge/b.png]]");
  });
  it("bettet PDFs ein", () => {
    expect(attachmentLink("Anhaenge/b.pdf", "application/pdf")).toBe("![[Anhaenge/b.pdf]]");
  });
  it("verlinkt alles andere ohne Einbettung", () => {
    expect(attachmentLink("Anhaenge/b.ics", "text/calendar")).toBe("[[Anhaenge/b.ics]]");
  });
});

describe("insertAttachmentLink", () => {
  it("setzt den Link VOR die verwaltete Zone", () => {
    const r = insertAttachmentLink(NOTE, "[[Anhaenge/einladung.ics]]");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.indexOf("[[Anhaenge/einladung.ics]]")).toBeLessThan(r.content.indexOf("%% mailstone:begin %%"));
    expect(r.content.slice(r.content.indexOf("%% mailstone:begin %%"))).toBe(NOTE.slice(NOTE.indexOf("%% mailstone:begin %%")));
  });
  it("meldet fences-missing ohne Zone", () => {
    expect(insertAttachmentLink("---\nmail_id: a@x\n---\ntext", "[[x]]")).toEqual({ ok: false, code: "fences-missing" });
  });
  it("meldet nothing-to-do, wenn genau dieser Link schon dasteht", () => {
    const einmal = insertAttachmentLink(NOTE, "[[Anhaenge/einladung.ics]]");
    expect(einmal.ok && insertAttachmentLink(einmal.content, "[[Anhaenge/einladung.ics]]")).toEqual({ ok: false, code: "nothing-to-do" });
  });
});

describe("mail.extractAttachment", () => {
  it("ist anwendbar, wenn das Frontmatter Anhaenge fuehrt — ohne die .eml zu brauchen", () => {
    const ohneEml = ctx();
    delete ohneEml.mail;
    expect(EXTRACT_ATTACHMENT_COMMAND.appliesTo(ohneEml)).toBe(true);
  });

  it("ist nicht anwendbar ohne Anhaenge im Frontmatter", () => {
    expect(EXTRACT_ATTACHMENT_COMMAND.appliesTo(ctx({ frontmatter: { mail_id: "a@x", attachments: [] } }))).toBe(false);
  });

  it("bietet im Schema nur die NICHT-inline Anhaenge an", () => {
    const schema = schemaOf(EXTRACT_ATTACHMENT_COMMAND, ctx());
    expect(schema.properties["name"]).toMatchObject({ type: "string", enum: ["einladung.ics"] });
    expect(schema.required).toEqual(["name"]);
  });

  it("plant Datei plus Notiz-Update", () => {
    const r = EXTRACT_ATTACHMENT_COMMAND.plan({ name: "einladung.ics" }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.attachment).toEqual({ path: "Anhaenge/einladung.ics", data: new Uint8Array([66, 69]) });
    expect(r.plan.notes[0]).toMatchObject({ kind: "update", path: "Mail/2026/x.md", zoneHash: "gespeichert" });
  });

  it("weist einen Namen ab, der nicht in der Mail steckt", () => {
    expect(EXTRACT_ATTACHMENT_COMMAND.plan({ name: "erfunden.pdf" }, ctx())).toEqual({ ok: false, code: "invalid-input" });
  });

  it("meldet attachment-missing, wenn zum Namen keine Bytes vorliegen", () => {
    const m = mail();
    m.attachmentData.delete("einladung.ics");
    expect(EXTRACT_ATTACHMENT_COMMAND.plan({ name: "einladung.ics" }, ctx({ mail: m }))).toEqual({ ok: false, code: "attachment-missing" });
  });

  it("meldet eml-missing ohne geladene .eml", () => {
    const c = ctx();
    delete c.mail;
    expect(EXTRACT_ATTACHMENT_COMMAND.plan({ name: "einladung.ics" }, c)).toEqual({ ok: false, code: "eml-missing" });
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/commands/extract.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: `extract.ts` schreiben**

```typescript
import { BLOCK_BEGIN } from "../merge/fences";
import { validateInput, type ObjectSchema } from "./schema";
import { keepZoneHash } from "./zone";
import type { CommandContext, CommandDescriptor, CommandErrorCode, CommandProbe, PlanResult } from "./types";

const EMBED_TYPES = /^(image\/|video\/|audio\/)|^application\/pdf$/;

/** Bilder, Medien und PDFs bettet Obsidian mit `![[…]]` direkt ein; alles andere bleibt ein
 *  Link, damit die Notiz nicht mit einem leeren Rahmen aufgeht. */
export function attachmentLink(path: string, type: string): string {
  return `${EMBED_TYPES.test(type) ? "!" : ""}[[${path}]]`;
}

/**
 * Setzt den Link in den FREIEN Bereich, unmittelbar vor die verwaltete Zone. In der Zone
 * waere er beim naechsten mail.rerender verschwunden — sie wird dort vollstaendig ersetzt.
 */
export function insertAttachmentLink(content: string, link: string): { ok: true; content: string } | { ok: false; code: CommandErrorCode } {
  if (content.includes(link)) return { ok: false, code: "nothing-to-do" };
  const i = content.indexOf(BLOCK_BEGIN);
  if (i < 0) return { ok: false, code: "fences-missing" };
  return { ok: true, content: `${content.slice(0, i)}${link}\n\n${content.slice(i)}` };
}

/** Die Namen aus der .eml — nur echte Anhaenge, keine Inline-Bilder (die bleiben laut
 *  Spec § 2.2 in der .eml und erscheinen im Text als Platzhalter). */
function attachmentNames(ctx: CommandContext): string[] {
  return (ctx.mail?.attachments ?? []).filter((a) => !a.inline).map((a) => a.name);
}

function extractSchema(ctx: CommandContext): ObjectSchema {
  return {
    type: "object",
    properties: {
      name: {
        type: "string",
        enum: attachmentNames(ctx),
        description: "Which attachment to copy into the vault.",
        descriptionKey: "cmd.mail.extractAttachment.field.name",
      },
    },
    required: ["name"],
  };
}

export const EXTRACT_ATTACHMENT_COMMAND: CommandDescriptor = {
  id: "mail.extractAttachment",
  title: "Extract an attachment",
  titleKey: "cmd.mail.extractAttachment.title",
  description: "Copies one attachment out of the .eml into the vault's attachment folder and links it from the note. The .eml keeps its own copy.",
  descriptionKey: "cmd.mail.extractAttachment.desc",
  schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  schemaFor: extractSchema,
  needs: { eml: true },

  /** Billige Vorpruefung ueber das Frontmatter-Feld: `appliesTo` laeuft bei JEDEM Oeffnen
   *  der Kommandopalette, und dafuer eine .eml zu parsen waere unverhaeltnismaessig. Die
   *  DATEN kommen weiterhin ausschliesslich aus der .eml (Spec § 2.2). */
  appliesTo(probe: CommandProbe): boolean {
    const v = probe.frontmatter["attachments"];
    return Array.isArray(v) && v.length > 0;
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    const mail = ctx.mail;
    if (!mail) return { ok: false, code: "eml-missing" };
    const v = validateInput(extractSchema(ctx), input);
    if (!v.ok) return { ok: false, code: "invalid-input" };

    const name = String(v.value["name"]);
    const meta = mail.attachments.find((a) => !a.inline && a.name === name);
    if (!meta) return { ok: false, code: "attachment-missing" };
    const data = mail.attachmentData.get(meta.contentId ?? meta.name);
    if (!data) return { ok: false, code: "attachment-missing" };

    const path = ctx.attachmentPathFor(name);
    const link = attachmentLink(path, meta.type);
    const ins = insertAttachmentLink(ctx.content, link);
    if (!ins.ok) return { ok: false, code: ins.code };
    const hash = keepZoneHash(ctx.content, ctx.zoneHash);
    if (hash === null) return { ok: false, code: "fences-missing" };

    return {
      ok: true,
      plan: {
        commandId: "mail.extractAttachment",
        mailId: ctx.target.mailId,
        summary: `Extract attachment: ${name} → ${path}`,
        summaryKey: "plan.mail.extractAttachment.summary",
        summaryArgs: [name, path],
        diff: [{ field: "attachment", after: path }],
        notes: [{ kind: "update", path: ctx.target.path, content: ins.content, mailId: ctx.target.mailId, zoneHash: hash }],
        attachment: { path, data },
      },
    };
  },
};
```

- [ ] **Step 4: Kommando registrieren** — `MAIL_COMMANDS` um `EXTRACT_ATTACHMENT_COMMAND` erweitern (Reihenfolge: rerender, relink, extract).

- [ ] **Step 5: Tests laufen lassen**

Run: `npx vitest run tests/core/commands`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/commands tests/core/commands
git commit -m "feat(commands): mail.extractAttachment mit kontextabhaengigem Schema"
```

---

## Task 6: `mail.replyExternal` — Antwort im Standard-Mailclient

**Files:**
- Modify: `src/core/mime/headers.ts` (neue Funktion `addressOf`)
- Create: `src/core/commands/reply.ts`
- Modify: `src/core/commands/mail-commands.ts`
- Test: `tests/core/mime/headers.test.ts` (erweitern), `tests/core/commands/reply.test.ts`

**Interfaces:**
- Consumes: `CommandContext`, `formatAddress` (nur als Gegenstück; `addressOf` ist die Umkehrung)
- Produces: `addressOf(formatted)`, `replySubject(subject)`, `buildMailtoUrl({to, subject, inReplyTo})`, `REPLY_EXTERNAL_COMMAND`

**Der Fallstrick dieses Tasks in einem Satz:** `In-Reply-To` ist die Message-ID **dieser** Mail (`mail_id` der Notiz), nicht der Wert des Frontmatter-Feldes `in_reply_to` — das ist die ID des Vorgängers. Wer sie verwechselt, hängt die Antwort an die falsche Stelle des Threads. Und wenn die ID eine Ersatz-ID ist (Präfix `noid-`, Spec § 2.2), wird der Header **weggelassen**: eine erfundene ID in einen echten Thread zu schreiben ist schlechter, als keinen Bezug zu setzen.

mailstone versendet hier ausdrücklich **nicht** selbst. Ein Antwortfenster im Plugin wäre ein zweiter Editor mit eigenen Zitierregeln, Signaturen und Entwürfen; `mailto:` gibt die Aufgabe an das Programm ab, das dafür da ist.

- [ ] **Step 1: Test schreiben**

`tests/core/commands/reply.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { replySubject, buildMailtoUrl, REPLY_EXTERNAL_COMMAND } from "../../../src/core/commands/reply";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { CommandContext } from "../../../src/core/commands/types";

const profile = defaultMailProfile();

function ctx(fm: Record<string, unknown>, mailId = "a@x"): CommandContext {
  return {
    now: new Date("2026-08-30T22:00:00Z"), profile,
    target: { mailId, path: "Mail/2026/x.md", source: "acc/Vault", state: "live" },
    content: "", frontmatter: { mail_id: mailId, ...fm }, zoneHash: null,
    linkFor: () => null, attachmentPathFor: (n) => `Anhaenge/${n}`,
  };
}

describe("replySubject", () => {
  it("stellt Re: voran", () => {
    expect(replySubject("Quartalsreview")).toBe("Re: Quartalsreview");
  });
  it("verdoppelt ein vorhandenes Re: nicht", () => {
    expect(replySubject("Re: Quartalsreview")).toBe("Re: Quartalsreview");
  });
  it("erkennt auch das deutsche AW:", () => {
    expect(replySubject("AW: Quartalsreview")).toBe("AW: Quartalsreview");
  });
  it("behandelt einen leeren Betreff", () => {
    expect(replySubject("")).toBe("Re:");
  });
});

describe("buildMailtoUrl", () => {
  it("baut Adresse, Betreff und In-Reply-To", () => {
    expect(buildMailtoUrl({ to: "erika@example.org", subject: "Termin", inReplyTo: "a@x" }))
      .toBe("mailto:erika@example.org?subject=Re%3A%20Termin&in-reply-to=%3Ca%40x%3E");
  });
  it("laesst das @ der Adresse unkodiert", () => {
    expect(buildMailtoUrl({ to: "a+b@example.org", subject: "x", inReplyTo: null })).toContain("mailto:a%2Bb@example.org");
  });
  it("laesst In-Reply-To weg, wenn es keine gibt", () => {
    expect(buildMailtoUrl({ to: "a@x.org", subject: "x", inReplyTo: null })).not.toContain("in-reply-to");
  });
});

describe("mail.replyExternal", () => {
  it("ist anwendbar, wenn from eine Adresse traegt", () => {
    expect(REPLY_EXTERNAL_COMMAND.appliesTo(ctx({ from: "Erika <erika@example.org>" }))).toBe(true);
  });
  it("ist nicht anwendbar ohne Absender", () => {
    expect(REPLY_EXTERNAL_COMMAND.appliesTo(ctx({ from: "" }))).toBe(false);
  });
  it("braucht weder .eml noch alle Notizen", () => {
    expect(REPLY_EXTERNAL_COMMAND.needs).toBeUndefined();
  });
  it("plant eine URL und keinen einzigen Schreibvorgang", () => {
    const r = REPLY_EXTERNAL_COMMAND.plan({}, ctx({ from: "Erika <erika@example.org>", subject: "Termin" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.notes).toEqual([]);
    expect(r.plan.openUrl).toBe("mailto:erika@example.org?subject=Re%3A%20Termin&in-reply-to=%3Ca%40x%3E");
  });
  it("nimmt die eigene mail_id als In-Reply-To, nicht das Feld in_reply_to", () => {
    const r = REPLY_EXTERNAL_COMMAND.plan({}, ctx({ from: "e@example.org", subject: "T", in_reply_to: "vorgaenger@x" }));
    expect(r.ok && r.plan.openUrl).toContain("in-reply-to=%3Ca%40x%3E");
  });
  it("laesst In-Reply-To bei einer Ersatz-ID weg", () => {
    const r = REPLY_EXTERNAL_COMMAND.plan({}, ctx({ from: "e@example.org", subject: "T" }, "noid-9f2c"));
    expect(r.ok && r.plan.openUrl).not.toContain("in-reply-to");
  });
  it("meldet no-recipient, wenn die Absenderzeile keine Adresse enthaelt", () => {
    expect(REPLY_EXTERNAL_COMMAND.plan({}, ctx({ from: "Erika ohne Adresse" }))).toEqual({ ok: false, code: "no-recipient" });
  });
});
```

Ergänzung in `tests/core/mime/headers.test.ts`:

```typescript
describe("addressOf", () => {
  it("holt die Adresse aus einer Anzeigeform", () => {
    expect(addressOf("Erika Beispiel <erika@example.org>")).toBe("erika@example.org");
  });
  it("nimmt eine nackte Adresse unveraendert", () => {
    expect(addressOf("erika@example.org")).toBe("erika@example.org");
  });
  it("kommt mit Anfuehrungszeichen im Namen zurecht", () => {
    expect(addressOf("\"Beispiel, Erika\" <erika@example.org>")).toBe("erika@example.org");
  });
  it("liefert null ohne @", () => {
    expect(addressOf("Erika Beispiel")).toBeNull();
  });
  it("liefert null bei leerem Wert", () => {
    expect(addressOf("")).toBeNull();
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/commands/reply.test.ts tests/core/mime/headers.test.ts`
Expected: FAIL — `addressOf`/`reply.ts` fehlen.

- [ ] **Step 3: `addressOf` in `src/core/mime/headers.ts` ergänzen**

```typescript
/** Umkehrung zu formatAddress: die reine Adresse aus "Name <adresse>" oder aus einer
 *  nackten Adresse. null, wenn nichts Adressartiges drinsteht — der Aufrufer entscheidet,
 *  ob das ein Fehler ist. */
export function addressOf(formatted: string): string | null {
  const m = /<([^<>]+)>\s*$/.exec(formatted.trim());
  const candidate = (m?.[1] ?? formatted).trim();
  return candidate.includes("@") && !candidate.includes(" ") ? candidate : null;
}
```

- [ ] **Step 4: `reply.ts` schreiben**

```typescript
import { addressOf } from "../mime/headers";
import { fmKeyFor } from "../mirror/profile";
import { validateInput } from "./schema";
import { EMPTY_SCHEMA, type CommandContext, type CommandDescriptor, type CommandProbe, type PlanResult } from "./types";

/** Kein zweites "Re:" davorstellen — auch nicht vor ein deutsches "AW:". */
const REPLY_PREFIX_RE = /^(re|aw)\s*:/i;

export function replySubject(subject: string): string {
  const s = subject.trim();
  if (s === "") return "Re:";
  return REPLY_PREFIX_RE.test(s) ? s : `Re: ${s}`;
}

/** RFC 6068. `@` bleibt roh — encodeURIComponent macht sonst %40 daraus, was zwar zulaessig
 *  ist, aber von aelteren Mailclients unterschiedlich behandelt wird. */
export function buildMailtoUrl(input: { to: string; subject: string; inReplyTo: string | null }): string {
  const to = encodeURIComponent(input.to).replace(/%40/g, "@");
  const params = [`subject=${encodeURIComponent(replySubject(input.subject))}`];
  if (input.inReplyTo) params.push(`in-reply-to=${encodeURIComponent(`<${input.inReplyTo}>`)}`);
  return `mailto:${to}?${params.join("&")}`;
}

function recipientOf(probe: CommandProbe): string | null {
  const key = fmKeyFor(probe.profile, "from");
  const raw = key ? probe.frontmatter[key] : undefined;
  return typeof raw === "string" ? addressOf(raw) : null;
}

export const REPLY_EXTERNAL_COMMAND: CommandDescriptor = {
  id: "mail.replyExternal",
  title: "Reply in the external mail client",
  titleKey: "cmd.mail.replyExternal.title",
  description: "Opens your system mail client with recipient, subject and thread reference filled in. Mailstone does not send this reply itself.",
  descriptionKey: "cmd.mail.replyExternal.desc",
  schema: EMPTY_SCHEMA,

  appliesTo(probe: CommandProbe): boolean {
    return recipientOf(probe) !== null;
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    if (!validateInput(EMPTY_SCHEMA, input).ok) return { ok: false, code: "invalid-input" };
    const to = recipientOf(ctx);
    if (!to) return { ok: false, code: "no-recipient" };

    const subjectKey = fmKeyFor(ctx.profile, "subject");
    const rawSubject = subjectKey ? ctx.frontmatter[subjectKey] : undefined;
    const subject = typeof rawSubject === "string" ? rawSubject : "";

    // In-Reply-To ist die ID DIESER Mail, nicht der Wert des Feldes `in_reply_to` (das ist
    // der Vorgaenger). Eine Ersatz-ID (Praefix "noid-", Spec § 2.2) ist keine echte
    // Message-ID und wird weggelassen statt erfunden.
    const ownId = ctx.target.mailId;
    const inReplyTo = ownId && !ownId.startsWith("noid-") ? ownId : null;

    const url = buildMailtoUrl({ to, subject, inReplyTo });
    return {
      ok: true,
      plan: {
        commandId: "mail.replyExternal",
        mailId: ctx.target.mailId,
        summary: `Reply to ${to} in the external mail client`,
        summaryKey: "plan.mail.replyExternal.summary",
        summaryArgs: [to],
        diff: [],
        notes: [],
        openUrl: url,
      },
    };
  },
};
```

- [ ] **Step 5: Kommando registrieren** — `MAIL_COMMANDS = [RERENDER_COMMAND, RELINK_COMMAND, EXTRACT_ATTACHMENT_COMMAND, REPLY_EXTERNAL_COMMAND]`.

- [ ] **Step 6: Tests und Gates laufen lassen**

Run: `npx vitest run tests/core && npm run check:pure && npm run typecheck`
Expected: PASS / grün.

- [ ] **Step 7: Commit**

```bash
git add src/core tests/core
git commit -m "feat(commands): mail.replyExternal ueber mailto: mit Thread-Bezug"
```

---

## Task 7: UI-Kette — Übersetzung, Formular, Vorschau

**Files:**
- Create: `src/obsidian/command-i18n.ts`
- Create: `src/obsidian/modals/schema-form-modal.ts`
- Create: `src/obsidian/modals/plan-preview-modal.ts`
- Modify: `styles.css`
- Test: `tests/obsidian/schema-form-modal.test.ts`, `tests/obsidian/plan-preview-modal.test.ts`

**Interfaces:**
- Consumes: `ObjectSchema`/`FieldSchema` (Task 1), `CommandDescriptor`, `MailCommandPlan`, `t` (`src/vendor/code-kit/i18n.ts`)
- Produces: `trTitle`, `trDescription`, `tr`, `trFieldDescription`, `trPlan`, `fieldLabel`, `parseFormValues(schema, raw)`, `SchemaFormModal`, `diffRows(plan)`, `PlanPreviewModal`

Der Kern trägt Schlüssel **und** englischen Fallback-Text; übersetzt wird ausschließlich hier. Der Grund ist nicht Ästhetik: `t()` fällt bei einem unbekannten Schlüssel auf den Schlüssel selbst zurück („Key-Echo"), und dann stünde `cmd.mail.relink.title` als Knopfbeschriftung in der Oberfläche. `trOrFallback` erkennt genau diesen Fall.

Beide Modale folgen der Knopf-Grammatik aus `UI-STANDARD.md` § 8 (Confirm-Modal): Abbrechen links, Bestätigen rechts, beide im `modal-button-container`, `setCta()` auf dem bestätigenden Knopf — keine der vier Aktionen ist destruktiv, also kein `mod-warning`.

- [ ] **Step 1: `command-i18n.ts` schreiben**

```typescript
// uebernommen aus calendar-notes/src/obsidian/command-i18n.ts, 2026-08-30
import { t } from "../vendor/code-kit/i18n";
import type { FieldSchema } from "../core/commands/schema";
import type { CommandDescriptor, MailCommandPlan } from "../core/commands/types";

/** `t()` faellt bei einem unbekannten Key auf den Key selbst zurueck. Passiert das, zeigen
 *  wir den englischen Fallback aus dem Deskriptor statt `cmd.mail.relink.title`. */
function trOrFallback(key: string, fallback: string, ...args: (string | number)[]): string {
  const translated = t(key, ...args);
  return translated === key ? fallback : translated;
}

export function trTitle(d: CommandDescriptor): string {
  return trOrFallback(d.titleKey, d.title);
}

export function trDescription(d: CommandDescriptor): string {
  return trOrFallback(d.descriptionKey, d.description);
}

export function tr(d: CommandDescriptor): { title: string; description: string } {
  return { title: trTitle(d), description: trDescription(d) };
}

export function trFieldDescription(field: FieldSchema): string | undefined {
  if (!field.descriptionKey) return field.description;
  return trOrFallback(field.descriptionKey, field.description ?? "");
}

export function trPlan(plan: MailCommandPlan): string {
  return trOrFallback(plan.summaryKey, plan.summary, ...plan.summaryArgs);
}

/** Feldname fuer die Diff-Tabelle. Frontmatter-Keys (`subject`, `to`) bleiben, wie sie in
 *  der Notiz stehen — sie sind der Sache nach schon der richtige Name. Nur die wenigen
 *  eigenen Bezeichner (`attachment`) haben einen Eintrag und werden uebersetzt. */
export function fieldLabel(name: string): string {
  return trOrFallback(`plan.field.${name}`, name);
}
```

- [ ] **Step 2: Test für `parseFormValues` schreiben**

`tests/obsidian/schema-form-modal.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseFormValues } from "../../src/obsidian/modals/schema-form-modal";
import type { ObjectSchema } from "../../src/core/commands/schema";

const schema: ObjectSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    note: { type: "string", format: "multiline" },
    count: { type: "number" },
    flag: { type: "boolean" },
    list: { type: "array", items: { type: "string" } },
  },
  required: ["name"],
};

describe("parseFormValues", () => {
  it("laesst leere optionale Felder weg", () => {
    expect(parseFormValues(schema, { name: "a", note: "", count: "" })).toEqual({ name: "a" });
  });
  it("behaelt ein leeres PFLICHTfeld, damit die Validierung es bemaengeln kann", () => {
    expect(parseFormValues(schema, { name: "" })).toEqual({ name: "" });
  });
  it("wandelt Zahlen", () => {
    expect(parseFormValues(schema, { name: "a", count: "3" })).toEqual({ name: "a", count: 3 });
  });
  it("macht aus Zeilen eine Liste und wirft Leerzeilen weg", () => {
    expect(parseFormValues(schema, { name: "a", list: "x\n\n y \n" })).toEqual({ name: "a", list: ["x", "y"] });
  });
  it("nimmt einen Toggle als boolean", () => {
    expect(parseFormValues(schema, { name: "a", flag: true })).toEqual({ name: "a", flag: true });
  });
  it("uebergeht Rohwerte, die im Schema nicht vorkommen", () => {
    expect(parseFormValues(schema, { name: "a", fremd: "x" })).toEqual({ name: "a" });
  });
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/obsidian/schema-form-modal.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 4: `schema-form-modal.ts` schreiben**

```typescript
import { ButtonComponent, Modal, Setting, type App } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import { validateInput, type FieldSchema, type ObjectSchema } from "../../core/commands/schema";
import { trFieldDescription } from "../command-i18n";

/** `String(unknown)` faellt bei Objekten auf "[object Object]" zurueck (eslint
 *  no-base-to-string) — hier reichen die drei Formular-Wertarten. */
function scalarToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/**
 * Rohwerte der Setting-Komponenten (Strings, bei Toggle boolean) auf die vom Schema
 * erwarteten Typen bringen. Leere OPTIONALE Felder fallen weg — ein leeres, nie
 * ausgefuelltes Feld soll nicht als ungueltiger Wert durch die Validierung fallen.
 * Leere PFLICHTfelder bleiben drin, damit `validateInput` sie bemaengeln kann.
 * Pure — ohne Modal testbar.
 */
export function parseFormValues(schema: ObjectSchema, raw: Record<string, unknown>): Record<string, unknown> {
  const required = new Set(schema.required ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    const v = raw[key];
    if (v === undefined) continue;
    if (field.type === "boolean") { out[key] = Boolean(v); continue; }
    if (field.type === "number") {
      const s = scalarToString(v).trim();
      if (s === "" && !required.has(key)) continue;
      out[key] = Number(s);
      continue;
    }
    if (field.type === "array") {
      const items = (typeof v === "string" ? v : "").split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
      if (items.length === 0 && !required.has(key)) continue;
      out[key] = items;
      continue;
    }
    const s = scalarToString(v);
    if (s === "" && !required.has(key)) continue;
    out[key] = s;
  }
  return out;
}

/**
 * Formular aus einem ObjectSchema. Ein `enum` wird zum Dropdown (so wird aus der
 * Anhangliste eine Auswahl), `format: "multiline"` und `type: "array"` werden zur TextArea,
 * alles andere ein Textfeld. Aufloesung ueber `pick()`: `null` bei Abbruch.
 */
export class SchemaFormModal extends Modal {
  private readonly values: Record<string, unknown> = {};
  private settled = false;
  private resolveFn: (v: Record<string, unknown> | null) => void = () => undefined;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, private readonly heading: string, private readonly schema: ObjectSchema) {
    super(app);
  }

  pick(): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      this.resolveFn = resolve;
      this.open();
    });
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    for (const [key, field] of Object.entries(this.schema.properties)) this.renderField(key, field);
    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("form.cancel")).onClick(() => { this.close(); });
    new ButtonComponent(btns).setButtonText(t("form.submit")).setCta().onClick(() => { this.submit(); });
  }

  onClose(): void {
    this.contentEl.empty();
    this.settle(null);
  }

  private renderField(key: string, field: FieldSchema): void {
    const setting = new Setting(this.contentEl).setName(key);
    const desc = trFieldDescription(field);
    if (desc) setting.setDesc(desc);
    if (field.type === "boolean") {
      setting.addToggle((c) => c.onChange((v) => { this.values[key] = v; }));
      this.values[key] = false;
      return;
    }
    if (field.type === "string" && field.enum) {
      setting.addDropdown((c) => {
        for (const option of field.enum ?? []) c.addOption(option, option);
        this.values[key] = field.enum?.[0] ?? "";
        c.setValue(String(this.values[key]));
        c.onChange((v) => { this.values[key] = v; });
      });
      return;
    }
    if (field.type === "array" || (field.type === "string" && field.format === "multiline")) {
      setting.addTextArea((c) => c.onChange((v) => { this.values[key] = v; }));
      return;
    }
    setting.addText((c) => c.onChange((v) => { this.values[key] = v; }));
  }

  private submit(): void {
    const parsed = parseFormValues(this.schema, this.values);
    const check = validateInput(this.schema, parsed);
    if (!check.ok) {
      this.errorEl?.remove();
      this.errorEl = this.contentEl.createEl("p", { text: check.errors.join(" · "), cls: "mailstone-form-errors" });
      return;
    }
    this.settle(check.value);
    this.close();
  }

  private settle(v: Record<string, unknown> | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveFn(v);
  }
}
```

- [ ] **Step 5: Test für `diffRows` schreiben**

`tests/obsidian/plan-preview-modal.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { diffRows } from "../../src/obsidian/modals/plan-preview-modal";
import type { MailCommandPlan } from "../../src/core/commands/types";

function plan(diff: MailCommandPlan["diff"]): MailCommandPlan {
  return { commandId: "mail.rerender", mailId: "a@x", summary: "s", summaryKey: "k", summaryArgs: [], diff, notes: [] };
}

describe("diffRows", () => {
  it("fuellt fehlende Vorher-/Nachher-Werte mit einem Gedankenstrich", () => {
    expect(diffRows(plan([{ field: "cc", after: "a@x" }]))).toEqual([{ field: "cc", before: "—", after: "a@x" }]);
  });
  it("reicht vorhandene Werte durch", () => {
    expect(diffRows(plan([{ field: "subject", before: "alt", after: "neu" }]))).toEqual([{ field: "subject", before: "alt", after: "neu" }]);
  });
  it("liefert eine leere Liste, wenn es nichts zu zeigen gibt", () => {
    expect(diffRows(plan([]))).toEqual([]);
  });
});
```

- [ ] **Step 6: `plan-preview-modal.ts` schreiben**

```typescript
// uebernommen (Muster) aus calendar-notes/src/obsidian/plan-preview-modal.ts, 2026-08-30
import { ButtonComponent, Modal, type App } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import type { MailCommandPlan } from "../../core/commands/types";
import { fieldLabel, trPlan } from "../command-i18n";

/** Zeilen der Vorschau-Tabelle; "—" statt undefined, damit die Spalte nicht leer wirkt.
 *  Pure, ohne DOM testbar. */
export function diffRows(plan: MailCommandPlan): { field: string; before: string; after: string }[] {
  return plan.diff.map((d) => ({ field: fieldLabel(d.field), before: d.before ?? "—", after: d.after ?? "—" }));
}

/**
 * Zeigt einen Plan, bevor er ausgefuehrt wird: Zusammenfassung, Diff-Tabelle, Knoepfe nach
 * der Confirm-Grammatik aus UI-STANDARD § 8 (Abbrechen links, Ausfuehren rechts mit
 * `setCta()`). `confirm()` liefert true, wenn der Nutzer ausfuehren will.
 */
export class PlanPreviewModal extends Modal {
  private settled = false;
  private resolveFn: (v: boolean) => void = () => undefined;

  constructor(app: App, private readonly plan: MailCommandPlan) {
    super(app);
  }

  confirm(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveFn = resolve;
      this.open();
    });
  }

  onOpen(): void {
    this.titleEl.setText(t("plan.heading"));
    this.contentEl.createEl("p", { text: trPlan(this.plan) });

    const rows = diffRows(this.plan);
    if (rows.length > 0) {
      const table = this.contentEl.createEl("table", { cls: "mailstone-diff-table" });
      const head = table.createEl("thead").createEl("tr");
      for (const h of [t("plan.col.field"), t("plan.col.before"), t("plan.col.after")]) head.createEl("th", { text: h });
      const body = table.createEl("tbody");
      for (const row of rows) {
        const tr = body.createEl("tr");
        tr.createEl("td", { text: row.field });
        tr.createEl("td", { text: row.before });
        tr.createEl("td", { text: row.after });
      }
    }

    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("plan.cancel")).onClick(() => { this.close(); });
    new ButtonComponent(btns).setButtonText(t("plan.execute")).setCta().onClick(() => {
      this.settle(true);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.settle(false);
  }

  private settle(v: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveFn(v);
  }
}
```

- [ ] **Step 7: `styles.css` ergänzen**

Nur Theme-Variablen, keine festen Farben oder Größen (`UI-STANDARD.md` § 3):

```css
.mailstone-diff-table { width: 100%; border-collapse: collapse; margin: var(--size-4-2) 0; }
.mailstone-diff-table th,
.mailstone-diff-table td { text-align: left; padding: var(--size-4-1) var(--size-4-2); border-bottom: 1px solid var(--background-modifier-border); vertical-align: top; }
.mailstone-diff-table th { color: var(--text-muted); font-weight: var(--font-medium); }
.mailstone-form-errors { color: var(--text-error); margin-top: var(--size-4-2); }
```

- [ ] **Step 8: Tests laufen lassen**

Run: `npx vitest run tests/obsidian && npm run typecheck && npm run typecheck:test`
Expected: PASS / grün.

- [ ] **Step 9: Commit**

```bash
git add src/obsidian styles.css tests/obsidian
git commit -m "feat(ui): Schema-Formular und Plan-Vorschau fuer Mail-Kommandos"
```

---

## Task 8: Verdrahtung — Kontext bauen, Kette fahren, Kommandos registrieren

**Files:**
- Create: `src/obsidian/command-flow.ts`
- Modify: `src/obsidian/vault-notes.ts` (`writeAttachment`)
- Modify: `src/main.ts`
- Modify: `src/i18n/strings.ts` (Keys + `export` der Wörterbücher)
- Modify: `tests/helpers/memory-vault.ts` (`getAvailablePathForAttachment`)
- Test: `tests/obsidian/command-flow.test.ts`, `tests/i18n/commands.test.ts`

**Interfaces:**
- Consumes: alles aus Task 1–7
- Produces: `mailTargetFor(profile, path, frontmatter)`, `probeFor(app, profile)`, `runCommand(deps, descriptor)`, `RunResult`, `writeAttachment(app)`

**Die Zweiteilung des Kontexts ist der Kern dieses Tasks.** `checkCallback` läuft bei **jedem** Öffnen der Kommandopalette, für **jedes** registrierte Kommando, und muss synchron antworten. Ein voller Kontext ist dort unbezahlbar: er liest die Notiz, parst womöglich eine `.eml` und löst Anhangpfade auf. Deshalb prüft `appliesTo` einen **`CommandProbe`** — Profil, Ziel, Frontmatter, alles synchron aus dem Metadata-Cache — und der volle `CommandContext` entsteht erst, wenn das Kommando wirklich läuft. `CommandContext extends CommandProbe`, die Kommandos aus Task 3–6 sehen davon nichts.

**Ein Detail, das sonst erst zur Laufzeit auffällt:** `app.fileManager.getAvailablePathForAttachment()` ist **asynchron**. `CommandContext.attachmentPathFor` ist synchron, weil `plan()` synchron ist — also löst `command-flow` die Zielpfade für alle Anhänge dieser Mail **vorab** auf (es sind wenige) und der Kontext greift nur noch in die fertige Map.

- [ ] **Step 1: Voraussetzungen aus Task 1 prüfen**

`CommandProbe`, `CommandContext extends CommandProbe` und `appliesTo(probe: CommandProbe)` sind bereits in Task 1 angelegt; die Deskriptoren aus Task 3–6 greifen ausschließlich auf `profile`, `target` und `frontmatter` zu. Vor dem Weiterbauen einmal bestätigen:

Run: `npm run typecheck && npx vitest run tests/core/commands`
Expected: grün — sonst zuerst Task 1 nachziehen, nicht hier reparieren.

- [ ] **Step 2: `writeAttachment` in `src/obsidian/vault-notes.ts` ergänzen**

```typescript
/** Legt eine Anlage im Vault an und stellt den Zielordner sicher. Eigene Pfadzerlegung
 *  statt des modulinternen `dirOf`: ein Anhangordner auf Vault-Ebene liefert einen Pfad
 *  ohne "/", und `dirOf` schnitte dann das letzte Zeichen des Dateinamens ab. */
export function writeAttachment(app: App): (path: string, data: Uint8Array) => Promise<void> {
  return async (path, data) => {
    const p = normalizePath(path);
    const cut = p.lastIndexOf("/");
    if (cut > 0) await ensureFolder(app, p.slice(0, cut));
    await app.vault.createBinary(p, new Uint8Array(data).buffer);
  };
}
```

- [ ] **Step 3: Test für `command-flow.ts` schreiben**

`tests/obsidian/command-flow.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { mailTargetFor, buildContext } from "../../src/obsidian/command-flow";
import { makeApp } from "../helpers/memory-vault";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { RERENDER_COMMAND } from "../../src/core/commands/rerender";
import { RELINK_COMMAND } from "../../src/core/commands/relink";

const profile = defaultMailProfile();
const ZONE = "%% mailstone:begin %%\n## Nachricht\nHallo\n%% mailstone:end %%\n";
const EML = "Message-ID: <a@x>\r\nFrom: Erika <erika@example.org>\r\nSubject: Termin\r\nDate: Sat, 29 Aug 2026 10:00:00 +0200\r\n\r\nHallo\r\n";

async function vaultWithNote(emlBody = EML) {
  const app = makeApp();
  await app.vault.create("Mail/2026/x.md", `---\nmail_id: a@x\nmail_source: acc/Vault\nmail_state: live\n---\n## Notizen\n\n${ZONE}`);
  await app.vault.createBinary("Mail/2026/_eml/x.eml", new TextEncoder().encode(emlBody).buffer);
  return app;
}

function deps(app: unknown) {
  return {
    app: app as never,
    profile: () => profile,
    hashes: { get: () => null, set: () => {} },
    now: () => new Date("2026-08-30T22:00:00Z"),
  };
}

describe("mailTargetFor", () => {
  it("erkennt eine Mail-Notiz am idField", () => {
    expect(mailTargetFor(profile, "Mail/2026/x.md", { mail_id: "a@x", mail_source: "acc/Vault", mail_state: "live" }))
      .toEqual({ mailId: "a@x", path: "Mail/2026/x.md", source: "acc/Vault", state: "live" });
  });
  it("liefert null ohne mail_id", () => {
    expect(mailTargetFor(profile, "Notiz.md", { titel: "x" })).toBeNull();
  });
  it("vertraegt eine Notiz ohne Herkunft und ohne Zustand (Altbestand)", () => {
    expect(mailTargetFor(profile, "x.md", { mail_id: "a@x" })).toEqual({ mailId: "a@x", path: "x.md", source: "", state: null });
  });
});

describe("buildContext", () => {
  it("laedt und prueft die .eml fuer ein Kommando mit needs.eml", async () => {
    const app = await vaultWithNote();
    const r = await buildContext(deps(app), RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok).toBe(true);
    expect(r.ok && r.ctx.mail?.id).toBe("a@x");
  });

  it("meldet eml-missing, wenn am Konventionspfad nichts liegt", async () => {
    const app = makeApp();
    await app.vault.create("Mail/2026/x.md", `---\nmail_id: a@x\n---\n${ZONE}`);
    const r = await buildContext(deps(app), RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r).toEqual({ ok: false, code: "eml-missing" });
  });

  it("meldet eml-mismatch, wenn die .eml zu einer anderen Mail gehoert", async () => {
    const app = await vaultWithNote(EML.replace("<a@x>", "<fremd@x>"));
    const r = await buildContext(deps(app), RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r).toEqual({ ok: false, code: "eml-mismatch" });
  });

  it("laedt fuer needs.allNotes alle Mail-Notizen samt Frontmatter und Inhalt", async () => {
    const app = await vaultWithNote();
    await app.vault.create("Mail/2026/y.md", `---\nmail_id: b@x\n---\n${ZONE}`);
    const r = await buildContext(deps(app), RELINK_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok && r.ctx.notes?.map((n) => n.mailId).sort()).toEqual(["a@x", "b@x"]);
    expect(r.ok && r.ctx.notes?.[0]?.frontmatter["mail_id"]).toBeDefined();
  });

  it("laedt KEINE .eml fuer ein Kommando ohne needs.eml", async () => {
    const app = await vaultWithNote();
    const spy = vi.spyOn(app.vault, "readBinary");
    await buildContext(deps(app), RELINK_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("loest die Anhangpfade vorab auf, damit attachmentPathFor synchron bleibt", async () => {
    const app = await vaultWithNote(EML.replace("\r\n\r\nHallo\r\n", "\r\nContent-Type: text/plain; name=\"a.txt\"\r\nContent-Disposition: attachment; filename=\"a.txt\"\r\n\r\nInhalt\r\n"));
    const r = await buildContext(deps(app), RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok && r.ctx.attachmentPathFor("a.txt")).toBe("Anhaenge/a.txt");
  });
});
```

- [ ] **Step 4: `getAvailablePathForAttachment` im Test-Vault ergänzen**

In `tests/helpers/memory-vault.ts`, neben `processFrontMatter`:

```typescript
  // Obsidian legt Anhaenge in den konfigurierten Anhangordner und weicht Kollisionen mit
  // einem Zaehler aus. Async wie das Original — genau deshalb loest command-flow die Pfade
  // vorab auf, statt sie im Plan zu berechnen.
  app.fileManager.getAvailablePathForAttachment = async (name: string): Promise<string> => {
    const base = `Anhaenge/${name}`;
    if (!files.has(base)) return base;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let n = 1; ; n++) {
      const candidate = `Anhaenge/${stem} ${n}${ext}`;
      if (!files.has(candidate)) return candidate;
    }
  };
```

- [ ] **Step 5: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/obsidian/command-flow.test.ts`
Expected: FAIL — `src/obsidian/command-flow` fehlt.

- [ ] **Step 6: `command-flow.ts` schreiben**

```typescript
import { TFile, normalizePath, type App } from "obsidian";
import { parseEml } from "../core/mime/parse";
import { emlPathFor, verifyEml } from "../core/commands/eml";
import { executeCommandPlan, type CommandExecuteDeps, type CommandExecuteResult } from "../core/commands/execute";
import { schemaOf, type CommandContext, type CommandDescriptor, type CommandErrorCode, type CommandProbe, type MailNoteRef, type MailTarget } from "../core/commands/types";
import type { MailProfile } from "../core/mirror/profile";
import { SchemaFormModal } from "./modals/schema-form-modal";
import { PlanPreviewModal } from "./modals/plan-preview-modal";
import { trTitle } from "./command-i18n";
import type { ZoneHashStore } from "./vault-notes";

export interface CommandFlowDeps {
  app: App;
  profile: () => MailProfile;
  hashes: ZoneHashStore;
  now: () => Date;
}

export type RunResult =
  | { kind: "cancelled" }
  | { kind: "done"; result: CommandExecuteResult }
  | { kind: "error"; code: CommandErrorCode };

/** Die Notiz als Kommando-Ziel — oder null, wenn sie keine Mail-Notiz ist. Herkunft und
 *  Zustand duerfen fehlen (Altbestand aus einem Import vor M3); die Kommandos reichen dann
 *  weiter, was dasteht, und erfinden nichts. */
export function mailTargetFor(profile: MailProfile, path: string, frontmatter: Record<string, unknown>): MailTarget | null {
  const id = frontmatter[profile.idField];
  if (typeof id !== "string" || id === "") return null;
  const source = frontmatter[profile.sourceField];
  const state = frontmatter[profile.stateField];
  return {
    mailId: id,
    path,
    source: typeof source === "string" ? source : "",
    state: typeof state === "string" ? state : null,
  };
}

/** Synchrone Vorpruefung fuer `checkCallback` — s. Task-Kommentar im Plan. */
export function probeFor(app: App, profile: MailProfile): CommandProbe | null {
  const file = app.workspace.getActiveFile();
  if (!file || file.extension !== "md") return null;
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const target = mailTargetFor(profile, file.path, frontmatter);
  return target ? { profile, target, frontmatter } : null;
}

async function loadNotes(app: App, profile: MailProfile, hashes: ZoneHashStore): Promise<MailNoteRef[]> {
  const out: MailNoteRef[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(f)?.frontmatter;
    const id: unknown = frontmatter?.[profile.idField];
    if (typeof id !== "string" || id === "") continue;
    out.push({ mailId: id, path: f.path, content: await app.vault.cachedRead(f), frontmatter, zoneHash: hashes.get(id) });
  }
  return out;
}

export async function buildContext(
  deps: CommandFlowDeps,
  descriptor: CommandDescriptor,
  file: TFile | null,
): Promise<{ ok: true; ctx: CommandContext } | { ok: false; code: CommandErrorCode }> {
  const { app } = deps;
  const profile = deps.profile();
  if (!(file instanceof TFile)) return { ok: false, code: "not-applicable" };
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const target = mailTargetFor(profile, file.path, frontmatter);
  if (!target) return { ok: false, code: "not-applicable" };

  const index = new Map<string, string>();
  for (const f of app.vault.getMarkdownFiles()) {
    const id: unknown = app.metadataCache.getFileCache(f)?.frontmatter?.[profile.idField];
    if (typeof id === "string" && id) index.set(id, f.path.replace(/\.md$/, ""));
  }

  const attachmentPaths = new Map<string, string>();
  let mail: Awaited<ReturnType<typeof parseEml>> | undefined;
  if (descriptor.needs?.eml) {
    const emlFile = app.vault.getAbstractFileByPath(normalizePath(emlPathFor(profile, file.path)));
    if (!(emlFile instanceof TFile)) return { ok: false, code: "eml-missing" };
    let parsed: Awaited<ReturnType<typeof parseEml>>;
    try {
      parsed = await parseEml(new Uint8Array(await app.vault.readBinary(emlFile)));
    } catch {
      return { ok: false, code: "eml-unparseable" };
    }
    const check = verifyEml(parsed, target.mailId);
    if (!check.ok) return { ok: false, code: check.code };
    mail = parsed;
    // getAvailablePathForAttachment ist async, `plan()` ist synchron — also hier aufloesen.
    for (const a of parsed.attachments.filter((x) => !x.inline)) {
      attachmentPaths.set(a.name, await app.fileManager.getAvailablePathForAttachment(a.name, file.path));
    }
  }

  const notes = descriptor.needs?.allNotes ? await loadNotes(app, profile, deps.hashes) : undefined;

  return {
    ok: true,
    ctx: {
      now: deps.now(),
      profile,
      target,
      frontmatter,
      content: await app.vault.read(file),
      zoneHash: deps.hashes.get(target.mailId),
      linkFor: (id) => index.get(id) ?? null,
      attachmentPathFor: (name) => attachmentPaths.get(name) ?? `${name}`,
      ...(mail ? { mail } : {}),
      ...(notes ? { notes } : {}),
    },
  };
}

/**
 * Die volle Kette: Kontext bauen → (Formular, falls das Schema Felder hat) → Plan →
 * Vorschau → ausfuehren. Jeder Abbruch durch den Nutzer ist `cancelled`, kein Fehler.
 */
export async function runCommand(deps: CommandFlowDeps, execute: CommandExecuteDeps, descriptor: CommandDescriptor): Promise<RunResult> {
  const built = await buildContext(deps, descriptor, deps.app.workspace.getActiveFile());
  if (!built.ok) return { kind: "error", code: built.code };
  const ctx = built.ctx;
  if (!descriptor.appliesTo(ctx)) return { kind: "error", code: "not-applicable" };

  const schema = schemaOf(descriptor, ctx);
  let input: Record<string, unknown> = {};
  if (Object.keys(schema.properties).length > 0) {
    const picked = await new SchemaFormModal(deps.app, trTitle(descriptor), schema).pick();
    if (!picked) return { kind: "cancelled" };
    input = picked;
  }

  const planned = descriptor.plan(input, ctx);
  if (!planned.ok) return { kind: "error", code: planned.code };

  const go = await new PlanPreviewModal(deps.app, planned.plan).confirm();
  if (!go) return { kind: "cancelled" };

  return { kind: "done", result: await executeCommandPlan(planned.plan, execute) };
}
```

- [ ] **Step 7: Tests laufen lassen**

Run: `npx vitest run tests/obsidian/command-flow.test.ts`
Expected: PASS (9 Tests).

- [ ] **Step 8: i18n-Keys ergänzen (`src/i18n/strings.ts`)**

Zuerst die Wörterbücher exportierbar machen — der Paritätstest in Step 10 braucht sie:
`const en = {` → `export const en = {`, `const de: typeof en = {` → `export const de: typeof en = {`.

EN (kanonisch):

```typescript
  "cmd.mail.rerender.title": "Re-render mail note from its .eml",
  "cmd.mail.rerender.desc": "Rebuilds the message section and the derived front matter keys from the .eml stored next to the note. Anything you wrote outside the managed section stays untouched.",
  "cmd.mail.relink.title": "Relink mail threads",
  "cmd.mail.relink.desc": "Turns the message ids in in_reply_to and references into wikilinks wherever the target note exists. Runs across all mail notes.",
  "cmd.mail.extractAttachment.title": "Extract an attachment from a mail note",
  "cmd.mail.extractAttachment.desc": "Copies one attachment out of the .eml into the vault's attachment folder and links it from the note. The .eml keeps its own copy.",
  "cmd.mail.extractAttachment.field.name": "Which attachment to copy into the vault.",
  "cmd.mail.replyExternal.title": "Reply to a mail in the external mail client",
  "cmd.mail.replyExternal.desc": "Opens your system mail client with recipient, subject and thread reference filled in. Mailstone does not send this reply itself.",

  "plan.heading": "Review before writing",
  "plan.col.field": "Field", "plan.col.before": "Before", "plan.col.after": "After",
  "plan.execute": "Apply", "plan.cancel": "Cancel",
  "plan.field.attachment": "Attachment",
  "plan.mail.rerender.summary": "Rebuild this note from its .eml: {0} front matter key(s) change, message section is rewritten.",
  "plan.mail.relink.summary": "{0} note(s) get new wikilinks in in_reply_to or references.",
  "plan.mail.extractAttachment.summary": "Copy {0} into the vault as {1} and link it from this note.",
  "plan.mail.replyExternal.summary": "Open your mail client with a reply to {0}.",

  "notice.command.done": "Done: {0} note(s) written, {1} skipped.",
  "notice.command.attachment": "Attachment saved as {0}.",

  "error.command.busy": "A synchronisation or another command is running. Try again in a moment.",
  "error.command.invalid-input": "The values you entered are not valid.",
  "error.command.not-applicable": "This command does not apply to the note you have open.",
  "error.command.eml-missing": "The .eml belonging to this note was not found. It is expected in the _eml subfolder next to the note — moving or renaming the note breaks that link.",
  "error.command.eml-unparseable": "The .eml belonging to this note could not be read.",
  "error.command.eml-mismatch": "The .eml next to this note belongs to a different message. Nothing was changed.",
  "error.command.fences-missing": "This note has no managed message section (the %% mailstone:begin %% … %% mailstone:end %% markers). Mailstone will not guess where its content belongs.",
  "error.command.zone-edited": "The message section of this note was edited by hand. Re-rendering would discard those edits, so nothing was written.",
  "error.command.frontmatter-unparseable": "A front matter key managed by Mailstone is written as a multi-line block, which cannot be rewritten safely.",
  "error.command.attachment-missing": "That attachment is not in the .eml.",
  "error.command.no-recipient": "This note has no sender address to reply to.",
  "error.command.nothing-to-do": "Nothing to change.",
  "error.command.write-failed": "Writing failed. Nothing or only part of it was saved — check the note.",
```

DE:

```typescript
  "cmd.mail.rerender.title": "Mail-Notiz aus ihrer .eml neu aufbauen",
  "cmd.mail.rerender.desc": "Baut den Nachrichtenabschnitt und die abgeleiteten Frontmatter-Felder aus der .eml neu, die neben der Notiz liegt. Was du außerhalb des verwalteten Abschnitts geschrieben hast, bleibt unberührt.",
  "cmd.mail.relink.title": "Mail-Threads neu verknüpfen",
  "cmd.mail.relink.desc": "Macht aus den Message-IDs in in_reply_to und references Wikilinks, wo die Zielnotiz existiert. Läuft über alle Mail-Notizen.",
  "cmd.mail.extractAttachment.title": "Anhang aus einer Mail-Notiz herausholen",
  "cmd.mail.extractAttachment.desc": "Kopiert einen Anhang aus der .eml in den Anhangordner des Vaults und verlinkt ihn in der Notiz. Die .eml behält ihre eigene Kopie.",
  "cmd.mail.extractAttachment.field.name": "Welcher Anhang in den Vault kopiert werden soll.",
  "cmd.mail.replyExternal.title": "Auf eine Mail im externen Mailprogramm antworten",
  "cmd.mail.replyExternal.desc": "Öffnet dein Mailprogramm mit Empfänger, Betreff und Thread-Bezug. Mailstone verschickt diese Antwort nicht selbst.",

  "plan.heading": "Vor dem Schreiben prüfen",
  "plan.col.field": "Feld", "plan.col.before": "Vorher", "plan.col.after": "Nachher",
  "plan.execute": "Anwenden", "plan.cancel": "Abbrechen",
  "plan.field.attachment": "Anhang",
  "plan.mail.rerender.summary": "Diese Notiz aus ihrer .eml neu aufbauen: {0} Frontmatter-Felder ändern sich, der Nachrichtenabschnitt wird neu geschrieben.",
  "plan.mail.relink.summary": "{0} Notizen bekommen neue Wikilinks in in_reply_to oder references.",
  "plan.mail.extractAttachment.summary": "{0} als {1} in den Vault kopieren und in dieser Notiz verlinken.",
  "plan.mail.replyExternal.summary": "Mailprogramm mit einer Antwort an {0} öffnen.",

  "notice.command.done": "Fertig: {0} Notizen geschrieben, {1} übersprungen.",
  "notice.command.attachment": "Anhang gespeichert als {0}.",

  "error.command.busy": "Es läuft gerade eine Synchronisation oder ein anderes Kommando. Bitte gleich noch einmal versuchen.",
  "error.command.invalid-input": "Die eingegebenen Werte sind ungültig.",
  "error.command.not-applicable": "Dieses Kommando passt nicht zur geöffneten Notiz.",
  "error.command.eml-missing": "Die .eml zu dieser Notiz wurde nicht gefunden. Sie wird im Unterordner _eml neben der Notiz erwartet — wer die Notiz verschiebt oder umbenennt, trennt diese Verbindung.",
  "error.command.eml-unparseable": "Die .eml zu dieser Notiz konnte nicht gelesen werden.",
  "error.command.eml-mismatch": "Die .eml neben dieser Notiz gehört zu einer anderen Nachricht. Es wurde nichts geändert.",
  "error.command.fences-missing": "Diese Notiz hat keinen verwalteten Nachrichtenabschnitt (die Markierungen %% mailstone:begin %% … %% mailstone:end %%). Mailstone rät nicht, wohin sein Inhalt gehört.",
  "error.command.zone-edited": "Der Nachrichtenabschnitt dieser Notiz wurde von Hand geändert. Ein Neuaufbau würde diese Änderungen verwerfen, deshalb wurde nichts geschrieben.",
  "error.command.frontmatter-unparseable": "Ein von Mailstone verwaltetes Frontmatter-Feld steht als mehrzeiliger Block, der sich nicht gefahrlos ersetzen lässt.",
  "error.command.attachment-missing": "Dieser Anhang steckt nicht in der .eml.",
  "error.command.no-recipient": "In dieser Notiz steht keine Absenderadresse, an die geantwortet werden könnte.",
  "error.command.nothing-to-do": "Es gibt nichts zu ändern.",
  "error.command.write-failed": "Das Schreiben ist fehlgeschlagen. Es wurde nichts oder nur ein Teil gespeichert — sieh in der Notiz nach.",
```

- [ ] **Step 9: Verdrahtung in `src/main.ts`**

Importe ergänzen:

```typescript
import { commandRegistry, ensureDefaultCommands } from "./core/commands/registry";
import type { CommandDescriptor } from "./core/commands/types";
import type { CommandExecuteDeps } from "./core/commands/execute";
import { runCommand, probeFor, type RunResult } from "./obsidian/command-flow";
import { trTitle } from "./obsidian/command-i18n";
import { writeAttachment, type ZoneHashStore } from "./obsidian/vault-notes";
```

Zwei private Helfer an der Plugin-Klasse — sie liefern dieselben Objekte, die `onload()` schon für den Sync baut, aber auch außerhalb von dessen Gültigkeitsbereich:

```typescript
  private hashStore(): ZoneHashStore {
    return { get: (k) => this.zoneHashes[k] ?? null, set: (k, v) => { this.zoneHashes[k] = v; } };
  }

  private commandExecuteDeps(): CommandExecuteDeps {
    return {
      // Derselbe Guard wie der SyncService: ein laufender Sync und ein Kommando schliessen
      // einander aus.
      busy: this.busy,
      notes: vaultPlanExecutor(this.app, this.hashStore()),
      writeAttachment: writeAttachment(this.app),
      openExternal: (url: string) => { window.open(url); },
    };
  }

  /** Faehrt ein Kommando und meldet das Ergebnis. Ein Abbruch durch den Nutzer meldet
   *  nichts — er weiss, dass er abgebrochen hat. Die Zone-Hashes werden auch nach einem
   *  Fehlschlag persistiert (dieselbe Begruendung wie beim Import- und beim Sync-Kommando:
   *  sonst gilt eine geschriebene Notiz beim naechsten Lauf als fremd editiert). */
  private async runMailCommand(descriptor: CommandDescriptor, notify: Notifier): Promise<void> {
    let outcome: RunResult;
    try {
      outcome = await runCommand(
        { app: this.app, profile: () => this.settings.profile, hashes: this.hashStore(), now: () => new Date() },
        this.commandExecuteDeps(),
        descriptor,
      );
    } finally {
      await this.saveSettings();
    }
    if (outcome.kind === "cancelled") return;
    if (outcome.kind === "error") { notify.error(`error.command.${outcome.code}`); return; }
    const r = outcome.result;
    if (!r.ok) { notify.error(`error.command.${r.code}`); return; }
    notify.info("notice.command.done", r.created + r.updated, r.skipped.length);
    if (r.attachmentPath) notify.info("notice.command.attachment", r.attachmentPath);
  }
```

In `onload()`, nach der Registrierung von `sync-mailbox`:

```typescript
    // Ohne diesen Aufruf bliebe die Registry leer und jedes Kommando waere unauffindbar —
    // genau der Fehler, den calendar-notes erst im GUI-Smoke bemerkte.
    ensureDefaultCommands();
    for (const descriptor of commandRegistry()) {
      this.addCommand({
        // Obsidian-Kommando-IDs tragen keine Punkte; die Deskriptor-ID bleibt unberuehrt.
        id: descriptor.id.replace(/\./g, "-"),
        name: trTitle(descriptor),
        // checkCallback statt callback: ein Kommando, das zur geoeffneten Notiz nicht passt,
        // steht gar nicht erst in der Palette — statt dort zu stehen und eine Fehlermeldung
        // zu zeigen.
        checkCallback: (checking: boolean): boolean => {
          const probe = probeFor(this.app, this.settings.profile);
          if (!probe || !descriptor.appliesTo(probe)) return false;
          if (!checking) void this.runMailCommand(descriptor, notify);
          return true;
        },
      });
    }
```

- [ ] **Step 10: i18n-Paritätstest schreiben**

`tests/i18n/commands.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { en, de } from "../../src/i18n/strings";
import { MAIL_COMMANDS } from "../../src/core/commands/mail-commands";

const COMMAND_ERROR_CODES = [
  "busy", "invalid-input", "not-applicable", "eml-missing", "eml-unparseable", "eml-mismatch",
  "fences-missing", "zone-edited", "frontmatter-unparseable", "attachment-missing",
  "no-recipient", "nothing-to-do", "write-failed",
] as const;

const dicts: [string, Record<string, string>][] = [["en", en], ["de", de]];

describe("i18n-Paritaet der Kommandos", () => {
  it.each(dicts)("%s kennt Titel und Beschreibung jedes registrierten Kommandos", (_lang, dict) => {
    for (const c of MAIL_COMMANDS) {
      expect(dict[c.titleKey], `${c.id}: titleKey`).toBeTruthy();
      expect(dict[c.descriptionKey], `${c.id}: descriptionKey`).toBeTruthy();
    }
  });

  it.each(dicts)("%s kennt jede Zusammenfassung", (_lang, dict) => {
    for (const c of MAIL_COMMANDS) expect(dict[`plan.${c.id}.summary`], `${c.id}: summary`).toBeTruthy();
  });

  it.each(dicts)("%s kennt jeden Fehlercode", (_lang, dict) => {
    for (const code of COMMAND_ERROR_CODES) expect(dict[`error.command.${code}`], code).toBeTruthy();
  });

  it("hat in beiden Sprachen dieselben Schluessel", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });
});
```

**Warum dieser Test mehr ist als Buchhaltung:** die Deskriptoren tragen ihre Schlüssel als Zeichenketten, und `t()` fällt bei einem Tippfehler still auf den Schlüssel zurück. Ohne diese Prüfung merkt man `cmd.mail.relink.titel` erst, wenn der Schlüssel als Knopfbeschriftung in der Kommandopalette steht.

- [ ] **Step 11: Volles Gate**

Run: `npm run gate`
Expected: grün. Erwartungswert der Testzahl: 312 (Stand `main`) + ca. 75 aus M3b.

- [ ] **Step 12: Commit**

```bash
git add src tests
git commit -m "feat(commands): Verdrahtung in Obsidian, i18n und Paritaetstest"
```

---

## Task 9: Live-Probe, Carry-over und Dokumentation

**Files:**
- Modify: `docs/SMOKE.md`
- Modify: `docs/superpowers/specs/2026-08-23-mailstone-design.md` (§ 3.2 Nachtrag)
- Modify: `../REGISTRY.md` (Dach — **deklarierte Scope-Ausnahme**, s. u.)
- Modify: `src/obsidian/calendar-notes-bridge.ts` (Carry-over)
- Test: `tests/core/smtp/client.test.ts` (Carry-over)

**Interfaces:** keine neuen.

- [ ] **Step 1: Carry-over aus der M1-Nachlese — mehrzeiliges SMTP-Greeting**

`readResponse` kann Mehrzeilen-Antworten (`220-` gefolgt von `220 `), geprüft war es nie. Test in `tests/core/smtp/client.test.ts` ergänzen:

```typescript
it("liest ein mehrzeiliges Greeting als eine Antwort", async () => {
  const socket = fakeSocket(["220-mail.example.org ESMTP\r\n", "220 ready\r\n", "250-mail.example.org\r\n", "250 AUTH PLAIN\r\n"]);
  // … bestehende Testform dieser Datei uebernehmen: verbinden, EHLO, Antwortcode pruefen
  // Erwartung: der Client sieht 220 (nicht "220-") und faehrt mit EHLO fort.
});
```

Die genaue Form richtet sich nach den vorhandenen Tests derselben Datei — Fake-Socket, kein echtes Netz.

- [ ] **Step 2: Carry-over — `unregister()` bei gewechselter API-Identität**

In `src/obsidian/calendar-notes-bridge.ts` ruft `unregister()` die **aktuelle** `api`-Instanz mit der eigenen ID auf. Hat calendar-notes zwischenzeitlich neu geladen, ist das ein idempotenter No-op auf einer fremden Instanz — harmlos, aber beim Lesen irreführend. Die gemerkte Instanz beim Registrieren festhalten und beim Abmelden dieselbe verwenden; passt ein bestehender Test nicht mehr, mitziehen.

**Nicht in diesem Task:** der Orphan-Secret-Pfad aus derselben Liste („Geheimnis hinzufügen" → Abbrechen hinterlässt einen Schlüsselbund-Eintrag ohne Konto). Er gehört zur Konten-UI, und die wird in M4 ohnehin angefasst; er bleibt in `M1-Nachlese — Deferred-Punkte aus den Reviews` stehen.

- [ ] **Step 3: Live-Probe gegen ein laufendes Obsidian**

⚠️ **Vorbedingungen, bevor irgendetwas gestartet wird** (Dach-`AGENTS.md`, „Staging-Vaults"):

```bash
lsof -nP -iTCP:9222 -sTCP:LISTEN            # hoert der Port schon? dann MITNUTZEN, nicht neu starten
curl -s http://127.0.0.1:9222/json/list | python3 -c "
import json,sys
for t in json.load(sys.stdin):
    if t.get('type') == 'page': print(' ·', t.get('title'))"   # wen traefe ein Quit?
python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label mailstone --exclusive focus \
  --intent "M3b Live-Probe Vault-Kommandos"
```

Der Lock ist die Eintrittskarte, nicht eine Schutzoption — ohne ihn blockt der Guard jeden CDP-Zugriff. `--exclusive focus`, weil gemessen und nicht gequittet wird. Am Ende `release`.

Prüfpunkte (Ergebnis nach `docs/SMOKE.md`, Abschnitt „M3b — Vault-Kommandos", mit Datum und Obsidian-Version):

1. Eine per Sync angelegte Mail-Notiz öffnen → alle vier Kommandos stehen in der Palette.
2. Eine **fremde** Notiz (ohne `mail_id`) öffnen → **keines** der vier steht dort.
3. `mail.rerender` auf einer unveränderten Notiz → Meldung „Es gibt nichts zu ändern", keine Schreiboperation.
4. Im freien Bereich der Notiz etwas ergänzen, dann `mail.rerender` → Vorschau, anwenden, **der eigene Text steht unverändert da**.
5. In der Zone ein Zeichen ändern, dann `mail.rerender` → `zone-edited`, **nichts** geschrieben (Datei-Zeitstempel prüfen).
6. `mail.relink` bei zwei Notizen desselben Threads → `in_reply_to` wird zum Wikilink, der beim Klick trägt.
7. `mail.extractAttachment` auf einer Mail mit Anhang → Dropdown zeigt genau die Anhänge, Datei landet im Anhangordner, Link in der Notiz funktioniert, `.eml` unverändert.
8. `mail.replyExternal` → das Mailprogramm öffnet sich mit Empfänger, `Re: …` und gesetztem `In-Reply-To` (im Client-Fenster sichtbar oder am erzeugten Entwurf prüfbar).
9. Während eines laufenden Sync ein Kommando auslösen → „Es läuft gerade eine Synchronisation" statt eines zweiten Schreibwegs.

- [ ] **Step 4: Spec-Nachtrag § 3.2**

Zwei Ergänzungen mit Datum, in derselben Form wie die bestehenden „⚠️ Geändert in M3"-Marken:
- `CommandDescriptor` hat gegenüber der calendar-notes-Vorlage ein optionales `schemaFor(ctx)` — gebraucht, weil die Anhangliste erst aus der geparsten `.eml` entsteht und als `enum` das Formular zum Dropdown macht.
- `mail.replyExternal` ist mit M3b gebaut (in der Tabelle als Vault-Kommando geführt, aber keinem Meilenstein zugeordnet gewesen). `mail.createTask` bleibt M5.

- [ ] **Step 5: REGISTRY-Eintrag im Dach (deklarierte Scope-Ausnahme)**

Dies ist die einzige Änderung dieses Plans außerhalb von `mailstone`. Sie ist nach der Tabelle in `session-start` § 3b-3 legitim („Dach anfassen: Standards, REGISTRY, Tools liegen dort") und gehört ins Dach-Repo mit eigenem Commit.

In `REGISTRY.md` die Zeile „**Schreib-Kommandos als Deskriptoren mit JSON-Schema**" (bisher `calendar-notes`, Muster-Referenz 2026-08-23) um die zweite Instanz erweitern: `mailstone/src/core/commands/` — Status auf **n=2 → Kit-Kandidat**. Dazu die Unterschiede benennen, weil sie die Abstraktionsgrenze zeigen und genau das ist, wofür die zweite Instanz gebraucht wurde:
- Plan-Typ **nicht** geteilt (CalDAV-PUT gegen Vault-`NotePlan`) — uniform sind Deskriptor, Schema-Validator und Registry, nicht der Plan.
- `schemaFor(ctx)` als Ergänzung für kontextabhängige Auswahlen.
- Zweiteilung `CommandProbe`/`CommandContext`, damit `checkCallback` synchron und billig bleibt.

Ein zweiter Eintrag für den **Frontmatter-only-Merge** (`mergeFrontmatterOnly`: bestehende Keys in-place ändern, Body byte-identisch lassen, fehlende Keys nicht anlegen) — n=1, Muster-Referenz.

- [ ] **Step 6: Volles Gate und Abschluss**

Run: `npm run gate`
Expected: grün.

```bash
git add docs src tests
git commit -m "docs(m3b): Live-Probe protokolliert, Spec-Nachtrag, Carry-over aus der M1-Nachlese"
```

Danach im Dach-Repo: `git add REGISTRY.md && git commit -m "docs(registry): Kommando-Deskriptoren n=2 (mailstone), Frontmatter-only-Merge"`.

- [ ] **Step 7: Push und Mirror-Messung**

```bash
git push origin main
```

⚠️ **Hier steht eine offene Messung an, die diese Gelegenheit braucht** (Dach-`AGENTS.md`, Nachtrag 2026-08-30): ob `mailstone` einen wirksamen Forgejo→GitHub-Mirror hat, ist **nicht** entschieden — beide bisherigen Messungen tragen den Schluss nicht. Also **nicht sofort nachschieben**, sondern ein paar Minuten warten und dann messen:

```bash
git ls-remote github main    # zeigt er auf denselben Commit wie origin?
```

Trägt der Mirror: Ergebnis im Cockpit und in der Dach-`AGENTS.md` festhalten. Trägt er nicht: `git push github main` nachsetzen **und** `mailstone` als fünftes Repo ohne wirksamen Mirror eintragen. So oder so ist die Frage danach beantwortet statt weitergereicht.

---

## Definition of Done

- [ ] `npm run gate` grün (Lint, Typecheck × 3, Unit, Integration, `check:pure`, Build, Bundle-Test).
- [ ] Die neun Prüfpunkte aus Task 9 Step 3 sind gegen ein laufendes Obsidian gefahren und in `docs/SMOKE.md` protokolliert — mit Datum, Obsidian-Version und dem, was **nicht** funktioniert hat.
- [ ] Kein Kommando schreibt ohne Vorschau; `mail.rerender` schreibt nicht bei `zone-edited`.
- [ ] Jeder Kommando- und Fehlerschlüssel existiert in EN **und** DE (Paritätstest aus Task 8).
- [ ] REGISTRY im Dach nachgezogen (eigener Commit im Dach-Repo).
- [ ] Die M1-Nachlese-Task ist um die zwei erledigten Punkte gekürzt; der Orphan-Secret-Punkt steht dort mit dem Vermerk „gehört zu M4".
- [ ] Die Mirror-Frage aus Task 9 Step 7 ist beantwortet, nicht weitergereicht.

## Was dieser Plan bewusst offen lässt

- **Kein `mail.delete`, keine Massenaktion mit Vorauswahl** — Spec § 3.2 schließt beides aus, und `mail.relink` ist die einzige Ausnahme davon: es wirkt auf viele Notizen, ändert aber nur Verweise und legt nichts an.
- **Kein Rückgängig.** `calendar-notes` hat `undo.last` über einen Verlauf im Collection-State; mailstone hat keinen solchen Zustand, und die Vault-Historie ist Obsidians Aufgabe. Wenn sich das ändert, ist es ein eigener Plan, kein Anhängsel.
- **Keine Anbieter-API.** Der Rahmen wäre dafür geeignet (`commandsFor`, `schemaOf`, `plan`/`execute` getrennt), aber ein Vertrag nach außen will eigene Versionierung und `docs/API.md` — das ist eine Entscheidung, kein Nebenprodukt.
