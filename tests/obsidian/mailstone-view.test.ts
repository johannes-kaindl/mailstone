import { describe, it, expect, vi } from "vitest";
import { WorkspaceLeaf } from "obsidian";
import { MailstoneView, VIEW_TYPE_MAILSTONE, activateMailstoneView } from "../../src/obsidian/views/mailstone-view";
import type { CockpitHost } from "../../src/obsidian/views/cockpit-panel";
import type { InboxHost } from "../../src/obsidian/views/inbox-panel";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

function fakeHost(onChange?: CockpitHost["onChange"]): CockpitHost {
  return {
    accounts: () => [], runState: () => ({}), nextDueAt: () => null, isBusy: () => false,
    syncNow: () => undefined, openSettings: () => undefined, onChange: onChange ?? (() => () => undefined),
  };
}

function fakeInboxHost(onChange?: InboxHost["onChange"]): InboxHost {
  return {
    accounts: () => [], selectedAccountId: () => "", selectAccount: () => undefined,
    viewModel: () => ({ state: "leer", rows: [], fehlerCode: null, aktionenAktiv: false }),
    refresh: () => undefined, adopt: () => undefined, archive: () => undefined,
    openSettings: () => undefined, onChange: onChange ?? (() => () => undefined),
  };
}

/** Alle Nachfahren mit dieser Klasse — der Fake-El haelt Kinder in `children`. Identisch zu
 *  `findAll` aus tests/obsidian/cockpit-panel.test.ts:31. */
function alleMit(el: any, cls: string): any[] {
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

describe("MailstoneView", () => {
  it("meldet den einen View-Type des Plugins", () => {
    const v = new MailstoneView(new WorkspaceLeaf(), fakeHost(), fakeInboxHost());
    expect(v.getViewType()).toBe(VIEW_TYPE_MAILSTONE);
    expect(v.getIcon()).toBe("mail");
  });

  it("baut das Panel beim Oeffnen auf und raeumt beim Schliessen ab", async () => {
    const v = new MailstoneView(new WorkspaceLeaf(), fakeHost(), fakeInboxHost());
    await v.onOpen();
    expect(v.contentEl.children.length).toBeGreaterThan(0);
    await v.onClose();
    expect(v.contentEl.children.length).toBe(0);
  });

  it("meldet das Panel beim Schliessen wirklich ab — nicht nur den DOM geleert", async () => {
    // Die Kinderzahl oben belegt das NICHT: `contentEl.empty()` leert sie ohnehin, ob das
    // Panel sich vorher abgemeldet hat oder nicht (Task 4, Mutation 4 blieb genau daran
    // gruen). Ein nicht abgemeldeter Listener feuerte bei jedem Sync-Lauf weiter und zeichnete
    // in einen abgehaengten DOM — ein Leck pro Oeffnen/Schliessen-Zyklus.
    const unsub = vi.fn();
    const v = new MailstoneView(new WorkspaceLeaf(), fakeHost(() => unsub), fakeInboxHost());
    await v.onOpen();
    expect(unsub).not.toHaveBeenCalled();
    await v.onClose();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("mountet beide Panels als Tabs", async () => {
    const v = new MailstoneView(new WorkspaceLeaf(), fakeHost(), fakeInboxHost());
    await v.onOpen();
    // Attributselektoren kann der Fake-El NICHT (matchesSimpleSelector versteht nur Tag und
    // .klasse) — also die Tabs ueber ihre Klasse einsammeln und data-tab dort auslesen. Die
    // Klasse ist okit-hub-tab, nicht kit-hub-tab — verbindlich ist, was hub.ts nach dem
    // Vendoring tatsaechlich vergibt (src/vendor/kit-obsidian/hub.ts:186).
    const ids = alleMit(v.contentEl, "okit-hub-tab").map((el) => el.getAttribute("data-tab"));
    expect(ids).toContain("cockpit");
    expect(ids).toContain("inbox");
  });

  it("bleibt bei EINEM registerView-Typ", () => {
    expect(VIEW_TYPE_MAILSTONE).toBe("mailstone-cockpit");
  });

  it("zerstoert beim Schliessen BEIDE Panels", async () => {
    const abCockpit = vi.fn();
    const abInbox = vi.fn();
    const v = new MailstoneView(new WorkspaceLeaf(), fakeHost(() => abCockpit), fakeInboxHost(() => abInbox));
    await v.onOpen();
    await v.onClose();
    expect(abCockpit).toHaveBeenCalled();
    expect(abInbox).toHaveBeenCalled();
  });
});

describe("activateMailstoneView", () => {
  it("klappt die Seitenleiste auf — sonst entsteht die View mit 0x0 px", async () => {
    // REGISTRY §UI: getRightLeaf(false) + setViewState() erzeugt das Blatt, oeffnet aber
    // die eingeklappte Leiste nicht. Fuer den Erstnutzer taete der Klick sichtbar nichts.
    const setViewState = vi.fn().mockResolvedValue(undefined);
    const leaf = { setViewState };
    const revealLeaf = vi.fn();
    const app: any = {
      workspace: {
        getLeavesOfType: () => [],
        getRightLeaf: () => leaf,
        revealLeaf,
      },
    };
    await activateMailstoneView(app);
    expect(setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_MAILSTONE, active: true });
    expect(revealLeaf).toHaveBeenCalledWith(leaf);
  });

  it("nimmt ein vorhandenes Blatt, statt ein zweites anzulegen", async () => {
    const vorhanden = { setViewState: vi.fn() };
    const revealLeaf = vi.fn();
    const getRightLeaf = vi.fn();
    const app: any = {
      workspace: { getLeavesOfType: () => [vorhanden], getRightLeaf, revealLeaf },
    };
    await activateMailstoneView(app);
    expect(getRightLeaf).not.toHaveBeenCalled();
    expect(vorhanden.setViewState).not.toHaveBeenCalled();
    expect(revealLeaf).toHaveBeenCalledWith(vorhanden);
  });

  it("tut nichts, wenn kein rechtes Blatt zu bekommen ist", async () => {
    const revealLeaf = vi.fn();
    const app: any = {
      workspace: { getLeavesOfType: () => [], getRightLeaf: () => null, revealLeaf },
    };
    await activateMailstoneView(app);
    expect(revealLeaf).not.toHaveBeenCalled();
  });
});
