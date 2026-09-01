# Sidebar-Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Betriebsansicht in der rechten Seitenleiste, die pro Konto letzten Lauf, nächsten Lauf, Zähler und Fehler zeigt und einen Sync auslösen kann.

**Architecture:** Zwei pure Module tragen die Logik (`run-state.ts` hält den letzten Lauf je Konto, `cockpit-vm.ts` rechnet daraus ein ViewModel), zwei DOM-Module zeigen sie an (`cockpit-panel.ts` nach dem Kit-`HubPanel`-Vertrag, `mailstone-view.ts` als die eine `ItemView`). `main.ts` verbindet beides über ein schmales Host-Interface und füttert das Register dort, wo `runSync()` die vollständigen Ergebnisse hat.

**Tech Stack:** TypeScript · vitest · Obsidian Plugin API 1.13 · Obsidian-Mock aus `tests/vendor/kit/obsidian-mock.ts`

**Spec:** `docs/superpowers/specs/2026-09-01-sidebar-cockpit-design.md`

## Global Constraints

- **`src/core/**` bleibt pur.** Kein Import von `obsidian`, `electron`, `node:*`, `fs`, `path`, `http`, `https`, `net`, `tls`, `child_process`; keine DOM-Globals. Gate: `npm run check:pure`.
- **Texte nur über `t()`** aus `src/i18n/strings.ts`, Schlüssel in **beiden** Blöcken (`en` und `de`). Kein Fachbegriff ohne Auflösung (UI-STANDARD §10).
- **CSS nur mit Theme-Variablen**, keine festen Farben (UI-STANDARD §3). Neue Regeln in `styles.css`, Präfix `mailstone-cockpit-`.
- **Genau ein `registerView`-Type** im ganzen Plugin (UI-STANDARD §1).
- **Status-Indikator-Vokabel ist verbindlich** (UI-STANDARD §8): Klassen `is-checking` / `is-ok` / `is-error` / `is-warning`, Icons `loader` / `circle-check` / `circle-x` / `alert-triangle`, dazu immer ein `aria-label` — Farbe nie allein.
- **Jede übernommene Datei trägt den Herkunftsstempel** in Zeile 1: `// uebernommen aus <repo>/<pfad>, 2026-09-01`.
- **Mutation als Gegenprobe für jeden Test.** Nach Grün: die Implementierung gezielt kaputtmachen, Test rot sehen, zurücknehmen. Ein Test, der bei kaputtem Code grün bleibt, misst nichts.
- **Gate vor jedem Merge:** `npm run gate` (lint · typecheck · typecheck:test · typecheck:scripts · test · test:integration · check:pure · build · bundle).

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/core/sync/run-state.ts` | *neu, pur.* `RunInfo` je Konto; `recordRun`, `parseRunState`, `nextDueAt` |
| `src/core/view/cockpit-vm.ts` | *neu, pur.* `buildCockpitViewModel` — Zustandszuordnung, Zählerverdichtung, Empty-State |
| `src/obsidian/views/cockpit-panel.ts` | *neu, DOM.* Kit-`HubPanel`-Vertrag; rendert das ViewModel |
| `src/obsidian/views/mailstone-view.ts` | *neu, DOM.* Die eine `ItemView`; mountet das Panel |
| `src/i18n/strings.ts` | *ändern.* Neue Schlüssel in `en` **und** `de` |
| `styles.css` | *ändern.* `mailstone-cockpit-*`-Regeln |
| `src/main.ts` | *ändern.* `PersistedState.runState`, `registerView`, Öffnen mit `revealLeaf`, Ribbon, Kommando, Opt-in-Setting, `recordRun`-Aufruf |
| `src/obsidian/settings-tab.ts` | *ändern.* Toggle „Beim Start öffnen" |

---

## Task 1: Lauf-Register (pur)

**Files:**
- Create: `src/core/sync/run-state.ts`
- Test: `tests/core/sync/run-state.test.ts`

**Interfaces:**
- Consumes: `SyncRunResult` und `SyncCounts` aus `src/core/sync/service.ts` bzw. `src/core/sync/events.ts`; `Account` aus `src/core/settings.ts`; `SyncErrorCode` aus `src/core/sync/errors.ts`
- Produces:
  - `interface RunInfo { at: number; ok: boolean; code?: SyncErrorCode; counts: SyncCounts }`
  - `type RunState = Record<string, RunInfo>`
  - `function recordRun(state: RunState, results: readonly SyncRunResult[], at: number): RunState`
  - `function parseRunState(raw: unknown): RunState`
  - `function nextDueAt(account: Account, lastRunMs: number | undefined): number | null`

> **Herkunft:** Vorlage ist `calendar-notes/src/core/state/collection-state.ts` (`RunInfo`, `withRun`, defensives Lesen in `parseState`). Zwei bewusste Abweichungen: `code?: SyncErrorCode` statt `error?: string`, weil mailstone die Meldung über `error.sync.${code}` auflöst; `at` als Millisekunden-Zahl statt ISO-String, weil `dueAccounts` und `nextDueAt` ohnehin in ms rechnen.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/sync/run-state.test.ts
import { describe, it, expect } from "vitest";
import { recordRun, parseRunState, nextDueAt, type RunState } from "../../../src/core/sync/run-state";
import { newAccount, type Account } from "../../../src/core/settings";
import type { SyncCounts } from "../../../src/core/sync/events";

const MIN = 60_000;
const NIX: SyncCounts = { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 };

function acc(id: string, intervalMin: number, enabled = true): Account {
  const a = newAccount(id);
  a.sync = { enabled, intervalMin };
  return a;
}

describe("recordRun", () => {
  it("haelt Erfolg mit Zaehlern und ohne Code", () => {
    const next = recordRun({}, [{ ok: true, accountId: "a", counts: { ...NIX, created: 3 } }], 1000);
    expect(next["a"]).toEqual({ at: 1000, ok: true, counts: { ...NIX, created: 3 } });
    expect(next["a"]?.code).toBeUndefined();
  });

  it("haelt den Fehlercode, damit die Anzeige error.sync.<code> aufloesen kann", () => {
    const next = recordRun({}, [{ ok: false, accountId: "a", code: "auth" }], 2000);
    expect(next["a"]?.ok).toBe(false);
    expect(next["a"]?.code).toBe("auth");
  });

  it("ersetzt den Vorlauf desselben Kontos und laesst fremde Konten unberuehrt", () => {
    const vorher: RunState = { a: { at: 1, ok: false, code: "connect", counts: NIX }, b: { at: 5, ok: true, counts: NIX } };
    const next = recordRun(vorher, [{ ok: true, accountId: "a", counts: NIX }], 9);
    expect(next["a"]).toEqual({ at: 9, ok: true, counts: NIX });
    expect(next["b"]).toBe(vorher["b"]);
  });

  it("mutiert den Eingabezustand nicht", () => {
    const vorher: RunState = { a: { at: 1, ok: true, counts: NIX } };
    recordRun(vorher, [{ ok: true, accountId: "a", counts: NIX }], 9);
    expect(vorher["a"]?.at).toBe(1);
  });

  it("bucht einen busy-Lauf NICHT als Lauf", () => {
    // `busy` heisst: ein anderer Lauf hielt die Sperre, dieses Konto wurde gar nicht
    // synchronisiert. Es als Lauf zu buchen ueberschriebe den letzten echten Stand mit
    // einem Nicht-Ereignis — dieselbe Ueberlegung, aus der runDueSyncs den lastRun-Stempel
    // bei `busy` zuruecknimmt (main.ts).
    const vorher: RunState = { a: { at: 1, ok: true, counts: NIX } };
    const next = recordRun(vorher, [{ ok: false, accountId: "a", code: "busy" }], 9);
    expect(next["a"]).toEqual({ at: 1, ok: true, counts: NIX });
  });
});

describe("parseRunState", () => {
  it("liefert leer bei Unsinn statt zu werfen", () => {
    expect(parseRunState(undefined)).toEqual({});
    expect(parseRunState(null)).toEqual({});
    expect(parseRunState("kaputt")).toEqual({});
    expect(parseRunState(42)).toEqual({});
    expect(parseRunState([1, 2])).toEqual({});
  });

  it("wirft einzelne unbrauchbare Eintraege weg und behaelt die guten", () => {
    const raw = {
      gut: { at: 5, ok: true, counts: NIX },
      ohneAt: { ok: true, counts: NIX },
      atText: { at: "gestern", ok: true, counts: NIX },
      ohneCounts: { at: 5, ok: true },
      keinObjekt: 7,
    };
    expect(Object.keys(parseRunState(raw))).toEqual(["gut"]);
  });

  it("behaelt den Code nur, wenn er eine Zeichenkette ist", () => {
    const raw = { a: { at: 5, ok: false, code: 42, counts: NIX } };
    expect(parseRunState(raw)["a"]?.code).toBeUndefined();
  });
});

describe("nextDueAt", () => {
  it("rechnet Intervall auf den letzten Lauf", () => {
    expect(nextDueAt(acc("a", 5), 10 * MIN)).toBe(15 * MIN);
  });

  it("liefert null fuer ein deaktiviertes Konto — es wird nie faellig", () => {
    expect(nextDueAt(acc("a", 5, false), 10 * MIN)).toBeNull();
  });

  it("liefert null ohne bekannten letzten Lauf — faellig heisst sofort, nicht irgendwann", () => {
    expect(nextDueAt(acc("a", 5), undefined)).toBeNull();
  });

  it("klemmt einen unbrauchbaren Intervallwert auf einen Takt, wie dueAccounts", () => {
    // Gleiche Begruendung wie in schedule.ts: NaN-Vergleiche sind immer false, ein Konto
    // waere sonst nie wieder faellig — ein stiller Ausfall ist der schlechtere Ausgang.
    const kaputt = acc("a", Number.NaN);
    expect(nextDueAt(kaputt, 10 * MIN)).toBe(11 * MIN);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/sync/run-state.test.ts`
