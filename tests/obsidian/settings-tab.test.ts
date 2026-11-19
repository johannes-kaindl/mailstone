import { afterEach, describe, it, expect, vi } from "vitest";
import { App, Plugin, Setting } from "obsidian";
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
function newTab(opts: { accounts?: Account[]; secrets?: Partial<SecretStore>; runState?: RunState; onStatusBar?: (on: boolean) => void } = {}): MailstoneSettingTab {
  const settings: MailstoneSettings = { ...loadSettings(undefined), accounts: opts.accounts ?? [] };
  const host: SettingsHost = {
    settings,
    saveSettings: async () => {},
    secrets: fakeSecrets(opts.secrets),
    transport: () => ({}) as unknown as SocketTransport,
    runState: () => opts.runState ?? {},
    setStatusBarVisible: opts.onStatusBar ?? (() => {}),
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

  it("nennt die Identitaeten in der Zaehlform: 1 Identitaet, 0 und 2 Identitaeten", () => {
    const mk = (n: number) => ({ ...newAccount("acc"), label: "Privat", identities: Array.from({ length: n }, (_, i) => ({ id: `i${i}`, name: "N", address: `a${i}@example.test` })) }) as Account;
    const desc = (n: number) => accountList(newTab({ accounts: [mk(n)] })).items[0]!.desc;
    expect(desc(1)).toContain("1 Identität");
    expect(desc(1)).not.toContain("Identitäten");
    expect(desc(2)).toContain("2 Identitäten");
    expect(desc(0)).toContain("0 Identitäten");
  });

  it("bietet im Profil-Abschnitt einen Schalter fuer die .eml mit Beschreibung (A6)", async () => {
    const tab = newTab({ accounts: [] });
    const defs = tab.getSettingDefinitions() as { name?: string; desc?: string; control?: { key?: string } }[];
    const i = defs.findIndex((d) => d.control?.key === "profile.saveEml");
    expect(i).toBeGreaterThan(defs.findIndex((d) => d.control?.key === "profile.filename"));
    expect(defs[i]?.name).toBe("Original als .eml speichern");
    expect(defs[i]?.desc).toContain("vom Server");
    // Standard an; ausgeschaltet landet der Wert im Profil.
    expect(tab.getControlValue("profile.saveEml")).toBe(true);
    await tab.setControlValue("profile.saveEml", false);
    expect(tab.getControlValue("profile.saveEml")).toBe(false);
  });

  it("bietet einen Schalter fuer das Debug-Protokoll", () => {
    const tab = newTab({ accounts: [] });
    const defs = tab.getSettingDefinitions() as { name?: string; control?: { key?: string } }[];
    const toggle = defs.find((d) => d.control?.key === "debugLog");
    expect(toggle).toBeDefined();
    expect(toggle?.name).toBe("Debug-Protokoll");
  });
});

