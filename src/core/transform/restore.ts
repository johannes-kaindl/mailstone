// Die Rueckwandlung beim Hinausgeben (A5, Schritt 5): vor jeder Stelle, an der Text mailstone verlaesst (Senden, Antworten), werden Platzhalter des
// Pseudonymizers durch den Klartext ersetzt, damit die Mail beim Empfaenger lesbar ankommt und die Bestaetigung zeigt, was wirklich hinausgeht.
//
// Rein: der Port `(text) => RestoreOutcome` kommt hinein, die obsidian-Schicht bindet ihn an `restoreFor(app, profile.pseudonymize, text, "mailstone")`
// (Kit, `kit-obsidian/pseudonymizer-call`). Dort steht auch, was der Schalter bei fehlendem, nicht eingerichtetem oder gesperrtem Plugin tut; diese
// Datei entscheidet das nicht noch einmal. `tests/core/transform/mode-type.test.ts` haelt `RestoreOutcome` und den Kit-Typ gleich.
//
// Regeln (Spec 2026-11-18, 8.7 und 8.8; die Setzungen sind mit der Quelle belegt):
// - `hold` bei irgendeinem Teil (unbekannte Platzhalter, gesperrt, nicht bereit, Fehler): nichts geht hinaus. Gemeldet wird die Anzahl der
//   Platzhalter, nie der Klartext und nie der Platzhalter selbst.
// - Ein vergessener Platzhalter (`forgotten`) in einem ADRESSFELD ist ein Fehler. In Betreff, Text und HTML geht er als Platzhalter hinaus
//   („Vergessene Platzhalter gehen als Platzhalter hinaus, nach einem Hinweis im Dialog des Verbrauchers“); die Zahl steht im Ergebnis.
// - Eine Empfaengeradresse, die einen Platzhalter trug, muss nach der Rueckwandlung ein `@` haben. Der Pseudonymizer kann einen Platzhalter ohne
//   Traeger (`Mail_<id>`, „gehoert niemandem“) oder einen Namen zurueckgeben, der keine Adresse ist; beides darf nie als Adresse weitergehen.
//   Eine Adresse OHNE Platzhalter wird nicht angefasst: ihre Grammatik prueft weiter `validateOutgoing` bzw. der Torwaechter der API.
import { findPlaceholders } from "../../vendor/kit/placeholder";

/** Der Ausgang des Ports. Dieselbe Form wie `ReleaseOutcome` im Kit (`kit-obsidian/pseudonymizer-call`); `src/core` importiert aus der obsidian-Schicht nicht. */
export type RestoreOutcome =
  | { kind: "release"; text: string; forgotten: string[] }
  | { kind: "hold"; reason: string; unknown: string[]; message: string };

export type RestorePort = (text: string) => RestoreOutcome;

export type RestoreFailure =
  /** Nichts geht hinaus: `count` Platzhalter lassen sich nicht aufloesen (0, wenn das Plugin gar nicht antwortet), `reason` und `message` kommen vom Port. */
  | { kind: "held"; reason: string; count: number; message: string }
  /** Ein vergessener Platzhalter steht in einem Adressfeld. */
  | { kind: "forgotten-address"; count: number }
  /** Eine Adresse, die einen Platzhalter trug, hat nach der Rueckwandlung kein `@`. */
  | { kind: "address-unresolved"; count: number }
  /** P13: der ICS-Teil oder ein Anhang traegt Platzhalter. Diese Teile werden nie zurueckgewandelt (Zeilenfaltung, Injektionsrisiko); `count` zaehlt die
   *  verschiedenen Platzhalter, nie ihr Wert. */
  | { kind: "unrestorable-part"; count: number };

export type RestoreResult<T> = ({ ok: true } & T) | { ok: false; failure: RestoreFailure };

/** Der Text nach der Rueckwandlung; `forgotten` zaehlt die vergessenen Platzhalter, die stehen geblieben sind. */
export type RestoredText = RestoreResult<{ text: string; forgotten: number }>;

const held = (o: Extract<RestoreOutcome, { kind: "hold" }>): RestoreFailure => ({ kind: "held", reason: o.reason, count: o.unknown.length, message: o.message });

/** Ein Textteil (Betreff, Text, HTML): vergessene Platzhalter bleiben stehen und werden gezaehlt. */
export function restoreText(text: string, port: RestorePort): RestoredText {
  const o = port(text);
  if (o.kind === "hold") return { ok: false, failure: held(o) };
  return { ok: true, text: o.text, forgotten: o.forgotten.length };
}

