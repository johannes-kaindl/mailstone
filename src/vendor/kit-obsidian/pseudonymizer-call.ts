// vendored from obsidian-kit@0.108.0, src/obsidian/pseudonymizer-call.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Der Verbraucher-Aufruf der Pseudonymisierungs-API (Welle 36, kp1b, Teil B; Bestellung 14 der Design-Linie pseudonymizer, Spec 2026-11-18 § 8.7).
//
// Wer Text hinausgibt oder schreibt (mailstone, koda-agent, ein Export), ruft `pseudonymizeFor` vor dem Schreiben und `restoreFor` vor dem Anzeigen oder Senden. Beide kapseln den Schalter
// Aus / Wenn verfügbar / Verlangt und entscheiden, was bei fehlendem, nicht eingerichtetem oder gesperrtem Plugin gilt: **kein Verbraucher entscheidet den Rückfall selbst.** Die Entscheidung ist
// eine Tabelle (Test `tests/pseudonymizer-call.test.ts`, jede Zelle mit Mutationsprobe), nicht ein `if` im Aufrufer.
//
// BEWUSSTE ABWEICHUNG vom Sanitizer-Muster (`filename-sanitizer`): dort ist der Rückfall ohne Plugin harmlos (der Verbraucher läuft mit seiner eigenen Kit-Funktion weiter, ein unbereinigter Name ist
// höchstens hässlich). Hier schriebe der Rückfall Klarnamen und Adressen in eine Notiz oder auf einen Kanal, die der Nutzer geschützt glaubt. Deshalb gibt es in `"required"` **nie** `plain`,
// ein fehlendes Plugin ist dort ein Warten (`wait`), kein Weiterlaufen; und `restoreFor` lässt einen Text mit Platzhaltern nie ungeprüft durch, wenn das Plugin den Platzhalter nicht auflösen kann
// (`hold`), denn ein Platzhalter im Adressfeld oder im gesendeten Text ist ein Fehler.
//
// Entscheidungen (am Vertrag der Bestellung, jede mit Grund):
// - **Fehler sind Werte, der Aufruf wirft nie.** Ein Wurf der API, eine unlesbare Antwort und ein Wurf der Erkennung werden `error/threw` (`pseudonymizeFor`) und `hold/threw` (`restoreFor`): sie sehen nie wie
//   eine wartende Mail aus (`wait`), denn ein Programmierfehler darf nicht endlos warten.
// - **`wait` heißt: nichts schreiben, später wiederholen; `error` heißt: nicht wiederholen, der Aufrufer hat einen Fehler.** `invalid-input` ist ein Programmierfehler des Aufrufers (`error`), `deferred`, `cancelled`,
//   `storage-failed`, `not-ready` sind Zustände (`wait`). Ein unbekannter Fehlerwert einer späteren Version der API behandelt der Aufruf wie `not-ready` (der Vertrag erlaubt neue Werte in `ApiError.error`:
//   nichts hinausgeben, nichts schreiben, warten).
// - **Ein `locked` aus `transform` (obwohl `status` bereit meldete, das Plugin kann zwischen beiden sperren) gilt wie ein `locked` aus `status`**: `plain` in „Wenn verfügbar“, `wait` in „Verlangt“.
// - **`restoreFor` in „Aus“:** ohne bereites Plugin (fehlt, nicht eingerichtet, gesperrt) bleibt der Text unverändert, ohne Suche nach Platzhaltern: „Aus“ heißt, dass der Verbraucher das Plugin nicht nutzt. Ist das
//   Plugin bereit, löst auch „Aus“ auf: eine alte Notiz kann Platzhalter tragen, und sie in der Anzeige als Platzhalter stehen zu lassen, wäre die Ausnahme, nicht der Schalter.
// - **`restoreFor` ohne bereites Plugin, in „Wenn verfügbar“ und „Verlangt“:** die Funktion sucht selbst mit der Grammatik aus code-kit (`pure/placeholder`, `findPlaceholders`) und gibt einen Text ohne
//   Platzhalter frei, einen mit Platzhaltern nicht (`hold`, die gefundenen Platzhalter in `unknown`, ohne Doppelte, in der Reihenfolge des Textes). Die Grammatik wird nicht nachgebaut (ein Plugin ohne
//   `pseudonymizer` kennt sie sonst nicht).
// - **`restoreFor` mit bereitem Plugin, Fehlerwert:** `locked` und `not-ready` behalten ihren Grund (`hold/locked`, `hold/not-ready`), jeder andere Fehlerwert ist `hold/error`.
//
// - **`message` ist Anzeige und folgt der Sprache (Standard Englisch, `opts.strings.lang: "de"` für Deutsch; `pseudonymizer-call-strings.ts`, Welle 36, kp1c).** Tragend sind `kind`, `reason` und `unknown`; die `message` einer
//   Antwort der Plugin-API reicht der Aufruf unverändert durch.
//
// Der Aufruf liest die Plugin-API frisch je Aufruf (`readPseudonymizerApi`), er merkt sich nichts.