describe("MailstoneSettingTab — Statusleiste (UI-STANDARD § 8)", () => {
  type Hatch = { name?: string; desc?: string; render?: (s: Setting) => void };
  const zeile = (tab: MailstoneSettingTab): Hatch => {
    const defs = tab.getSettingDefinitions() as unknown as Hatch[];
    const z = defs.find((d) => d.name === "Statusleiste");
    expect(z).toBeDefined();
    return z!;
  };
  it("bietet die Zeile Statusleiste mit einem Schalter, der den gespeicherten Wert zeigt und den Eintrag umschaltet", async () => {
    initI18n("de");
    const calls: boolean[] = [];
    const tab = newTab({ onStatusBar: (on) => { calls.push(on); } });
    const setting = new Setting(undefined as never);
    zeile(tab).render?.(setting);
    const comp = (setting as unknown as { components: Array<{ getValue(): boolean; onChangeCB: ((v: boolean) => unknown) | null }> }).components[0]!;
    expect(comp.getValue()).toBe(true); // Standard an
    await comp.onChangeCB?.(false);
    expect(calls).toEqual([false]);
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
    // Vertrauensliste), seit A2 (Welle 36) eine fuenfte (weitergegebene Felder). Beide neuen/bestehenden Ohne-Heading-Listen (taskPreset,
    // onCreateAllowedValues) tragen einen addItem-Knopf — unterschieden ueber dessen Beschriftung.
    const lists = defs.filter((d): d is { type: string; addItem?: { name?: string }; items: unknown[] } => d.type === "list");
    expect(lists.length).toBe(5);
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
    const defs = tab.getSettingDefinitions() as { type?: string; heading?: string; addItem?: { name?: string; action: (el: HTMLElement) => void } }[];
    const list = defs.find((d) => d.type === "list" && d.addItem?.name === t("settings.taskPreset.add"))!;
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

describe("Hilfe-Zeile (UI-STANDARD §8)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    initI18n("de");
  });
  type Hatch = { name?: string; desc?: string; render?: (s: Setting) => void };
  const erste = (): Hatch => newTab().getSettingDefinitions()[0] as unknown as Hatch;

  it("ist das ERSTE Element von getSettingDefinitions, vor jeder anderen Zeile", () => {
    initI18n("de");
    expect(erste().name).toBe("Hilfe");
    expect(typeof erste().render).toBe("function");
  });

  it("spricht die Sprache der Settings (EN und DE)", () => {
    initI18n("en");
    expect(erste().name).toBe("Help");
    expect(erste().desc).toBe("Getting started, how-tos and troubleshooting");
    initI18n("de");
    expect(erste().desc).toBe("Erste Schritte, Anleitungen und Fehlersuche");
  });

  it("die Knöpfe öffnen Doku-Index und Issues dieses Repos", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const setting = new Setting(undefined as never);
    erste().render?.(setting);
    const knoepfe = (setting as unknown as { components: Array<{ clickCB: (() => void) | null }> }).components;
    expect(knoepfe).toHaveLength(2);
    knoepfe.forEach((k) => k.clickCB?.());
    expect(open.mock.calls.map((c) => c[0])).toEqual([
      "https://github.com/johannes-kaindl/mailstone/blob/main/docs/README.md",
      "https://github.com/johannes-kaindl/mailstone/issues",
    ]);
  });
});

