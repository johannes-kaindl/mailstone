/**
 * GUI-Smoke-Treiber — fährt die Verdrahtungs-Prüfpunkte aus `docs/SMOKE.md`
 * (§ „M5-Handprobe — Verdrahtung“) gegen ein **laufendes** Obsidian statt von Hand.
 *
 * Warum getrackt (CORE-TEST-02 b): Am 2026-09-02 lief diese Runde schon einmal von Hand,
 * mit einem Treiber, der nur im Session-Scratchpad lag. Sie belegte zehn Punkte, die kein
 * Unit-Test erreicht — und wäre beim nächsten Mal wieder Handarbeit gewesen. Ein Werkzeug,
 * das nur einmal existiert, ist keine Praxis.
 *
 * Was er prüft, das der vendorte `Plugin`-Mock strukturell nicht kann: `registerView`, die
 * Ribbon-Umstellung (der Mock verwirft Titel **und** Callback von `addRibbonIcon`), das
 * `onLayoutReady`-Gate, und alles Sichtbare — ob ein Element Pixel hat, wo ein Knopf sitzt,
 * ob eine Animation läuft.
 *
 * ## Voraussetzung
 *
 * ⚠️ **Zuerst prüfen, wer sonst an Obsidian hängt.** Obsidian ist Single-Instance — ein
 * `quit` trifft die Instanz, an der möglicherweise eine andere Session arbeitet, und
 * zerstört deren Zustand. Der eigene Lauf ist danach sauber grün; der Schaden entsteht
 * woanders und fällt nicht auf.
 *
 * ```bash
 * lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "läuft bereits — NICHT beenden"
 * curl -s http://127.0.0.1:9222/json/list   # zeigt, WEN ein Quit träfe (Vault je Fenster)
 * ```
 *
 * Hört der Port schon, dann **mitnutzen statt neu starten** — fehlt nur der Ziel-Vault:
 *
 * ```bash
 * open "obsidian://open?vault=mailstone"    # zusätzliches Fenster derselben Instanz
 * ```
 *
 * Erst wenn gar nichts läuft:
 *
 * ```bash
 * osascript -e 'quit app "Obsidian"'
 * open -a Obsidian --args --remote-debugging-port=9222
 * ```
 *
 * Dann, mit deployter Plugin-Version:
 *
 * ```bash
 * OBSIDIAN_PLUGIN_DIR="$STAGING_VAULTS_DIR/mailstone/.obsidian/plugins/mailstone" npm run deploy
 * npm run smoke:gui
 * npm run smoke:gui -- --vault mailstone --keep
 * ```
 *
 * ⚠️ Der CDP-Zugriff ist gelockt (globaler PreToolUse-Hook). Vor dem Lauf:
 * `python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label mailstone --intent "…"
 * --exclusive focus`, danach `release`.
 *
 * ## Warum dieser Smoke kein echtes Postfach anfasst
 *
 * Die zehn Punkte prüfen **Verdrahtung**, nicht Postfach-Logik — dafür genügt, dass ein Lauf
 * *stattfindet*, nicht dass er gelingt. Der Treiber legt sich deshalb ein eigenes Testkonto
 * an, das auf `127.0.0.1` zeigt, und räumt es hinterher weg. Zwei Gegenstellen, beide vom
 * Treiber selbst hergestellt und damit deterministisch:
 *
 * - **toter Port** (niemand lauscht) → `ECONNREFUSED`, der Lauf endet in Millisekunden.
 *   Das ist die Gegenstelle für „hat ein Lauf stattgefunden?“ (V3, V6).
 * - **Schweige-Server** (nimmt die Verbindung an und sendet nie etwas) → der Lauf hängt bis
 *   zur Frist und ist damit lang genug, um die Lauf-Anzeige zu messen (V10). Danach schließt
 *   der Treiber den Server, der Client bekommt seinen Abbruch und der Lauf endet sofort —
 *   ohne dass jemand 30 s wartet.
 *
 * Ein *erfolgreicher* Sync ist hier bewusst nicht herstellbar: `Account["imap"]["tls"]` kennt
 * nur `implicit`/`starttls` (die Settings-UI bietet unverschlüsseltes IMAP nie an), und der
 * getrackte Fake-IMAP spricht kein TLS. Den Typ dafür aufzuweichen wäre der falsche Preis;
 * der Dialog gegen einen echten Socket ist ohnehin in `tests/integration/` abgedeckt.
 */

import { createServer, type Server } from "node:net";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { attachTo, clickReal, releaseAlwaysOnTop, requireVisible, type Cdp } from "../../tools/obsidian-cdp/cdp.js";

const PLUGIN_ID = "mailstone";
const VIEW_TYPE = "mailstone-cockpit";
/** Konto-Id des Testkontos. Distinkt genug, dass ein Rest im Vault als Testrest erkennbar ist. */
const SMOKE_ACCOUNT_ID = "gui-smoke-testkonto";

