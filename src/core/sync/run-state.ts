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