Expected: FAIL — `Failed to resolve import "../../../src/core/sync/run-state"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/sync/run-state.ts
// uebernommen aus calendar-notes/src/core/state/collection-state.ts, 2026-09-01 —
// RunInfo/withRun/parseState an mailstone angepasst: `code?: SyncErrorCode` statt
// `error?: string` (die Anzeige loest ueber error.sync.<code> auf) und `at` in
// Millisekunden statt ISO (dueAccounts/nextDueAt rechnen in ms).
import type { Account } from "../settings";
import type { SyncCounts } from "./events";
import type { SyncErrorCode } from "./errors";
import type { SyncRunResult } from "./service";
import { TICK_MS } from "./schedule";

/** Der letzte Lauf eines Kontos — das, was die Statusleiste heute nur fluechtig zeigt. */
export interface RunInfo {
  at: number;
  ok: boolean;
  code?: SyncErrorCode;
  counts: SyncCounts;
}

export type RunState = Record<string, RunInfo>;

const COUNT_KEYS = ["created", "reattached", "detached", "skipped", "detachSkipped", "errors"] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseCounts(v: unknown): SyncCounts | null {
  if (!isObj(v)) return null;
  const out = {} as Record<string, number>;
  for (const k of COUNT_KEYS) {
    const n = v[k];
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out[k] = n;
  }
  return out as unknown as SyncCounts;
}

/** Schreibt die Ergebnisse eines Laufs fort. Rein: der Eingabezustand bleibt unberuehrt.
 *
 *  `busy` wird uebersprungen — es heisst, dass ein anderer Lauf die Sperre hielt und dieses
 *  Konto gar nicht lief. Es zu buchen ueberschriebe den letzten echten Stand mit einem
 *  Nicht-Ereignis (dieselbe Ueberlegung wie die Ruecknahme des lastRun-Stempels in
 *  runDueSyncs). */
export function recordRun(state: RunState, results: readonly SyncRunResult[], at: number): RunState {
  const next: RunState = { ...state };
  for (const r of results) {
    if (!r.ok && r.code === "busy") continue;
    next[r.accountId] = r.ok
      ? { at, ok: true, counts: r.counts }
      : { at, ok: false, code: r.code, counts: emptyCounts() };
  }
  return next;
}

function emptyCounts(): SyncCounts {
  return { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 };
}

/** Liest das Register aus `data.json`. Defensiv wie `parseState` in calendar-notes: ein
 *  unbrauchbarer Einzeleintrag faellt weg, er nimmt nicht das ganze Register mit. */
export function parseRunState(raw: unknown): RunState {
  if (!isObj(raw)) return {};
  const out: RunState = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!isObj(v)) continue;
    const at = v["at"];
    const ok = v["ok"];
    const counts = parseCounts(v["counts"]);
    if (typeof at !== "number" || !Number.isFinite(at) || typeof ok !== "boolean" || !counts) continue;
    const code = v["code"];
    out[id] = typeof code === "string" ? { at, ok, code: code as SyncErrorCode, counts } : { at, ok, counts };
  }
  return out;
}

/** Wann das Konto fruehestens wieder laeuft — `null`, wenn die Frage nicht beantwortbar ist
 *  (Konto aus, oder in dieser Sitzung noch kein Lauf bekannt). Die Klemmung auf einen Takt
 *  ist dieselbe wie in `dueAccounts`, damit Anzeige und Wecker nicht auseinanderlaufen. */
export function nextDueAt(account: Account, lastRunMs: number | undefined): number | null {
  if (!account.sync.enabled) return null;
  if (lastRunMs === undefined) return null;
  const wert = Number(account.sync.intervalMin);
  const everyMs = Number.isFinite(wert) && wert > 0 ? Math.max(TICK_MS, wert * TICK_MS) : TICK_MS;
  return lastRunMs + everyMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/sync/run-state.test.ts`
Expected: PASS (16 Tests)

- [ ] **Step 5: Mutation als Gegenprobe**

Jede Mutation einzeln setzen, Test laufen lassen, **zurücknehmen**. Erwartet ist jeweils genau ein roter Test:

| Mutation | erwartet rot |
|---|---|
| in `recordRun` die `busy`-Zeile (`if (!r.ok && r.code === "busy") continue;`) entfernen | „bucht einen busy-Lauf NICHT als Lauf" |
| in `recordRun` `next[r.accountId] = …` direkt auf `state` schreiben statt auf die Kopie | „mutiert den Eingabezustand nicht" |
| in `parseRunState` die `parseCounts`-Prüfung durch `const counts = v["counts"] as SyncCounts` ersetzen | „wirft einzelne unbrauchbare Eintraege weg" |
| in `nextDueAt` die `Number.isFinite`-Klemmung durch `wert * TICK_MS` ersetzen | „klemmt einen unbrauchbaren Intervallwert" |

Bleibt eine Mutation grün, misst der zugehörige Test nichts — Test nachschärfen, bevor es weitergeht.

- [ ] **Step 6: check:pure und commit**

```bash
npm run check:pure
git add src/core/sync/run-state.ts tests/core/sync/run-state.test.ts
git commit -m "feat(cockpit): Lauf-Register je Konto - was ein Sync ergab, ueberlebt jetzt den Lauf"
```

---

## Task 2: ViewModel (pur)

**Files:**
- Create: `src/core/view/cockpit-vm.ts`
- Modify: `src/i18n/strings.ts` (neue Schlüssel in `en` **und** `de`)
- Test: `tests/core/view/cockpit-vm.test.ts`

**Interfaces:**
- Consumes: `RunInfo`, `RunState` aus Task 1; `Account` aus `src/core/settings.ts`
- Produces:
  - `type CockpitState = "checking" | "ok" | "warning" | "error" | "never"`
  - `interface CockpitRow { accountId: string; label: string; state: CockpitState; lastRunAt: number | null; nextRunAt: number | null; countsKey: string | null; countsArgs: readonly (string | number)[]; errorKey: string | null; disabled: boolean }`
  - `interface CockpitViewModel { rows: readonly CockpitRow[]; empty: boolean; busy: boolean }`
  - `function buildCockpitViewModel(input: CockpitInput): CockpitViewModel`
  - `interface CockpitInput { accounts: readonly Account[]; runState: RunState; nextDue: (accountId: string) => number | null; busy: boolean }`

> **Warum das ViewModel Schlüssel statt Text liefert:** `t()` lebt in `src/i18n`, das Modul liegt unter `src/core/**` und muss pur bleiben. Die Auflösung passiert im Panel (Task 3). Der `state` trägt hier die Vokabel *ohne* `is-`-Präfix; die Klassenschreibweise ist Sache der Darstellung.