interface Pruefpunkt {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const ergebnisse: Pruefpunkt[] = [];

function pruefe(name: string, ok: boolean, detail: string): void {
  ergebnisse.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name} — ${detail}`);
}

// ── Argumente ───────────────────────────────────────────────────────────────────────────

function argWert(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? String(process.argv[i + 1]) : fallback;
}

const PORT = Number(argWert("--port", "9222"));
const VAULT = argWert("--vault", "mailstone");
const KEEP = process.argv.includes("--keep");

// ── Renderer-Helfer ─────────────────────────────────────────────────────────────────────

/** Auswertung im Renderer. Der Ausdruck läuft in einem async-Funktionsrumpf — `return` nötig. */
async function evaluieren<T>(cdp: Cdp, ausdruck: string): Promise<T> {
  return cdp.evaluate<T>(ausdruck);
}

/**
 * Fenster neu laden — **mit Beleg**, dass es passiert ist.
 *
 * Ohne Beleg ist der Fehlerausgang grün, nicht rot: antwortet nach dem `reload`-Befehl noch
 * der alte Renderer, sieht die Probe den Neustart nie und misst trotzdem etwas Plausibles.
 * Die Marke unten überlebt den Übergang nicht — erst ihr Verschwinden *plus* ein wieder
 * geladenes Plugin gilt als vollzogen (Lektion `_docs/LESSONS.md` 2026-09-02).
 */
async function neuLaden(cdp: Cdp, marke: string): Promise<void> {
  await evaluieren(
    cdp,
    `window.__smokeMarke = ${JSON.stringify(marke)}; app.commands.executeCommandById("app:reload"); return true;`,
  );
  const frist = Date.now() + 60_000;
  while (Date.now() < frist) {
    const zustand = await evaluieren<{ marke: string | null; geladen: boolean }>(
      cdp,
      `return {
         marke: window.__smokeMarke ?? null,
         geladen: !!app?.plugins?.plugins?.[${JSON.stringify(PLUGIN_ID)}],
       };`,
    ).catch(() => ({ marke: marke, geladen: false }));
    if (zustand.marke === null && zustand.geladen) {
      await evaluieren(cdp, `await new Promise(r => app.workspace.onLayoutReady(r)); return true;`);
      // Das Startup-Gate hängt an `onLayoutReady`; erst danach steht fest, ob die Ansicht
      // von selbst aufgeht. Eine Messung direkt am Ereignis misst das Rennen mit.
      await warte(1500);
      // Der Fokus überlebt den Neustart nicht zuverlässig, und ein nicht fokussiertes
      // Fenster rendert verzögert: die Sidebar wurde danach mit 24 statt 300 px gemessen.
      await requireVisible(cdp);
      return;
    }
    await warte(500);
  }
  throw new Error(`Neustart „${marke}“ nicht belegt: Marke blieb stehen oder Plugin lud nicht`);
}

function warte(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Sichtbare Meldungen des Prüflings — gehört an jeden roten Punkt (CORE-TEST-14). */
async function klartext(cdp: Cdp): Promise<string> {
  const text = await evaluieren<string>(
    cdp,
    `const v = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view;
     const inhalt = v?.containerEl?.querySelector(".view-content")?.innerText ?? "(keine Ansicht)";
     const toasts = [...document.querySelectorAll(".notice")].map(n => n.innerText).join(" | ");
     return inhalt.replace(/\\n/g, " · ") + (toasts ? "  [Meldungen: " + toasts + "]" : "");`,
  ).catch(() => "(Klartext nicht lesbar)");
  return text.slice(0, 300);
}

/** Cockpit öffnen und die View-Instanz zurückgeben — Existenz vor Eigenschaft. */
async function cockpitOeffnen(cdp: Cdp): Promise<void> {
  await evaluieren(cdp, `app.commands.executeCommandById("${PLUGIN_ID}:open-cockpit"); return true;`);
  await warte(1200);
}

async function cockpitSchliessen(cdp: Cdp): Promise<void> {
  await evaluieren(
    cdp,
    `app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)}).forEach(l => l.detach());
     await app.workspace.saveLayout();
     return true;`,
  );
}

/**
 * Wartet, bis das **gespeicherte** Layout die Ansicht nicht mehr führt.
 *
 * Eine Sidebar-Leaf taucht nach einem Neustart auf zwei Wegen auf: durch das Startup-Gate
 * des Plugins *oder* durch Obsidians Layout-Gedächtnis (`workspace.json`). Wer nur den
 * ersten meint, muss den zweiten vorher ausschließen — sonst misst der Prüfpunkt die
 * Wiederherstellung und ist rot, obwohl das Gate korrekt arbeitet. `requestSaveLayout()`
 * genügt dafür nicht: es ist entprellt und war beim Neustart noch nicht durch.
 */
async function layoutOhneAnsichtGespeichert(cdp: Cdp): Promise<boolean> {
  const frist = Date.now() + 15_000;
  while (Date.now() < frist) {
    const drin = await evaluieren<boolean>(
      cdp,
      `const roh = await app.vault.adapter.read(app.vault.configDir + "/workspace.json");
       return roh.includes(${JSON.stringify(VIEW_TYPE)});`,
    );
    if (!drin) return true;
    await warte(500);
  }
  return false;
}

// ── Gegenstellen, die der Treiber selbst herstellt ──────────────────────────────────────

/** Port, auf dem niemand lauscht → `ECONNREFUSED`, ein Lauf endet in Millisekunden. */
const TOTER_PORT = 9;

/**
 * Nimmt die Verbindung an und sendet **nie** etwas: der Lauf hängt in seiner Frist und ist
 * damit lang genug, um die Lauf-Anzeige zu messen. `schliessen()` beendet ihn sofort.
 */
function schweigeServer(): Promise<{ port: number; schliessen: () => void }> {
  return new Promise((resolve, reject) => {
    const sockets: { destroy: () => void }[] = [];
    const server: Server = createServer((socket) => {
      sockets.push(socket);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const adresse = server.address();
      if (adresse === null || typeof adresse === "string") {
        reject(new Error("Schweige-Server lieferte keine Portnummer"));
        return;
      }
      resolve({
        port: adresse.port,
        schliessen: () => {
          for (const s of sockets) s.destroy();
          server.close();
        },
      });
    });
  });
}

// ── Testkonto ───────────────────────────────────────────────────────────────────────────

/**
 * Legt das Testkonto an bzw. richtet es auf eine Gegenstelle aus.
 *
 * Bewusst über die Plugin-API und `persist()` statt über einen Dateitausch: so läuft
 * derselbe Reparatur- und Serialisierungspfad wie im Normalbetrieb. Die Sicherung der
 * `data.json` steht trotzdem — `persist()` schreibt die Datei.
 */
async function testkontoSetzen(cdp: Cdp, port: number): Promise<void> {
  await evaluieren(
    cdp,
    `const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
     const id = ${JSON.stringify(SMOKE_ACCOUNT_ID)};
     const konto = {
       id, label: "GUI-Smoke Testkonto",
       imap: { host: "127.0.0.1", port: ${String(port)}, tls: "implicit" },
       smtp: { host: "127.0.0.1", port: ${String(port)}, tls: "implicit" },
       username: "smoke@example.invalid", secretId: "mailstone-" + id,
       identities: [], defaultIdentityId: "",
       folders: { inbox: "INBOX", allowlist: "Vault", archive: "Archive", sent: "Sent" },
       // sync.enabled muss AN sein: "Alle synchronisieren" arbeitet nur ueber Konten mit
       // aktivierter Synchronisierung — der Pruefling sagt das im Klartext, wenn keines da
       // ist. Das Intervall ist absichtlich riesig: ein nie gelaufenes Konto ist sofort
       // faellig, danach aber fuer Stunden nicht mehr, und der Scheduler funkt nicht in
       // die Messung von V3a.
       sync: { enabled: true, intervalMin: 6000 },
     };
     p.settings.accounts = [konto];
     // Ohne hinterlegtes Passwort bricht der Lauf VOR dem Verbindungsaufbau ab — die
     // Gegenstelle wird dann nie erreicht und die Lauf-Anzeige ist nur Millisekunden da.
     app.secretStorage.setSecret(konto.secretId, "gui-smoke-kein-echtes-passwort");
     await p.saveSettings();
     return true;`,
  );
  await warte(400);
}

// ── Prüfpunkte ──────────────────────────────────────────────────────────────────────────

async function v4_genauEinViewType(cdp: Cdp): Promise<void> {
  const typen = await evaluieren<string[]>(
    cdp,
    `return Object.keys(app.viewRegistry.viewByType).filter(t => /mail/i.test(t));`,
  );
  pruefe(
    "V4 genau ein View-Type",
    typen.length === 1 && typen[0] === VIEW_TYPE,
    typen.length === 0 ? "kein View-Type registriert — registerView lief nicht" : typen.join(", "),
  );
}

async function v8_kommandoname(cdp: Cdp): Promise<void> {
  const name = await evaluieren<string | null>(
    cdp,
    `return app.commands.commands[${JSON.stringify(PLUGIN_ID + ":open-cockpit")}]?.name ?? null;`,
  );
  // Der Defekt, den dieser Punkt fängt, hieß „Mailstone: Mailstone“: ein Kommandoname, der
  // nur den Plugin-Namen wiederholt. Geprüft wird deshalb, dass hinter dem Präfix etwas
  // anderes steht — nicht der genaue Wortlaut, der übersetzbar bleibt.
  const rumpf = (name ?? "").replace(/^Mailstone:\s*/i, "").trim();
  pruefe(
    "V8 Kommandoname nennt die Handlung",
    name !== null && rumpf.length > 0 && !/^mailstone$/i.test(rumpf),
    name === null ? "Kommando open-cockpit nicht registriert" : `„${name}“`,
  );
}

async function v3_ribbonOeffnetNurUndPaletteLaeuft(cdp: Cdp): Promise<void> {
  await cockpitSchliessen(cdp);
  const vorher = await laufStand(cdp);

  const geklickt = await ribbonKlicken(cdp);
  if (!geklickt) {
    pruefe("V3 Ribbon öffnet, ohne einen Lauf zu starten", false, "Ribbon-Symbol nicht im DOM gefunden");
    return;
  }
  await warte(2500);
  const nachRibbon = await laufStand(cdp);
  const leaves = await evaluieren<number>(
    cdp,
    `return app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)}).length;`,
  );
  pruefe(
    "V3a Ribbon öffnet, ohne einen Lauf zu starten",
    leaves === 1 && nachRibbon === vorher,
    leaves !== 1
      ? `Ansicht nicht geöffnet (${String(leaves)} Leaves) — ${await klartext(cdp)}`
      : nachRibbon !== vorher
        ? `Ribbon hat einen Lauf gestartet (${String(vorher)} → ${String(nachRibbon)})`
        : `Leaves 0 → 1, Lauf-Zeitstempel unverändert`,
  );

  // Gegenprobe: die Befehlspalette startet weiterhin einen Lauf. Ohne sie wäre V3a auch
  // dann grün, wenn Läufe generell nicht mehr anlaufen.
  await evaluieren(cdp, `app.commands.executeCommandById("${PLUGIN_ID}:sync-mailbox"); return true;`);
  const nachPalette = await warteAufNeuenLauf(cdp, nachRibbon, 20_000);
  pruefe(
    "V3b Befehlspalette startet weiterhin einen Lauf",
    nachPalette !== null,
    nachPalette === null
      ? `kein neuer Lauf binnen 20 s — ${await klartext(cdp)}`
      : `Lauf-Zeitstempel ${String(nachRibbon)} → ${String(nachPalette)}`,
  );
}

/** Zeitstempel des letzten Laufs für das Testkonto, oder `null` wenn es noch keinen gab. */
async function laufStand(cdp: Cdp): Promise<number | null> {
  return evaluieren<number | null>(
    cdp,
    `return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].runState?.[${JSON.stringify(SMOKE_ACCOUNT_ID)}]?.at ?? null;`,
  );
}

/**
 * Wartet, bis kein Lauf mehr arbeitet (`busy` leer).
 *
 * Der Vorgaenger fragte „gibt es schon einen Lauf?" — und war damit sofort zufrieden,
 * waehrend der haengende Lauf weiterlief. Sein spaeterer Abschluss landete dann im
 * naechsten Pruefpunkt und wurde dort dem Ribbon-Klick zugerechnet: ein roter Punkt mit
 * einer Ursache aus einem anderen Abschnitt.
 */
async function laufBeendet(cdp: Cdp, frist: number): Promise<boolean> {
  const ende = Date.now() + frist;
  while (Date.now() < ende) {
    const beschaeftigt = await evaluieren<number>(
      cdp,
      `return Object.keys(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].busy ?? {}).length;`,
    );
    if (beschaeftigt === 0) return true;
    await warte(300);
  }
  return false;
}

async function warteAufNeuenLauf(cdp: Cdp, vorher: number | null, frist: number): Promise<number | null> {
  const ende = Date.now() + frist;
  while (Date.now() < ende) {
    const jetzt = await laufStand(cdp);
    if (jetzt !== null && jetzt !== vorher) return jetzt;
    await warte(300);
  }
  return null;
}

async function ribbonKlicken(cdp: Cdp): Promise<boolean> {
  const ausdruck = `document.querySelector(".side-dock-ribbon-action[aria-label=\\"Mailstone\\"]")`;
  const da = await evaluieren<boolean>(cdp, `return !!${ausdruck};`);
  if (!da) return false;
  // Echter Mausklick statt `element.click()`: ein synthetischer Klick trägt `isTrusted:false`
  // und läuft an Host-Pfaden vorbei, die an echten Zeigereingaben hängen.
  await clickReal(cdp, ausdruck, 150);
  return true;
}

async function v2_knopfPosition(cdp: Cdp): Promise<void> {
  const messung = await evaluieren<{ da: boolean; w: number; h: number; imInhalt: boolean } | null>(
    cdp,
    `const v = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view;
     const inhalt = v?.containerEl?.querySelector(".view-content");
     if (!inhalt) return null;
     const knopf = inhalt.querySelector(".mailstone-cockpit-sync-all");
     if (!knopf) return { da: false, w: 0, h: 0, imInhalt: false };
     const r = knopf.getBoundingClientRect(), i = inhalt.getBoundingClientRect();
     return { da: true, w: Math.round(r.width), h: Math.round(r.height),
              imInhalt: r.top >= i.top - 1 && r.bottom <= i.bottom + 1 && r.width > 0 && r.height > 0 };`,
  );
  pruefe(
    "V2 „Alle synchronisieren“ hat Pixel und sitzt im Inhalt",
    messung !== null && messung.da && messung.imInhalt,
    messung === null
      ? "keine Ansicht offen"
      : !messung.da
        ? "Knopf nicht im DOM"
        : `${String(messung.w)}×${String(messung.h)} px, innerhalb der view-content: ${String(messung.imInhalt)}`,
  );
}

async function v1_sichtbarBeimErstoeffnen(cdp: Cdp): Promise<void> {
  // Die Szene: rechte Leiste eingeklappt, keine Ansicht im Layout, Startup-Gate aus. Erst so
  // misst der Ribbon-Klick das Erstöffnen und nicht eine Wiederherstellung aus dem Layout.
  await startupGateSetzen(cdp, false);
  await cockpitSchliessen(cdp);
  await evaluieren(cdp, `app.workspace.rightSplit.collapse(); await app.workspace.saveLayout(); return true;`);
  if (!(await layoutOhneAnsichtGespeichert(cdp))) {
    pruefe("V5a Startup-Gate aus: Ansicht bleibt zu", false, "Vorbedingung nicht herstellbar: workspace.json führt die Ansicht weiter");
    return;
  }
  await neuLaden(cdp, "v1");

  const vorher = await evaluieren<{ leaves: number; eingeklappt: boolean }>(
    cdp,
    `return { leaves: app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)}).length,
              eingeklappt: !!app.workspace.rightSplit.collapsed };`,
  );
  // Zugleich die erste Hälfte des Startup-Gates: mit `openViewOnStartup: false` bleibt zu.
  pruefe(
    "V5a Startup-Gate aus: Ansicht bleibt zu",
    vorher.leaves === 0 && vorher.eingeklappt,
    `Leaves ${String(vorher.leaves)}, rechte Leiste eingeklappt: ${String(vorher.eingeklappt)}`,
  );

  if (!(await ribbonKlicken(cdp))) {
    pruefe("V1 Erstöffnen zeigt ein sichtbares Cockpit", false, "Ribbon-Symbol nicht im DOM gefunden");
    return;
  }
  await breiteStabil(cdp);
  const messung = await evaluieren<{ da: boolean; w: number; h: number; offen: boolean; leiste: number }>(
    cdp,
    `const v = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view;
     const leiste = Math.round(app.workspace.rightSplit.containerEl?.getBoundingClientRect().width ?? 0);
     const inhalt = v?.containerEl?.querySelector(".view-content");
     if (!inhalt) return { da: false, w: 0, h: 0, offen: !app.workspace.rightSplit.collapsed, leiste };
     const r = inhalt.getBoundingClientRect();
     return { da: true, w: Math.round(r.width), h: Math.round(r.height),
              offen: !app.workspace.rightSplit.collapsed, leiste };`,
  );
  // Der Fallstrick ist nicht „Element fehlt“, sondern „Element hat null Pixel“: das Kommando
  // meldet Erfolg, der Klick tut sichtbar nichts (REGISTRY § UI).
  // Nicht „mehr als null Pixel“, sondern „füllt die Seitenleiste“: ein Blatt von 24 px in
  // einer 300 px breiten Leiste besteht jede Schwelle über null und ist trotzdem unsichtbar.
  const fuelltLeiste = messung.leiste > 0 && messung.w >= messung.leiste - 40;
  pruefe(
    "V1 Erstöffnen zeigt ein sichtbares Cockpit (kein 0×0)",
    messung.da && messung.offen && messung.h > 0 && fuelltLeiste,
    messung.da
      ? `${String(messung.w)}×${String(messung.h)} px in einer ${String(messung.leiste)} px breiten Leiste, offen: ${String(messung.offen)}` +
        (fuelltLeiste ? "" : " — die Ansicht füllt die Seitenleiste nicht")
      : `keine Ansicht nach dem Ribbon-Klick — ${await klartext(cdp)}`,
  );
}

/**
 * Wartet, bis die Breite der Ansicht zweimal hintereinander gleich ist.
 *
 * Die Seitenleiste klappt animiert auf. Wer direkt nach dem Klick misst, liest einen
 * Zwischenwert — gemessen wurden 24 px, wo 300 px stehen. Der Punkt bleibt dabei gruen
 * (24 > 0) und behauptet Sichtbarkeit fuer ein Blatt, das noch keine hat.
 */
async function breiteStabil(cdp: Cdp): Promise<void> {
  let vorherige = -1;
  const frist = Date.now() + 8000;
  while (Date.now() < frist) {
    const w = await evaluieren<number>(
      cdp,
      `const v = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view;
       const r = v?.containerEl?.querySelector(".view-content")?.getBoundingClientRect();
       return r ? Math.round(r.width) : 0;`,
    );
    if (w > 0 && w === vorherige) return;
    vorherige = w;
    await warte(400);
  }
}

async function v5b_startupGateAn(cdp: Cdp): Promise<void> {
  await startupGateSetzen(cdp, true);
  await cockpitSchliessen(cdp);
  await evaluieren(cdp, `app.workspace.rightSplit.collapse(); await app.workspace.saveLayout(); return true;`);
  if (!(await layoutOhneAnsichtGespeichert(cdp))) {
    pruefe("V5b Startup-Gate an: Ansicht öffnet sich von selbst", false, "Vorbedingung nicht herstellbar: workspace.json führt die Ansicht weiter");
    return;
  }
  await neuLaden(cdp, "v5b");
  await breiteStabil(cdp);

  const messung = await evaluieren<{ leaves: number; w: number; h: number }>(
    cdp,
    `const v = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view;
     const r = v?.containerEl?.querySelector(".view-content")?.getBoundingClientRect();
     return { leaves: app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)}).length,
              w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0 };`,
  );
  pruefe(
    "V5b Startup-Gate an: Ansicht öffnet sich von selbst",
    messung.leaves === 1 && messung.w > 0 && messung.h > 0,
    messung.leaves === 1
      ? `${String(messung.w)}×${String(messung.h)} px`
      : `${String(messung.leaves)} Leaves nach onLayoutReady — ${await klartext(cdp)}`,
  );
}

async function startupGateSetzen(cdp: Cdp, an: boolean): Promise<void> {
  await evaluieren(
    cdp,
    `const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
     p.settings.openViewOnStartup = ${String(an)};
     await p.saveSettings();
     return true;`,
  );
  await warte(400);
}

async function v6_registerUeberlebtNeustart(cdp: Cdp, datenDatei: string): Promise<void> {
  const vorher = await laufStand(cdp);
  if (vorher === null) {
    pruefe("V6 Register überlebt den Neustart", false, "vor dem Neustart gab es keinen Lauf zu merken");
    return;
  }
  // Erst gegen die Datei prüfen, dann gegen den Speicher: `persist()` kann im Objekt wirken,
  // ohne die Datei zu ändern — dann räumt der Smoke sichtbar auf und die Platte bleibt alt.
  const aufPlatte = JSON.parse(readFileSync(datenDatei, "utf8")) as Record<string, unknown>;
  const schluessel = Object.keys(aufPlatte);
  const nebeneinander = ["settings", "zoneHashes", "uidCache", "runState"].every((k) => schluessel.includes(k));

  await neuLaden(cdp, "v6");
  const nachher = await laufStand(cdp);
  pruefe(
    "V6 Register überlebt den Neustart und liegt neben den übrigen Feldern",
    nachher === vorher && nebeneinander,
    nachher !== vorher
      ? `Zeitstempel ${String(vorher)} → ${String(nachher)} — Register nicht wiederhergestellt`
      : `Zeitstempel ${String(vorher)} identisch; data.json führt ${schluessel.join(", ")}`,
  );
}

async function v7_kaputtesRegisterKipptDenStartNicht(cdp: Cdp, datenDatei: string): Promise<void> {
  const zeilen: string[] = [];
  await cdp.mitschnitt((z) => zeilen.push(z));

  const roh = JSON.parse(readFileSync(datenDatei, "utf8")) as Record<string, unknown>;
  roh.runState = "kaputt";
  writeFileSync(datenDatei, JSON.stringify(roh, null, 2));
  await neuLaden(cdp, "v7");
  await cockpitOeffnen(cdp);

  const zustand = await evaluieren<{ geladen: boolean; register: string; text: string }>(
    cdp,
    `const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
     const v = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view;
     return { geladen: !!p, register: JSON.stringify(p?.runState ?? null),
              text: v?.containerEl?.querySelector(".view-content")?.innerText ?? "" };`,
  );
  const eigene = zeilen.filter((z) => /mailstone/i.test(z));
  // Zulässig ist mehr als ein Ausgang: das Register wird leer, ODER es fällt auf einen
  // brauchbaren Ersatz zurück. Falsch ist allein, dass der Start kippt oder laut scheitert.
  const registerRepariert = zustand.register === "{}" || zustand.register === "null";
  pruefe(
    "V7 kaputtes Register kippt den Start nicht",
    zustand.geladen && registerRepariert && eigene.length === 0,
    !zustand.geladen
      ? "Plugin lud nach dem Neustart nicht"
      : eigene.length > 0
        ? `Konsole meldet: ${eigene.slice(0, 2).join(" | ")}`
        : `runState → ${zustand.register}, Ansicht sagt „${zustand.text.replace(/\n/g, " · ").slice(0, 90)}", 0 Konsolenmeldungen`,
  );
}