/** Eine Empfaengeradresse (`to`, `cc`, `bcc`). */
export function restoreAddress(address: string, port: RestorePort): RestoredText {
  const o = port(address);
  if (o.kind === "hold") return { ok: false, failure: held(o) };
  if (o.forgotten.length > 0) return { ok: false, failure: { kind: "forgotten-address", count: o.forgotten.length } };
  // Nur eine Adresse, die einen Platzhalter trug: `max.mustermann` ohne Platzhalter bleibt eine Sache der Adresspruefung (`invalid`).
  if (!o.text.includes("@") && findPlaceholders(address).length > 0) return { ok: false, failure: { kind: "address-unresolved", count: findPlaceholders(address).length } };
  return { ok: true, text: o.text, forgotten: 0 };
}

/** Eine formatierte Absenderzeile (`Name <adresse>`), aus der die Antwort-Adresse gelesen wird: wie ein Adressfeld, nur dass die Pruefung auf `@`
 *  der Aufrufer macht (er liest die Adresse aus der Zeile). */
export function restoreFormatted(formatted: string, port: RestorePort): RestoredText {
  const o = port(formatted);
  if (o.kind === "hold") return { ok: false, failure: held(o) };
  if (o.forgotten.length > 0) return { ok: false, failure: { kind: "forgotten-address", count: o.forgotten.length } };
  return { ok: true, text: o.text, forgotten: 0 };
}

/** Die Felder einer Nachricht, die hinausgehen. `OutgoingMessage` passt hinein; die API baut sich dieselbe Form aus `body`. */
export interface RestorableMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
}

/** Wandelt Empfaenger, Betreff, Text und HTML zurueck, ALLE Teile (damit die Zahl der Platzhalter vollstaendig ist). Weitere Felder bleiben unveraendert.
 *  Rangfolge der Fehler: `held` vor `forgotten-address` vor `address-unresolved`. */
export function restoreMessage<M extends RestorableMessage>(msg: M, port: RestorePort): RestoreResult<{ msg: M; forgotten: number }> {
  const failures: RestoreFailure[] = [];
  let forgotten = 0;
  const take = (r: RestoredText): string => {
    if (!r.ok) { failures.push(r.failure); return ""; }
    forgotten += r.forgotten;
    return r.text;
  };
  const list = (values: string[]): string[] => values.map((a) => take(restoreAddress(a, port)));
  const out: M = { ...msg };
  out.to = list(msg.to);
  if (msg.cc) out.cc = list(msg.cc);
  if (msg.bcc) out.bcc = list(msg.bcc);
  out.subject = take(restoreText(msg.subject, port));
  out.text = take(restoreText(msg.text, port));
  if (msg.html !== undefined) out.html = take(restoreText(msg.html, port));
  if (failures.length === 0) return { ok: true, msg: out, forgotten };
  const heldOnes = failures.filter((f): f is Extract<RestoreFailure, { kind: "held" }> => f.kind === "held");
  const first = heldOnes[0];
  if (first) return { ok: false, failure: { ...first, count: heldOnes.reduce((n, f) => n + f.count, 0) } };
  return { ok: false, failure: failures.find((f) => f.kind === "forgotten-address") ?? failures[0]! };
}

/** Die Teile einer Nachricht, die nicht zurueckgewandelt werden: der ICS-Teil und die Anhaenge. */
export interface UnrestorableParts {
  calendar?: { ics: string };
  attachments?: { name: string; type: string; data: Uint8Array }[];
}

/** Textformate, deren Bytes als Text gelesen werden: `text/*` und die gaengigen Anwendungsformate mit Textinhalt (auch `+json`, `+xml`). */
const TEXTUAL_TYPE = /^(?:text\/|application\/(?:[\w.-]+\+)?(?:json|xml|ics|yaml|x-yaml)\s*(?:;|$))/i;

/** P13: Platzhalter im ICS-Teil, in Anhangnamen oder in Textanhaengen. Diese Teile wandelt Mailstone nicht zurueck (eine Rueckwandlung faltet Zeilen um
 *  und oeffnet Injektion in den Kalendertext), sie duerfen aber auch nicht mit Platzhaltern hinaus: ein Treffer heisst, nichts wird gesendet. Gemeldet
 *  wird die Anzahl der verschiedenen Platzhalter, nie ein Wert. Binaeranhaenge werden nicht gelesen. Ohne Treffer `null`, die Nachricht bleibt byte-gleich. */
export function unrestorablePlaceholders(msg: UnrestorableParts): Extract<RestoreFailure, { kind: "unrestorable-part" }> | null {
  const found = new Set<string>();
  const scan = (text: string): void => { for (const p of findPlaceholders(text)) found.add(p.raw); };
  if (msg.calendar) scan(msg.calendar.ics);
  for (const a of msg.attachments ?? []) {
    scan(a.name);
    if (TEXTUAL_TYPE.test(a.type)) scan(new TextDecoder().decode(a.data));
  }
  return found.size > 0 ? { kind: "unrestorable-part", count: found.size } : null;
}