- [ ] **Step 1: i18n-Schlüssel ergänzen**

In `src/i18n/strings.ts` im `en`-Block einfügen (vor der schließenden Klammer des Objekts):

```ts
  "cockpit.title": "Mailstone",
  "cockpit.syncAll": "Synchronise all",
  "cockpit.syncOne": "Synchronise now",
  "cockpit.empty": "No accounts set up yet.",
  "cockpit.empty.cta": "Open settings",
  "cockpit.never": "Not run yet",
  "cockpit.lastRun": "Last run {0}",
  "cockpit.nextRun": "Next run {0}",
  "cockpit.nextRun.off": "Automatic sync is off",
  "cockpit.running": "Synchronising…",
  "cockpit.counts.none": "No changes",
  "cockpit.counts.created": "{0} new",
  "cockpit.counts.reattached": "{0} relinked",
  "cockpit.counts.detached": "{0} detached",
  "cockpit.counts.skipped": "{0} skipped",
  "cockpit.counts.detachSkipped": "{0} detachments left out",
  "cockpit.counts.errors": "{0} errors",
  "cockpit.aria.ok": "Last run succeeded",
  "cockpit.aria.warning": "Last run succeeded, but left something out",
  "cockpit.aria.error": "Last run failed",
  "cockpit.aria.checking": "Synchronisation running",
  "settings.openViewOnStartup": "Open the panel at startup",
  "settings.openViewOnStartup.desc": "Off by default. The panel stays reachable via the ribbon icon and the command palette.",
```

Dieselben Schlüssel im `de`-Block:

```ts
  "cockpit.title": "Mailstone",
  "cockpit.syncAll": "Alle synchronisieren",
  "cockpit.syncOne": "Jetzt synchronisieren",
  "cockpit.empty": "Noch kein Konto eingerichtet.",
  "cockpit.empty.cta": "Einstellungen öffnen",
  "cockpit.never": "Noch nicht gelaufen",
  "cockpit.lastRun": "Zuletzt {0}",
  "cockpit.nextRun": "Nächster Lauf {0}",
  "cockpit.nextRun.off": "Automatischer Abgleich ist aus",
  "cockpit.running": "Synchronisiert…",
  "cockpit.counts.none": "Keine Änderungen",
  "cockpit.counts.created": "{0} neu",
  "cockpit.counts.reattached": "{0} wieder verknüpft",
  "cockpit.counts.detached": "{0} abgelöst",
  "cockpit.counts.skipped": "{0} übersprungen",
  "cockpit.counts.detachSkipped": "{0} Ablösungen ausgelassen",
  "cockpit.counts.errors": "{0} Fehler",
  "cockpit.aria.ok": "Letzter Lauf erfolgreich",
  "cockpit.aria.warning": "Letzter Lauf erfolgreich, hat aber etwas ausgelassen",
  "cockpit.aria.error": "Letzter Lauf gescheitert",
  "cockpit.aria.checking": "Abgleich läuft",
  "settings.openViewOnStartup": "Beim Start öffnen",
  "settings.openViewOnStartup.desc": "Standardmäßig aus. Die Ansicht bleibt über das Ribbon-Symbol und die Befehlspalette erreichbar.",
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/core/view/cockpit-vm.test.ts
import { describe, it, expect } from "vitest";
import { buildCockpitViewModel } from "../../../src/core/view/cockpit-vm";
import { newAccount, type Account } from "../../../src/core/settings";
import type { RunState } from "../../../src/core/sync/run-state";
import type { SyncCounts } from "../../../src/core/sync/events";

const NIX: SyncCounts = { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 };

function acc(id: string, label = id, enabled = true): Account {
  const a = newAccount(id);
  a.label = label;
  a.sync = { enabled, intervalMin: 5 };
  return a;
}

const keineFaelligkeit = (): number | null => null;

describe("buildCockpitViewModel — Zustandszuordnung", () => {
  it("ok bei erfolgreichem Lauf ohne Fehler", () => {
    const rs: RunState = { a: { at: 100, ok: true, counts: NIX } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.state).toBe("ok");
  });

  it("warning bei erfolgreichem Lauf mit Fehlern in den Zaehlern", () => {
    // Der Fall, fuer den is-warning im §8-Katalog steht: der Lauf ging durch und hat
    // trotzdem etwas ausgelassen — weder ok noch Fehler.
    const rs: RunState = { a: { at: 100, ok: true, counts: { ...NIX, errors: 2 } } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.state).toBe("warning");
  });

  it("warning auch bei ausgelassenen Abloesungen", () => {
    const rs: RunState = { a: { at: 100, ok: true, counts: { ...NIX, detachSkipped: 1 } } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.state).toBe("warning");
  });

  it("error bei gescheitertem Lauf, mit Schluessel error.sync.<code>", () => {
    const rs: RunState = { a: { at: 100, ok: false, code: "auth", counts: NIX } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.state).toBe("error");
    expect(vm.rows[0]?.errorKey).toBe("error.sync.auth");
  });

  it("never ohne Eintrag — und KEIN Indikatorzustand, den es nicht gibt", () => {
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: {}, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.state).toBe("never");
    expect(vm.rows[0]?.lastRunAt).toBeNull();
  });

  it("checking schlaegt jeden anderen Zustand, solange ein Lauf haengt", () => {
    const rs: RunState = { a: { at: 100, ok: false, code: "auth", counts: NIX } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: true });
    expect(vm.rows[0]?.state).toBe("checking");
    expect(vm.busy).toBe(true);
  });
});

describe("buildCockpitViewModel — Zaehlerverdichtung", () => {
  it("nennt nur die Zaehler ungleich null", () => {
    const rs: RunState = { a: { at: 100, ok: true, counts: { ...NIX, created: 3, reattached: 1 } } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.countsKey).toBe("cockpit.counts.created cockpit.counts.reattached");
    expect(vm.rows[0]?.countsArgs).toEqual([3, 1]);
  });

  it("sagt bei einem Lauf ohne Aenderung genau das — nicht sechs Nullen", () => {
    const rs: RunState = { a: { at: 100, ok: true, counts: NIX } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.countsKey).toBe("cockpit.counts.none");
    expect(vm.rows[0]?.countsArgs).toEqual([]);
  });

  it("zeigt fuer einen gescheiterten Lauf keine Zaehler", () => {
    const rs: RunState = { a: { at: 100, ok: false, code: "connect", counts: NIX } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.countsKey).toBeNull();
  });
});

describe("buildCockpitViewModel — Zeilen und Empty-State", () => {
  it("meldet leer, wenn kein Konto eingerichtet ist", () => {
    const vm = buildCockpitViewModel({ accounts: [], runState: {}, nextDue: keineFaelligkeit, busy: false });
    expect(vm.empty).toBe(true);
    expect(vm.rows).toEqual([]);
  });

  it("ist NICHT leer, wenn ein Konto existiert und nur noch nie lief", () => {
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: {}, nextDue: keineFaelligkeit, busy: false });
    expect(vm.empty).toBe(false);
  });

  it("behaelt die Reihenfolge der Kontoliste und traegt das Label", () => {
    const accounts = [acc("z", "Zweitkonto"), acc("a", "Hauptkonto")];
    const vm = buildCockpitViewModel({ accounts, runState: {}, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows.map((r) => r.label)).toEqual(["Zweitkonto", "Hauptkonto"]);
  });

  it("markiert ein abgeschaltetes Konto als disabled und reicht die Faelligkeit durch", () => {
    const accounts = [acc("aus", "Aus", false), acc("an", "An")];
    const vm = buildCockpitViewModel({
      accounts,
      runState: {},
      nextDue: (id) => (id === "an" ? 500 : null),
      busy: false,
    });
    expect(vm.rows[0]?.disabled).toBe(true);
    expect(vm.rows[0]?.nextRunAt).toBeNull();
    expect(vm.rows[1]?.disabled).toBe(false);
    expect(vm.rows[1]?.nextRunAt).toBe(500);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/core/view/cockpit-vm.test.ts`
Expected: FAIL — `Failed to resolve import "../../../src/core/view/cockpit-vm"`

- [ ] **Step 4: Write minimal implementation**

