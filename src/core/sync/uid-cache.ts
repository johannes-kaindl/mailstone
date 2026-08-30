// UID -> Message-ID pro <Konto>|<Ordner>, damit nicht jeder Sync-Lauf alle Header holt.
// Der Cache ist Beschleunigung, nie Wahrheit: bei UIDVALIDITY-Wechsel wird er verworfen und
// der Lauf faellt auf den vollen Header-Abgleich zurueck.
export interface UidCacheEntry { uidValidity: number; map: Record<string, string> }
export type UidCacheData = Record<string, UidCacheEntry>;

export interface UidCacheStore {
  known(accountId: string, folder: string, uidValidity: number): Map<number, string>;
  remember(accountId: string, folder: string, uidValidity: number, uid: number, mailId: string): void;
  retain(accountId: string, folder: string, uidValidity: number, uids: readonly number[]): void;
  data(): UidCacheData;
}

const keyOf = (accountId: string, folder: string): string => `${accountId}|${folder}`;

function repair(raw: unknown): UidCacheData {
  const out: UidCacheData = {};
  if (raw === null || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    if (typeof e.uidValidity !== "number" || e.map === null || typeof e.map !== "object") continue;
    const map: Record<string, string> = {};
    for (const [uid, id] of Object.entries(e.map as Record<string, unknown>)) if (typeof id === "string") map[uid] = id;
    out[k] = { uidValidity: e.uidValidity, map };
  }
  return out;
}

export function createUidCache(initial: unknown): UidCacheStore {
  const data = repair(initial);

  function entry(accountId: string, folder: string, uidValidity: number): UidCacheEntry {
    const k = keyOf(accountId, folder);
    const cur = data[k];
    if (cur && cur.uidValidity === uidValidity) return cur;
    const fresh: UidCacheEntry = { uidValidity, map: {} };
    data[k] = fresh;
    return fresh;
  }

  return {
    known(accountId, folder, uidValidity) {
      const cur = data[keyOf(accountId, folder)];
      const out = new Map<number, string>();
      if (!cur || cur.uidValidity !== uidValidity) return out;
      for (const [uid, id] of Object.entries(cur.map)) out.set(Number(uid), id);
      return out;
    },
    remember(accountId, folder, uidValidity, uid, mailId) {
      entry(accountId, folder, uidValidity).map[String(uid)] = mailId;
    },
    retain(accountId, folder, uidValidity, uids) {
      const cur = entry(accountId, folder, uidValidity);
      const keep = new Set(uids.map((u) => String(u)));
      for (const uid of Object.keys(cur.map)) if (!keep.has(uid)) delete cur.map[uid];
    },
    data: () => data,
  };
}