async function v10_laufAnzeige(cdp: Cdp, schweigePort: number, schliessen: () => void): Promise<void> {
  await testkontoSetzen(cdp, schweigePort);
  await cockpitOeffnen(cdp);

  // Ein Lauf ist unter einer Sekunde durch, wenn die Gegenstelle sofort ablehnt — ein Blick
  // „während des Laufs“ verpasst die Anzeige dann und meldete fälschlich Stillstand. Deshalb
  // eine Abtastung über den ganzen Vorgang statt einer Stichprobe.
  await evaluieren(
    cdp,
    `const c = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0].view.containerEl.querySelector(".view-content");
     window.__smokeProben = [];
     window.__smokeTakt = setInterval(() => {
       const kopf = c.querySelector(".mailstone-cockpit-head");
       const zeile = c.querySelector(".mailstone-cockpit-row");
       const symbole = [...c.querySelectorAll("svg")].map(s => ({
         cls: String(s.getAttribute("class") || ""),
         imKopf: !!kopf && kopf.contains(s),
         inZeile: !!zeile && zeile.contains(s) && !(kopf && kopf.contains(s)),
         anim: getComputedStyle(s).animationName,
       }));
       window.__smokeProben.push({ symbole, zeilenStatus: zeile?.querySelector(".mailstone-cockpit-status")?.className ?? null });
     }, 20);
     return true;`,
  );

  await clickReal(cdp, `document.querySelector(".mailstone-cockpit-sync-all")`, 150);
  await warte(2500);

  const messung = await evaluieren<{
    proben: number;
    mitSymbol: number;
    imKopf: number;
    inZeile: number;
    hoechstensEines: boolean;
    animationen: string[];
  }>(
    cdp,
    `clearInterval(window.__smokeTakt);
     const p = window.__smokeProben ?? [];
     const mit = p.filter(f => f.symbole.some(s => /loader/.test(s.cls)));
     return {
       proben: p.length,
       mitSymbol: mit.length,
       imKopf: mit.filter(f => f.symbole.some(s => /loader/.test(s.cls) && s.imKopf)).length,
       inZeile: mit.filter(f => f.symbole.some(s => /loader/.test(s.cls) && s.inZeile)).length,
       hoechstensEines: mit.every(f => f.symbole.filter(s => /loader/.test(s.cls)).length <= 1),
       animationen: [...new Set(mit.flatMap(f => f.symbole.filter(s => /loader/.test(s.cls)).map(s => s.anim)))],
     };`,
  );

  // Eine Abtastung mit zu wenigen Proben hat den Vorgang nicht beobachtet, sondern
  // gestreift — dann ist der Punkt ungueltig, nicht bestanden.
  const GENUG_PROBEN = 40;
  const sichtbar = messung.mitSymbol > 0;
  const nurImKopf = messung.imKopf === messung.mitSymbol && messung.inZeile === 0;
  const bewegtSich = messung.animationen.some((a) => a !== "none" && a !== "");
  pruefe(
    "V10 Lauf-Anzeige dreht in der Kopfzeile, nicht in der Kontozeile",
    messung.proben >= GENUG_PROBEN && sichtbar && nurImKopf && messung.hoechstensEines && bewegtSich,
    messung.proben < GENUG_PROBEN
      ? `nur ${String(messung.proben)} Proben in 2,5 s (erwartet >${String(GENUG_PROBEN)}) — das Fenster hatte keinen Fokus, ` +
        `Chromium drosselt dann die Timer. Die Messung ist ungueltig, nicht bestanden.`
      : !sichtbar
      ? `kein loader-Symbol in ${String(messung.proben)} Proben — ${await klartext(cdp)}`
      : `${String(messung.mitSymbol)}/${String(messung.proben)} Proben mit Symbol, davon ${String(messung.imKopf)} in der Kopfzeile / ` +
        `${String(messung.inZeile)} in der Kontozeile, höchstens eines gleichzeitig: ${String(messung.hoechstensEines)}, ` +
        `animation-name: ${messung.animationen.join(",") || "(keine)"}`,
  );

  // Gegenstelle schließen: der hängende Lauf bekommt seinen Abbruch und endet sofort,
  // statt den Busy-Guard bis zur 30-s-Frist zu blockieren.
  schliessen();
  await laufBeendet(cdp, 35_000);
  await evaluieren(cdp, `delete window.__smokeProben; delete window.__smokeTakt; return true;`);
}

