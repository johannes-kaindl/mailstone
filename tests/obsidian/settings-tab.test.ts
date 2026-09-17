import { describe, it, expect } from "vitest";
import { App, Plugin } from "obsidian";
import { Platform } from "../vendor/kit/obsidian-mock";
import { MailstoneSettingTab, type SettingsHost } from "../../src/obsidian/settings-tab";
import { loadSettings, newAccount, type Account, type MailstoneSettings } from "../../src/core/settings";
import type { SecretStore } from "../../src/vendor/kit/secrets";
import type { SocketTransport } from "../../src/core/net/types";
import type { RunState } from "../../src/core/sync/run-state";
import { initI18n } from "../../src/i18n/strings";
import { t } from "../../src/vendor/code-kit/i18n";

initI18n("de");

// `Plugin` ist in den echten Obsidian-Typings abstrakt — eine leere Unterklasse ist die
// einzige Form, die sowohl zur Laufzeit (Mock) als auch fuer `tsc -p tsconfig.test.json`
// (echte Typings) funktioniert (Muster aus calendar-notes/tests/obsidian/settings-tab.test.ts).
class TestPlugin extends Plugin {}

function fakeSecrets(overrides?: Partial<SecretStore>): SecretStore {
  const store = new Map<string, string>();
  return {
    get: (id) => store.get(id) ?? null,
    set: (id, v) => { store.set(id, v); },
    has: (id) => (store.get(id) ?? "") !== "",
    delete: (id) => { store.delete(id); },
    ...overrides,
  };
}

/** Baut den Tab mit einer Attrappe fuer `SettingsHost` (Muster: calendar-notes/tests/obsidian/
 *  settings-tab.test.ts `fakeHost`/`newTab`). Wir pruefen `getSettingDefinitions()` — die eine
 *  Wahrheit, aus der sowohl der native 1.13-Renderer als auch der `display()`-Fallback fuer
 *  aeltere Obsidian-Versionen ihren Baum ziehen — statt einen gerenderten DOM-Baum zu erwarten,
 *  den der Mock (anders als das echte Obsidian) fuer `Setting.setName`/`setDesc` gar nicht erst
 *  aufbaut. Das deckt sich mit Fix-Runde 1: der zuvor genutzte `settings_walker`-Fallback-Renderer
 *  ist fuer Obsidian <1.13 gedacht, das Manifest hier fuehrt aber 1.13.0 als Untergrenze und der
 *  Tab hat kein eigenes `display()` — der gerenderte Pfad waere also nie der reale gewesen.
 */
function newTab(opts: { accounts?: Account[]; secrets?: Partial<SecretStore>; runState?: RunState } = {}): MailstoneSettingTab {
  const settings: MailstoneSettings = { ...loadSettings(undefined), accounts: opts.accounts ?? [] };
  const host: SettingsHost = {
    settings,
    saveSettings: async () => {},
    secrets: fakeSecrets(opts.secrets),
    transport: () => ({}) as unknown as SocketTransport,
    runState: () => opts.runState ?? {},
  };
  const manifest = { id: "mailstone", name: "Mailstone", version: "0.1.0", minAppVersion: "1.13.0", description: "", author: "" };
  const app = new App();
  return new MailstoneSettingTab(app, new TestPlugin(app, manifest), host);
}

/** Die Konten-Liste, unabhaengig von ihrer Position in der Definitionsliste. */
function accountList(tab: MailstoneSettingTab): { items: { name: string; desc: string }[] } {
  const defs = tab.getSettingDefinitions() as { heading?: string; items: { name: string; desc: string }[] }[];
  const list = defs.find((d) => d.heading === "Konten");
  expect(list).toBeDefined();
  return list!;
}