```ts
// src/core/view/cockpit-vm.ts
import type { Account } from "../settings";
import type { SyncCounts } from "../sync/events";
import type { RunState } from "../sync/run-state";

/** Zustandsvokabel des §8-Bausteins „Status-Indikator" ohne `is-`-Praefix — die
 *  Klassenschreibweise ist Sache der Darstellung. `never` ist bewusst KEIN
 *  Indikatorzustand: fuer „noch nie gelaufen" gibt es keine Vokabel, und einen der vier
 *  zu behaupten waere falsch. Das Panel zeigt dafuer nur Text. */
export type CockpitState = "checking" | "ok" | "warning" | "error" | "never";

export interface CockpitRow {
  accountId: string;
  label: string;
  state: CockpitState;
  lastRunAt: number | null;
  nextRunAt: number | null;
  /** Leerzeichen-getrennte i18n-Schluessel; `null` bei gescheitertem Lauf (dort steht der Fehler). */
  countsKey: string | null;
  countsArgs: readonly (string | number)[];
  errorKey: string | null;
  disabled: boolean;
}

export interface CockpitViewModel {
  rows: readonly CockpitRow[];
  empty: boolean;
  busy: boolean;
}

export interface CockpitInput {
  accounts: readonly Account[];
  runState: RunState;
  nextDue: (accountId: string) => number | null;
  busy: boolean;
}

const COUNT_KEYS: ReadonlyArray<readonly [keyof SyncCounts, string]> = [
  ["created", "cockpit.counts.created"],
  ["reattached", "cockpit.counts.reattached"],
  ["detached", "cockpit.counts.detached"],
  ["skipped", "cockpit.counts.skipped"],
  ["detachSkipped", "cockpit.counts.detachSkipped"],
  ["errors", "cockpit.counts.errors"],
];

/** Nur die Zaehler ungleich null. In einer schmalen Seitenleiste stuenden sonst fuenf
 *  Nullen, und die eine Zahl, auf die es ankommt, ginge darin unter. */
function condenseCounts(c: SyncCounts): { key: string; args: (string | number)[] } {
  const keys: string[] = [];
  const args: (string | number)[] = [];
  for (const [feld, schluessel] of COUNT_KEYS) {
    const n = c[feld];
    if (n > 0) {
      keys.push(schluessel);
      args.push(n);
    }
  }
  return keys.length === 0 ? { key: "cockpit.counts.none", args: [] } : { key: keys.join(" "), args };
}

export function buildCockpitViewModel(input: CockpitInput): CockpitViewModel {
  const rows: CockpitRow[] = input.accounts.map((a) => {
    const run = input.runState[a.id];
    const disabled = !a.sync.enabled;

    // busy schlaegt alles: der Guard ist global und weiss nicht, WELCHES Konto laeuft —
    // solange er haelt, ist jede Zeilenaussage ueber „gerade" ungedeckt.
    if (input.busy) {
      return { accountId: a.id, label: a.label, state: "checking", lastRunAt: run?.at ?? null,
        nextRunAt: input.nextDue(a.id), countsKey: null, countsArgs: [], errorKey: null, disabled };
    }
    if (!run) {
      return { accountId: a.id, label: a.label, state: "never", lastRunAt: null,
        nextRunAt: input.nextDue(a.id), countsKey: null, countsArgs: [], errorKey: null, disabled };
    }
    if (!run.ok) {
      return { accountId: a.id, label: a.label, state: "error", lastRunAt: run.at,
        nextRunAt: input.nextDue(a.id), countsKey: null, countsArgs: [],
        errorKey: `error.sync.${run.code ?? "protocol"}`, disabled };
    }
    const auffaellig = run.counts.errors > 0 || run.counts.detachSkipped > 0;
    const { key, args } = condenseCounts(run.counts);
    return { accountId: a.id, label: a.label, state: auffaellig ? "warning" : "ok", lastRunAt: run.at,
      nextRunAt: input.nextDue(a.id), countsKey: key, countsArgs: args, errorKey: null, disabled };
  });

  return { rows, empty: rows.length === 0, busy: input.busy };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/core/view/cockpit-vm.test.ts`
Expected: PASS (12 Tests)

- [ ] **Step 6: Mutation als Gegenprobe**

| Mutation | erwartet rot |
|---|---|
| `auffaellig` auf `run.counts.errors > 0` reduzieren (`detachSkipped` weglassen) | „warning auch bei ausgelassenen Abloesungen" |
| den `if (input.busy)`-Block ans Ende verschieben (hinter `!run.ok`) | „checking schlaegt jeden anderen Zustand" |
| in `condenseCounts` die Bedingung `n > 0` auf `n >= 0` ändern | „nennt nur die Zaehler ungleich null" |
| bei `!run.ok` `countsKey` auf `condenseCounts(run.counts).key` setzen | „zeigt fuer einen gescheiterten Lauf keine Zaehler" |

- [ ] **Step 7: i18n-Vollständigkeit prüfen, check:pure, commit**

```bash
npx vitest run tests/i18n
npm run check:pure
git add src/core/view/cockpit-vm.ts src/i18n/strings.ts tests/core/view/cockpit-vm.test.ts
git commit -m "feat(cockpit): ViewModel - Zustandsvokabel und verdichtete Zaehler, ohne DOM"
```

Der i18n-Test wacht darüber, dass `en` und `de` denselben Schlüsselsatz tragen. Meldet er Fehlstellen, fehlt ein Schlüssel in einem der beiden Blöcke.

---

## Task 3: Cockpit-Panel (DOM)

**Files:**
- Create: `src/obsidian/views/cockpit-panel.ts`
- Modify: `styles.css`
- Test: `tests/obsidian/cockpit-panel.test.ts`

**Interfaces:**
- Consumes: `buildCockpitViewModel`, `CockpitRow`, `CockpitState` aus Task 2; `Unsubscribe` aus `src/core/sync/events.ts`
- Produces:
  - `interface CockpitHost { accounts(): readonly Account[]; runState(): RunState; nextDueAt(accountId: string): number | null; isBusy(): boolean; syncNow(accountId?: string): void; openSettings(): void; onChange(cb: () => void): Unsubscribe }`
  - `class CockpitPanel` mit `id`, `label`, `icon`, `mount(container)`, `onShow()`, `destroy()` — der Kit-`HubPanel`-Vertrag

> ⚠️ **`nextDueAt` gibt es zweimal, mit verschiedenen Signaturen — das ist Absicht.** Die pure Funktion aus Task 1 nimmt `(account, lastRunMs)`; die gleichnamige Host-Methode nimmt nur die Konto-Id und ruft die pure auf (siehe Task 5). Das Panel kennt weder `Account`-Objekte noch Zeitstempel des Weckers, deshalb die schmalere Fassung am Vertrag.