describe("MailstoneSettingTab — Vorgang (A3, E7)", () => {
  type Def = { name?: string; desc?: string; control?: { key?: string } };
  const defs = (tab: MailstoneSettingTab): Def[] => tab.getSettingDefinitions() as Def[];
  const field = (tab: MailstoneSettingTab) => defs(tab).find((d) => d.control?.key === "profile.threadField");
  const token = (tab: MailstoneSettingTab) => defs(tab).find((d) => d.control?.key === "profile.threadTokenPattern");

  it("zeigt beide Zeilen im Profil-Abschnitt, nach dem Schalter fuer die .eml", () => {
    const tab = newTab();
    const keys = defs(tab).map((d) => d.control?.key);
    expect(keys.indexOf("profile.saveEml")).toBeLessThan(keys.indexOf("profile.threadField"));
    expect(keys.indexOf("profile.threadField")).toBeLessThan(keys.indexOf("profile.threadTokenPattern"));
    expect(field(tab)?.name).toBe(t("settings.threadField"));
    expect(token(tab)?.name).toBe(t("settings.threadTokenPattern"));
  });

  it("die Werte stehen im Profil: Vorgabe aus und `\\[Ticket#\\d+\\]`", () => {
    const tab = newTab();
    expect(tab.getControlValue("profile.threadField")).toBe("");
    expect(tab.getControlValue("profile.threadTokenPattern")).toBe("\\[Ticket#\\d+\\]");
  });

  it("speichert beide Werte getrimmt im Profil", async () => {
    const tab = newTab();
    await tab.setControlValue("profile.threadField", "  vorgang ");
    await tab.setControlValue("profile.threadTokenPattern", "\\bINC\\d+\\b");
    expect(tab["host"].settings.profile.threadField).toBe("vorgang");
    expect(tab["host"].settings.profile.threadTokenPattern).toBe("\\bINC\\d+\\b");
  });

  it("kein Hinweis bei brauchbaren Werten", () => {
    const tab = newTab();
    tab["host"].settings.profile.threadField = "vorgang";
    expect(defs(tab).some((d) => d.name === t("settings.threadHint"))).toBe(false);
  });

  it("ein verwalteter Schluessel zeigt einen Hinweis unter der Zeile, der Wert bleibt sichtbar", () => {
    const tab = newTab();
    tab["host"].settings.profile.threadField = "mail_id";
    const list = defs(tab);
    const i = list.findIndex((d) => d.control?.key === "profile.threadField");
    expect(list[i + 1]?.desc).toBe(t("settings.threadField.problem.managed", "mail_id"));
    expect(tab.getControlValue("profile.threadField")).toBe("mail_id");
  });

  it("ein Name mit Umlaut zeigt den Hinweis zu nicht lesbaren Namen", () => {
    const tab = newTab();
    tab["host"].settings.profile.threadField = "vorgäng";
    const list = defs(tab);
    const i = list.findIndex((d) => d.control?.key === "profile.threadField");
    expect(list[i + 1]?.desc).toBe(t("settings.threadField.problem.unreadable", "vorgäng"));
  });

  it("ein ungueltiger Regex zeigt den Hinweis unter der Token-Zeile", () => {
    const tab = newTab();
    tab["host"].settings.profile.threadTokenPattern = "[";
    const list = defs(tab);
    const i = list.findIndex((d) => d.control?.key === "profile.threadTokenPattern");
    expect(list[i + 1]?.desc).toBe(t("settings.threadTokenPattern.problem.syntax"));
  });

  it("ein Regex, den das Risiko-Veto ablehnt, zeigt einen eigenen Hinweis", () => {
    const tab = newTab();
    tab["host"].settings.profile.threadTokenPattern = "(a+)+$";
    const list = defs(tab);
    const i = list.findIndex((d) => d.control?.key === "profile.threadTokenPattern");
    expect(list[i + 1]?.desc).toBe(t("settings.threadTokenPattern.problem.risky"));
  });

  it("leer und die Vorgabe zeigen keinen Hinweis", () => {
    const tab = newTab();
    for (const v of ["", "\\[Ticket#\\d+\\]"]) {
      tab["host"].settings.profile.threadTokenPattern = v;
      const list = defs(tab);
      const i = list.findIndex((d) => d.control?.key === "profile.threadTokenPattern");
      expect(list[i + 1]?.name, JSON.stringify(v)).not.toBe(t("settings.threadHint"));
    }
  });

  it("die Aenderung des Ausdrucks zeichnet nur neu, wenn der Hinweis wechselt", async () => {
    const tab = newTab();
    let neu = 0;
    (tab as unknown as { update: () => void }).update = () => { neu++; };
    await tab.setControlValue("profile.threadTokenPattern", "\\bINC\\d+\\b");
    expect(neu).toBe(0);
    await tab.setControlValue("profile.threadTokenPattern", "[");
    expect(neu).toBe(1);
    await tab.setControlValue("profile.threadTokenPattern", "(a+)+$");
    expect(neu).toBe(2);
    await tab.setControlValue("profile.threadTokenPattern", "");
    expect(neu).toBe(3);
  });

  it("nach einer Aenderung, die den Hinweis ein- oder ausblendet, zeichnet der Tab neu", async () => {
    const tab = newTab();
    let neu = 0;
    (tab as unknown as { update: () => void }).update = () => { neu++; };
    await tab.setControlValue("profile.threadField", "vorgang");
    expect(neu).toBe(0);
    await tab.setControlValue("profile.threadField", "mail_id");
    expect(neu).toBe(1);
    await tab.setControlValue("profile.threadField", "mail_id2");
    expect(neu).toBe(2);
  });
});