describe("MailstoneSettingTab — Passwort-Hinweis und Debug-Schalter", () => {
  it("zeigt in der Kontenzeile an, wenn kein Passwort hinterlegt ist", () => {
    const tab = newTab({ accounts: [{ ...newAccount("acc"), label: "Privat" }], secrets: { has: () => false } });
    const item = accountList(tab).items[0];
    expect(item?.desc).toContain("Kein Passwort hinterlegt");
  });

  it("zeigt den Hinweis nicht, wenn ein Passwort hinterlegt ist", () => {
    const tab = newTab({ accounts: [{ ...newAccount("acc"), label: "Privat" }], secrets: { has: () => true } });
    const item = accountList(tab).items[0];
    expect(item?.desc).not.toContain("Kein Passwort hinterlegt");
  });

  it("bietet einen Schalter fuer das Debug-Protokoll", () => {
    const tab = newTab({ accounts: [] });
    const defs = tab.getSettingDefinitions() as { name?: string; control?: { key?: string } }[];
    const toggle = defs.find((d) => d.control?.key === "debugLog");
    expect(toggle).toBeDefined();
    expect(toggle?.name).toBe("Debug-Protokoll");
  });
});

// Fix-Runde 2, Minor: die Zeile zeigte die rohe transportId ("privat/mail") — zwei interne
// Ids, die dem Nutzer nicht sagen, WORUEBER das fremde Plugin senden darf.
describe("MailstoneSettingTab — Vertrauensliste", () => {
  function trustList(tab: MailstoneSettingTab) {
    const defs = tab.getSettingDefinitions() as
      { type?: string; heading?: string; addItem?: unknown; items?: { name: string; desc: string }[] }[];
    // Die Vertrauensliste ist die einzige Liste OHNE Heading und OHNE addItem-Knopf: neue
    // Eintraege entstehen nur ueber das Zustimmungs-Modal, nie von Hand (s. Kommentar im Tab).
    const list = defs.find((d) => d.type === "list" && d.heading === undefined && !("addItem" in d));
    expect(list).toBeDefined();
    return list!.items!;
  }

  function mitIdentitaet(): Account {
    return {
      ...newAccount("privat"),
      label: "Privat",
      identities: [{ id: "mail", address: "max@example.net", name: "Max" }],
      defaultIdentityId: "mail",
    };
  }

  it("loest die transportId zur Absenderadresse auf", () => {
    const tab = newTab({ accounts: [mitIdentitaet()] });
    tab["host"].settings.trustedSenders = [{ pluginId: "calendar-notes", transportId: "privat/mail" }];
    expect(trustList(tab)[0]?.desc).toBe("max@example.net");
  });

  it("zeigt bei einem verwaisten Eintrag weiter die rohe Id, statt die Zeile zu verstecken", () => {
    // Eine Freigabe, die man nicht zurueckziehen kann, ist keine — die Zeile muss bleiben,
    // auch wenn die Identitaet, fuer die sie galt, geloescht wurde.
    const tab = newTab({ accounts: [mitIdentitaet()] });
    tab["host"].settings.trustedSenders = [{ pluginId: "calendar-notes", transportId: "privat/weg" }];
    const items = trustList(tab);
    expect(items.length).toBe(1);
    expect(items[0]?.desc).toBe("privat/weg");
  });
});

