// vendored from obsidian-kit@0.103.0, src/pure/pseudonymizer-source.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/* VERTRAG v1, EINGEFROREN von Anfang an (Spec pseudonymizer 2026-11-18, Abschnitt 8.7, von Johannes um 22:44 freigegeben; mit mailstone abgestimmt): `ApiError` (im Index
 * `PseudonymizerApiError`), `TransformPart`, `TransformEntity`, `TransformRequest`, `TransformResult`, `RestoreResult` und `PseudonymizerApi` gelten wie gebaut als Vertrag der Plugin-API v1; geändert
 * werden sie nur ADDITIV oder als v2 mit Übergang (`version: 2`, `isPseudonymizerApi` nimmt beide, das Kit bedient beide, bis das Plugin v1 abkündigt). Additiv heißt je Typ (dieselbe Tabelle
 * wie bei `describe-provider.ts` und `filename-sanitizer-source.ts`): `TransformRequest` — ein neues OPTIONALES Feld ja, ein neues Pflichtfeld nein; `TransformPart` und `TransformEntity` —
 * ein neues optionales Feld ja, ein neuer Wert in `kind` nein (der Besitzer müsste ihn kennen, ein Aufrufer ihn senden dürfen: das ist v2); `TransformResult` und `RestoreResult` — ein neues
 * optionales Feld ja, ein neues Pflichtfeld nein; `PseudonymizerApi` — eine neue OPTIONALE Methode ja (`isPseudonymizerApi` prüft nur die vier heutigen), eine neue Pflichtmethode, eine andere
 * Rückgabe oder `version` ungleich 1 nein; `ApiError` — ein neues optionales Feld ja, ein neuer Wert in `error` ja, weil jeder Konsument einen unbekannten Fehler wie `not-ready` behandeln muss
 * (nichts hinausgeben, nichts schreiben, warten). Ein neues PFLICHTfeld, ein entferntes, umbenanntes oder umgetyptes Feld ist v2. Gehalten wird die Form von
 * `tests/pseudonymizer-source.types.test.ts`: `npm run typecheck` bricht bei einer nicht additiven Änderung. `forget` fehlt in v1 mit Absicht (Entscheidung C der Planung, Spec 5.2). */

/** Vertrag der Plugin-API v1 des Plugins `pseudonymizer` (Spec 2026-11-18, § 8.7), so wie ein Plugin ihn braucht, das Text hinausgibt oder schreibt. Das Plugin besitzt die Platzhalter-Tabelle,
 *  den Schlüssel, die Erkennung und das Einblenden des Klartexts; wer Text pseudonymisieren oder zurücksetzen will, ruft die API (`readPseudonymizerApi`, `src/obsidian/`; der Aufruf mit dem Schalter
 *  Aus / Wenn verfügbar / Verlangt ist `pseudonymizeFor` / `restoreFor`, nicht hier). Die Datei hat keine Importe und keinen `obsidian`-Import.
 *
 *  **Regeln des Vertrags:**
 *  - **Fehler sind Werte, nie Ausnahmen** (`ApiError`); `version` wird streng mit `1` verglichen.
 *  - **`transform` ist asynchron und alles oder nichts:** entweder kommen alle Teile zurück oder ein Fehlerwert, und dann ist nichts gespeichert. Es kehrt **erst nach dem Schreiben der Tabelle**
 *    (neue Zuordnungen in der Gerätedatei) zurück, sonst könnte der Verbraucher eine Notiz mit Platzhaltern schreiben, deren Zuordnung ein Absturz verschluckt; scheitert das Schreiben, kommt
 *    `storage-failed` und der Verbraucher schreibt nichts. Es ist deterministisch (gleiche Eingabe und gleiche Tabelle, dieselbe Ausgabe). `interactive: false` liefert das Ergebnis nur, wenn jede
 *    Fundstelle durch eine frühere Entscheidung gedeckt ist, sonst `deferred`; `interactive: true` öffnet bei offenen Kandidaten das Prüffenster, ein Abbruch ergibt `cancelled`.
 *  - **`restore` ist synchron** (Anzeige und Senden brauchen das) und arbeitet auf der Tabelle im Arbeitsspeicher. `unknown` nennt Platzhalter, die es gerade nicht auflösen kann (fremd, oder ein
 *    anderes Gerät hat noch nicht nachgezogen), `forgotten` die vergessenen. **Ein nicht leeres `unknown` heißt für jeden, der etwas hinausgibt: nichts hinausgeben** und die Platzhalter nennen
 *    (wie bei `locked`). Vergessene Platzhalter gehen als Platzhalter hinaus, nach einem Hinweis im Dialog des Verbrauchers; in einem Adressfeld sind sie ein Fehler.
 *
 *  @example
 *  isPseudonymizerApi({ version: 1, status() {}, transform() {}, restore() {}, containsPlaceholder() {} }); // true */
export const PSEUDONYMIZER_PLUGIN_ID = "pseudonymizer";
export const PSEUDONYMIZER_API_VERSION = 1;

export interface ApiError { error: "not-ready" | "locked" | "cancelled" | "deferred" | "invalid-input" | "storage-failed"; message: string }

export interface TransformPart { id: string; kind: "text" | "line" | "filename"; value: string }
export interface TransformEntity { name?: string; email?: string }

export interface TransformRequest {
  caller: string;            // Plugin-ID des Aufrufers (Selbstauskunft)
  documentKey: string;       // stabiler Schlüssel des Dokuments, bei mailstone die Message-ID
  interactive: boolean;      // false: nie ein Fenster öffnen
  title?: string;            // Überschrift des Prüffensters
  parts: TransformPart[];    // die Textteile; der Aufrufer vergibt die ids
  entities?: TransformEntity[]; // bekannte Paare, etwa aus dem Mail-Kopf
  keep?: string[];           // Werte, die nie ersetzt werden (eigene Identitäten, Vorgangs-Token)
}

export interface TransformResult { parts: { id: string; value: string }[]; entities: TransformEntity[]; applied: number }
export interface RestoreResult { text: string; restored: number; unknown: string[]; forgotten: string[] }

export interface PseudonymizerApi {
  version: 1;
  status(): { state: "ready" | "locked" | "not-set-up" };
  transform(req: TransformRequest): Promise<TransformResult | ApiError>;
  restore(text: string, opts: { caller: string }): RestoreResult | ApiError;
  containsPlaceholder(text: string): boolean;
}

const METHODS = ["status", "transform", "restore", "containsPlaceholder"] as const;

/** Form-Prüfung statt Vertrauen: ein Fremdplugin bekommt kein TS-Vertrauen geschenkt. */
export function isPseudonymizerApi(x: unknown): x is PseudonymizerApi {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== PSEUDONYMIZER_API_VERSION) return false;
  return METHODS.every((m) => typeof o[m] === "function");
}
