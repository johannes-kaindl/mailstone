import type { Account } from "../settings";

/** Taktweite des Sync-Weckers. Der Wecker laeuft NICHT im Intervall eines Kontos, sondern in
 *  einem festen, kurzen Takt und fragt bei jedem Schlag, welche Konten faellig sind. Das loest
 *  zwei Dinge auf einmal: verschiedene Konten bekommen verschiedene Intervalle, und eine
 *  geaenderte Einstellung wirkt beim naechsten Takt statt erst nach einem Neustart (die alte
 *  Kadenz wurde in onload() einmal berechnet). Eine Minute ist zugleich der kleinste sinnvolle
 *  Kontowert und damit die Untergrenze jedes Intervalls. */
export const TICK_MS = 60_000;

/** IDs der Konten, die bei `nowMs` synchronisiert werden sollen — in der Reihenfolge der
 *  Kontoliste, damit ein Lauf reproduzierbar bleibt.
 *
 *  `lastRun` haelt je Konto den Zeitpunkt des letzten Laufs; ein fehlender Eintrag gilt als
 *  faellig. Wer beim Start nicht sofort synchronisieren will, setzt ihn beim Laden auf "jetzt" —
 *  diese Funktion entscheidet ueber Faelligkeit, nicht ueber die Anlaufpolitik.
 *
 *  Deaktivierte Konten fallen hier raus und nicht erst im Sync: ihr Intervall darf den Takt der
 *  anderen nicht beeinflussen. Genau das war der Fehler der alten Fassung, die das Minimum ueber
 *  ALLE Konten bildete — auch ueber abgeschaltete. */
export function dueAccounts(
  accounts: readonly Account[],
  lastRun: Readonly<Record<string, number>>,
  nowMs: number,
): string[] {
  const out: string[] = [];
  for (const a of accounts) {
    if (!a.sync.enabled) continue;
    const everyMs = Math.max(TICK_MS, a.sync.intervalMin * TICK_MS);
    const last = lastRun[a.id];
    if (last === undefined || nowMs - last >= everyMs) out.push(a.id);
  }
  return out;
}