/**
 * Aktiver Tab im Einstellungs-**Fenster** (Obsidian ab 1.13).
 *
 * Der Fenstertitel ist lokalisiert und taugt nicht zur Auswahl — die Brücke unterscheidet
 * die Art deshalb an `window.app`. Gelesen wird das DOM des Fensters, nicht `app.setting`.
 */
async function aktiverEinstellungsTab(): Promise<string | null> {
  // Das Fenster wird durch den Klick neu erzeugt und steht nicht sofort in `/json/list` —
  // ein einzelner Blick ist ein Rennen, kein Prüfpunkt.
  let fenster = null;
  const frist = Date.now() + 12_000;
  while (fenster === null && Date.now() < frist) {
    fenster = await attachTo("settings", PORT, VAULT).catch(() => null);
    if (fenster === null) await warte(700);
  }
  if (!fenster) return null;
  try {
    return await fenster.evaluate<string | null>(
      `const aktiv = document.querySelector(".vertical-tab-nav-item.is-active");
       return aktiv ? aktiv.textContent : null;`,
    );
  } finally {
    fenster.close();
  }
}

async function v9_einstellungenOeffnenTrifftDenEigenenTab(cdp: Cdp): Promise<void> {
  // Der CTA erscheint nur ohne Konto — das ist zugleich der Empty-State-Prüfpunkt.
  await evaluieren(
    cdp,
    `const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
     p.settings.accounts = []; await p.saveSettings(); return true;`,
  );
  await neuLaden(cdp, "v9");
  await cockpitOeffnen(cdp);

  // Einstieg ueber einen PLUGIN-EIGENEN Anker. Der naheliegende Weg — „der erste Knopf in
  // der Ansicht, der nicht `sync-all` ist" — traf Obsidians eigenen `view-action`-Knopf im
  // Kopf der Leaf: der Klick ging ins Leere, und der Punkt meldete einen Plugin-Defekt.
  const ctaAusdruck = `document.querySelector(".mailstone-cockpit-empty button")`;
  const ctaDa = await evaluieren<boolean>(cdp, `return !!${ctaAusdruck};`);
  if (!ctaDa) {
    pruefe("V9 Empty-State-CTA öffnet den eigenen Einstellungs-Tab", false, `kein CTA im leeren Cockpit — ${await klartext(cdp)}`);
    return;
  }

  // Vorbelegung: einen FREMDEN Tab aktiv machen. Ohne sie wäre der Punkt auch dann grün,
  // wenn der CTA die Einstellungen bloß öffnet und der eigene Tab zufällig oben steht.
  await evaluieren(cdp, `app.setting.open(); app.setting.openTabById("appearance"); return true;`);
  await warte(1500);
  await evaluieren(cdp, `app.setting.close(); return true;`);
  await warte(800);

  await clickReal(cdp, ctaAusdruck, 150);
  await warte(2000);

  // Ab Obsidian 1.13 sind die Einstellungen ein eigenes FENSTER. `app.setting.activeTab`
  // im Workspace-Renderer ist dort `null` — der Punkt las damit nicht den Tab, sondern die
  // Abwesenheit des Modals, und war rot bei intaktem Prüfling.
  const aktiv = await aktiverEinstellungsTab();
  // Verglichen wird der Anzeigename des Tabs (das Fenster-DOM führt keine Id). Er ist
  // lokalisiert, der Plugin-Name aber nicht — „Mailstone" steht in jeder Sprache dort.
  const eigener = aktiv !== null && /mailstone/i.test(aktiv);
  pruefe(
    "V9 Empty-State-CTA öffnet den eigenen Einstellungs-Tab",
    eigener,
    aktiv === null
      ? "kein Einstellungs-Fenster gefunden — öffnete der CTA die Einstellungen überhaupt?"
      : `aktiver Tab: „${aktiv}“${/darstellung|appearance/i.test(aktiv) ? " — der CTA hat den Tab nicht gewechselt" : ""}`,
  );
  await evaluieren(cdp, `app.setting.close(); return true;`).catch(() => undefined);
}

