import { describe, it, expect, vi } from "vitest";
import { createCockpitHost } from "../../src/obsidian/views/cockpit-host";
import { newAccount, type Account } from "../../src/core/settings";
import type { RunState } from "../../src/core/sync/run-state";
import type { SyncCounts } from "../../src/core/sync/events";

const MIN = 60_000;
const NIX: SyncCounts = { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 };

function acc(id: string, intervalMin = 5, enabled = true): Account {
  const a = newAccount(id);
  a.sync = { enabled, intervalMin };
  return a;
}

function host(over: Partial<Parameters<typeof createCockpitHost>[0]> = {}) {
  return createCockpitHost({
    accounts: () => [],
    runState: () => ({}),
    lastRun: () => ({}),
    isBusy: () => false,
    syncNow: () => undefined,
    openSettings: () => undefined,
    onChange: () => () => undefined,
    ...over,
  });
}

describe("createCockpitHost — nextDueAt", () => {
  it("loest die Konto-Id ueber die Kontoliste auf und rechnet das Intervall darauf", () => {
    const h = host({ accounts: () => [acc("a", 5)], lastRun: () => ({ a: 10 * MIN }) });
    expect(h.nextDueAt("a")).toBe(15 * MIN);
  });

  it("liefert null fuer eine Id, die es nicht (mehr) gibt — statt zu werfen", () => {
    // Ein geloeschtes Konto kann noch im Register stehen; die View fragt dann nach einer Id,
    // zu der kein Account mehr existiert.
    const h = host({ accounts: () => [acc("a")], lastRun: () => ({ weg: 10 * MIN }) });
    expect(h.nextDueAt("weg")).toBeNull();
  });

  it("liefert null fuer ein abgeschaltetes Konto", () => {
    const h = host({ accounts: () => [acc("a", 5, false)], lastRun: () => ({ a: 10 * MIN }) });
    expect(h.nextDueAt("a")).toBeNull();
  });

  it("liefert null, solange kein Lauf des Kontos bekannt ist", () => {
    const h = host({ accounts: () => [acc("a")], lastRun: () => ({}) });
    expect(h.nextDueAt("a")).toBeNull();
  });

  it("liest lastRun bei JEDEM Aufruf frisch — der Wecker schreibt waehrend die View offen ist", () => {
    let lastRun: Record<string, number> = {};
    const h = host({ accounts: () => [acc("a", 5)], lastRun: () => lastRun });
    expect(h.nextDueAt("a")).toBeNull();
    lastRun = { a: 10 * MIN };
    expect(h.nextDueAt("a")).toBe(15 * MIN);
  });
});

describe("createCockpitHost — Durchreichen", () => {
  it("reicht accounts, runState und isBusy als lebende Sicht durch, nicht als Kopie", () => {
    let busy = false;
    let rs: RunState = {};
    const h = host({ accounts: () => [acc("a")], runState: () => rs, isBusy: () => busy });
    expect(h.isBusy()).toBe(false);
    expect(h.runState()).toEqual({});
    busy = true;
    rs = { a: { at: 1, ok: true, counts: NIX } };
    expect(h.isBusy()).toBe(true);
    expect(h.runState()["a"]?.at).toBe(1);
    expect(h.accounts()).toHaveLength(1);
  });

  it("reicht syncNow mit und ohne Konto-Id weiter", () => {
    const syncNow = vi.fn();
    const h = host({ syncNow });
    h.syncNow("a");
    h.syncNow();
    expect(syncNow).toHaveBeenNthCalledWith(1, "a");
    expect(syncNow).toHaveBeenNthCalledWith(2, undefined);
  });

  it("reicht openSettings und onChange samt Abmeldung weiter", () => {
    const openSettings = vi.fn();
    const unsub = vi.fn();
    const onChange = vi.fn().mockReturnValue(unsub);
    const h = host({ openSettings, onChange });
    h.openSettings();
    const cb = (): void => undefined;
    expect(h.onChange(cb)).toBe(unsub);
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(cb);
  });
});
