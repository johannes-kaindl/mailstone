// Werte, die aus der ORIGINAL-Mail bestimmt werden, bevor ein Transformer sie veraendert (A5, Schritt 1, E18).
//
// Vorstufe fuer A5 (Anonymizer), verdrahtet mit dem Pseudonymizer-Aufruf: nach einer Pseudonymisierung stehen in `from`
// und `subject` Platzhalter, aus denen sich weder die Richtung noch die Kennung eines Vorgangs ableiten laesst. Die
// Planung bekommt diese Werte deshalb je Mail vorberechnet (`facts`) und bevorzugt sie. Es gibt keine zweite
// Implementierung der Regeln: `directionOf` und `tokenOf` sind dieselben Funktionen, die die Planung sonst selbst ruft.
import type { ParsedMail } from "../mime/types";
import type { MailProfile } from "../mirror/profile";
import { directionOf } from "../render/frontmatter";
import { tokenOf, tokenRegexOf } from "../thread/token";

export interface OriginalFacts {
  /** `richtung` der Notiz: der Absender der Original-Mail gegen die eigenen Adressen. */
  direction: "eingehend" | "ausgehend";
  /** Die Betreff-Kennung der Original-Mail nach der eingestellten Regel, `null` ohne Regel oder Treffer. */
  threadToken: string | null;
}

export function originalFactsOf(mail: Pick<ParsedMail, "from" | "subject">, profile: MailProfile): OriginalFacts {
  return {
    direction: directionOf(mail.from, profile.ownAddresses),
    threadToken: tokenOf(mail, tokenRegexOf(profile)),
  };
}