// ── Posteingang (Hub-Tabs: Cockpit / Inbox) ────────────────────────────────────────────
//
// Diese drei Punkte pruefen Verdrahtung wie die zehn davor — nicht Postfach-Logik (dafuer
// `tests/integration/` gegen den erweiterten Fake-IMAP). Sie brauchen keine IMAP-Gegenstelle:
// das Panel zeigt seinen Inhalt erst nach einem Refresh-Klick, den kein Punkt hier ausloest,
// darum ist die Inbox in jedem frischen View-Zustand "leer" — genau der Zustand, den V12
// belegen soll.

/** Klickt einen Hub-Tab per `data-tab` und meldet, ob der Button ueberhaupt im DOM stand. */
async function tabKlicken(cdp: Cdp, tabId: string): Promise<boolean> {
  const ausdruck = `document.querySelector('.okit-hub-tab[data-tab="${tabId}"]')`;
  const da = await evaluieren<boolean>(cdp, `return !!${ausdruck};`);
  if (!da) return false;
  // Echter Mausklick wie beim Ribbon — ein synthetischer Klick liefe an denselben
  // Host-Pfaden vorbei (s. `ribbonKlicken`).
  await clickReal(cdp, ausdruck, 150);
  return true;
}

async function v11_inboxTabOeffnetInhalt(cdp: Cdp): Promise<void> {
  await cockpitOeffnen(cdp);
  if (!(await tabKlicken(cdp, "inbox"))) {
    pruefe("V11 Inbox-Tab existiert, ist klickbar und zeigt seinen Inhalt", false, "Inbox-Tab nicht im DOM");
    return;
  }
  await warte(600);
  const messung = await evaluieren<{
    inboxDa: boolean;
    inboxVersteckt: boolean;
    inboxSichtbar: boolean;
    cockpitDa: boolean;
    cockpitVersteckt: boolean;
  }>(
    cdp,
    `const inbox = document.querySelector('.okit-hub-panel[data-tab="inbox"]');
     const cockpit = document.querySelector('.okit-hub-panel[data-tab="cockpit"]');
     const r = inbox ? inbox.getBoundingClientRect() : null;
     return {
       inboxDa: !!inbox,
       inboxVersteckt: !!inbox && inbox.classList.contains("is-hidden"),
       inboxSichtbar: !!r && r.width > 0 && r.height > 0,
       cockpitDa: !!cockpit,
       cockpitVersteckt: !!cockpit && cockpit.classList.contains("is-hidden"),
     };`,
  );
  pruefe(
    "V11 Inbox-Tab existiert, ist klickbar und zeigt seinen Inhalt",
    messung.inboxDa && !messung.inboxVersteckt && messung.inboxSichtbar && messung.cockpitDa && messung.cockpitVersteckt,
    `Inbox da: ${String(messung.inboxDa)}, versteckt: ${String(messung.inboxVersteckt)}, sichtbar: ${String(messung.inboxSichtbar)} — ` +
      `Cockpit da: ${String(messung.cockpitDa)}, versteckt: ${String(messung.cockpitVersteckt)}`,
  );
}