describe("MailstoneSettingTab — Folgen-Feld (A1, E7)", () => {
  type Def = { name?: string; desc?: string; control?: { key?: string } };
  const defs = (tab: MailstoneSettingTab): Def[] => tab.getSettingDefinitions() as Def[];
  const after = (tab: MailstoneSettingTab, key: string): Def | undefined => {
    const list = defs(tab);
    return list[list.findIndex((d) => d.control?.key === key) + 1];
  };

  it("zeigt die Zeile direkt nach der Kennung im Betreff, Vorgabe mail_follow", () => {
    const tab = newTab();
    const keys = defs(tab).map((d) => d.control?.key);
    expect(keys.indexOf("profile.followField")).toBe(keys.indexOf("profile.threadTokenPattern") + 1);
    expect(defs(tab).find((d) => d.control?.key === "profile.followField")?.name).toBe(t("settings.followField"));
    expect(tab.getControlValue("profile.followField")).toBe("mail_follow");
  });

  it("speichert den Wert getrimmt; leer bleibt leer (aus)", async () => {
    const tab = newTab();
    await tab.setControlValue("profile.followField", "  folgen ");
    expect(tab["host"].settings.profile.followField).toBe("folgen");
    await tab.setControlValue("profile.followField", "");
    expect(tab["host"].settings.profile.followField).toBe("");
  });

  it("kein Hinweis beim Standard", () => {
    expect(defs(newTab()).some((d) => d.name === t("settings.threadHint"))).toBe(false);
  });

  it("ein verwalteter Schluessel, ein Name mit Umlaut und eine Kollision zeigen je ihren Hinweis unter der Zeile", () => {
    const tab = newTab();
    tab["host"].settings.profile.followField = "mail_id";
    expect(after(tab, "profile.followField")?.desc).toBe(t("settings.followField.problem.managed", "mail_id"));
    tab["host"].settings.profile.followField = "folgen-ä";
    expect(after(tab, "profile.followField")?.desc).toBe(t("settings.followField.problem.unreadable", "folgen-ä"));
    tab["host"].settings.profile.threadField = "vorgang";
    tab["host"].settings.profile.followField = "vorgang";
    expect(after(tab, "profile.followField")?.desc).toBe(t("settings.followField.problem.collision", "vorgang"));
    // dieselbe Kollision zeigt auch das Vorgangsfeld an
    expect(after(tab, "profile.threadField")?.desc).toBe(t("settings.threadField.problem.collision", "vorgang"));
  });

  it("nach einer Aenderung, die einen Hinweis ein- oder ausblendet, zeichnet der Tab neu; sonst nicht (Fokus)", async () => {
    const tab = newTab();
    let neu = 0;
    (tab as unknown as { update: () => void }).update = () => { neu++; };
    await tab.setControlValue("profile.followField", "folgen");
    expect(neu).toBe(0);
    await tab.setControlValue("profile.followField", "mail_id");
    expect(neu).toBe(1);
    await tab.setControlValue("profile.threadField", "x");
    expect(neu).toBe(1);
    // Das Vorgangsfeld auf denselben Namen: der Hinweis erscheint unter beiden Zeilen
    await tab.setControlValue("profile.followField", "gleich");
    expect(neu).toBe(2);
    await tab.setControlValue("profile.threadField", "gleich");
    expect(neu).toBe(3);
  });
});

