// Die Reihenfolge der Mails eines Vorgangs: Datum und Uhrzeit aus dem Frontmatter, eine Mail ohne
// Datum steht am Ende, bei Gleichstand entscheidet die mailId (stabil, unabhaengig von der
// Reihenfolge, in der der Vault die Dateien nennt).

export interface Dated { mailId: string; date: string; time: string }

/** Sortierschluessel `"YYYY-MM-DD HH:MM"`, `null` ohne Datum. Eine fehlende Uhrzeit gilt als 00:00. */
export function dateKey(d: Pick<Dated, "date" | "time">): string | null {
  return d.date === "" ? null : `${d.date} ${d.time === "" ? "00:00" : d.time}`;
}

/** Negativ, wenn `a` frueher ist als `b`. Ohne Datum ans Ende, dann nach mailId. */
export function compareDated(a: Dated, b: Dated): number {
  const ka = dateKey(a);
  const kb = dateKey(b);
  if (ka !== kb) {
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka < kb ? -1 : 1;
  }
  return a.mailId < b.mailId ? -1 : a.mailId > b.mailId ? 1 : 0;
}