async function v12_leererOrdnerZeigtEmptyState(cdp: Cdp): Promise<void> {
  // Konten explizit leeren statt sich auf "noch nie geladen" zu verlassen — so bleibt der
  // Punkt unabhaengig davon, ob ein frueherer Lauf schon einmal "Aktualisieren" geklickt hat.
  await evaluieren(
    cdp,
    `const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
     p.settings.accounts = []; await p.saveSettings(); return true;`,
  );
  await warte(400);
  if (!(await tabKlicken(cdp, "inbox"))) {
    pruefe("V12 leerer Ordner zeigt Empty-State mit Handlungsangebot", false, "Inbox-Tab nicht im DOM");
    return;
  }
  await warte(600);
  const messung = await evaluieren<{ emptyDa: boolean; ctaDa: boolean; ctaSichtbar: boolean }>(
    cdp,
    `const leer = document.querySelector(".mailstone-inbox-empty");
     const cta = leer ? leer.querySelector("button") : null;
     const r = cta ? cta.getBoundingClientRect() : null;
     return { emptyDa: !!leer, ctaDa: !!cta, ctaSichtbar: !!r && r.width > 0 && r.height > 0 };`,
  );
  pruefe(
    "V12 leerer Ordner zeigt Empty-State mit Handlungsangebot",
    messung.emptyDa && messung.ctaDa && messung.ctaSichtbar,
    `Empty-State da: ${String(messung.emptyDa)}, CTA da: ${String(messung.ctaDa)}, CTA sichtbar: ${String(messung.ctaSichtbar)} — ${await klartext(cdp)}`,
  );
}