> **Warum ein Host-Interface und kein Plugin-Zugriff:** UI-STANDARD §4 verlangt, dass die View weder Plugin noch Ports kennt. Alle Methoden sind lesend oder `void` — kein Rückkanal, damit das Panel nicht auf Ergebnisse warten muss. Vorbild ist `PanelHost` in `vault-crews/src/obsidian/panel.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/obsidian/cockpit-panel.test.ts
import { describe, it, expect, vi } from "vitest";
import { makeFakeEl } from "../vendor/kit/obsidian-mock";
import { CockpitPanel, type CockpitHost } from "../../src/obsidian/views/cockpit-panel";
import { newAccount, type Account } from "../../src/core/settings";
import type { RunState } from "../../src/core/sync/run-state";
import type { SyncCounts } from "../../src/core/sync/events";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

const NIX: SyncCounts = { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 };

function acc(id: string, label = id): Account {
  const a = newAccount(id);
  a.label = label;
  a.sync = { enabled: true, intervalMin: 5 };
  return a;
}

function fakeHost(o: Partial<CockpitHost> & { accounts?: () => Account[]; runState?: () => RunState } = {}): CockpitHost {
  return {
    accounts: o.accounts ?? (() => []),
    runState: o.runState ?? (() => ({})),
    nextDueAt: o.nextDueAt ?? (() => null),
    isBusy: o.isBusy ?? (() => false),
    syncNow: o.syncNow ?? (() => undefined),
    openSettings: o.openSettings ?? (() => undefined),
    onChange: o.onChange ?? (() => () => undefined),
  };
}

/** Alle Nachfahren mit dieser Klasse — der Fake-El haelt Kinder in `children`. */
function findAll(el: any, cls: string): any[] {
  const out: any[] = [];
  const walk = (n: any): void => {
    for (const c of n.children ?? []) {
      if (String(c.className ?? "").split(" ").includes(cls)) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

describe("CockpitPanel — Status-Indikator (UI-STANDARD §8)", () => {
  it("traegt die Zustandsklasse is-ok UND ein aria-label — Farbe nie allein", () => {
    const rs: RunState = { a: { at: 100, ok: true, counts: NIX } };
    const el = makeFakeEl();
    const p = new CockpitPanel(fakeHost({ accounts: () => [acc("a")], runState: () => rs }));
    p.mount(el);
    const ind = findAll(el, "mailstone-cockpit-status")[0];
    expect(String(ind.className).split(" ")).toContain("is-ok");
    expect(ind.getAttribute("aria-label")).toBeTruthy();
  });

  it("nutzt is-warning fuer einen Lauf, der durchlief und etwas auslies", () => {
    const rs: RunState = { a: { at: 100, ok: true, counts: { ...NIX, detachSkipped: 1 } } };
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a")], runState: () => rs })).mount(el);
    expect(String(findAll(el, "mailstone-cockpit-status")[0].className).split(" ")).toContain("is-warning");
  });

  it("nutzt is-error und zeigt den Fehler im Klartext", () => {
    const rs: RunState = { a: { at: 100, ok: false, code: "auth", counts: NIX } };
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a")], runState: () => rs })).mount(el);
    expect(String(findAll(el, "mailstone-cockpit-status")[0].className).split(" ")).toContain("is-error");
    const zeile = findAll(el, "mailstone-cockpit-row")[0];
    expect(JSON.stringify(zeile)).toContain("Anmeldung");
  });

  it("zeigt fuer ein nie gelaufenes Konto KEINEN Indikator", () => {
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a")] })).mount(el);
    expect(findAll(el, "mailstone-cockpit-status")).toHaveLength(0);
  });
});

describe("CockpitPanel — Empty-State (UI-STANDARD §8)", () => {
  it("zeigt ohne Konto den Empty-State mit genau einem mod-cta", () => {
    const el = makeFakeEl();
    new CockpitPanel(fakeHost()).mount(el);
    expect(findAll(el, "mailstone-cockpit-empty")).toHaveLength(1);
    expect(findAll(el, "mod-cta")).toHaveLength(1);
  });

  it("der CTA fuehrt in die Einstellungen", () => {
    const openSettings = vi.fn();
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ openSettings })).mount(el);
    findAll(el, "mod-cta")[0].dispatchEvent({ type: "click" });
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});

describe("CockpitPanel — Bedienung", () => {
  it("loest den Sync fuer genau das geklickte Konto aus", () => {
    const syncNow = vi.fn();
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a"), acc("b")], syncNow })).mount(el);
    findAll(el, "mailstone-cockpit-sync")[1].dispatchEvent({ type: "click" });
    expect(syncNow).toHaveBeenCalledWith("b");
  });

  it("der Kopfknopf synchronisiert alle — ohne Konto-Argument", () => {
    const syncNow = vi.fn();
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a")], syncNow })).mount(el);
    findAll(el, "mailstone-cockpit-sync-all")[0].dispatchEvent({ type: "click" });
    expect(syncNow).toHaveBeenCalledWith(undefined);
  });

  it("sperrt beide Knoepfe, solange ein Lauf haengt — sonst rennt der Nutzer in den busy-Guard", () => {
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a")], isBusy: () => true })).mount(el);
    expect(findAll(el, "mailstone-cockpit-sync")[0].disabled).toBe(true);
    expect(findAll(el, "mailstone-cockpit-sync-all")[0].disabled).toBe(true);
  });

  it("GEGENPROBE: bei freiem Guard ist derselbe Knopf bedienbar und loest aus", () => {
    // Ohne diese Haelfte belegt der Test darueber nicht, dass die Sperre je etwas bewegt —
    // ein immer deaktivierter Knopf bestuende ihn genauso (LESSONS 2026-09-01, koda-agent).
    const syncNow = vi.fn();
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a")], isBusy: () => false, syncNow })).mount(el);
    const knopf = findAll(el, "mailstone-cockpit-sync")[0];
    expect(knopf.disabled).toBeFalsy();
    knopf.dispatchEvent({ type: "click" });
    expect(syncNow).toHaveBeenCalledWith("a");
  });
});

describe("CockpitPanel — Lebenszyklus", () => {
  it("zeichnet bei einer Aenderung neu, statt am alten Stand zu kleben", () => {
    let cb: (() => void) | null = null;
    let rs: RunState = {};
    const el = makeFakeEl();
    const p = new CockpitPanel(fakeHost({
      accounts: () => [acc("a")],
      runState: () => rs,
      onChange: (fn) => { cb = fn; return () => { cb = null; }; },
    }));
    p.mount(el);
    expect(findAll(el, "mailstone-cockpit-status")).toHaveLength(0);
    rs = { a: { at: 100, ok: true, counts: NIX } };
    cb?.();
    expect(findAll(el, "mailstone-cockpit-status")).toHaveLength(1);
  });

  it("meldet sich bei destroy() ab", () => {
    const unsub = vi.fn();
    const p = new CockpitPanel(fakeHost({ onChange: () => unsub }));
    p.mount(makeFakeEl());
    p.destroy();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/cockpit-panel.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/obsidian/views/cockpit-panel"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/obsidian/views/cockpit-panel.ts
import { setIcon } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import type { Account } from "../../core/settings";
import type { Unsubscribe } from "../../core/sync/events";
import type { RunState } from "../../core/sync/run-state";
import { buildCockpitViewModel, type CockpitRow, type CockpitState } from "../../core/view/cockpit-vm";

/** Schmaler Vertrag zum Plugin (UI-STANDARD §4): lesend oder `void`, kein Rueckkanal.
 *  Vorbild ist `PanelHost` in vault-crews/src/obsidian/panel.ts. */
export interface CockpitHost {
  accounts(): readonly Account[];
  runState(): RunState;
  nextDueAt(accountId: string): number | null;
  isBusy(): boolean;
  /** Ohne Argument: alle aktivierten Konten. */
  syncNow(accountId?: string): void;
  openSettings(): void;
  onChange(cb: () => void): Unsubscribe;
}

/** Icon-Vokabel des §8-Bausteins. `never` fehlt bewusst — dafuer gibt es keinen Zustand. */
const ICONS: Record<Exclude<CockpitState, "never">, string> = {
  checking: "loader",
  ok: "circle-check",
  error: "circle-x",
  warning: "alert-triangle",
};

const ARIA: Record<Exclude<CockpitState, "never">, string> = {
  checking: "cockpit.aria.checking",
  ok: "cockpit.aria.ok",
  error: "cockpit.aria.error",
  warning: "cockpit.aria.warning",
};

function uhrzeit(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

export class CockpitPanel {
  readonly id = "cockpit";
  readonly icon = "mail";
  private root: HTMLElement | null = null;
  private unsub: Unsubscribe | null = null;

  constructor(private readonly host: CockpitHost) {}

  get label(): string {
    return t("cockpit.title");
  }

  mount(container: HTMLElement): void {
    this.root = container;
    this.unsub = this.host.onChange(() => this.render());
    this.render();
  }

  onShow(): void {
    this.render();
  }

  destroy(): void {
    this.unsub?.();
    this.unsub = null;
    this.root = null;
  }

  /** Voll-Neuaufbau aus dem ViewModel (UI-STANDARD §4, Muster ViewModel-Re-Render):
   *  das Panel haelt keinen langlebigen internen Zustand, also ist der DOM eine reine
   *  Funktion des gehaltenen Zustands. */
  private render(): void {
    const root = this.root;
    if (!root) return;
    root.empty();
    root.addClass("mailstone-cockpit");

    const vm = buildCockpitViewModel({
      accounts: this.host.accounts(),
      runState: this.host.runState(),
      nextDue: (id) => this.host.nextDueAt(id),
      busy: this.host.isBusy(),
    });

    // Kopfzeile im INHALT, nicht per addAction(): Obsidians app.css blendet den View-Kopf
    // in jeder Seitenleiste aus (`.mod-right-split .view-header { display: none }`), eine
    // Kopf-Aktion waere dort null Pixel hoch. Siehe REGISTRY §UI.
    const kopf = root.createDiv({ cls: "mailstone-cockpit-head" });
    kopf.createEl("h3", { text: t("cockpit.title") });
    const alle = kopf.createEl("button", { cls: "mailstone-cockpit-sync-all", text: t("cockpit.syncAll") });
    alle.disabled = vm.busy;
    alle.addEventListener("click", () => this.host.syncNow(undefined));
    if (vm.busy) kopf.createDiv({ cls: "mailstone-cockpit-hint", text: t("cockpit.running") });

    if (vm.empty) {
      const leer = root.createDiv({ cls: "mailstone-cockpit-empty" });
      leer.createEl("p", { text: t("cockpit.empty") });
      const cta = leer.createEl("button", { cls: "mod-cta", text: t("cockpit.empty.cta") });
      cta.addEventListener("click", () => this.host.openSettings());
      return;
    }

    for (const row of vm.rows) this.renderRow(root, row, vm.busy);
  }

  private renderRow(root: HTMLElement, row: CockpitRow, busy: boolean): void {
    const zeile = root.createDiv({ cls: "mailstone-cockpit-row" });
    const kopf = zeile.createDiv({ cls: "mailstone-cockpit-row-head" });

    if (row.state !== "never") {
      const ind = kopf.createSpan({
        cls: `mailstone-cockpit-status is-${row.state}`,
        attr: { "aria-label": t(ARIA[row.state]) },
      });
      setIcon(ind, ICONS[row.state]);
    }
    kopf.createSpan({ cls: "mailstone-cockpit-label", text: row.label });

    const knopf = kopf.createEl("button", { cls: "mailstone-cockpit-sync", text: t("cockpit.syncOne") });
    knopf.disabled = busy;
    knopf.addEventListener("click", () => this.host.syncNow(row.accountId));

    const meta = zeile.createDiv({ cls: "mailstone-cockpit-meta" });
    meta.createDiv({ text: row.lastRunAt === null ? t("cockpit.never") : t("cockpit.lastRun", uhrzeit(row.lastRunAt)) });
    meta.createDiv({
      text: row.disabled ? t("cockpit.nextRun.off")
        : row.nextRunAt === null ? "" : t("cockpit.nextRun", uhrzeit(row.nextRunAt)),
    });
    if (row.errorKey) meta.createDiv({ cls: "mailstone-cockpit-error", text: t(row.errorKey) });
    else if (row.countsKey) {
      const teile = row.countsKey.split(" ").map((k, i) => t(k, row.countsArgs[i] ?? 0));
      meta.createDiv({ cls: "mailstone-cockpit-counts", text: teile.join(" · ") });
    }
  }
}
```