import type { App } from "obsidian";
import { errorMessage } from "../kit/error-message";
import { findPlaceholders } from "../kit/placeholder";
import type { ApiError, PseudonymizerApi, TransformRequest, TransformResult } from "../kit/pseudonymizer-source";
import { readPseudonymizerApi } from "./capability-apis";
import { resolvePseudonymizerCallStrings, type PseudonymizerCallStringsOverride } from "./pseudonymizer-call-strings";

/** Der Schalter des Verbrauchers: Aus, Wenn verfügbar, Verlangt. */
export type PseudonymizeMode = "off" | "if-available" | "required";

export type PseudonymizeOutcome =
  | { kind: "pseudonymized"; result: TransformResult }
  /** Nur in „Aus“ und, bei diesen drei Gründen, in „Wenn verfügbar“: der Verbraucher läuft mit dem Klartext weiter. In „Verlangt“ nie. */
  | { kind: "plain"; reason: "off" | Unavailable }
  /** Nichts schreiben, später wiederholen. `absent`, `not-set-up`, `locked` nur in „Verlangt“. */
  | { kind: "wait"; reason: "deferred" | "cancelled" | "storage-failed" | "not-ready" | Unavailable; message: string }
  /** Programmierfehler des Aufrufers oder ein Wurf: sieht nie wie eine wartende Mail aus. */
  | { kind: "error"; reason: "invalid-input" | "threw"; message: string };

export type ReleaseOutcome =
  | { kind: "release"; text: string; forgotten: string[] }
  /** Nichts hinausgeben, die Platzhalter in `unknown` nennen. */
  | { kind: "hold"; reason: "unknown" | Unavailable | "not-ready" | "error" | "threw"; unknown: string[]; message: string };

/** Option beider Aufrufe: die Sprache der `message` (Standard Englisch, `strings.lang: "de"` für Deutsch) und einzelne Texte. `reason` und `unknown` hängen nicht davon ab. */
export interface PseudonymizerCallOptions {
  strings?: PseudonymizerCallStringsOverride;
  /** Nur für `restoreFor`: an `restore` der Plugin-API weitergereicht (Vertragskopf von `pseudonymizer-source.ts`, „Grenze von `restore`“): Platzhalter in Link-Zielen, Bild-URLs, Code usw. bleiben stehen.
   *  Im Rückfall ohne bereites Plugin wirkt er nicht: dort bleibt ein Platzhalter in einer Adresse ein Grund für `hold`. */
  skipAddressesAndCode?: boolean;
}

type Unavailable = "absent" | "not-set-up" | "locked";

function isApiError(x: unknown): x is ApiError {
  return x !== null && typeof x === "object" && typeof (x as { error?: unknown }).error === "string";
}

/** Der Zustand des Plugins: bereit mit der API, oder der Grund, warum nicht. Wirft nie nach außen weiter als in den Aufrufer, der es fängt. */
function availability(app: App): { ready: PseudonymizerApi } | { unavailable: Unavailable } {
  const api = readPseudonymizerApi(app);
  if (api === null) return { unavailable: "absent" };
  const state = api.status().state;
  if (state === "ready") return { ready: api };
  if (state === "locked") return { unavailable: "locked" };
  if (state === "not-set-up") return { unavailable: "not-set-up" };
  // Ein unbekannter Zustand einer späteren Version: wie nicht eingerichtet behandeln (nichts hinausgeben).
  return { unavailable: "not-set-up" };
}

