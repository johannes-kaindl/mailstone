// vendored from obsidian-kit@0.108.0, src/obsidian/pseudonymizer-call-strings.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Texte (EN/DE) der `message` in `pseudonymizeFor` und `restoreFor` — nach dem Muster von `redline-strings.ts` und `model-bar-strings.ts`: das Kit formuliert in der Sprache des Verbrauchers, Standard Englisch
 *  (Welle 36, kp1c, Zusatz des Kit-Masters; vorher stand der deutsche Text fest im Code). `message` ist Anzeige: tragend sind `kind`, `reason` und `unknown`, und diese ändern sich nicht. Die `message` einer
 *  Antwort der Plugin-API (`ApiError.message`) reicht der Aufruf unverändert durch, sie stammt vom Plugin pseudonymizer.
 *
 *  Überschreiben: `{ strings: { lang: "de", unavailable: { absent: "…" } } }` — Teil-Merge über dem Default der Sprache. */

export type CallUnavailable = "absent" | "not-set-up" | "locked";

export interface PseudonymizerCallStrings {
  /** Warum das Plugin nicht bereit ist. */
  unavailable: Record<CallUnavailable, string>;
  /** `transform` lieferte etwas, das weder Ergebnis noch Fehler ist. */
  unexpectedTransform: string;
  /** `restore` lieferte etwas, das weder Ergebnis noch Fehler ist. */
  unexpectedRestore: string;
  /** Das Plugin ist nicht bereit und der Text trägt `n` Platzhalter (angehängt an den Grund in `unavailable`). */
  placeholdersUnresolvable: (n: number) => string;
  /** Das Plugin ist bereit, kennt aber `n` Platzhalter nicht. */
  placeholdersUnknown: (n: number) => string;
}

export interface PseudonymizerCallStringsOverride extends Partial<Omit<PseudonymizerCallStrings, "unavailable">> {
  lang?: "en" | "de";
  unavailable?: Partial<Record<CallUnavailable, string>>;
}

export const PSEUDONYMIZER_CALL_STRINGS_EN: PseudonymizerCallStrings = {
  unavailable: {
    absent: "The pseudonymizer plugin is missing or disabled.",
    "not-set-up": "The pseudonymizer plugin is not set up yet.",
    locked: "The pseudonymizer plugin is locked.",
  },
  unexpectedTransform: "Unexpected response from pseudonymizer.transform.",
  unexpectedRestore: "Unexpected response from pseudonymizer.restore.",
  placeholdersUnresolvable: (n) => `The text contains ${String(n)} ${n === 1 ? "placeholder" : "placeholders"} that cannot be resolved.`,
  placeholdersUnknown: (n) => `${String(n)} ${n === 1 ? "placeholder cannot" : "placeholders cannot"} be resolved.`,
};

export const PSEUDONYMIZER_CALL_STRINGS_DE: PseudonymizerCallStrings = {
  unavailable: {
    absent: "Das Plugin pseudonymizer fehlt oder ist abgeschaltet.",
    "not-set-up": "Das Plugin pseudonymizer ist noch nicht eingerichtet.",
    locked: "Das Plugin pseudonymizer ist gesperrt.",
  },
  unexpectedTransform: "Unerwartete Antwort von pseudonymizer.transform.",
  unexpectedRestore: "Unerwartete Antwort von pseudonymizer.restore.",
  placeholdersUnresolvable: (n) => `Der Text enthält ${String(n)} ${n === 1 ? "Platzhalter, der sich" : "Platzhalter, die sich"} nicht auflösen lassen.`,
  placeholdersUnknown: (n) => `${String(n)} ${n === 1 ? "Platzhalter lässt" : "Platzhalter lassen"} sich nicht auflösen.`,
};

export function resolvePseudonymizerCallStrings(override?: PseudonymizerCallStringsOverride): PseudonymizerCallStrings {
  const base = override?.lang === "de" ? PSEUDONYMIZER_CALL_STRINGS_DE : PSEUDONYMIZER_CALL_STRINGS_EN;
  if (!override) return base;
  const out: PseudonymizerCallStrings = { ...base, unavailable: { ...base.unavailable, ...override.unavailable } };
  if (override.unexpectedTransform !== undefined) out.unexpectedTransform = override.unexpectedTransform;
  if (override.unexpectedRestore !== undefined) out.unexpectedRestore = override.unexpectedRestore;
  if (override.placeholdersUnresolvable) out.placeholdersUnresolvable = override.placeholdersUnresolvable;
  if (override.placeholdersUnknown) out.placeholdersUnknown = override.placeholdersUnknown;
  return out;
}