// M5 Task 7: die Settings-UI fuer taskPreset — nur die Struktur der Definitionen, wie oben
// (kein DOM-Rendering im Mock, s. Kommentar an newTab()).
describe("MailstoneSettingTab — taskPreset", () => {
  function presetList(tab: MailstoneSettingTab) {
    const defs = tab.getSettingDefinitions() as { type?: string; addItem?: { name?: string }; items?: unknown[] }[];
    // Seit Welle 2 (onCreate-Enum) gibt es vier Listen (Konten, taskPreset, onCreateAllowedValues,
    // Vertrauensliste). Beide neuen/bestehenden Ohne-Heading-Listen (taskPreset,
    // onCreateAllowedValues) tragen einen addItem-Knopf — unterschieden ueber dessen Beschriftung.
    const lists = defs.filter((d): d is { type: string; addItem?: { name?: string }; items: unknown[] } => d.type === "list");
    expect(lists.length).toBe(4);
    const preset = lists.find((d) => d.addItem?.name === t("settings.taskPreset.add"));
    expect(preset).toBeDefined();
    return preset as { items: { name: string }[] };
  }

  it("ist leer, wenn taskPreset leer ist", () => {
    const tab = newTab();
    expect(presetList(tab).items).toEqual([]);
  });

  it("zeigt einen bestehenden Preset-Eintrag als Zeile", () => {
    const tab = newTab();
    tab["host"].settings.taskPreset = { status: "open" };
    expect(presetList(tab).items.map((i) => i.name)).toEqual(["status"]);
  });

  it("addItem haengt einen neuen, kollisionsfreien Schluessel an", async () => {
    const tab = newTab();
    tab["host"].settings.taskPreset = { field: "x" };
    // Der Obsidian-Mock kennt kein PluginSettingTab.update() (echtes Obsidian ruft es fuer
    // einen Re-Render) — hier reicht ein No-op, da nur die Settings-Mutation geprueft wird.
    (tab as unknown as { update: () => void }).update = () => {};
    const defs = tab.getSettingDefinitions() as { type?: string; heading?: string; addItem?: { action: (el: HTMLElement) => void } }[];
    const list = defs.find((d) => d.type === "list" && d.addItem && d.heading === undefined)!;
    list.addItem!.action({} as HTMLElement);
    await Promise.resolve();
    expect(tab["host"].settings.taskPreset).toEqual({ field: "x", "field-2": "" });
  });

  // Fix-Runde 1, Important 2: eine Umbenennung auf einen bestehenden Schluessel darf den
  // Zielwert nicht mehr still per Object.fromEntries verschlucken.
  it("rename auf einen bestehenden Schluessel wird abgelehnt, kein Wert geht verloren", async () => {
    const tab = newTab();
    tab["host"].settings.taskPreset = { status: "open", prio: "high" };
    (tab as unknown as { update: () => void }).update = () => {};
    // Notice.instances ist eine reine Test-Instrumentierung des Mocks (tests/vendor/kit/
    // obsidian-mock.ts) und existiert in den echten Obsidian-Typings nicht — deshalb ueber
    // einen strukturellen Cast statt eines Imports der Mock-Klasse angesprochen.
    const NoticeSpy = (await import("obsidian")).Notice as unknown as { instances: unknown[] };
    NoticeSpy.instances.length = 0;
    await (tab as unknown as { renameTaskPresetKey: (i: number, k: string) => Promise<void> }).renameTaskPresetKey(0, "prio");
    expect(tab["host"].settings.taskPreset).toEqual({ status: "open", prio: "high" });
    expect(NoticeSpy.instances.length).toBe(1);
  });
});