/**
 * Belegt das „mount-once"-Muster (hub.ts): der Panel-Div wird einmal gebaut und beim
 * Tab-Wechsel nur per `is-hidden` umgeblendet, nie neu erzeugt. Eine selbst gesetzte Marke
 * am DOM-Element ist der Beleg — ueberlebt sie den Hin-und-zurueck-Wechsel nicht, wurde das
 * Element zwischendurch ausgetauscht (Panel-Zustand ginge dann bei jedem Tab-Wechsel verloren:
 * Scrollposition, laufende Aktionen, alles).
 */
async function v13_tabWahlUeberlebtWechsel(cdp: Cdp): Promise<void> {
  const NAME = "V13 Tab-Wahl übersteht Wechsel hin und zurück (mount-once)";
  if (!(await tabKlicken(cdp, "inbox"))) {
    pruefe(NAME, false, "Inbox-Tab nicht im DOM");
    return;
  }
  await warte(400);
  const marke = `smoke-${String(Date.now())}`;
  const gesetzt = await evaluieren<boolean>(
    cdp,
    `const inbox = document.querySelector('.okit-hub-panel[data-tab="inbox"]');
     if (!inbox) return false;
     inbox.dataset.smokeMarke = ${JSON.stringify(marke)};
     return true;`,
  );
  if (!gesetzt) {
    pruefe(NAME, false, "Inbox-Panel-Div nicht im DOM, Marke nicht gesetzt");
    return;
  }
  if (!(await tabKlicken(cdp, "cockpit"))) {
    pruefe(NAME, false, "Cockpit-Tab nicht im DOM (Ruecksprung nicht moeglich)");
    return;
  }
  await warte(400);
  if (!(await tabKlicken(cdp, "inbox"))) {
    pruefe(NAME, false, "Inbox-Tab beim Rueckwechsel nicht im DOM");
    return;
  }
  await warte(400);
  const messung = await evaluieren<{ markeDa: boolean; versteckt: boolean; sichtbar: boolean }>(
    cdp,
    `const inbox = document.querySelector('.okit-hub-panel[data-tab="inbox"]');
     const r = inbox ? inbox.getBoundingClientRect() : null;
     return {
       markeDa: !!inbox && inbox.dataset.smokeMarke === ${JSON.stringify(marke)},
       versteckt: !!inbox && inbox.classList.contains("is-hidden"),
       sichtbar: !!r && r.width > 0 && r.height > 0,
     };`,
  );
  pruefe(
    NAME,
    messung.markeDa && !messung.versteckt && messung.sichtbar,
    `Marke nach Hin-und-zurueck noch da: ${String(messung.markeDa)} (dasselbe DOM-Element = kein Neubau), ` +
      `versteckt: ${String(messung.versteckt)}, sichtbar: ${String(messung.sichtbar)}`,
  );
}

