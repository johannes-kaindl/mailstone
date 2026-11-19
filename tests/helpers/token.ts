import { defaultMailProfile } from "../../src/core/mirror/profile";
import { tokenRegexOf } from "../../src/core/thread/token";

/** Der Ausdruck, den die Einstellung `threadTokenPattern` mit diesem Wert ergibt (`null`: die Regel wirkt nicht). */
export const tokenRe = (pattern: string): RegExp | null => tokenRegexOf({ ...defaultMailProfile(), threadTokenPattern: pattern });

/** Die Vorgabe der Einstellung. */
export const DEFAULT_TOKEN = tokenRe("\\[Ticket#\\d+\\]");