// Punkt 3 der Welle-2-Aufgabe: plugin-eigene, in den Settings konfigurierbare Liste erlaubter
// onCreate-Werte (Default ["mail"]). Struktur wie taskPresetGroup, aber eine Zeile pro Wert
// (kein Schluessel/Wert-Paar).
describe("MailstoneSettingTab — onCreateAllowedValues", () => {
  function valuesList(tab: MailstoneSettingTab) {
    const defs = tab.getSettingDefinitions() as { type?: string; addItem?: { name?: string }; items?: { name: string }[] }[];
    const list = defs.find((d) => d.type === "list" && d.addItem?.name === t("settings.onCreateAllowedValues.add"));
    expect(list).toBeDefined();
    return list as { items: { name: string }[] };
  }

  it("zeigt den Default-Wert 'mail' als Zeile", () => {
    const tab = newTab();
    expect(valuesList(tab).items.map((i) => i.name)).toEqual(["mail"]);
  });

  it("addItem haengt eine neue, leere Zeile an", async () => {
    const tab = newTab();
    (tab as unknown as { update: () => void }).update = () => {};
    const defs = tab.getSettingDefinitions() as { type?: string; addItem?: { name?: string; action: () => void } }[];
    const list = defs.find((d) => d.type === "list" && d.addItem?.name === t("settings.onCreateAllowedValues.add"))!;
    list.addItem!.action();
    await Promise.resolve();
    expect(tab["host"].settings.onCreateAllowedValues).toEqual(["mail", ""]);
  });

  it("onDelete entfernt die Zeile am Index", async () => {
    const tab = newTab();
    tab["host"].settings.onCreateAllowedValues = ["mail", "task"];
    (tab as unknown as { update: () => void }).update = () => {};
    const defs = tab.getSettingDefinitions() as { type?: string; addItem?: { name?: string }; onDelete?: (i: number) => void }[];
    const list = defs.find((d) => d.type === "list" && d.addItem?.name === t("settings.onCreateAllowedValues.add"))!;
    list.onDelete!(0);
    await Promise.resolve();
    expect(tab["host"].settings.onCreateAllowedValues).toEqual(["task"]);
  });

  it("rename auf einen bestehenden Wert wird abgelehnt, kein Wert geht verloren", async () => {
    const tab = newTab();
    tab["host"].settings.onCreateAllowedValues = ["mail", "task"];
    (tab as unknown as { update: () => void }).update = () => {};
    const NoticeSpy = (await import("obsidian")).Notice as unknown as { instances: unknown[] };
    NoticeSpy.instances.length = 0;
    await (tab as unknown as { renameOnCreateAllowedValue: (i: number, v: string) => Promise<void> }).renameOnCreateAllowedValue(0, "task");
    expect(tab["host"].settings.onCreateAllowedValues).toEqual(["mail", "task"]);
    expect(NoticeSpy.instances.length).toBe(1);
  });

  it("rename auf einen leeren Wert entfernt die Zeile", async () => {
    const tab = newTab();
    tab["host"].settings.onCreateAllowedValues = ["mail", "task"];
    (tab as unknown as { update: () => void }).update = () => {};
    await (tab as unknown as { renameOnCreateAllowedValue: (i: number, v: string) => Promise<void> }).renameOnCreateAllowedValue(1, "  ");
    expect(tab["host"].settings.onCreateAllowedValues).toEqual(["mail"]);
  });
});

describe("MailstoneSettingTab — Sync-Stand auf Mobile (Welle 7)", () => {
  it("zeigt am Desktop keinen Sync-Stand-Eintrag — das Cockpit zeigt ihn schon live je Konto", () => {
    const prev = Platform.isMobile;
    Platform.isMobile = false;
    try {
      const defs = newTab().getSettingDefinitions() as { name?: string }[];
      expect(defs.some((d) => d.name === t("settings.lastSync"))).toBe(false);
    } finally {
      Platform.isMobile = prev;
    }
  });

  it("nennt auf Mobile 'noch kein Sync', solange kein Lauf erfolgreich war", () => {
    const prev = Platform.isMobile;
    Platform.isMobile = true;
    try {
      const defs = newTab().getSettingDefinitions() as { name?: string; desc?: string }[];
      const zeile = defs.find((d) => d.name === t("settings.lastSync"));
      expect(zeile?.desc).toContain(t("settings.lastSync.never"));
    } finally {
      Platform.isMobile = prev;
    }
  });

  it("nennt auf Mobile den Zeitpunkt des juengsten ERFOLGREICHEN Laufs, nicht des letzten Versuchs", () => {
    const prev = Platform.isMobile;
    Platform.isMobile = true;
    try {
      const runState: RunState = {
        a: { at: 1000, ok: true, counts: { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 } },
        b: { at: 2000, ok: false, code: "auth", counts: { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 } },
      };
      const defs = newTab({ runState }).getSettingDefinitions() as { name?: string; desc?: string }[];
      const zeile = defs.find((d) => d.name === t("settings.lastSync"));
      expect(zeile?.desc).toContain(t("settings.lastSync.value", new Date(1000).toLocaleString()));
    } finally {
      Platform.isMobile = prev;
    }
  });
});
