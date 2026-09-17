import { ItemView, Platform, type App, type WorkspaceLeaf } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import { buildHubInto, type HubController } from "../../vendor/kit-obsidian/hub";
import { CockpitPanel, type CockpitHost } from "./cockpit-panel";
import { InboxPanel, type InboxHost } from "./inbox-panel";

/** Der EINE registerView-Type dieses Plugins (UI-STANDARD §1). Cockpit und Posteingang sind
 *  zwei Tabs EINER View, kein zweiter Type — beide Panels erfuellen den HubPanel-Vertrag und
 *  bleiben nach dem Mount durchgaengig im DOM, der Tab-Wechsel blendet nur um. */
export const VIEW_TYPE_MAILSTONE = "mailstone-cockpit";

export class MailstoneView extends ItemView {
  private hub: HubController<"cockpit" | "inbox"> | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: CockpitHost,
    private readonly inboxHost: InboxHost,
  ) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_MAILSTONE; }
  getDisplayText(): string { return t("cockpit.title"); }
  getIcon(): string { return "mail"; }

  async onOpen(): Promise<void> {
    const cockpit = new CockpitPanel(this.host);
    // Der Posteingang liest live und unsynchronisiert aus der Mailbox — dieselbe Socket-Schicht
    // wie Sync/Versand, die auf Mobile nicht laedt (Welle 7). Ohne sie bliebe der Tab da und
    // jeder Versuch schiege als "Verbindungsfehler" fehl, was auf Mobile irrefuehrend waere.
    const panels = Platform.isMobile ? [cockpit] : [cockpit, new InboxPanel(this.inboxHost)];
    // Zwei Tabs, also traegt die Leiste jetzt eine Wahl — der Grund, aus dem sie beim
    // einzelnen Panel bewusst fehlte.
    this.hub = buildHubInto(this.contentEl, panels, "cockpit");
  }

  async onClose(): Promise<void> {
    this.hub?.destroy();
    this.hub = null;
    this.contentEl.empty();
    // Regression-Fix (I2-Re-Review): der Inbox-Host haengt sich fuer seine gesamte Lebensdauer
    // an einen plugin-lebenslangen Emitter (`syncEvents`). `hub.destroy()` raeumt nur die
    // Panels ab, nicht den Host dahinter — ohne diesen Aufruf ueberlebt der Listener das
    // Schliessen der Ansicht und kann bei jedem kuenftigen Sync erneut laden().
    this.inboxHost.destroy();
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
