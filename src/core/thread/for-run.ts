// Die Anlage-Werte der neuen Notizen eines Laufs (Sync und Import), die am Vault-Stand haengen: der Vorgangswert (A3)
// und die geerbten Felder (A2). Schlaegt die Bruecke von den geparsten Mails und den vorab vergebenen Pfaden
// (`assignRunPaths`) zu `threadValuesForNew` und `inheritedForNew`.
import type { ParsedMail } from "../mime/types";
import type { FmVal, MailProfile } from "../mirror/profile";
import { localDate, localTime } from "../../vendor/code-kit/local-stamp";
import type { OriginalFacts } from "../transform/original-facts";
import { threadValuesForNew, type KnownThreadNote } from "./create-links";
import { effectiveInheritFields, effectiveThreadField } from "./field";
import { inheritedForNew } from "./inherit";
import { tokenRegexOf } from "./token";

/** Mail-ID -> Anlage-Werte (`{ ...geerbt, [threadField]: "[[Wurzel]]" }`). Leer, wenn weder der Vorgang noch das Erben gilt
 *  oder der Lauf keine neue Mail hat; der Index (`known`) wird dann gar nicht erst gebaut. */
export function threadExtrasForRun(
  profile: MailProfile,
  fresh: readonly ParsedMail[],
  targets: ReadonlyMap<string, string>,
  known: (() => readonly KnownThreadNote[]) | undefined,
  /** Mail-ID -> Werte aus dem Original (A5): die Kennung geht dem Betreff vor. */
  facts?: ReadonlyMap<string, OriginalFacts>,
): Map<string, Record<string, FmVal>> {
  const field = effectiveThreadField(profile);
  const keys = effectiveInheritFields(profile);
  const out = new Map<string, Record<string, FmVal>>();
  if ((field === "" && keys.length === 0) || fresh.length === 0) return out;
  // Dieselben Mails fuer beide Regeln: die Vorgaengerin (Header, dann Kennung) ist fuer Vorgang und Erben dieselbe,
  // auch die Kennung aus dem Original (`facts`) gilt fuer beide.
  const news = fresh.flatMap((mail) => {
    const path = targets.get(mail.id);
    if (path === undefined) return [];
    return [{
      mailId: mail.id, path, inReplyTo: mail.inReplyTo, references: mail.references, subject: mail.subject,
      ...(facts?.has(mail.id) ? { threadToken: facts.get(mail.id)!.threadToken } : {}),
      date: mail.date ? localDate(mail.date) : "", time: mail.date ? localTime(mail.date) : "",
    }];
  });
  const notes = known?.() ?? [];
  const token = tokenRegexOf(profile);
  const inherited = inheritedForNew(news, notes, keys, token);
  const values = field === "" ? new Map<string, string>() : threadValuesForNew(news, notes, token);
  for (const id of new Set([...inherited.keys(), ...values.keys()])) {
    const v = values.get(id);
    // Reihenfolge wie beim Anlegen: geerbt, dann Vorgang; verwaltete Felder gewinnen in `newNote` ohnehin.
    out.set(id, { ...inherited.get(id), ...(v === undefined ? {} : { [field]: v }) });
  }
  return out;
}
