import { describe, it, expect, vi } from "vitest";
import { makeFakeEl } from "../vendor/kit/obsidian-mock";
import { CockpitPanel, type CockpitHost } from "../../src/obsidian/views/cockpit-panel";
import { newAccount, type Account } from "../../src/core/settings";
import type { RunState } from "../../src/core/sync/run-state";
import type { SyncCounts } from "../../src/core/sync/events";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

const NIX: SyncCounts = { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 };

function acc(id: string, label = id): Account {
  const a = newAccount(id);
  a.label = label;
  a.sync = { enabled: true, intervalMin: 5 };
  return a;
}

function fakeHost(o: Partial<CockpitHost> & { accounts?: () => Account[]; runState?: () => RunState } = {}): CockpitHost {
  return {
    accounts: o.accounts ?? (() => []),
    runState: o.runState ?? (() => ({})),
    nextDueAt: o.nextDueAt ?? (() => null),
    isBusy: o.isBusy ?? (() => false),
    syncNow: o.syncNow ?? (() => undefined),
    openSettings: o.openSettings ?? (() => undefined),
    onChange: o.onChange ?? (() => () => undefined),
  };
}

/** Alle Nachfahren mit dieser Klasse — der Fake-El haelt Kinder in `children`. */
function findAll(el: any, cls: string): any[] {
  const out: any[] = [];
  const walk = (n: any): void => {
    for (const c of n.children ?? []) {
      if (String(c.className ?? "").split(" ").includes(cls)) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

describe("CockpitPanel — Status-Indikator (UI-STANDARD §8)", () => {
  it("traegt die Zustandsklasse is-ok UND ein aria-label — Farbe nie allein", () => {
    const rs: RunState = { a: { at: 100, ok: true, counts: NIX } };
    const el = makeFakeEl();
    const p = new CockpitPanel(fakeHost({ accounts: () => [acc("a")], runState: () => rs }));
    p.mount(el);
    const ind = findAll(el, "mailstone-cockpit-status")[0];
    expect(String(ind.className).split(" ")).toContain("is-ok");
    expect(ind.getAttribute("aria-label")).toBeTruthy();
  });

  it("nutzt is-warning fuer einen Lauf, der durchlief und etwas auslies", () => {
    const rs: RunState = { a: { at: 100, ok: true, counts: { ...NIX, detachSkipped: 1 } } };
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a")], runState: () => rs })).mount(el);
    expect(String(findAll(el, "mailstone-cockpit-status")[0].className).split(" ")).toContain("is-warning");
  });

  it("nutzt is-error und zeigt den Fehler im Klartext", () => {
    const rs: RunState = { a: { at: 100, ok: false, code: "auth", counts: NIX } };
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a")], runState: () => rs })).mount(el);
    expect(String(findAll(el, "mailstone-cockpit-status")[0].className).split(" ")).toContain("is-error");
    const zeile = findAll(el, "mailstone-cockpit-row")[0];
    expect(JSON.stringify(zeile)).toContain("Anmeldung");
  });

  it("zeigt fuer ein nie gelaufenes Konto KEINEN Indikator", () => {
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a")] })).mount(el);
    expect(findAll(el, "mailstone-cockpit-status")).toHaveLength(0);
  });
});

describe("CockpitPanel — Empty-State (UI-STANDARD §8)", () => {
  it("zeigt ohne Konto den Empty-State mit genau einem mod-cta", () => {
    const el = makeFakeEl();
    new CockpitPanel(fakeHost()).mount(el);
    expect(findAll(el, "mailstone-cockpit-empty")).toHaveLength(1);
    expect(findAll(el, "mod-cta")).toHaveLength(1);
  });

  it("der CTA fuehrt in die Einstellungen", () => {
    const openSettings = vi.fn();
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ openSettings })).mount(el);
    findAll(el, "mod-cta")[0].dispatchEvent({ type: "click" });
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("sperrt den Alle-Knopf ohne Konto — er koennte nichts tun", () => {
    const el = makeFakeEl();
    new CockpitPanel(fakeHost()).mount(el);
    expect(findAll(el, "mailstone-cockpit-sync-all")[0].disabled).toBe(true);
  });
});

describe("CockpitPanel — Bedienung", () => {
  it("loest den Sync fuer genau das geklickte Konto aus", () => {
    const syncNow = vi.fn();
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a"), acc("b")], syncNow })).mount(el);
    findAll(el, "mailstone-cockpit-sync")[1].dispatchEvent({ type: "click" });
    expect(syncNow).toHaveBeenCalledWith("b");
  });

  it("der Kopfknopf synchronisiert alle — ohne Konto-Argument", () => {
    const syncNow = vi.fn();
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a")], syncNow })).mount(el);
    findAll(el, "mailstone-cockpit-sync-all")[0].dispatchEvent({ type: "click" });
    expect(syncNow).toHaveBeenCalledWith(undefined);
  });

  it("sperrt beide Knoepfe, solange ein Lauf haengt — sonst rennt der Nutzer in den busy-Guard", () => {
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a")], isBusy: () => true })).mount(el);
    expect(findAll(el, "mailstone-cockpit-sync")[0].disabled).toBe(true);
    expect(findAll(el, "mailstone-cockpit-sync-all")[0].disabled).toBe(true);
  });

  it("GEGENPROBE: bei freiem Guard ist derselbe Knopf bedienbar und loest aus", () => {
    // Ohne diese Haelfte belegt der Test darueber nicht, dass die Sperre je etwas bewegt —
    // ein immer deaktivierter Knopf bestuende ihn genauso (LESSONS 2026-09-01, koda-agent).
    const syncNow = vi.fn();
    const el = makeFakeEl();
    new CockpitPanel(fakeHost({ accounts: () => [acc("a")], isBusy: () => false, syncNow })).mount(el);
    const knopf = findAll(el, "mailstone-cockpit-sync")[0];
    expect(knopf.disabled).toBeFalsy();
    knopf.dispatchEvent({ type: "click" });
    expect(syncNow).toHaveBeenCalledWith("a");
  });
});

describe("CockpitPanel — Lebenszyklus", () => {
  it("zeichnet bei einer Aenderung neu, statt am alten Stand zu kleben", () => {
    // Zustand in einem Objekt statt einer `let`-Variablen: TypeScript verengt eine `let`-Variable
    // an der Aufrufstelle `cb?.()` auf den Stand VOR der Zuweisung im Callback (hier `null`) und
    // macht daraus `never` — obwohl die Zuweisung zur Laufzeit laengst passiert ist. Ein Feld auf
    // einem Objekt entgeht diesem Narrowing, die Testaussage bleibt unveraendert.
    const state: { cb: (() => void) | null } = { cb: null };
    let rs: RunState = {};
    const el = makeFakeEl();
    const p = new CockpitPanel(fakeHost({
      accounts: () => [acc("a")],
      runState: () => rs,
      onChange: (fn) => { state.cb = fn; return () => { state.cb = null; }; },
    }));
    p.mount(el);
    expect(findAll(el, "mailstone-cockpit-status")).toHaveLength(0);
    rs = { a: { at: 100, ok: true, counts: NIX } };
    state.cb?.();
    expect(findAll(el, "mailstone-cockpit-status")).toHaveLength(1);
  });

  it("meldet sich bei destroy() ab", () => {
    const unsub = vi.fn();
    const p = new CockpitPanel(fakeHost({ onChange: () => unsub }));
    p.mount(makeFakeEl());
    p.destroy();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
