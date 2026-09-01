import type { Account } from "../settings";

/** Taktweite des Sync-Weckers. Der Wecker laeuft NICHT im Intervall eines Kontos, sondern in
 *  einem festen, kurzen Takt und fragt bei jedem Schlag, welche Konten faellig sind. Das loest
 *  zwei Dinge auf einmal: verschiedene Konten bekommen verschiedene Intervalle, und eine
 *  geaenderte Einstellung wirkt beim naechsten Takt statt erst nach einem Neustart (die alte
 *  Kadenz wurde in onload() einmal berechnet). Eine Minute ist zugleich der kleinste sinnvolle
 *  Kontowert und damit die Untergrenze jedes Intervalls. */
export const TICK_MS = 60_000;

/** Wie lange ein Konto zwischen zwei Laeufen wartet, in Millisekunden.
 *
 *  `repairAccount` uebernimmt `sync` ungeprueft aus data.json — der Wert kann NaN, Infinity
 *  oder eine Zeichenkette sein. Ohne diesen Riegel waere `everyMs` NaN, und weil JEDER
 *  Vergleich mit NaN false ist, waere das Konto nie wieder faellig: kein Fehler, keine Notice,
 *  keine Spur in der Statusleiste. Ein stiller Ausfall ist der schlechtere Ausgang als der
 *  Dauerlauf, den die alte Fassung produzierte — also faellt Unbrauchbares auf einen Takt.
 *
 *  EINE Funktion fuer Wecker (`dueAccounts`) und Anzeige (`nextDueAt` in run-state.ts): die
 *  Formel stand bis zum Abschluss-Review byte-gleich an beiden Orten, mit dem Kommentar „damit
 *  Anzeige und Wecker nicht auseinanderlaufen" — genau dagegen sicherte nichts. */
export function intervalMs(account: Account): number {
  const wert = Number(account.sync.intervalMin);
  return Number.isFinite(wert) && wert > 0 ? Math.max(TICK_MS, wert * TICK_MS) : TICK_MS;
}

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
    const everyMs = intervalMs(a);
    const last = lastRun[a.id];
    if (last === undefined || nowMs - last >= everyMs) out.push(a.id);
  }
  return out;
}
