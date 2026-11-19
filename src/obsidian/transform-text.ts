import { t } from "../vendor/code-kit/i18n";
import type { NoMailOutcome } from "../core/transform/transform-mail";
import type { RestoreFailure } from "../core/transform/restore";

/** Der Text zum Grund eines Ausgangs ohne Mail (`wait`/`error` von `transformMail`): in der Oberflaechensprache, wenn der Grund bekannt ist
 *  (`pseudonymize.reason.*` in `strings.ts`), sonst die Meldung des Plugins selbst. */
export function noMailText(out: NoMailOutcome): string {
  const key = `pseudonymize.reason.${out.reason}`;
  const text = t(key);
  return text === key ? out.message : text;
}

/** Der Text zu einer gescheiterten Rueckwandlung (A5, Schritt 5), in der Oberflaechensprache: Art und Anzahl, nie ein Klartext und nie ein Platzhalter.
 *  Bei `held` kommt der Grund dazu, wenn er bekannt ist (`pseudonymize.reason.*`), sonst nur die Anzahl. */
export function restoreFailureText(f: RestoreFailure): string {
  switch (f.kind) {
    case "held": {
      const key = `pseudonymize.reason.${f.reason}`;
      const reason = t(key);
      const why = reason === key ? "" : reason;
      return f.count > 0 ? t("restore.held", String(f.count), why) : t("restore.heldNoCount", why || f.message);
    }
    case "forgotten-address": return t("restore.forgottenAddress", String(f.count));
    case "address-unresolved": return t("restore.addressUnresolved", String(f.count));
  }
}
