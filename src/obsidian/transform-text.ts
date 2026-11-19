import { getLang, t } from "../vendor/code-kit/i18n";
import { resolvePseudonymizerCallStrings } from "../vendor/kit-obsidian/pseudonymizer-call-strings";
import type { NoMailOutcome } from "../core/transform/transform-mail";
import type { RestoreFailure } from "../core/transform/restore";

/** Die Gruende, deren Text das Kit sagt: das Plugin pseudonymizer fehlt, ist nicht eingerichtet oder gesperrt (`pseudonymizer-call-strings`, EN/DE).
 *  Mailstone fuehrt dafuer keine eigene Tabelle; die Sprache reicht `main.ts` an `pseudonymizeFor`/`restoreFor` hinein. */
const KIT_REASONS = ["absent", "not-set-up", "locked"] as const;
type KitReason = (typeof KIT_REASONS)[number];
const isKitReason = (r: string): r is KitReason => (KIT_REASONS as readonly string[]).includes(r);

/** Der Text eines Kit-Grundes in der Oberflaechensprache (fuer die Rueckwandlung, deren Kit-`message` die Anzahl schon traegt). */
const kitReasonText = (r: KitReason): string => resolvePseudonymizerCallStrings({ lang: getLang() }).unavailable[r];

/** Der Text zum Grund eines Ausgangs ohne Mail (`wait`/`error` von `transformMail`): bei den Kit-Gruenden die `message` des Kits, sonst, wenn der Grund
 *  Mailstones eigenen Kontext sagt, der Text aus `strings.ts` (`pseudonymize.reason.*`), sonst die Meldung des Plugins selbst. */
export function noMailText(out: NoMailOutcome): string {
  if (isKitReason(out.reason)) return out.message;
  const key = `pseudonymize.reason.${out.reason}`;
  const text = t(key);
  return text === key ? out.message : text;
}

/** Der Text zu einer gescheiterten Rueckwandlung (A5, Schritt 5), in der Oberflaechensprache: Art und Anzahl, nie ein Klartext und nie ein Platzhalter.
 *  Bei `held` kommt der Grund dazu, wenn er bekannt ist (Kit-Grund aus dem Kit, sonst `pseudonymize.reason.*`), sonst nur die Anzahl. */
export function restoreFailureText(f: RestoreFailure): string {
  switch (f.kind) {
    case "held": {
      const key = `pseudonymize.reason.${f.reason}`;
      const own = t(key);
      const why = isKitReason(f.reason) ? kitReasonText(f.reason) : own === key ? "" : own;
      return f.count > 0 ? t("restore.held", String(f.count), why) : t("restore.heldNoCount", why || f.message);
    }
    case "forgotten-address": return t("restore.forgottenAddress", String(f.count));
    case "address-unresolved": return t("restore.addressUnresolved", String(f.count));
    case "unrestorable-part": return t("restore.unrestorablePart", String(f.count));
  }
}