/** Pseudonymisiert die Teile von `req` für einen Verbraucher, der sie schreibt oder hinausgibt. Wirft nie.
 *  - `"off"`: ruft die API nie, `plain/off`.
 *  - `"if-available"`: fehlt das Plugin, ist es nicht eingerichtet oder gesperrt, `plain` mit diesem Grund; sonst `transform`.
 *  - `"required"`: **nie `plain`**; fehlt das Plugin, ist es nicht eingerichtet oder gesperrt, `wait` mit diesem Grund.
 *  `transform`: Erfolg → `pseudonymized`; `deferred`, `cancelled`, `storage-failed`, `not-ready` → `wait`; `invalid-input` → `error`; Wurf → `error/threw`. */
export async function pseudonymizeFor(app: App, mode: PseudonymizeMode, req: TransformRequest, opts?: PseudonymizerCallOptions): Promise<PseudonymizeOutcome> {
  if (mode === "off") return { kind: "plain", reason: "off" };
  const t = resolvePseudonymizerCallStrings(opts?.strings);
  const unavailable = (reason: Unavailable): PseudonymizeOutcome =>
    mode === "required" ? { kind: "wait", reason, message: t.unavailable[reason] } : { kind: "plain", reason };
  try {
    const a = availability(app);
    if ("unavailable" in a) return unavailable(a.unavailable);
    const out = await a.ready.transform(req);
    if (isApiError(out)) {
      switch (out.error) {
        case "locked": return unavailable("locked");
        case "invalid-input": return { kind: "error", reason: "invalid-input", message: out.message };
        case "deferred": case "cancelled": case "storage-failed": case "not-ready":
          return { kind: "wait", reason: out.error, message: out.message };
        default: return { kind: "wait", reason: "not-ready", message: out.message };
      }
    }
    if (out === null || typeof out !== "object" || !Array.isArray((out).parts)) {
      return { kind: "error", reason: "threw", message: t.unexpectedTransform };
    }
    return { kind: "pseudonymized", result: out };
  } catch (e) {
    return { kind: "error", reason: "threw", message: errorMessage(e) };
  }
}

/** Blendet Platzhalter in `text` wieder ein, für einen Verbraucher, der anzeigt oder sendet. Synchron, wirft nie.
 *  Ist das Plugin bereit (in jeder Stellung): `restore`; ein nicht leeres `unknown` ist `hold/unknown`, ein Fehlerwert `hold/error` (`locked`, `not-ready` mit ihrem Grund), ein Wurf `hold/threw`, sonst `release`.
 *  Ist es nicht bereit: in „Aus“ `release` mit dem Text unverändert; in „Wenn verfügbar“ und „Verlangt“ `release`, wenn der Text keinen Platzhalter enthält, sonst `hold` mit dem Grund. */
export function restoreFor(app: App, mode: PseudonymizeMode, text: string, caller: string, opts?: PseudonymizerCallOptions): ReleaseOutcome {
  const t = resolvePseudonymizerCallStrings(opts?.strings);
  try {
    const a = availability(app);
    if ("unavailable" in a) {
      if (mode === "off") return { kind: "release", text, forgotten: [] };
      const found: string[] = [];
      for (const p of findPlaceholders(text)) if (!found.includes(p.raw)) found.push(p.raw);
      if (found.length === 0) return { kind: "release", text, forgotten: [] };
      return { kind: "hold", reason: a.unavailable, unknown: found, message: `${t.unavailable[a.unavailable]} ${t.placeholdersUnresolvable(found.length)}` };
    }
    const r = a.ready.restore(text, opts?.skipAddressesAndCode === undefined ? { caller } : { caller, skipAddressesAndCode: opts.skipAddressesAndCode });
    if (isApiError(r)) {
      const reason = r.error === "locked" ? "locked" : r.error === "not-ready" ? "not-ready" : "error";
      return { kind: "hold", reason, unknown: [], message: r.message };
    }
    if (r === null || typeof r !== "object" || typeof r.text !== "string" || !Array.isArray(r.unknown) || !Array.isArray(r.forgotten)) {
      return { kind: "hold", reason: "threw", unknown: [], message: t.unexpectedRestore };
    }
    if (r.unknown.length > 0) {
      return { kind: "hold", reason: "unknown", unknown: [...r.unknown], message: t.placeholdersUnknown(r.unknown.length) };
    }
    return { kind: "release", text: r.text, forgotten: [...r.forgotten] };
  } catch (e) {
    return { kind: "hold", reason: "threw", unknown: [], message: errorMessage(e) };
  }
}
