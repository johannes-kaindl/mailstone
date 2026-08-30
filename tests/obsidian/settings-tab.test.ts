import { describe, it, expect } from "vitest";
import { App, Plugin, Setting } from "obsidian";
import { MailstoneSettingTab, type SettingsHost } from "../../src/obsidian/settings-tab";
import { loadSettings, newAccount, type Account, type MailstoneSettings } from "../../src/core/settings";
import type { SecretStore } from "../../src/core/send/secrets";
import type { SocketTransport } from "../../src/core/net/types";
import { renderSettingDefinitions, type SettingControlHost } from "../../src/vendor/kit-obsidian/settings_walker";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

// `Plugin` ist in den echten Obsidian-Typings abstrakt — eine leere Unterklasse ist die
// einzige Form, die sowohl zur Laufzeit (Mock) als auch fuer `tsc -p tsconfig.test.json`
// (echte Typings) funktioniert (Muster aus calendar-notes/tests/obsidian/settings-tab.test.ts).
class TestPlugin extends Plugin {}

// Override: setName/setDesc im vendorten Kit-Mock (Stand 0.28.0, tests/vendor/kit/obsidian-mock.ts)
// schreiben nur in interne nameValue/descValue-Felder, nicht ins DOM — im echten Obsidian legt
// `Setting` sofort `.setting-item-name`/`.setting-item-description` an und schreibt Name/
// Beschreibung dort hinein. Fuer `renderTab()` unten (das den gerenderten Tab per `.textContent`
// prueft) wird das reale Verhalten gebraucht — deshalb hier per Prototyp-Patch nachgezogen,
// NUR in dieser Testdatei (kein Eingriff in den geteilten Mock/Override, s. Task-8-Bericht).
const nameEls = new WeakMap<Setting, HTMLElement>();
const descEls = new WeakMap<Setting, HTMLElement>();
const origSetName = Setting.prototype.setName;
Setting.prototype.setName = function patchedSetName(this: Setting, name: string | DocumentFragment): Setting {
  origSetName.call(this, name);
  let el = nameEls.get(this);
  if (!el) {
    el = this.settingEl.createDiv({ cls: "setting-item-name" });
    nameEls.set(this, el);
  }
  el.textContent = typeof name === "string" ? name : (name?.textContent ?? "");
  return this;
};
const origSetDesc = Setting.prototype.setDesc;
Setting.prototype.setDesc = function patchedSetDesc(this: Setting, desc: string | DocumentFragment): Setting {
  origSetDesc.call(this, desc);
  let el = descEls.get(this);
  if (!el) {
    el = this.settingEl.createDiv({ cls: "setting-item-description" });
    descEls.set(this, el);
  }
  el.textContent = typeof desc === "string" ? desc : (desc?.textContent ?? "");
  return this;
};

function fakeSecrets(overrides?: Partial<SecretStore>): SecretStore {
  const store = new Map<string, string>();
  return {
    get: (id) => store.get(id) ?? null,
    set: (id, v) => { store.set(id, v); },
    has: (id) => (store.get(id) ?? "") !== "",
    ...overrides,
  };
}

/** Zeichnet den Tab mit dem vendorten Fallback-Walker (`renderSettingDefinitions`, sonst nur
 *  fuer Obsidian <1.13 gedacht) in ein `HTMLElement` und liefert dieses zurueck — der Mock kennt
 *  die native 1.13-Registrierung von `getSettingDefinitions()` nicht selbst (kein `display()`
 *  in `MailstoneSettingTab`), der Walker macht denselben Baum trotzdem sichtbar. */
function renderTab(opts: { accounts?: Account[]; secrets?: Partial<SecretStore> } = {}): HTMLElement {
  const settings: MailstoneSettings = { ...loadSettings(undefined), accounts: opts.accounts ?? [] };
  const host: SettingsHost = {
    settings,
    saveSettings: async () => {},
    secrets: fakeSecrets(opts.secrets),
    transport: () => ({}) as unknown as SocketTransport,
  };
  const manifest = { id: "mailstone", name: "Mailstone", version: "0.1.0", minAppVersion: "1.13.0", description: "", author: "" };
  const app = new App();
  const tab = new MailstoneSettingTab(app, new TestPlugin(app, manifest), host);
  renderSettingDefinitions(tab.containerEl, tab.getSettingDefinitions(), tab as unknown as SettingControlHost, tab.app);
  return tab.containerEl;
}

describe("MailstoneSettingTab — Passwort-Hinweis und Debug-Schalter", () => {
  it("zeigt in der Kontenzeile an, wenn kein Passwort hinterlegt ist", () => {
    const tab = renderTab({ accounts: [{ ...newAccount("acc"), label: "Privat" }], secrets: { has: () => false } });
    expect(tab.textContent).toContain("Kein Passwort hinterlegt");
  });

  it("zeigt den Hinweis nicht, wenn ein Passwort hinterlegt ist", () => {
    const tab = renderTab({ accounts: [{ ...newAccount("acc"), label: "Privat" }], secrets: { has: () => true } });
    expect(tab.textContent).not.toContain("Kein Passwort hinterlegt");
  });

  it("bietet einen Schalter fuer das Debug-Protokoll", () => {
    const tab = renderTab({ accounts: [] });
    expect(tab.textContent).toContain("Debug-Protokoll");
  });
});
