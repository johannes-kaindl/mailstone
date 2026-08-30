// uebernommen aus calendar-notes/src/core/sync/events.ts, 2026-08-30 — Payloads an mailstone angepasst
import type { NotePlan } from "../mirror/plan";

export type Unsubscribe = () => void;

/** Generischer, minimaler Event-Emitter — pure (`src/core/**`, `check:pure`), kein
 *  Node-`EventEmitter`-Import. `E` bindet Event-Namen an ihren Payload-Typ, damit
 *  `on`/`emit` je Event ohne Cast typsicher bleiben. */
export interface Emitter<E extends Record<string, unknown>> {
  on<K extends keyof E & string>(event: K, cb: (payload: E[K]) => void): Unsubscribe;
  emit<K extends keyof E & string>(event: K, payload: E[K]): void;
}

export function createEmitter<E extends Record<string, unknown>>(): Emitter<E> {
  const listeners = new Map<keyof E & string, Set<(payload: E[keyof E & string]) => void>>();
  return {
    on(event, cb) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(cb as (payload: E[keyof E & string]) => void);
      return () => {
        set.delete(cb as (payload: E[keyof E & string]) => void);
      };
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      // Kopie, damit ein `unsubscribe()` aus einem Callback heraus die laufende Iteration nicht stoert.
      for (const cb of [...set]) {
        // Fix-Runde 1, Punkt 1: ein werfender Listener darf den Aufrufer (SyncService,
        // executeCommandPlan) nicht stoppen — ein Fremdplugin-Callback (z. B. ueber
        // `api.on(...)`) soll den eigenen Sync-/Kommando-Lauf nicht kippen koennen. `emit()`
        // selbst bleibt synchron und ohne Rueckgabewert, ein Fehler hat also nirgends
        // hinzulaufen — verschluckt statt geworfen.
        try {
          cb(payload);
        } catch {
          /* Listener-Fehler bewusst verschluckt, s. o. */
        }
      }
    },
  };
}

/** Zaehler eines Sync-Laufs. Liegt hier und nicht in service.ts: sonst importierten sich
 *  events.ts und service.ts gegenseitig, nur um einen Zaehler-Typ zu teilen.
 *  `detachSkipped` = Detach-Plaene, die dieser Lauf bewusst ausgelassen hat, weil er nicht jede
 *  Mail-ID auf dem Server bestimmen konnte (siehe service.ts, `undetermined`). Ohne diesen
 *  Zaehler waere ein stillgelegter Detach-Durchgang von "es gab nichts zu tun" nicht zu
 *  unterscheiden — der Lauf meldet in beiden Faellen ok: true. */
export interface SyncCounts { created: number; reattached: number; detached: number; skipped: number; detachSkipped: number; errors: number }

/** Events, die `SyncService` ueber `SyncDeps.events` feuert — `synced` nach jedem Lauf
 *  (auch ohne Aenderungen), `changed` je tatsaechlich ausgefuehrtem `NotePlan`. */
export interface SyncEvents extends Record<string, unknown> {
  synced: { accountId: string; counts: SyncCounts };
  changed: { path: string; kind: NotePlan["kind"]; mailId: string };
}

export type SyncEmitter = Emitter<SyncEvents>;