- [ ] **Step 4: CSS ergänzen**

An `styles.css` anhängen — nur Theme-Variablen, keine festen Farben:

```css
/* Cockpit — Listen-Zeile (vertikale Grammatik, UI-STANDARD §8) */
.mailstone-cockpit-head { display: flex; align-items: center; gap: var(--size-4-2); flex-wrap: wrap; margin-bottom: var(--size-4-3); }
.mailstone-cockpit-head h3 { margin: 0; flex: 1 1 auto; min-width: 0; }
.mailstone-cockpit-hint { color: var(--text-muted); font-size: var(--font-ui-smaller); flex-basis: 100%; }
.mailstone-cockpit-row { display: flex; flex-direction: column; gap: var(--size-4-1); padding: var(--size-4-2) 0; border-bottom: 1px solid var(--background-modifier-border); }
.mailstone-cockpit-row-head { display: flex; align-items: center; gap: var(--size-4-2); }
.mailstone-cockpit-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--font-medium); }
.mailstone-cockpit-meta { color: var(--text-muted); font-size: var(--font-ui-smaller); display: flex; flex-direction: column; gap: 2px; }
.mailstone-cockpit-error { color: var(--text-error); }
.mailstone-cockpit-counts { color: var(--text-muted); }
.mailstone-cockpit-empty { color: var(--text-muted); display: flex; flex-direction: column; gap: var(--size-4-2); align-items: flex-start; }

/* Status-Indikator: Form UND Farbe UND Klasse UND aria-label (WCAG 1.4.1) */
.mailstone-cockpit-status { display: inline-flex; align-items: center; }
.mailstone-cockpit-status.is-ok { color: var(--text-success); }
.mailstone-cockpit-status.is-error { color: var(--text-error); }
.mailstone-cockpit-status.is-warning { color: var(--text-warning); }
.mailstone-cockpit-status.is-checking { color: var(--text-muted); }
.mailstone-cockpit-status.is-checking svg { animation: mailstone-spin 1s linear infinite; }
@keyframes mailstone-spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/obsidian/cockpit-panel.test.ts`
Expected: PASS (11 Tests)

- [ ] **Step 6: Mutation als Gegenprobe**

| Mutation | erwartet rot |
|---|---|
| das `aria-label`-Attribut am Indikator weglassen | „traegt die Zustandsklasse is-ok UND ein aria-label" |
| `if (row.state !== "never")` entfernen (Indikator immer zeichnen) | „zeigt fuer ein nie gelaufenes Konto KEINEN Indikator" |
| `knopf.disabled = busy` durch `knopf.disabled = false` ersetzen | „sperrt beide Knoepfe" |
| `knopf.disabled = busy` durch `knopf.disabled = true` ersetzen | **die Gegenprobe** — „bei freiem Guard ist derselbe Knopf bedienbar" |
| `this.unsub?.()` in `destroy()` entfernen | „meldet sich bei destroy() ab" |
| `this.host.syncNow(row.accountId)` durch `syncNow(undefined)` ersetzen | „loest den Sync fuer genau das geklickte Konto aus" |

Die vierte Zeile ist der Grund für die Gegenprobe: ohne sie bestünde ein *immer* gesperrter Knopf den Sperr-Test genauso.

- [ ] **Step 7: Commit**

```bash
git add src/obsidian/views/cockpit-panel.ts styles.css tests/obsidian/cockpit-panel.test.ts
git commit -m "feat(cockpit): Panel mit Status-Indikator, Empty-State und Sync-Knopf je Konto"
```

---

## Task 4: Die eine View

**Files:**
- Create: `src/obsidian/views/mailstone-view.ts`
- Test: `tests/obsidian/mailstone-view.test.ts`

**Interfaces:**
- Consumes: `CockpitPanel`, `CockpitHost` aus Task 3
- Produces:
  - `const VIEW_TYPE_MAILSTONE = "mailstone-cockpit"`
  - `class MailstoneView extends ItemView` mit `constructor(leaf: WorkspaceLeaf, host: CockpitHost)`
  - `async function activateMailstoneView(app: App): Promise<void>`

> **Die Leiste kommt erst mit dem zweiten Tab.** `buildHubInto` aus dem Kit rendert die Tab-Leiste unbedingt (`obsidian-kit/src/obsidian/hub.ts:154`); bei einem Panel wäre das eine Leiste mit einem Knopf. Das Panel erfüllt den `HubPanel`-Vertrag bereits, der spätere Umstieg ist deshalb Schalenarbeit: `buildHubInto(this.contentEl, [cockpit, inbox], "cockpit")` statt des direkten `mount`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/obsidian/mailstone-view.test.ts
import { describe, it, expect, vi } from "vitest";
import { WorkspaceLeaf } from "obsidian";
import { MailstoneView, VIEW_TYPE_MAILSTONE, activateMailstoneView } from "../../src/obsidian/views/mailstone-view";
import type { CockpitHost } from "../../src/obsidian/views/cockpit-panel";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

function fakeHost(): CockpitHost {
  return {
    accounts: () => [], runState: () => ({}), nextDueAt: () => null, isBusy: () => false,
    syncNow: () => undefined, openSettings: () => undefined, onChange: () => () => undefined,
  };
}

describe("MailstoneView", () => {
  it("meldet den einen View-Type des Plugins", () => {
    const v = new MailstoneView(new WorkspaceLeaf(), fakeHost());
    expect(v.getViewType()).toBe(VIEW_TYPE_MAILSTONE);
    expect(v.getIcon()).toBe("mail");
  });

  it("baut das Panel beim Oeffnen auf und raeumt beim Schliessen ab", async () => {
    const v = new MailstoneView(new WorkspaceLeaf(), fakeHost());
    await v.onOpen();
    expect(v.contentEl.children.length).toBeGreaterThan(0);
    await v.onClose();
    expect(v.contentEl.children.length).toBe(0);
  });
});

