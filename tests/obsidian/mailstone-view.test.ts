import { describe, it, expect, vi } from "vitest";
import { WorkspaceLeaf } from "obsidian";
import { MailstoneView, VIEW_TYPE_MAILSTONE, activateMailstoneView } from "../../src/obsidian/views/mailstone-view";
import type { CockpitHost } from "../../src/obsidian/views/cockpit-panel";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

function fakeHost(): CockpitHost {
  return {
    accounts: () => [], runState: () => ({}), nextDueAt: () => null, isBusy: () => false,
    syncNow: () => undefined, openSettings: () => undefined, onChange: () => () => undefined,
  };
}

describe("MailstoneView", () => {
  it("meldet den einen View-Type des Plugins", () => {
    const v = new MailstoneView(new WorkspaceLeaf(), fakeHost());
    expect(v.getViewType()).toBe(VIEW_TYPE_MAILSTONE);
    expect(v.getIcon()).toBe("mail");
  });

  it("baut das Panel beim Oeffnen auf und raeumt beim Schliessen ab", async () => {
    const v = new MailstoneView(new WorkspaceLeaf(), fakeHost());
    await v.onOpen();
    expect(v.contentEl.children.length).toBeGreaterThan(0);
    await v.onClose();
    expect(v.contentEl.children.length).toBe(0);
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
