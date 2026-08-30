import type { TimeoutTimers } from "../../src/vendor/code-kit/timeout";

/** `withTimeout` bekommt seine Timer injiziert (der Kit-Code darf `window` nicht kennen).
 *  Im Test reichen die echten Node-Timer: die Dialoge des Fake-Transports laufen synchron
 *  durch, ein Timeout tritt nie ein — der Port muss nur vorhanden sein. */
export const testTimers: TimeoutTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => {
    globalThis.clearTimeout(id);
  },
};
