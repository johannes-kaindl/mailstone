import { describe, it, expect } from "vitest";
import { App, Plugin } from "obsidian";
import { MailstoneSettingTab, type SettingsHost } from "../../src/obsidian/settings-tab";
import { loadSettings, newAccount, type Account, type MailstoneSettings } from "../../src/core/settings";
import type { SecretStore } from "../../src/core/send/secrets";
import type { SocketTransport } from "../../src/core/net/types";
import { initI18n } from "../../src/i18n/strings";

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
function newTab(opts: { accounts?: Account[]; secrets?: Partial<SecretStore> } = {}): MailstoneSettingTab {
  const settings: MailstoneSettings = { ...loadSettings(undefined), accounts: opts.accounts ?? [] };
  const host: SettingsHost = {
    settings,
    saveSettings: async () => {},
    secrets: fakeSecrets(opts.secrets),
    transport: () => ({}) as unknown as SocketTransport,
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