// ── Lauf ────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cdp = await attachTo("workspace", PORT, VAULT);
  if (!cdp) {
    throw new Error(
      `Kein Obsidian-Fenster für Vault „${VAULT}“ auf Port ${String(PORT)}. ` +
        `Läuft Obsidian mit --remote-debugging-port? Fehlt nur der Vault: open "obsidian://open?vault=${VAULT}"`,
    );
  }

  const konfigVerzeichnis = await evaluieren<string>(cdp, `return app.vault.configDir;`);
  const vaultPfad = await evaluieren<string>(cdp, `return app.vault.adapter.basePath;`);
  const datenDatei = join(vaultPfad, konfigVerzeichnis, "plugins", PLUGIN_ID, "data.json");
  const rettung = `${datenDatei}.smoke-rettung`;

  // Vorwerte AUSSERHALB des try: das `finally` muss sie auch nach einem Abbruch sehen.
  let originalRoh: string | null = null;
  let server: { port: number; schliessen: () => void } | null = null;

  if (existsSync(datenDatei)) {
    originalRoh = readFileSync(datenDatei, "utf8");
    // Rettungskopie neben die Datei: das `finally` läuft bei Ctrl-C oder einem Absturz des
    // Node-Prozesses nicht mehr, und was dann im Vault steht, ist eine Testfixtur.
    copyFileSync(datenDatei, rettung);
  }

  try {
    // Ohne Fokus drosselt Chromium die Timer dieses Fensters auf etwa einen Tick pro
    // Sekunde und rendert verzoegert: die Abtastung in V10 verliert dann 95 % ihrer Proben
    // und Groessen werden mitten in der Sidebar-Animation abgelesen. Beide Male bleibt der
    // Punkt gruen und misst das Falsche.
    await requireVisible(cdp);
    // Obsidian haelt `main.js` im Speicher: ein frisches `npm run deploy` wirkt erst nach
    // einem Plugin-Neuladen. Ohne das misst der erste Pruefpunkt den Stand von vorhin —
    // in der ersten Gegenprobe blieb V10 genau deshalb gruen, obwohl der geprueft Fix
    // ausgebaut war. Der Neustart weiter unten kaeme zu spaet.
    await evaluieren(
      cdp,
      `await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
       await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
       return true;`,
    );
    await warte(1500);
    const version = await deployteVersion(cdp, vaultPfad, konfigVerzeichnis);
    console.log(`Vault: ${VAULT} · deployte Version: ${version}\n`);

    console.log("── Registrierung (ohne Neustart messbar)");
    await v4_genauEinViewType(cdp);
    await v8_kommandoname(cdp);
    console.log("");

    console.log("── Lauf-Anzeige (Gegenstelle: Schweige-Server)");
    server = await schweigeServer();
    await v10_laufAnzeige(cdp, server.port, server.schliessen);
    server = null;
    console.log("");

    console.log("── Läufe und Register (Gegenstelle: toter Port)");
    await testkontoSetzen(cdp, TOTER_PORT);
    await v3_ribbonOeffnetNurUndPaletteLaeuft(cdp);
    await v2_knopfPosition(cdp);
    await v6_registerUeberlebtNeustart(cdp, datenDatei);
    console.log("");

    console.log("── Sichtbarkeit und Startup-Gate (mit Neustarts)");
    await v1_sichtbarBeimErstoeffnen(cdp);
    await v5b_startupGateAn(cdp);
    console.log("");

    console.log("── Defensive Pfade");
    await v7_kaputtesRegisterKipptDenStartNicht(cdp, datenDatei);
    await v9_einstellungenOeffnenTrifftDenEigenenTab(cdp);
    console.log("");

    console.log("── Posteingang (Hub-Tabs)");
    await v11_inboxTabOeffnetInhalt(cdp);
    await v12_leererOrdnerZeigtEmptyState(cdp);
    await v13_tabWahlUeberlebtWechsel(cdp);
    console.log("");
  } finally {
    // Aufräumen darf nie am Ergebnis hängen: auch ein abgebrochener Lauf gibt den Vault so
    // zurück, wie er ihn vorgefunden hat.
    server?.schliessen();
    await releaseAlwaysOnTop(cdp).catch(() => undefined);
    await evaluieren(
      cdp,
      `app.secretStorage.setSecret(${JSON.stringify("mailstone-" + SMOKE_ACCOUNT_ID)}, ""); return true;`,
    ).catch(() => undefined);
    if (originalRoh !== null && !KEEP) {
      // Reihenfolge zaehlt: das Plugin schreibt seinen Speicherstand beim Entladen zurueck.
      // Wer die Datei zuerst herstellt und dann neu laedt, laesst genau diesen Schreibvorgang
      // hinterher drueberlaufen — der Vergleich sah trotzdem "byte-gleich", weil er zu frueh
      // mass. Gemessene Folge: ein absichtlich kaputt gesetztes Register (V7) blieb im Vault.
      // Deshalb erst abschalten, dann herstellen, dann wieder einschalten.
      await evaluieren(cdp, `await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)}); return true;`).catch(
        () => undefined,
      );
      await warte(1000);
      writeFileSync(datenDatei, originalRoh);
      await evaluieren(cdp, `await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)}); return true;`).catch(
        () => undefined,
      );
      await warte(2000);
      // Am Ergebnis messen, nicht am Objekt im Speicher — und das Ergebnis ins Protokoll.
      const zurueck = readFileSync(datenDatei, "utf8");
      console.log(
        zurueck === originalRoh
          ? "data.json zurückgeschrieben: byte-gleich"
          : "data.json zurückgeschrieben: ABWEICHUNG — Rettungskopie bleibt liegen",
      );
      if (zurueck === originalRoh && existsSync(rettung)) rmSync(rettung);
    } else if (KEEP) {
      console.log(`--keep: data.json bleibt verändert, Rettungskopie liegt unter ${rettung}`);
    }
    cdp.close();
  }

  const rot = ergebnisse.filter((e) => !e.ok);
  console.log(`${String(ergebnisse.length - rot.length)}/${String(ergebnisse.length)} grün`);
  if (rot.length > 0) {
    console.log("Rot:");
    for (const e of rot) console.log(`  - ${e.name}: ${e.detail}`);
    process.exitCode = 1;
  }
}

/**
 * Version aus der **deployten** Datei, nicht aus `plugin.manifest`.
 *
 * Obsidian liest die Manifeste beim App-Start; `enablePlugin` lädt danach zwar `main.js` neu,
 * aber nicht diese Angabe. `plugin.manifest.version` ist damit der Stand vom Start — eine
 * Zahl, die genau dann irreführt, wenn man ihr glaubt (json_viewer, 2026-08-22).
 */
async function deployteVersion(cdp: Cdp, _vaultPfad: string, konfigVerzeichnis: string): Promise<string> {
  return evaluieren<string>(
    cdp,
    `try {
       const roh = await app.vault.adapter.read(${JSON.stringify(konfigVerzeichnis)} + "/plugins/${PLUGIN_ID}/manifest.json");
       return JSON.parse(roh).version ?? "(ohne Version)";
     } catch { return "(manifest.json nicht lesbar)"; }`,
  );
}

main().catch((error: unknown) => {
  console.error(`\nAbbruch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
