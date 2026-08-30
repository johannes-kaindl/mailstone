import type { FmVal } from "../mirror/profile";

function show(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v) ?? "";
}

/**
 * Zeilen fuer die Vorschau-Tabelle: je verwaltetem Key ein Vorher/Nachher, aber nur wo sich
 * etwas unterscheidet. `before` fehlt, wenn der Key in der Notiz noch gar nicht vorkam —
 * das Modal zeigt dafuer "—".
 */
export function diffFrontmatter(
  before: Record<string, unknown>,
  after: Record<string, FmVal>,
  keys: readonly string[],
): { field: string; before?: string; after?: string }[] {
  const rows: { field: string; before?: string; after?: string }[] = [];
  for (const k of keys) {
    if (!Object.hasOwn(after, k)) continue;
    const a = show(after[k]);
    if (!Object.hasOwn(before, k)) { rows.push({ field: k, after: a }); continue; }
    const b = show(before[k]);
    if (b !== a) rows.push({ field: k, before: b, after: a });
  }
  return rows;
}
