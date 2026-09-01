import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import { CockpitPanel, type CockpitHost } from "./cockpit-panel";

/** Der EINE registerView-Type dieses Plugins (UI-STANDARD §1). Kommt mit M4 der
 *  Posteingang dazu, wird er ein zweiter Tab dieser View — kein zweiter Type. */
export const VIEW_TYPE_MAILSTONE = "mailstone-cockpit";

export class MailstoneView extends ItemView {
  private panel: CockpitPanel | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly host: CockpitHost) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_MAILSTONE; }
  getDisplayText(): string { return t("cockpit.title"); }
  getIcon(): string { return "mail"; }

  async onOpen(): Promise<void> {
    // Direkter Mount statt buildHubInto: bei einem Panel waere die Tab-Leiste ein Knopf
    // ohne Wahl. Das Panel erfuellt den HubPanel-Vertrag bereits — mit dem zweiten Tab
    // wird aus dieser Zeile `buildHubInto(this.contentEl, [cockpit, inbox], "cockpit")`.
    this.panel = new CockpitPanel(this.host);
    this.panel.mount(this.contentEl);
  }

  async onClose(): Promise<void> {
    this.panel?.destroy();
    this.panel = null;
    this.contentEl.empty();
  }
}

/** Oeffnet die View und macht sie SICHTBAR. `revealLeaf` ist kein Beiwerk: ohne den Aufruf
 *  entsteht die View bei eingeklappter Seitenleiste — dem Normalzustand eines frisch
 *  eingerichteten Vaults — mit 0x0 Pixeln, das Kommando meldet Erfolg, und der Klick tut
 *  sichtbar nichts (REGISTRY §UI, belegt an image-to-markdown und 3d-codeblocks). */
export async function activateMailstoneView(app: App): Promise<void> {
  const vorhanden = app.workspace.getLeavesOfType(VIEW_TYPE_MAILSTONE);
  const bestehend = vorhanden[0];
  if (bestehend) {
    // await statt void: die Funktion ist ohnehin async, und ein Aufrufer, der auf sie wartet
    // (Tests, ein spaeterer Kommando-Callback), soll erst nach dem tatsaechlichen Aufklappen
    // als fertig gelten — kein Grund, hier ein Fire-and-forget zu waehlen.
    await app.workspace.revealLeaf(bestehend);
    return;
  }
  const leaf = app.workspace.getRightLeaf(false);
  if (!leaf) return;
  await leaf.setViewState({ type: VIEW_TYPE_MAILSTONE, active: true });
  await app.workspace.revealLeaf(leaf);
}
