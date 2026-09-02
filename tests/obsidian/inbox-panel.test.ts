import { describe, it, expect, vi } from "vitest";
import { makeFakeEl } from "../vendor/kit/obsidian-mock";
import { InboxPanel, type InboxHost } from "../../src/obsidian/views/inbox-panel";
import type { InboxViewModel } from "../../src/core/view/inbox-vm";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

/** Alle Nachfahren mit dieser Klasse — der Fake-El haelt Kinder in `children`.
 *  Uebernommen aus tests/obsidian/cockpit-panel.test.ts. */
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

const zeile = { uid: 7, from: "Jürgen", subject: "Rechnung", date: "2026-09-02T07:15:00.000Z", imVault: false, ungelesen: true };

function host(vm: Partial<InboxViewModel> = {}, over: Partial<InboxHost> = {}): InboxHost {
  return {
    accounts: () => [],
    selectedAccountId: () => "a1",
    selectAccount: vi.fn(),
    viewModel: () => ({ state: "gefuellt", rows: [zeile], fehlerCode: null, aktionenAktiv: true, ...vm }),
    refresh: vi.fn(),
    adopt: vi.fn(),
    archive: vi.fn(),
    openSettings: vi.fn(),
    onChange: () => () => undefined,
    ...over,
  };
}

describe("InboxPanel", () => {
  it("erfuellt den HubPanel-Vertrag", () => {
    const p = new InboxPanel(host());
    expect(p.id).toBe("inbox");
    expect(typeof p.label).toBe("string");
    expect(typeof p.icon).toBe("string");
  });

  it("zeichnet je Mail eine Zeile mit Absender und Betreff", () => {
    const el = makeFakeEl();
    new InboxPanel(host()).mount(el);
    expect(findAll(el, "mailstone-inbox-row")).toHaveLength(1);
    expect(String(el.textContent)).toContain("Jürgen");
    expect(String(el.textContent)).toContain("Rechnung");
  });

  it("zeigt den Empty-State samt Handlungsangebot, wenn nichts da ist", () => {
    const el = makeFakeEl();
    new InboxPanel(host({ state: "leer", rows: [] })).mount(el);
    expect(findAll(el, "mailstone-inbox-empty")).toHaveLength(1);
  });

  it("zeichnet keine Aktionsknoepfe, solange aktionenAktiv false ist", () => {
    const el = makeFakeEl();
    new InboxPanel(host({ aktionenAktiv: false })).mount(el);
    expect(findAll(el, "mailstone-inbox-action")).toHaveLength(0);
  });

  it("zeichnet zwei Aktionsknoepfe je Zeile, wenn sie aktiv sind", () => {
    const el = makeFakeEl();
    new InboxPanel(host()).mount(el);
    expect(findAll(el, "mailstone-inbox-action")).toHaveLength(2);
  });

  it("meldet einen Fehlerzustand mit Zustandsklasse UND aria-label — Farbe nie allein", () => {
    const el = makeFakeEl();
    new InboxPanel(host({ state: "fehler", rows: [], fehlerCode: "auth" })).mount(el);
    const ind = findAll(el, "mailstone-inbox-status")[0];
    expect(String(ind.className).split(" ")).toContain("is-error");
    expect(ind.getAttribute("aria-label")).toBeTruthy();
  });

  it("blendet die Kontowahl aus, solange es nur ein Konto gibt", () => {
    const eins = makeFakeEl();
    new InboxPanel(host()).mount(eins);
    expect(findAll(eins, "mailstone-inbox-account")).toHaveLength(0);
  });

  it("raeumt beim destroy auf", () => {
    const unsub = vi.fn();
    const p = new InboxPanel(host({}, { onChange: () => unsub }));
    p.mount(makeFakeEl());
    p.destroy();
    expect(unsub).toHaveBeenCalled();
  });
});