describe("MailstoneSettingTab — weitergegebene Felder (A2, E7)", () => {
  type Def = { name?: string; desc?: string; type?: string; control?: { key?: string }; items?: { name: string }[]; addItem?: { name?: string; action: () => void }; onDelete?: (i: number) => void; emptyState?: string };
  const defs = (tab: MailstoneSettingTab): Def[] => tab.getSettingDefinitions() as Def[];
  const listIn = (all: Def[]): Def => {
    const l = all.find((d) => d.type === "list" && d.addItem?.name === t("settings.inheritFields.add"));
    expect(l).toBeDefined();
    return l!;
  };
  const list = (tab: MailstoneSettingTab): Def => listIn(defs(tab));
  /** Die Hinweiszeilen unter der Liste. */
  const hints = (tab: MailstoneSettingTab): string[] => {
    const all = defs(tab);
    const i = all.indexOf(listIn(all));
    const out: string[] = [];
    for (let j = i + 1; all[j]?.name === t("settings.threadHint"); j++) out.push(all[j]!.desc ?? "");
    return out;
  };
  const noUpdate = (tab: MailstoneSettingTab) => { (tab as unknown as { update: () => void }).update = () => {}; };

  it("zeigt eine erklaerende Zeile und danach die Liste, leer mit Leerzustand", () => {
    const tab = newTab();
    const all = defs(tab);
    const i = all.indexOf(listIn(all));
    expect(all[i - 1]).toMatchObject({ name: t("settings.inheritFields"), desc: t("settings.inheritFields.desc") });
    expect(list(tab).items).toEqual([]);
    expect(list(tab).emptyState).toBe(t("settings.inheritFields.empty"));
  });

  it("steht nach dem Folgen-Feld und vor den Konten", () => {
    const tab = newTab();
    const all = defs(tab);
    const i = all.indexOf(listIn(all));
    expect(all.findIndex((d) => d.control?.key === "profile.followField")).toBeLessThan(i);
    expect(i).toBeLessThan(all.findIndex((d) => (d as { heading?: string }).heading === t("settings.accounts")));
  });

  it("zeigt die Eintraege als Zeilen", () => {
    const tab = newTab();
    tab["host"].settings.profile.inheritFields = ["projekt", "kunde"];
    expect(list(tab).items!.map((i) => i.name)).toEqual(["projekt", "kunde"]);
  });

  it("kein Hinweis bei brauchbaren Namen", () => {
    const tab = newTab();
    tab["host"].settings.profile.inheritFields = ["projekt", "kunde"];
    expect(hints(tab)).toEqual([]);
  });

  it("addItem haengt eine leere Zeile an und speichert", async () => {
    const tab = newTab();
    noUpdate(tab);
    let gespeichert = 0;
    tab["host"].saveSettings = async () => { gespeichert++; };
    list(tab).addItem!.action();
    await Promise.resolve();
    expect(tab["host"].settings.profile.inheritFields).toEqual([""]);
    expect(gespeichert).toBe(1);
  });

  it("onDelete entfernt die Zeile am Index", async () => {
    const tab = newTab();
    noUpdate(tab);
    tab["host"].settings.profile.inheritFields = ["a", "b", "c"];
    list(tab).onDelete!(1);
    await Promise.resolve();
    expect(tab["host"].settings.profile.inheritFields).toEqual(["a", "c"]);
  });

  type Rename = { renameInheritField: (i: number, v: string) => Promise<void> };
  it("eine Umbenennung speichert den getrimmten Namen", async () => {
    const tab = newTab();
    noUpdate(tab);
    tab["host"].settings.profile.inheritFields = ["projekt"];
    await (tab as unknown as Rename).renameInheritField(0, "  kunde ");
    expect(tab["host"].settings.profile.inheritFields).toEqual(["kunde"]);
  });

  it("ein leerer Name entfernt die Zeile", async () => {
    const tab = newTab();
    noUpdate(tab);
    tab["host"].settings.profile.inheritFields = ["projekt", "kunde"];
    await (tab as unknown as Rename).renameInheritField(0, "   ");
    expect(tab["host"].settings.profile.inheritFields).toEqual(["kunde"]);
  });

  it("eine Umbenennung auf einen vorhandenen Namen wird abgelehnt, mit Notice, kein Eintrag geht verloren", async () => {
    const tab = newTab();
    noUpdate(tab);
    tab["host"].settings.profile.inheritFields = ["projekt", "kunde"];
    const NoticeSpy = (await import("obsidian")).Notice as unknown as { instances: unknown[] };
    NoticeSpy.instances.length = 0;
    await (tab as unknown as Rename).renameInheritField(0, "kunde");
    expect(tab["host"].settings.profile.inheritFields).toEqual(["projekt", "kunde"]);
    expect(NoticeSpy.instances.length).toBe(1);
  });

  it("ein verwalteter Schluessel, ein Name mit Umlaut und das Vorgangsfeld zeigen je ihren Hinweis unter der Liste; der Eintrag bleibt stehen", () => {
    const tab = newTab();
    tab["host"].settings.profile.threadField = "vorgang";
    tab["host"].settings.profile.inheritFields = ["mail_id", "prüfung", "vorgang", "mail_follow", "projekt"];
    expect(hints(tab)).toEqual([
      t("settings.inheritFields.problem.managed", "mail_id"),
      t("settings.inheritFields.problem.unreadable", "prüfung"),
      t("settings.inheritFields.problem.collision", "vorgang"),
      t("settings.inheritFields.problem.collision", "mail_follow"),
    ]);
    expect(list(tab).items!.map((i) => i.name)).toEqual(["mail_id", "prüfung", "vorgang", "mail_follow", "projekt"]);
  });

  it("ein leerer Eintrag (frisch angelegte Zeile) ist kein Problem", () => {
    const tab = newTab();
    tab["host"].settings.profile.inheritFields = [""];
    expect(hints(tab)).toEqual([]);
  });

  it("aendert sich das Vorgangsfeld so, dass ein Eintrag kollidiert, zeichnet der Tab neu", async () => {
    const tab = newTab();
    tab["host"].settings.profile.inheritFields = ["vorgang"];
    let neu = 0;
    (tab as unknown as { update: () => void }).update = () => { neu++; };
    await tab.setControlValue("profile.threadField", "vorgang");
    expect(neu).toBe(1);
  });
});
