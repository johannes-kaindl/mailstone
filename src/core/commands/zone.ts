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
