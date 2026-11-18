// Anzeige-Modell der Folge-Mails (A1): nach Vorgang gruppiert. Rein; den Link auf die Wurzel-Notiz
// loest die Obsidian-Schicht aus der Mail-ID der Wurzel auf.
import type { FollowItem } from "../thread/follow-run";

export interface FollowGroup {
  /** Mail-ID der Wurzel des Vorgangs. */
  root: string;
  /** Die Folge-Mails des Vorgangs, die fruehste zuerst. */
  items: FollowItem[];
}

const byDate = (a: FollowItem, b: FollowItem): number =>
  a.date === b.date ? (a.folder === b.folder ? a.uid - b.uid : a.folder < b.folder ? -1 : 1) : a.date === "" ? 1 : b.date === "" ? -1 : a.date < b.date ? -1 : 1;

export function groupFollowUps(items: readonly FollowItem[]): FollowGroup[] {
  const groups = new Map<string, FollowItem[]>();
  for (const item of items) {
    const g = groups.get(item.root);
    if (g) g.push(item); else groups.set(item.root, [item]);
  }
  const out = [...groups].map(([root, list]) => ({ root, items: [...list].sort(byDate) }));
  // Gruppen: die mit der fruehesten Mail zuerst, ohne Datum zuletzt, dann nach Wurzel.
  out.sort((a, b) => {
    const da = a.items[0]!.date;
    const db = b.items[0]!.date;
    if (da !== db) return da === "" ? 1 : db === "" ? -1 : da < db ? -1 : 1;
    return a.root < b.root ? -1 : a.root > b.root ? 1 : 0;
  });
  return out;
}
