// Der Vorgangswert der neuen Notizen eines Laufs (Sync und Import): schlaegt die Bruecke von den
// geparsten Mails und den vorab vergebenen Pfaden (`assignRunPaths`) zu `threadValuesForNew`.
import type { ParsedMail } from "../mime/types";
import type { FmVal, MailProfile } from "../mirror/profile";
import { localDate, localTime } from "../../vendor/code-kit/local-stamp";
import { threadValuesForNew, type KnownThreadNote } from "./create-links";
import { effectiveThreadField } from "./field";
import { tokenRegexOf } from "./token";

/** Mail-ID -> Anlage-Werte (`{ [threadField]: "[[Wurzel]]" }`). Leer, wenn der Vorgang aus ist oder der Lauf
 *  keine neue Mail hat; der Index (`known`) wird dann gar nicht erst gebaut. */
export function threadExtrasForRun(
  profile: MailProfile,
  fresh: readonly ParsedMail[],
  targets: ReadonlyMap<string, string>,
  known: (() => readonly KnownThreadNote[]) | undefined,
): Map<string, Record<string, FmVal>> {
  const field = effectiveThreadField(profile);
  const out = new Map<string, Record<string, FmVal>>();
  if (field === "" || fresh.length === 0) return out;
  const values = threadValuesForNew(
    fresh.flatMap((mail) => {
      const path = targets.get(mail.id);
      if (path === undefined) return [];
      return [{
        mailId: mail.id, path, inReplyTo: mail.inReplyTo, references: mail.references, subject: mail.subject,
        date: mail.date ? localDate(mail.date) : "", time: mail.date ? localTime(mail.date) : "",
      }];
    }),
    known?.() ?? [],
    tokenRegexOf(profile),
  );
  for (const [id, v] of values) out.set(id, { [field]: v });
  return out;
}
