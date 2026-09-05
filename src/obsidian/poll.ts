import type { TimeoutTimers } from "../vendor/code-kit/timeout";

/** Erfuellt `CreateTaskFlowDeps.pollUntil` (create-task-flow.ts) — im Kern injiziert, hier
 *  gebaut, weil `src/core/**` kein `window.setTimeout` kennen darf (`check:pure`). Prueft
 *  `pruefen` sofort und danach im festen Takt, bis sie zutrifft oder die Frist reisst. */
export function pollUntil(
  timers: TimeoutTimers,
  intervalMs = 1000,
): (pruefen: () => boolean, fristMs: number) => Promise<boolean> {
  return (pruefen, fristMs) =>
    new Promise((resolve) => {
      const start = Date.now();
      const tick = (): void => {
        if (pruefen()) { resolve(true); return; }
        if (Date.now() - start >= fristMs) { resolve(false); return; }
        timers.setTimeout(tick, intervalMs);
      };
      tick();
    });
}
