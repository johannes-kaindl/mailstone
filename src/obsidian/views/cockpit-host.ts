import type { Account } from "../../core/settings";
import type { Unsubscribe } from "../../core/sync/events";
import { nextDueAt as berechneFaelligkeit, type RunState } from "../../core/sync/run-state";
import type { CockpitHost } from "./cockpit-panel";

/** Die Zugaenge, die das Plugin beisteuert. Alles Funktionen, damit der Host eine LEBENDE
 *  Sicht ist und keine Momentaufnahme: waehrend die Ansicht offen steht, schreibt der Wecker
 *  weiter in `lastRun` und ein Lauf ins Register. */
export interface CockpitHostDeps {
  accounts: () => readonly Account[];
  runState: () => RunState;
  lastRun: () => Readonly<Record<string, number>>;
  isBusy: () => boolean;
  syncNow: (accountId?: string) => void;
  openSettings: () => void;
  onChange: (cb: () => void) => Unsubscribe;
}

/** Baut den Vertrag, den das Panel sieht. Die einzige Stelle mit eigener Logik ist
 *  `nextDueAt`: die Ansicht kennt nur Konto-Ids, die Berechnung braucht das Konto und den
 *  Zeitstempel des Weckers. Eine Id ohne Konto liefert `null` statt zu werfen — ein
 *  geloeschtes Konto kann im Register noch stehen. */
export function createCockpitHost(deps: CockpitHostDeps): CockpitHost {
  return {
    accounts: () => deps.accounts(),
    runState: () => deps.runState(),
    nextDueAt: (id) => {
      const konto = deps.accounts().find((a) => a.id === id);
      return konto ? berechneFaelligkeit(konto, deps.lastRun()[id]) : null;
    },
    isBusy: () => deps.isBusy(),
    syncNow: (accountId) => deps.syncNow(accountId),
    openSettings: () => deps.openSettings(),
    onChange: (cb) => deps.onChange(cb),
  };
}
