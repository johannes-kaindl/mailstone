import { t } from "../vendor/code-kit/i18n";
import type { NoMailOutcome } from "../core/transform/transform-mail";

/** Der Text zum Grund eines Ausgangs ohne Mail (`wait`/`error` von `transformMail`): in der Oberflaechensprache, wenn der Grund bekannt ist
 *  (`pseudonymize.reason.*` in `strings.ts`), sonst die Meldung des Plugins selbst. */
export function noMailText(out: NoMailOutcome): string {
  const key = `pseudonymize.reason.${out.reason}`;
  const text = t(key);
  return text === key ? out.message : text;
}
