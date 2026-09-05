import { describe, it, expect, vi } from "vitest";
import { makeFakeEl } from "../vendor/kit/obsidian-mock";
import { InboxPanel, type InboxHost } from "../../src/obsidian/views/inbox-panel";
import type { InboxViewModel } from "../../src/core/view/inbox-vm";
import { initI18n } from "../../src/i18n/strings";
import { t } from "../../src/vendor/code-kit/i18n";

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

const zeile = { uid: 7, mailId: "7@example.invalid", from: "Jürgen", subject: "Rechnung", date: "2026-09-02T07:15:00.000Z", imVault: false, ungelesen: true };

function host(vm: Partial<InboxViewModel> = {}, over: Partial<InboxHost> = {}): InboxHost {
  return {
    accounts: () => [],
    selectedAccountId: () => "a1",
    selectAccount: vi.fn(),
    viewModel: () => ({ state: "gefuellt", rows: [zeile], fehlerCode: null, aktionenGrund: null, ...vm }),
    refresh: vi.fn(),
    ensureLoaded: vi.fn(),
    adopt: vi.fn(),
    archive: vi.fn(),
    canCreateTask: () => false,
    createTask: vi.fn(),
    openSettings: vi.fn(),
    onChange: () => () => undefined,
    destroy: vi.fn(),
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

  it("zeichnet die Aktionsknoepfe deaktiviert MIT Grund als Tooltip, statt sie wegzulassen (I6) — ohne TaskNotes", () => {
    const el = makeFakeEl();
    new InboxPanel(host({ aktionenGrund: "unsupported" })).mount(el);
    const knoepfe = findAll(el, "mailstone-inbox-action");
    expect(knoepfe).toHaveLength(2);
    for (const k of knoepfe) {
      expect(k.disabled).toBe(true);
      expect(k.getAttribute("aria-disabled")).toBe("true");
      expect(k.getAttribute("title")).toBeTruthy();
    }
  });

  it("zeichnet zwei Aktionsknoepfe je Zeile, wenn sie aktiv sind — ohne TaskNotes", () => {
    const el = makeFakeEl();
    new InboxPanel(host()).mount(el);
    expect(findAll(el, "mailstone-inbox-action")).toHaveLength(2);
  });

  // Fix-Runde 1, Minor 6: die vorigen beiden Tests belegten nur den TaskNotes-losen Fall
  // (`canCreateTask: () => false` ist der Default), obwohl Spec § 4 ausdruecklich "kein
  // Ausgrauen, der Knopf fehlt ganz" verlangt — bisher nur in dieser einen Richtung geprueft.
  it("zeichnet eine dritte Aktion, wenn TaskNotes erreichbar ist", () => {
    const el = makeFakeEl();
    new InboxPanel(host({}, { canCreateTask: () => true })).mount(el);
    const knoepfe = findAll(el, "mailstone-inbox-action");
    expect(knoepfe).toHaveLength(3);
    expect(String(el.textContent)).toContain(t("inbox.createTask"));
  });

  it("deaktiviert auch die dritte Aktion mit Grund, wenn die anderen gesperrt sind", () => {
    const el = makeFakeEl();
    new InboxPanel(host({ aktionenGrund: "busy" }, { canCreateTask: () => true })).mount(el);
    const knoepfe = findAll(el, "mailstone-inbox-action");
    expect(knoepfe).toHaveLength(3);
    for (const k of knoepfe) {
      expect(k.disabled).toBe(true);
      expect(k.getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("ruft host.createTask(uid) beim Klick auf die dritte Aktion", () => {
    const createTask = vi.fn();
    const el = makeFakeEl();
    new InboxPanel(host({}, { canCreateTask: () => true, createTask })).mount(el);
    const dritte = findAll(el, "mailstone-inbox-action")[2];
    dritte.click();
    expect(createTask).toHaveBeenCalledWith(zeile.uid);
  });

  it("meldet einen Fehlerzustand mit Zustandsklasse UND aria-label — Farbe nie allein", () => {
    const el = makeFakeEl();
    new InboxPanel(host({ state: "fehler", rows: [], fehlerCode: "auth" })).mount(el);
    const ind = findAll(el, "mailstone-inbox-status")[0];
    expect(String(ind.className).split(" ")).toContain("is-error");
    const label = ind.getAttribute("aria-label");
    expect(label).toBeTruthy();
    // Nicht nur "irgendein Label" — es muss den Fehlerzustand beschreiben, nicht bloss den
    // Panel-Titel wiederholen (den ein Screenreader sonst faelschlich auf das Fehlersymbol liest).
    expect(label).not.toBe(t("inbox.title"));
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