describe("activateMailstoneView", () => {
  it("klappt die Seitenleiste auf — sonst entsteht die View mit 0x0 px", async () => {
    // REGISTRY §UI: getRightLeaf(false) + setViewState() erzeugt das Blatt, oeffnet aber
    // die eingeklappte Leiste nicht. Fuer den Erstnutzer taete der Klick sichtbar nichts.
    const setViewState = vi.fn().mockResolvedValue(undefined);
    const leaf = { setViewState };
    const revealLeaf = vi.fn();
    const app: any = {
      workspace: {
        getLeavesOfType: () => [],
        getRightLeaf: () => leaf,
        revealLeaf,
      },
    };
    await activateMailstoneView(app);
    expect(setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_MAILSTONE, active: true });
    expect(revealLeaf).toHaveBeenCalledWith(leaf);
  });

  it("nimmt ein vorhandenes Blatt, statt ein zweites anzulegen", async () => {
    const vorhanden = { setViewState: vi.fn() };
    const revealLeaf = vi.fn();
    const getRightLeaf = vi.fn();
    const app: any = {
      workspace: { getLeavesOfType: () => [vorhanden], getRightLeaf, revealLeaf },
    };
    await activateMailstoneView(app);
    expect(getRightLeaf).not.toHaveBeenCalled();
    expect(vorhanden.setViewState).not.toHaveBeenCalled();
    expect(revealLeaf).toHaveBeenCalledWith(vorhanden);
  });

  it("tut nichts, wenn kein rechtes Blatt zu bekommen ist", async () => {
    const revealLeaf = vi.fn();
    const app: any = {
      workspace: { getLeavesOfType: () => [], getRightLeaf: () => null, revealLeaf },
    };
    await activateMailstoneView(app);
    expect(revealLeaf).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/mailstone-view.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/obsidian/views/mailstone-view"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/obsidian/views/mailstone-view.ts
import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import { CockpitPanel, type CockpitHost } from "./cockpit-panel";

/** Der EINE registerView-Type dieses Plugins (UI-STANDARD §1). Kommt mit M4 der
 *  Posteingang dazu, wird er ein zweiter Tab dieser View — kein zweiter Type. */
export const VIEW_TYPE_MAILSTONE = "mailstone-cockpit";

export class MailstoneView extends ItemView {
  private panel: CockpitPanel | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly host: CockpitHost) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_MAILSTONE; }
  getDisplayText(): string { return t("cockpit.title"); }
  getIcon(): string { return "mail"; }

  async onOpen(): Promise<void> {
    // Direkter Mount statt buildHubInto: bei einem Panel waere die Tab-Leiste ein Knopf
    // ohne Wahl. Das Panel erfuellt den HubPanel-Vertrag bereits — mit dem zweiten Tab
    // wird aus dieser Zeile `buildHubInto(this.contentEl, [cockpit, inbox], "cockpit")`.
    this.panel = new CockpitPanel(this.host);
    this.panel.mount(this.contentEl);
  }

  async onClose(): Promise<void> {
    this.panel?.destroy();
    this.panel = null;
    this.contentEl.empty();
  }
}

/** Oeffnet die View und macht sie SICHTBAR. `revealLeaf` ist kein Beiwerk: ohne den Aufruf
 *  entsteht die View bei eingeklappter Seitenleiste — dem Normalzustand eines frisch
 *  eingerichteten Vaults — mit 0x0 Pixeln, das Kommando meldet Erfolg, und der Klick tut
 *  sichtbar nichts (REGISTRY §UI, belegt an image-to-markdown und 3d-codeblocks). */
export async function activateMailstoneView(app: App): Promise<void> {
  const vorhanden = app.workspace.getLeavesOfType(VIEW_TYPE_MAILSTONE);
  const bestehend = vorhanden[0];
  if (bestehend) {
    app.workspace.revealLeaf(bestehend);
    return;
  }
  const leaf = app.workspace.getRightLeaf(false);
  if (!leaf) return;
  await leaf.setViewState({ type: VIEW_TYPE_MAILSTONE, active: true });
  app.workspace.revealLeaf(leaf);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/obsidian/mailstone-view.test.ts`
Expected: PASS (5 Tests)

- [ ] **Step 5: Mutation als Gegenprobe**

| Mutation | erwartet rot |
|---|---|
| den `revealLeaf(leaf)`-Aufruf nach `setViewState` entfernen | „klappt die Seitenleiste auf" |
| den `if (bestehend)`-Zweig entfernen | „nimmt ein vorhandenes Blatt" |
| `if (!leaf) return;` entfernen | „tut nichts, wenn kein rechtes Blatt zu bekommen ist" (wirft statt still zu bleiben) |
| `this.panel?.destroy()` in `onClose` entfernen | keiner — **das ist der Punkt:** Unit-Tests sehen das Leck nicht. Nach der Mutation den Test wieder herstellen und den Fall in die Handprobe (Step 7) aufnehmen. |

- [ ] **Step 6: Commit**

```bash
git add src/obsidian/views/mailstone-view.ts tests/obsidian/mailstone-view.test.ts
git commit -m "feat(cockpit): die eine ItemView - oeffnet sichtbar statt mit 0x0 Pixeln"
```

---

## Task 5: Verdrahtung in main.ts

**Files:**
- Modify: `src/main.ts` (`PersistedState` in Zeile 27; Felder ab Zeile 195; `onload` ab 208; `saveSettings` bei 356; `runSync` bei 428; Ribbon bei 265; `lastRun` bei 293)
- Modify: `src/obsidian/settings-tab.ts` (Toggle „Beim Start öffnen")
- Modify: `src/core/settings.ts` (`openViewOnStartup` in `MailstoneSettings` und `DEFAULT_SETTINGS`)
- Test: `tests/obsidian/main.test.ts` (bestehende Datei erweitern)

**Interfaces:**
- Consumes: `recordRun`, `parseRunState`, `nextDueAt`, `RunState` (Task 1); `CockpitHost` (Task 3); `MailstoneView`, `VIEW_TYPE_MAILSTONE`, `activateMailstoneView` (Task 4)
- Produces: nichts für spätere Tasks — das ist die letzte

- [ ] **Step 1: Write the failing test**

An `tests/obsidian/main.test.ts` anhängen (die vorhandenen Importe und Helfer der Datei mitbenutzen; `MailstonePlugin` ist dort bereits importiert):

```ts
describe("Cockpit-Verdrahtung", () => {
  it("liest ein kaputtes runState-Feld, ohne den Start zu kippen", async () => {
    const plugin = await ladePlugin({ settings: {}, runState: "kaputt" });
    expect(plugin.runState).toEqual({});
  });

  it("uebernimmt ein gueltiges runState-Feld aus data.json", async () => {
    const gespeichert = { a: { at: 5, ok: true, counts: { created: 1, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 } } };
    const plugin = await ladePlugin({ settings: {}, runState: gespeichert });
    expect(plugin.runState["a"]?.at).toBe(5);
  });

  it("schreibt runState in dieselbe data.json wie zoneHashes und uidCache", async () => {
    const plugin = await ladePlugin({ settings: {} });
    plugin.runState = { a: { at: 7, ok: true, counts: { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 } } };
    await plugin.saveSettings();
    expect(gespeicherteDaten()?.runState?.["a"]?.at).toBe(7);
  });

  it("registriert genau einen View-Type (UI-STANDARD §1)", async () => {
    const plugin = await ladePlugin({ settings: {} });
    expect(registrierteViewTypes(plugin)).toEqual([VIEW_TYPE_MAILSTONE]);
  });

  it("das Ribbon-Symbol oeffnet die Ansicht, statt zu synchronisieren", async () => {
    const plugin = await ladePlugin({ settings: {} });
    expect(ribbonTitel(plugin)).toBe(t("cockpit.title"));
  });

  it("oeffnet die Ansicht beim Start NICHT, solange das Opt-in aus ist", async () => {
    const plugin = await ladePlugin({ settings: { openViewOnStartup: false } });
    await layoutReady(plugin);
    expect(geoeffneteViews(plugin)).toEqual([]);
  });

  it("GEGENPROBE: mit gesetztem Opt-in oeffnet sie beim Start", async () => {
    const plugin = await ladePlugin({ settings: { openViewOnStartup: true } });
    await layoutReady(plugin);
    expect(geoeffneteViews(plugin)).toEqual([VIEW_TYPE_MAILSTONE]);
  });
});
```

Die Helfer `ladePlugin`, `gespeicherteDaten`, `registrierteViewTypes`, `ribbonTitel`, `geoeffneteViews` und `layoutReady` gehören in denselben Testdateikopf. Sie kapseln den Mock-Zugriff; die bestehende `main.test.ts` hat bereits ein Lademuster — dieses wiederverwenden und nur um die fehlenden Zugriffe ergänzen.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/main.test.ts`
Expected: FAIL — `plugin.runState is undefined`

- [ ] **Step 3: `openViewOnStartup` in die Settings aufnehmen**

In `src/core/settings.ts`:

```ts
// In MailstoneSettings ergaenzen:
export interface MailstoneSettings { schemaVersion: 1; language: "auto" | "en" | "de"; accounts: Account[]; profile: MailProfile; taskPreset: Record<string, string | number | boolean>; debugLog: boolean; openViewOnStartup: boolean }

// In DEFAULT_SETTINGS ergaenzen — Default AUS: ein Plugin, das sich beim Start ungefragt
// in die Seitenleiste draengt, ist ein Aergernis (REGISTRY: Opt-in-Gate fuer
// Startup-Seiteneffekt, n=2 in vim-dojo und kuro-gamification).
export const DEFAULT_SETTINGS: MailstoneSettings = { schemaVersion: 1, language: "auto", accounts: [], profile: defaultMailProfile(), taskPreset: {}, debugLog: false, openViewOnStartup: false };
```

- [ ] **Step 4: `main.ts` verdrahten**

`PersistedState` (Zeile 27) um die vierte Ecke erweitern — `runState` ist Laufzeitzustand wie `zoneHashes` und `uidCache`, keine Einstellung:

```ts
interface PersistedState { settings: MailstoneSettings; zoneHashes: Record<string, string>; uidCache: UidCacheData; runState: RunState }
```

Feld neben `zoneHashes` (bei Zeile 197):

```ts
  runState: RunState = {};
  private lastRun: Record<string, number> = {};
```

In `onload()` neben `this.zoneHashes = raw?.zoneHashes ?? {};` (Zeile 211):

```ts
    this.runState = parseRunState(raw?.runState);
```

`saveSettings()` (Zeile 359):

```ts
    await this.persist({ settings: this.settings, zoneHashes: this.zoneHashes, uidCache: this.uidCache.data(), runState: this.runState } satisfies PersistedState);
```

`lastRun` vom lokalen Objekt (Zeile 293–296) auf das Feld umstellen:

```ts
    const startedAt = Date.now();
    for (const a of this.settings.accounts) this.lastRun[a.id] = startedAt;
    this.registerInterval(window.setInterval(() => { void this.runDueSyncs(notify, this.lastRun); }, TICK_MS));
```

In `runSync()` vor dem `return results;` (Zeile 445) das Register füttern — hier liegen die vollständigen Ergebnisse, anders als im `synced`-Event:

```ts
      this.runState = recordRun(this.runState, results, Date.now());
      this.cockpitChanged.emit("changed", undefined);
```

View registrieren, Ribbon umstellen, Kommando und Opt-in-Gate (bei Zeile 265):

```ts
    this.registerView(VIEW_TYPE_MAILSTONE, (leaf) => new MailstoneView(leaf, this.cockpitHost(notify)));
    this.addRibbonIcon("mail", t("cockpit.title"), () => { void activateMailstoneView(this.app); });
    this.addCommand({ id: "open-cockpit", name: t("cockpit.title"), callback: () => { void activateMailstoneView(this.app); } });
    // Auto-Oeffnen ist Opt-in, Default aus (REGISTRY: Opt-in-Gate fuer Startup-Seiteneffekt).
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openViewOnStartup) void activateMailstoneView(this.app);
    });
```

Der Host als eigene Methode neben `commandExecuteDeps()`:

```ts
  private cockpitHost(notify: Notifier): CockpitHost {
    return {
      accounts: () => this.settings.accounts,
      runState: () => this.runState,
      nextDueAt: (id) => {
        const a = this.settings.accounts.find((x) => x.id === id);
        return a ? nextDueAt(a, this.lastRun[id]) : null;
      },
      isBusy: () => this.busy.isBusy(),
      syncNow: (accountId) => { void this.runSync(notify, false, accountId ? [accountId] : undefined); },
      openSettings: () => { (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting.open(); },
      onChange: (cb) => this.cockpitChanged.on("changed", cb),
    };
  }
```

Dazu das Änderungs-Signal als Feld neben `syncEvents` (Zeile 206) — ein eigener Emitter, damit `SyncEvents` unberührt bleibt: das ist die Fläche, an der Fremdplugins per `api.on(...)` hängen.

```ts
  private readonly cockpitChanged: Emitter<{ changed: undefined }> = createEmitter();
```

- [ ] **Step 5: Toggle im Settings-Tab**

In `src/obsidian/settings-tab.ts` bei den übrigen allgemeinen Schaltern:

```ts
    new Setting(containerEl)
      .setName(t("settings.openViewOnStartup"))
      .setDesc(t("settings.openViewOnStartup.desc"))
      .addToggle((tg) => tg.setValue(this.host.settings.openViewOnStartup).onChange((v) => {
        this.host.settings.openViewOnStartup = v;
        void this.host.saveSettings();
      }));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/obsidian/main.test.ts`
Expected: PASS

- [ ] **Step 7: Mutation als Gegenprobe**

| Mutation | erwartet rot |
|---|---|
| `parseRunState(raw?.runState)` durch `(raw?.runState ?? {}) as RunState` ersetzen | „liest ein kaputtes runState-Feld, ohne den Start zu kippen" |
| `runState` aus dem `persist`-Aufruf entfernen | „schreibt runState in dieselbe data.json" |
| das `if (this.settings.openViewOnStartup)` im `onLayoutReady` entfernen | „oeffnet die Ansicht beim Start NICHT" |
| die `onLayoutReady`-Zeile ganz entfernen | **die Gegenprobe** — „mit gesetztem Opt-in oeffnet sie beim Start" |

- [ ] **Step 8: Volles Gate**

```bash
npm run gate
```

Erwartet: grün. `check:pure` muss bestätigen, dass `src/core/sync/run-state.ts` und `src/core/view/cockpit-vm.ts` keine Obsidian-Importe tragen.

- [ ] **Step 9: Handprobe im Staging-Vault**

Zwei Dinge sieht kein Unit-Test — beide sind anderswo im Workspace vom GUI-Smoke gefunden worden, mailstone hat noch keinen Treiber (M4):

1. **Sichtbarkeit beim Erstöffnen.** Rechte Seitenleiste einklappen, Obsidian neu laden, Ribbon-Symbol klicken. Erwartet: Leiste klappt auf, Cockpit ist sichtbar. Ein Blatt mit 0×0 px wäre der Defekt aus REGISTRY §UI.
2. **Knopf-Position.** Der „Alle synchronisieren"-Knopf muss im Inhalt stehen und sichtbar sein. Prüfen mit `getBoundingClientRect()` — Existenz im DOM ist grün, während niemand ihn sieht.

Ergebnis in `docs/SMOKE.md` protokollieren, wie die bisherigen Proben.

- [ ] **Step 10: Commit**

```bash
git add src/main.ts src/core/settings.ts src/obsidian/settings-tab.ts tests/obsidian/main.test.ts
git commit -m "feat(cockpit): Verdrahtung - Register persistiert, Ribbon oeffnet die Ansicht, Opt-in beim Start"
```

---

## Nach dem Plan

- `CHANGELOG.md` unter `## [Unreleased]` ergänzen (die Klammern gehören dazu — `release.mjs` prüft exakt auf diese Form und bräche sonst **nach** dem Versions-Bump ab).
- REGISTRY-Eintrag „Lauf-Zustand je Einheit halten" um mailstone als Übernahme ergänzen — **mit** dem Hinweis, dass es die Kopier-Kette aus `calendar-notes` fortsetzt und kein dritter unabhängiger Beleg ist.
- `git push origin main` **und** `git push github main`: mailstone hat seit dem 2026-09-01 gemessen keinen wirksamen Mirror.
