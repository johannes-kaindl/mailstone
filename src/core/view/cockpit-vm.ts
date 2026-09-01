import type { Account } from "../settings";
import type { SyncCounts } from "../sync/events";
import type { RunState } from "../sync/run-state";

/** Zustandsvokabel des §8-Bausteins „Status-Indikator" ohne `is-`-Praefix — die
 *  Klassenschreibweise ist Sache der Darstellung. `never` ist bewusst KEIN
 *  Indikatorzustand: fuer „noch nie gelaufen" gibt es keine Vokabel, und einen der vier
 *  zu behaupten waere falsch. Das Panel zeigt dafuer nur Text.
 *
 *  `checking` fehlt hier ebenso bewusst: es ist ein Zustand der KOPFZEILE, nicht einer Zeile
 *  (Spec „Status-Indikator", Bekannte Grenze). Der BusyGuard ist global und weiss nicht, welches
 *  Konto laeuft — eine Zeile auf `checking` zu setzen behauptete etwas Falsches, bei zwei Konten
 *  zwei Spinner fuer einen Lauf. Die Zeilen behalten waehrend eines Laufs ihren letzten Stand. */
export type CockpitState = "ok" | "warning" | "error" | "never";

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

/** Was in der Zeile steht, wenn das Konto keinen Namen hat. Ein leeres Label ist ein
 *  VORGESEHENER Zustand: `addAccount()` setzt es auf "", das Konto-Modal erzwingt nichts.
 *  Ohne diesen Rueckfall traegt die Zeile nur Indikator und Knopf, und bei zwei Konten ist
 *  nicht erkennbar, welches man synchronisiert. Dieselbe Konvention wie im Settings-Tab
 *  (`acc.label || acc.id`) — ein zweiter Erklaertext waere §10-widrig. */
function anzeigename(a: Account): string {
  return a.label || a.id;
}

export function buildCockpitViewModel(input: CockpitInput): CockpitViewModel {
  const rows: CockpitRow[] = input.accounts.map((a) => {
    const run = input.runState[a.id];
    const disabled = !a.sync.enabled;
    const label = anzeigename(a);

    // KEIN busy-Zweig: waehrend eines Laufs behaelt die Zeile ihren Zustand samt Zaehlern und
    // Fehler (Spec, Bekannte Grenze). Der Lauf-Indikator sitzt in der Kopfzeile, weil der
    // Guard global ist und nicht sagt, welches Konto gerade dran ist.
    if (!run) {
      return { accountId: a.id, label, state: "never", lastRunAt: null,
        nextRunAt: input.nextDue(a.id), countsKey: null, countsArgs: [], errorKey: null, disabled };
    }
    if (!run.ok) {
      return { accountId: a.id, label, state: "error", lastRunAt: run.at,
        nextRunAt: input.nextDue(a.id), countsKey: null, countsArgs: [],
        errorKey: `error.sync.${run.code ?? "protocol"}`, disabled };
    }
    const auffaellig = run.counts.errors > 0 || run.counts.detachSkipped > 0;
    const { key, args } = condenseCounts(run.counts);
    return { accountId: a.id, label, state: auffaellig ? "warning" : "ok", lastRunAt: run.at,
      nextRunAt: input.nextDue(a.id), countsKey: key, countsArgs: args, errorKey: null, disabled };
  });

  return { rows, empty: rows.length === 0, busy: input.busy };
}
