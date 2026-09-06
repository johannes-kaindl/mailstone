import { describe, it, expect, vi } from "vitest";
import { consentTimeout } from "../../src/obsidian/send-consent-modal";

describe("consentTimeout", () => {
  it("loest nach der Frist mit timeout auf", async () => {
    vi.useFakeTimers();
    const p = consentTimeout(60_000, window);
    vi.advanceTimersByTime(60_000);
    await expect(p).resolves.toEqual({ kind: "timeout" });
    vi.useRealTimers();
  });

  it("loest nicht vor der Frist auf", async () => {
    vi.useFakeTimers();
    let fertig = false;
    void consentTimeout(60_000, window).then(() => { fertig = true; });
    vi.advanceTimersByTime(59_000);
    await Promise.resolve();
    expect(fertig).toBe(false);
    vi.useRealTimers();
  });

  it("raeumt seinen Timer auf, wenn abgebrochen wird", () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(window, "clearTimeout");
    const p = consentTimeout(60_000, window);
    p.cancel();
    expect(clear).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
