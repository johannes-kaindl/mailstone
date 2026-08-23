// Reines Interface (kein Obsidian-Import, siehe scripts/check-pure.mjs) — die konkreten
// Implementierungen (Obsidian-Schluesselbund, In-Memory-Fallback) leben in src/obsidian/secrets.ts.
// Absichtlich klein gehalten: kein "delete" (SecretStorage kennt keins, s. dortiger Kommentar),
// `has()` behandelt einen leeren String als "nicht gesetzt" — konsistent mit dem Loesch-Ersatz
// (secrets.set(id, "")) in der Settings-UI.
export interface SecretStore {
  get(id: string): string | null;
  set(id: string, value: string): void;
  has(id: string): boolean;
}
