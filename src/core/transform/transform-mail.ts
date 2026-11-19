// Die eine Transformationsfunktion fuer A5 (Schritt 3): eine Mail geht durch den Pseudonymizer, bevor sie geschrieben wird.
//
// Rein: der Port `(req) => Promise<PortOutcome>` kommt hinein, die obsidian-Schicht bindet ihn an `pseudonymizeFor(app, mode, req)`
// (Kit, `kit-obsidian/pseudonymizer-call`). Dort steht auch, was der Schalter Aus / Wenn verfuegbar / Verlangt bei fehlendem
// Plugin tut; diese Funktion entscheidet das NICHT noch einmal, sie ruft den Port nur nicht, wenn der Schalter Aus ist.
//
// Zusagen (Gegenlese E17/E18, Abstimmung mit pseudonymizer-46):
// - `originalFactsOf` laeuft VOR dem Port: nach dem Transformer stehen in `from` und `subject` Platzhalter, aus denen sich weder
//   Richtung noch Vorgangs-Token ableiten lassen. Die Fakten sind immer die der Original-Mail.
// - Genau ein Markdown-Body (`bodyMarkdown`); die neue Mail traegt ihn als `text`, `html` ist null.
// - Gesperrt: `id`, `messageIdRaw`, `inReplyTo`, `references`, `attachments[].key` samt Reihenfolge. Aendert der Wiederaufbau eines
//   davon, ist das Ergebnis `error/locked-fields`, nie eine Mail (Riegel, `lockedFieldsChanged`).
// - Alles oder nichts: fehlt im Ergebnis ein gesendeter Teil, ist es `error/incomplete`.
// - Der Ausgang ist ein Wert; die Funktion wirft nie.
import type { ParsedMail, MailAddress } from "../mime/types";
import type { MailProfile } from "../mirror/profile";
import { bodyMarkdown } from "../render/body";
import type { TransformEntity, TransformPart, TransformRequest, TransformResult } from "../../vendor/kit/pseudonymizer-source";
import { errorMessage } from "../../vendor/kit/error-message";
import { lockedFieldsChanged } from "./locked-fields";
import { originalFactsOf, type OriginalFacts } from "./original-facts";

/** Der Ausgang des Ports. Dieselbe Form wie `PseudonymizeOutcome` im Kit (`kit-obsidian/pseudonymizer-call`); `src/core` importiert aus der
 *  obsidian-Schicht nicht, `tests/core/transform/mode-type.test.ts` haelt beide gleich (jeder Kit-Ausgang passt hier hinein). */
export type PortOutcome =
  | { kind: "pseudonymized"; result: TransformResult }
  | { kind: "plain"; reason: string }
  | { kind: "wait"; reason: string; message: string }
  | { kind: "error"; reason: string; message: string };

export type TransformPort = (req: TransformRequest) => Promise<PortOutcome>;

export type TransformOutcome =
  /** Die Mail, die geplant und geschrieben wird (pseudonymisiert, oder bei `plain`/Aus die Original-Mail selbst), mit den Fakten des Originals. */
  | { kind: "mail"; mail: ParsedMail; facts: OriginalFacts }
  /** Nichts schreiben, die Mail bleibt auf dem Server und kommt beim naechsten Lauf wieder. */
  | { kind: "wait"; reason: string; message: string }
  /** Nichts schreiben, der Grund gehoert ins Protokoll bzw. in eine Meldung. */
  | { kind: "error"; reason: string; message: string };

export const TRANSFORM_CALLER = "mailstone";

type Rebuild = (mail: ParsedMail, result: TransformResult) => ParsedMail | null;

const ADDRESS_FIELDS = ["from", "to", "cc"] as const;

/** Die Adressen eines Feldes mit ihrem Kennzeichen: `from` ist ein Eintrag oder keiner, `to`/`cc` eine Liste. */
function addressesOf(mail: ParsedMail, field: (typeof ADDRESS_FIELDS)[number]): { label: string; a: MailAddress }[] {
  if (field === "from") return mail.from ? [{ label: "from", a: mail.from }] : [];
  return mail[field].map((a, i) => ({ label: `${field}.${String(i)}`, a }));
}

/** Die Teile, die hinausgehen: Body, Betreff, Namen und Adressen aus dem Kopf, Anhangsnamen (nie der Schluessel). Leere Werte gehen nicht mit. */
export function partsOf(mail: ParsedMail): TransformPart[] {
  const parts: TransformPart[] = [{ id: "body", kind: "text", value: bodyMarkdown(mail) }];
  if (mail.subject !== "") parts.push({ id: "subject", kind: "line", value: mail.subject });
  for (const f of ADDRESS_FIELDS) {
    for (const { label, a } of addressesOf(mail, f)) {
      if (a.name !== "") parts.push({ id: `${label}.name`, kind: "line", value: a.name });
      if (a.address !== "") parts.push({ id: `${label}.address`, kind: "line", value: a.address });
    }
  }
  mail.attachments.forEach((att, i) => { if (att.name !== "") parts.push({ id: `attachment.${String(i)}.name`, kind: "filename", value: att.name }); });
  return parts;
}

/** Die bekannten Namens-/Adress-Paare aus dem Mail-Kopf, damit das Plugin sie nicht erst im Text suchen muss. */
function entitiesOf(mail: ParsedMail): TransformEntity[] {
  const out: TransformEntity[] = [];
  for (const f of ADDRESS_FIELDS) {
    for (const { a } of addressesOf(mail, f)) {
      const e: TransformEntity = {};
      if (a.name !== "") e.name = a.name;
      if (a.address !== "") e.email = a.address;
      if (e.name !== undefined || e.email !== undefined) out.push(e);
    }
  }
  return out;
}

/** Werte, die nie ersetzt werden: die eigenen Adressen (alle Identitaeten) und die Betreff-Kennung des Vorgangs. */
function keepOf(profile: MailProfile, facts: OriginalFacts): string[] {
  const keep: string[] = [];
  for (const v of [...(profile.ownAddresses ?? []), ...(facts.threadToken !== null ? [facts.threadToken] : [])]) if (v !== "" && !keep.includes(v)) keep.push(v);
  return keep;
}

/** Baut aus der Original-Mail und dem Ergebnis die neue Mail: `text` = transformierter Body, `html` null, alle uebrigen Teile ersetzt,
 *  die Adressen so, wie der Pseudonymizer sie liefert (Name + Platzhalter-Adresse, keine `@`-Pruefung). `null`, wenn ein gesendeter Teil fehlt. */
export function rebuildMail(mail: ParsedMail, result: TransformResult): ParsedMail | null {
  const values = new Map(result.parts.map((p) => [p.id, p.value]));
  for (const p of partsOf(mail)) if (typeof values.get(p.id) !== "string") return null;
  const v = (id: string, fallback: string): string => values.get(id) ?? fallback;
  const addr = (label: string, a: MailAddress): MailAddress => ({ name: v(`${label}.name`, a.name), address: v(`${label}.address`, a.address) });
  return {
    ...mail,
    text: v("body", ""),
    html: null,
    subject: v("subject", mail.subject),
    from: mail.from ? addr("from", mail.from) : null,
    to: mail.to.map((a, i) => addr(`to.${String(i)}`, a)),
    cc: mail.cc.map((a, i) => addr(`cc.${String(i)}`, a)),
    attachments: mail.attachments.map((att, i) => ({ ...att, name: v(`attachment.${String(i)}.name`, att.name) })),
  };
}

/** Wie `transformMail`, mit austauschbarem Wiederaufbau: so erreicht ein Test den Riegel, den der echte Wiederaufbau nie ausloest. */
export async function transformWith(
  mail: ParsedMail, profile: MailProfile, port: TransformPort, opts: { interactive: boolean }, rebuild: Rebuild,
): Promise<TransformOutcome> {
  // VOR dem Port: danach stehen in from/subject Platzhalter (E18).
  const facts = originalFactsOf(mail, profile);
  const plain: TransformOutcome = { kind: "mail", mail, facts };
  if (profile.pseudonymize === "off") return plain;

  const req: TransformRequest = {
    caller: TRANSFORM_CALLER, documentKey: mail.id, interactive: opts.interactive,
    ...(mail.subject !== "" ? { title: mail.subject } : {}),
    parts: partsOf(mail), entities: entitiesOf(mail), keep: keepOf(profile, facts),
  };
  let out: PortOutcome;
  try {
    out = await port(req);
  } catch (e) {
    return { kind: "error", reason: "threw", message: errorMessage(e) };
  }
  switch (out.kind) {
    case "plain": return plain;
    case "wait": return { kind: "wait", reason: out.reason, message: out.message };
    case "error": return { kind: "error", reason: out.reason, message: out.message };
    case "pseudonymized": break;
    default: return { kind: "error", reason: "unknown-outcome", message: "Unbekannte Antwort des Pseudonymisierers." };
  }
  const transformed = rebuild(mail, out.result);
  if (transformed === null) return { kind: "error", reason: "incomplete", message: "Das Ergebnis des Pseudonymisierers enthält nicht jeden gesendeten Teil." };
  const locked = lockedFieldsChanged(mail, transformed);
  if (locked.length > 0) return { kind: "error", reason: "locked-fields", message: `Der Pseudonymisierer hat gesperrte Felder verändert: ${locked.join(", ")}.` };
  return { kind: "mail", mail: transformed, facts };
}

/** Schickt `mail` durch den Pseudonymizer (siehe Kopf). Bei `profile.pseudonymize === "off"` wird der Port nicht gerufen. */
export function transformMail(mail: ParsedMail, profile: MailProfile, port: TransformPort, opts: { interactive: boolean }): Promise<TransformOutcome> {
  return transformWith(mail, profile, port, opts, rebuildMail);
}
