/**
 * GUI-Smoke-Treiber — fährt die Verdrahtungs-Prüfpunkte aus `docs/SMOKE.md`
 * (§ „Verdrahtungs-Handprobe (Bestand seit M4/M5: …)“ — NICHT die weiter unten stehenden
 * „M5 Task 8“/„M5 Task 9“, das sind die TaskNotes-Abschnitte) gegen ein **laufendes**
 * Obsidian statt von Hand.
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
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { attachTo, clickReal, pollUntil, releaseAlwaysOnTop, requireVisible, type Cdp } from "../../tools/obsidian-cdp/cdp.js";
import { requireEigenerBuild } from "../../tools/obsidian-cdp/vault.js";

// `import.meta.url` zeigt nach dem esbuild-Buendeln auf `.gui-smoke.mjs` im Repo-Root
// (esbuild schreibt `outfile` ohne Pfadpraefix dorthin, s. package.json), NICHT auf
// `scripts/` — HERE ist deshalb schon die Repo-Wurzel (Muster: calendar-notes/scripts/
// gui-smoke.ts).
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));

const PLUGIN_ID = "mailstone";
const VIEW_TYPE = "mailstone-cockpit";
/** Konto-Id des Testkontos. Distinkt genug, dass ein Rest im Vault als Testrest erkennbar ist. */
const SMOKE_ACCOUNT_ID = "gui-smoke-testkonto";
/** Fremder Plugin-Slot, den `readTaskNotesApi` abtastet (`src/obsidian/tasknotes-bridge.ts`).
 *  Ein Stub genuegt: die Bruecke prueft nur `apiVersion`, `tasks.create` und `model.config`
 *  (typeof-Pruefung, kein `hasCapability`) — ein echtes TaskNotes braucht dieser Treiber nicht. */
const TASKNOTES_PLUGIN_ID = "tasknotes";
/** Pfad der Mail-Notiz, die T-A..T-D fuer `checkCallback`/`probeFor` brauchen (Spec § 3: das
 *  Kommando gilt fuer jede Notiz mit gesetztem `mail_id`-Feld). */
const TASKNOTES_NOTIZ_PFAD = "gui-smoke-tasknotes-notiz.md";

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

/** V9b · Hilfe-Zeile (UI-STANDARD §8): die ERSTE Zeile des Einstellungs-Tabs traegt einen Text-Knopf
 *  und den Icon-Knopf (`bug`, Tooltip als Name). Gemessen wird Position und Bedienung, nicht der
 *  Wortlaut — sprachfrei, damit der Punkt in einer EN- und einer DE-Instanz laeuft. */
async function v9b_hilfeZeile(cdp: Cdp): Promise<void> {
  const name = "V9b Die Hilfe-Zeile steht als erste Zeile im Tab, mit Text-Knopf und Icon-Knopf";
  await evaluieren(cdp, `app.setting.open(); app.setting.openTabById(${JSON.stringify(PLUGIN_ID)}); return true;`);
  await warte(1800);
  let fenster = null;
  const frist = Date.now() + 12_000;
  while (fenster === null && Date.now() < frist) {
    fenster = await attachTo("settings", PORT, VAULT).catch(() => null);
    if (fenster === null) await warte(700);
  }
  if (!fenster) {
    pruefe(name, false, "kein Einstellungs-Fenster gefunden");
    return;
  }
  try {
    const hilfe = await fenster.evaluate<{ name: string; knoepfe: number; icon: string | null } | null>(
      `const erste = document.querySelector(".setting-item");
       if (!erste) return null;
       return {
         name: erste.querySelector(".setting-item-name")?.textContent?.trim() ?? "",
         knoepfe: erste.querySelectorAll("button").length,
         icon: erste.querySelector(".extra-setting-button")?.getAttribute("aria-label") ?? null,
       };`,
    );
    pruefe(
      name,
      hilfe !== null && hilfe.name !== "" && hilfe.knoepfe === 1 && !!hilfe.icon,
      hilfe ? `erste Zeile „${hilfe.name}“ · Text-Knöpfe ${hilfe.knoepfe} · Icon „${hilfe.icon ?? "keiner"}“` : "kein Settings-DOM",
    );
  } finally {
    fenster.close();
    await evaluieren(cdp, `app.setting.close(); return true;`).catch(() => undefined);
  }
}

// ── Posteingang (Hub-Tabs: Cockpit / Inbox) ────────────────────────────────────────────
//
// Diese drei Punkte pruefen Verdrahtung wie die zehn davor — nicht Postfach-Logik (dafuer
// `tests/integration/` gegen den erweiterten Fake-IMAP).
//
// Seit dem Nachlade-Fix (I2, Abschluss-Review) laedt der Tab sich beim ERSTEN
// Sichtbarwerden von selbst — ist zu diesem Zeitpunkt das Testkonto mit dem toten Port
// (TOTER_PORT) gesetzt, versucht `laden()` tatsaechlich eine Verbindung dorthin (die sofort
// mit ECONNREFUSED scheitert, also schnell bleibt) und die Inbox landet in "fehler", nicht
// in "leer". V12 verlaesst sich deshalb NICHT mehr auf einen impliziten "frischen"
// View-Zustand, sondern leert `settings.accounts` und klickt danach explizit
// "Aktualisieren" — der Knopf loest immer neu, unabhaengig vom Once-Gate des ersten Ladens.

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
  // Seit dem Nachlade-Fix (I2) laedt der Tab sich selbst beim ERSTEN Sichtbarwerden — hier
  // ist er das schon durch V11, das zuvor mit dem toten Testkonto gegen den Tab klickte und
  // dabei einen Fehlerzustand hinterliess. `setTab` auf einen bereits aktiven Tab ist ein
  // No-Op (hub.ts), ein zweiter `tabKlicken`-Aufruf loest also KEIN erneutes `onShow` aus.
  // Der "Aktualisieren"-Knopf tut das immer, unabhaengig vom Once-Gate — deshalb hier explizit
  // geklickt, statt sich auf einen impliziten Tab-Wechsel zu verlassen.
  await clickReal(cdp, `document.querySelector(".mailstone-inbox-refresh")`, 150);
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

// ── TaskNotes-Kopplung (M5) ────────────────────────────────────────────────────────────
//
// Fuenf Pruefpunkte, alle mit einem STUB statt eines echten TaskNotes (Task-8-Brief): die
// Bruecke (`src/obsidian/tasknotes-bridge.ts`) prueft nur `apiVersion`/`tasks.create`/
// `model.config` per typeof — ein Objekt an genau dieser Stelle im Plugin-Register genuegt.
// `app.plugins.plugins` ist ein PLAIN OBJECT (kein Klassensystem), ein Eintrag darin laesst
// sich also ohne echtes Fremd-Plugin setzen und wieder entfernen.
//
// ⚠️ Ein Abbruch (Ctrl-C) INNERHALB dieses Abschnitts laesst den Slot mit dem STUB stehen,
// statt die echte Registrierung wiederherzustellen — `taskNotesOriginalWiederherstellen()`
// (unten) laeuft nur im `finally` von `main()`, das ein SIGINT nicht erreicht. Das heilt sich
// von selbst (ein Plugin-Reload im Staging-Vault, oder der naechste Lauf: `TASKNOTES_SICHERN`
// greift beim ersten Zugriff und die Einmal-Sicherung im Speicher ist ohnehin futsch —
// `window.__smokeTaskNotesOriginal` lebt nur im Renderer-Prozess und ueberlebt einen Reload
// nicht, das naechste Mal sichert also wieder das echte Original), kostet bis dahin aber eine
// andere Session ihre TaskNotes-Registrierung. Einen SIGINT/SIGTERM-Handler bewusst NICHT hier
// gebaut — dieselbe Luecke besteht in `scripts/e2e-crossplugin.ts` und gehoert in einen eigenen
// Vorgang ueber beide Treiber, nicht in eine Ad-hoc-Reparatur an einem.

const TASKNOTES_SLOT = JSON.stringify(TASKNOTES_PLUGIN_ID);

/** Sichert den Vorzustand des Slots EINMAL, vor dem allerersten Zugriff dieses Abschnitts —
 *  gleich ob der erste Aufruf `an` oder `aus` setzt. Der Wert kann legitim `undefined` sein
 *  ("nichts installiert" ist ein gueltiger Vorzustand, kein "noch nicht gesichert"), deshalb
 *  ein eigener Waechter statt eines Vergleichs gegen `undefined`. */
const TASKNOTES_SICHERN = `if (!window.__smokeTaskNotesCaptured) {
     window.__smokeTaskNotesCaptured = true;
     window.__smokeTaskNotesOriginal = app.plugins.plugins[${TASKNOTES_SLOT}];
   }`;

/** Installiert den Stub bzw. macht den Slot fuer die Dauer einer Messung LEER — fuer die
 *  "ohne TaskNotes"-Haelfte von T-A/T-E.
 *
 *  Fix-Runde 1, Critical, ZWEITER Anlauf: die erste Reparatur sicherte den Vorzustand korrekt,
 *  behandelte `an: false` aber als "auf den Vorzustand zuruecksetzen" — und genau DAS bricht,
 *  sobald ein SPAETERER Task (T9) ein echtes, aktiviertes TaskNotes im selben Staging-Vault
 *  installiert: T-A rief `taskNotesStubSetzen(cdp, false)`, "zuruecksetzen" schrieb das echte
 *  Plugin unveraendert zurueck (es stand ja schon da), und `checkCallback(true)` sah folgerichtig
 *  weiter TaskNotes — T-A wurde rot, obwohl der Pruefling intakt war. Gemessen an genau dieser
 *  Konstellation (echtes TaskNotes 4.x jetzt im Vault `mailstone` installiert, `enabled: true`).
 *  „ohne TaskNotes" muss den Slot fuer die Dauer der Messung tatsaechlich LEEREN, unabhaengig
 *  davon, was vorher dort stand — der Vorzustand kommt erst am ENDE des ganzen Abschnitts
 *  zurueck, ueber `taskNotesOriginalWiederherstellen()`, nicht bei jedem einzelnen Toggle. */
async function taskNotesStubSetzen(cdp: Cdp, an: boolean): Promise<void> {
  await evaluieren(
    cdp,
    an
      ? `${TASKNOTES_SICHERN}
         window.__smokeTaskCreateCalls = [];
         app.plugins.plugins[${TASKNOTES_SLOT}] = {
           api: {
             apiVersion: 1,
             tasks: { create: (data) => { window.__smokeTaskCreateCalls.push(data); return Promise.resolve({ path: "Tasks/gui-smoke.md" }); } },
             model: { config: () => ({ defaults: { status: "open", priority: "normal", taskTag: "task" }, fieldMapping: {} }) },
           },
         };
         return true;`
      : `${TASKNOTES_SICHERN}
         delete app.plugins.plugins[${TASKNOTES_SLOT}];
         delete window.__smokeTaskCreateCalls;
         return true;`,
  );
}

/**
 * Einziger Ort, der den VORZUSTAND zurueckschreibt — genau einmal, am Ende des ganzen
 * TaskNotes-Abschnitts (`main()`s `finally`), nie zwischen zwei Prüfpunkten.
 *
 * Identitaetsvergleich (`===`), kein Struktur-/Feldvergleich: ein Stub kann strukturell wie
 * das Original aussehen (beide tragen `apiVersion`/`tasks.create`/`model.config`), und "welches
 * Objekt ist meins" darf deshalb nicht GERATEN werden — an einer Eigenschaft des Stubs, an der
 * Reihenfolge, oder daran, dass gerade eben etwas gesetzt wurde (der Fehler, der die erste
 * Reparatur von `local-image-generator`s Notice-Bug ueberlebt hat, 2026-09-02). Hier gibt es
 * nichts zu erraten: `window.__smokeTaskNotesOriginal` ist die tatsaechliche Referenz aus dem
 * einmaligen Sicherungs-Zugriff, keine Ableitung. `wiederhergestellt` ist deshalb ein echter
 * Beleg (Referenzgleichheit im selben Realm), keine Vermutung.
 */
async function taskNotesOriginalWiederherstellen(cdp: Cdp): Promise<{ beruehrt: boolean; wiederhergestellt: boolean }> {
  return evaluieren<{ beruehrt: boolean; wiederhergestellt: boolean }>(
    cdp,
    `if (!window.__smokeTaskNotesCaptured) return { beruehrt: false, wiederhergestellt: true };
     const original = window.__smokeTaskNotesOriginal;
     if (original === undefined) { delete app.plugins.plugins[${TASKNOTES_SLOT}]; }
     else { app.plugins.plugins[${TASKNOTES_SLOT}] = original; }
     const jetzt = app.plugins.plugins[${TASKNOTES_SLOT}];
     const wiederhergestellt = original === undefined ? jetzt === undefined : jetzt === original;
     delete window.__smokeTaskCreateCalls;
     delete window.__smokeTaskNotesCaptured;
     delete window.__smokeTaskNotesOriginal;
     return { beruehrt: true, wiederhergestellt };`,
  );
}

/** Legt die Mail-Notiz an, die `probeFor`/`checkCallback` fuer `mail.createTask` braucht
 *  (Spec § 3: jede Notiz mit `mail_id` gilt), und macht sie zur aktiven Datei — `checkCallback`
 *  liest `app.workspace.getActiveFile()` synchron. */
async function taskNotesNotizAnlegenUndOeffnen(cdp: Cdp): Promise<void> {
  await evaluieren(
    cdp,
    `const inhalt = "---\\nmail_id: gui-smoke-tasknotes-mail\\n---\\n\\nGUI-Smoke-Notiz fuer die TaskNotes-Kopplung.\\n";
     const bestehend = app.vault.getAbstractFileByPath(${JSON.stringify(TASKNOTES_NOTIZ_PFAD)});
     if (bestehend) await app.vault.delete(bestehend);
     const datei = await app.vault.create(${JSON.stringify(TASKNOTES_NOTIZ_PFAD)}, inhalt);
     await app.workspace.getLeaf(true).openFile(datei);
     return true;`,
  );
  // metadataCache aktualisiert das Frontmatter asynchron — probeFor() liest es aus dem Cache,
  // nicht aus der Datei selbst. Ohne die Wartezeit sah der allererste Pruefpunkt eine leere
  // Frontmatter-Zone und "kein Kommando" haette hier den falschen Grund gehabt.
  await warte(500);
}

async function taskNotesNotizAufraeumen(cdp: Cdp): Promise<void> {
  await evaluieren(
    cdp,
    `const datei = app.vault.getAbstractFileByPath(${JSON.stringify(TASKNOTES_NOTIZ_PFAD)});
     if (datei) await app.vault.delete(datei);
     return true;`,
  ).catch(() => undefined);
}

/** Was die Befehlspalette fuer dieses Kommando tatsaechlich zeigen wuerde — dieselbe Funktion,
 *  die Obsidian selbst vor dem Rendern jedes Eintrags aufruft (`checking: true`). */
async function createTaskCheckCallback(cdp: Cdp): Promise<boolean | null> {
  return evaluieren<boolean | null>(
    cdp,
    `const cmd = app.commands.commands[${JSON.stringify(PLUGIN_ID + ":mail-createTask")}];
     return cmd && typeof cmd.checkCallback === "function" ? cmd.checkCallback(true) : null;`,
  );
}

async function ta_kommandoFehltOhneTaskNotes(cdp: Cdp): Promise<void> {
  await taskNotesStubSetzen(cdp, false);
  const sichtbar = await createTaskCheckCallback(cdp);
  pruefe(
    "T-A mail.createTask fehlt ohne TaskNotes",
    sichtbar === false,
    sichtbar === null ? "Kommando nicht registriert" : `checkCallback(true) lieferte ${String(sichtbar)}`,
  );
}

async function tb_kommandoErscheintMitStub(cdp: Cdp): Promise<void> {
  await taskNotesStubSetzen(cdp, true);
  const sichtbar = await createTaskCheckCallback(cdp);
  pruefe(
    "T-B mail.createTask erscheint mit TaskNotes-Stub",
    sichtbar === true,
    sichtbar === null ? "Kommando nicht registriert" : `checkCallback(true) lieferte ${String(sichtbar)}`,
  );
}

/** Sucht einen Setting-Item im obersten Modal ueber seinen Namen — `SchemaFormModal` uebergibt
 *  den Schluessel (`title`/`due`) unuebersetzt an `setName()` (schema-form-modal.ts). */
function settingControlAusdruck(feld: string): string {
  return `[...document.querySelectorAll(".modal .setting-item")]
            .find(el => el.querySelector(".setting-item-name")?.textContent === ${JSON.stringify(feld)})
            ?.querySelector(".setting-item-control")`;
}

async function tc_modalZeigtTitelUndFaelligkeit(cdp: Cdp): Promise<void> {
  await evaluieren(cdp, `app.commands.executeCommandById(${JSON.stringify(PLUGIN_ID + ":mail-createTask")}); return true;`);
  await warte(800);
  const messung = await evaluieren<{ modalDa: boolean; titelDa: boolean; faelligkeitDa: boolean; typDatum: boolean }>(
    cdp,
    `const modalDa = !!document.querySelector(".modal");
     const titel = ${settingControlAusdruck("title")};
     const faelligkeit = ${settingControlAusdruck("due")};
     const dateInput = faelligkeit ? faelligkeit.querySelector("input[type=date]") : null;
     return {
       modalDa,
       titelDa: !!titel && !!titel.querySelector("input"),
       faelligkeitDa: !!faelligkeit,
       typDatum: !!dateInput,
     };`,
  );
  pruefe(
    "T-C Modal zeigt Titel-Feld und Faelligkeit als Datumsfeld",
    messung.modalDa && messung.titelDa && messung.faelligkeitDa && messung.typDatum,
    !messung.modalDa
      ? `kein Modal offen — ${await klartext(cdp)}`
      : `Titel-Feld da: ${String(messung.titelDa)}, Faelligkeit-Feld da: ${String(messung.faelligkeitDa)}, ` +
        `als input[type=date]: ${String(messung.typDatum)}`,
  );
  // Das Modal bleibt fuer T-D offen — dort wird es ausgefuellt statt neu geoeffnet, sonst
  // pruefte T-D nur, dass IRGENDEIN Aufruf tasks.create trifft, nicht der aus dieser Eingabe.
}

async function td_bestaetigungRuftTasksCreate(cdp: Cdp): Promise<void> {
  const TITEL = "GUI-Smoke Aufgabe";
  const FAELLIGKEIT = "2026-12-31";
  const gefuellt = await evaluieren<boolean>(
    cdp,
    `const titelInput = (${settingControlAusdruck("title")})?.querySelector("input");
     const faelligkeitInput = (${settingControlAusdruck("due")})?.querySelector("input[type=date]");
     if (!titelInput || !faelligkeitInput) return false;
     const setzen = (el, wert) => {
       const proto = Object.getPrototypeOf(el);
       Object.getOwnPropertyDescriptor(proto, "value").set.call(el, wert);
       el.dispatchEvent(new Event("input", { bubbles: true }));
     };
     setzen(titelInput, ${JSON.stringify(TITEL)});
     setzen(faelligkeitInput, ${JSON.stringify(FAELLIGKEIT)});
     return true;`,
  );
  if (!gefuellt) {
    pruefe("T-D Bestaetigung ruft tasks.create am Stub", false, "Formularfelder nicht gefunden — T-C muss davor gelaufen sein");
    return;
  }
  await clickReal(cdp, `document.querySelector(".modal .modal-button-container .mod-cta")`, 150);
  await warte(800);
  const planModalDa = await evaluieren<boolean>(cdp, `return !!document.querySelector(".modal");`);
  if (!planModalDa) {
    pruefe("T-D Bestaetigung ruft tasks.create am Stub", false, `kein Vorschau-Modal nach dem Absenden — ${await klartext(cdp)}`);
    return;
  }
  await clickReal(cdp, `document.querySelector(".modal .modal-button-container .mod-cta")`, 150);
  await warte(800);
  const aufrufe = await evaluieren<{ title: string; due?: string; details?: string }[]>(
    cdp,
    `return window.__smokeTaskCreateCalls ?? [];`,
  );
  const treffer = aufrufe.find((a) => a.title === TITEL);
  // `details` traegt den Wikilink zurueck zur Mail-Notiz (tasknotes-bridge.ts: TaskNotes hat
  // kein eigenes Link-Feld) — ohne diese Zusicherung koennte der Rueckverweis verschwinden,
  // waehrend Titel und Faelligkeit unveraendert blieben, und T-D bliebe trotzdem gruen.
  const NOTIZ_NAME = TASKNOTES_NOTIZ_PFAD.replace(/\.md$/, "");
  pruefe(
    "T-D Bestaetigung ruft tasks.create am Stub",
    aufrufe.length === 1 && treffer !== undefined && treffer.due === FAELLIGKEIT && treffer.details === `[[${NOTIZ_NAME}]]`,
    aufrufe.length === 0
      ? `tasks.create wurde nicht gerufen — ${await klartext(cdp)}`
      : `${String(aufrufe.length)} Aufruf(e): ${JSON.stringify(aufrufe)}`,
  );
}

/** Baut eine feste Posteingangs-Zeile, unabhaengig vom echten IMAP-Weg (der fuer einen
 *  erfolgreichen Abruf TLS braucht, s. Kopfkommentar) — `host.viewModel` ist eine PLAIN-
 *  OBJECT-Eigenschaft (`createInboxHost`, `inbox-host.ts`), also ohne echtes Fremd-Plugin
 *  ersetzbar. `canCreateTask()` bleibt die ECHTE Funktion und liest bei jedem Render frisch,
 *  ob der TaskNotes-Stub da ist — nur die Zeile selbst ist erfunden.
 */
async function inboxFesteZeileEinsetzen(cdp: Cdp): Promise<boolean> {
  return evaluieren<boolean>(
    cdp,
    `const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view;
     const host = view?.inboxHost;
     if (!host) return false;
     window.__smokeInboxHostOriginal = window.__smokeInboxHostOriginal ?? host.viewModel;
     host.viewModel = () => ({
       state: "gefuellt",
       rows: [{ uid: 12345, mailId: "gui-smoke-inbox-mail", from: "GUI-Smoke", subject: "GUI-Smoke Testmail",
                date: new Date().toISOString(), imVault: false, ungelesen: false }],
       fehlerCode: null,
       aktionenGrund: null,
     });
     return true;`,
  );
}

async function inboxAktionsKnoepfeMessen(cdp: Cdp): Promise<number> {
  if (!(await tabKlicken(cdp, "inbox"))) return -1;
  await warte(300);
  await clickReal(cdp, `document.querySelector(".mailstone-inbox-refresh")`, 150);
  await warte(500);
  return evaluieren<number>(
    cdp,
    `return document.querySelectorAll(".mailstone-inbox-row .mailstone-inbox-actions .mailstone-inbox-action").length;`,
  );
}

async function inboxHostWiederherstellen(cdp: Cdp): Promise<void> {
  await evaluieren(
    cdp,
    `const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view;
     const host = view?.inboxHost;
     if (host && window.__smokeInboxHostOriginal) host.viewModel = window.__smokeInboxHostOriginal;
     delete window.__smokeInboxHostOriginal;
     return true;`,
  ).catch(() => undefined);
}

async function te_postfachKnopfNurMitTaskNotes(cdp: Cdp): Promise<void> {
  await cockpitOeffnen(cdp);
  if (!(await inboxFesteZeileEinsetzen(cdp))) {
    pruefe("T-E dritter Posteingangs-Knopf nur mit TaskNotes", false, "kein Inbox-Host im offenen Cockpit gefunden");
    return;
  }
  try {
    await taskNotesStubSetzen(cdp, false);
    const ohne = await inboxAktionsKnoepfeMessen(cdp);
    await taskNotesStubSetzen(cdp, true);
    const mit = await inboxAktionsKnoepfeMessen(cdp);
    pruefe(
      "T-E dritter Posteingangs-Knopf nur mit TaskNotes",
      ohne === 2 && mit === 3,
      ohne === -1 || mit === -1
        ? "Inbox-Tab nicht im DOM"
        : `Knoepfe ohne TaskNotes: ${String(ohne)}, mit TaskNotes: ${String(mit)} (erwartet 2 / 3)`,
    );
  } finally {
    await inboxHostWiederherstellen(cdp);
  }
}

// ── Lauf ────────────────────────────────────────────────────────────────────────────────

/** Die offene CDP-Verbindung, damit der Abbruchpfad sie schliessen kann.
 *
 *  Gemessen 2026-09-05: nach einem Abbruch NACH `attachTo` (hier: `requireEigenerBuild`
 *  wirft, weil im Vault ein anderer Build liegt) druckte der Treiber seine Meldung und lief
 *  DANACH ACHT MINUTEN weiter — 0 % CPU, wartend. Der offene Socket haelt Nodes Event-Loop am
 *  Leben; `process.exitCode` beendet nichts, es setzt nur den Code fuer ein Ende, das nie
 *  kommt. Sichtbar wird das erst, wenn jemand die Ausgabe pipet (dann steht sie bis zum Ende
 *  im Puffer und der Lauf sieht aus wie haengend) — im Terminal liest man die Meldung und
 *  haelt den Prozess fuer fertig, waehrend er den Debug-Port belegt.
 *
 *  Der Erfolgspfad schliesst im `finally` weiter unten; das hier deckt die Abbrueche davor. */
let offeneVerbindung: Cdp | null = null;

/**
 * Versand-Plugin-API (Task 6 der Versand-API-Runde).
 *
 * Der Aufruf aus dem RENDERER ist exakt der Weg eines fremden Plugins — Unit-Tests koennen
 * strukturell nicht zeigen, dass der Vertrag am echten Plugin-Objekt haengt und die
 * Renderer-Grenze JSON-tauglich uebersteht.
 *
 * ⚠️ Der erfolgreiche Versand wird hier bewusst NICHT gefahren: er verschickte echte Mail.
 * Geprueft werden Flaeche, `status()`, der `not-configured`-Pfad und der Modal-Pfad mit
 * Abbruch. Der Versand selbst ist durch die SendService-Tests aus M2 gedeckt (inkl. des
 * Echt-Versandtests gegen mailbox.org).
 *
 * Das Smoke-Testkonto traegt `identities: []` (s. testkontoSetzen) — ohne Identitaet liefert
 * `transportAccounts` eine leere Liste und die API meldet `not-configured`. V23 nutzt genau
 * das; V24 setzt fuer seinen Lauf eine Identitaet und nimmt sie danach zurueck.
 */
async function versandApiPruefen(cdp: Cdp): Promise<void> {
  // Zustandsfrei: haengt die API ueberhaupt am Plugin-Objekt?
  const flaeche = await evaluieren<string>(
    cdp,
    `const a = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.api;
     return a ? Object.keys(a).sort().join(",") : "keine api";`,
  );
  // Flaechen-Waechter: faellt jemand auf die Idee, das interne Objekt durchzureichen
  // (`this.api = this.facade`), faellt es genau hier auf.
  pruefe("V21 API haengt am Plugin, Flaeche genau apiVersion+send+status",
    flaeche === "apiVersion,send,status", `Flaeche: ${flaeche}`);

  // ── Vorzustand sichern ──────────────────────────────────────────────────────────────
  // ⚠️ Dieser Abschnitt stellt JEDEN Zustand selbst her, den er misst, statt sich auf einen
  // frueheren Pruefpunkt zu verlassen. Der erste Entwurf tat das Gegenteil: er suchte das
  // Smoke-Testkonto und setzte ihm eine Identitaet. Gemessen 2026-09-06 war zu diesem
  // Zeitpunkt ein ANDERES Konto aktiv, das `find` lief ins Leere, der ungeprueft
  // gebliebene Rueckgabewert verschwieg es — und V24 fiel aus einem Grund durch, der nichts
  // mit dem Prueflings-Verhalten zu tun hatte.
  // Gemessen 2026-09-06: zum Zeitpunkt dieses Abschnitts ist `settings.accounts` LEER — ein
  // frueherer Pruefpunkt raeumt sie ab. Deshalb bringt dieser Abschnitt sein eigenes Konto mit,
  // statt eines vorzufinden: er setzt die ganze Liste, misst, und stellt die vorherige Liste
  // exakt wieder her.
  const vorherigeKonten = await evaluieren<string>(
    cdp,
    `return JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.accounts);`,
  );
  const API_KONTO_ID = "gui-smoke-api-konto";

  try {
    // ── Ohne Identitaet: not-configured, und ZWINGEND kein Modal ────────────────────────
    const geleert = await evaluieren<boolean>(
      cdp,
      `const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
       p.settings.accounts = [{
         id: ${JSON.stringify(API_KONTO_ID)}, label: "GUI-Smoke API-Konto",
         imap: { host: "127.0.0.1", port: 1, tls: "implicit" },
         smtp: { host: "127.0.0.1", port: 1, tls: "implicit" },
         username: "api@example.invalid", secretId: "mailstone-" + ${JSON.stringify(API_KONTO_ID)},
         identities: [], defaultIdentityId: "",
         folders: { inbox: "INBOX", allowlist: "Vault", archive: "Archive", sent: "Sent" },
         sync: { enabled: false, intervalMin: 6000 },
       }];
       await p.saveSettings();
       return p.settings.accounts.length === 1 && p.settings.accounts[0].identities.length === 0;`,
    );
    if (!geleert) throw new Error("V22/V23: eigenes Konto ohne Identitaet liess sich nicht herstellen — Messung ungueltig");
    await warte(300);

    const status = await evaluieren<string>(
      cdp, `return JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].api.status());`);
    pruefe("V22 status() antwortet synchron und meldet not-configured ohne Identitaet",
      status.includes('"ready":false') && status.includes("not-configured"), status);

    // Den Nutzer zu fragen, was er nicht entscheiden kann, waere Klickweg ohne Ertrag.
    const modalsVor = await evaluieren<number>(cdp, `return document.querySelectorAll(".modal-container").length;`);
    const ohneKonto = await evaluieren<string>(
      cdp,
      `return JSON.stringify(await app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].api.send({
         callerId: "gui-smoke-fremd", to: ["probe@example.invalid"], subject: "Smoke", body: "Text" }));`,
    );
    const modalsNach = await evaluieren<number>(cdp, `return document.querySelectorAll(".modal-container").length;`);
    pruefe("V23 send() ohne Identitaet liefert not-configured und oeffnet kein Modal",
      ohneKonto.includes("not-configured") && modalsVor === modalsNach,
      `${ohneKonto}, Modals ${String(modalsVor)} -> ${String(modalsNach)}`);

    // ── Mit Identitaet: das Modal muss aufgehen ─────────────────────────────────────────
    const gesetzt = await evaluieren<boolean>(
      cdp,
      `const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
       const k = p.settings.accounts.find(a => a.id === ${JSON.stringify(API_KONTO_ID)});
       if (!k) return false;
       k.identities = [{ id: "smoke", address: "smoke@example.invalid", name: "GUI-Smoke" }];
       k.defaultIdentityId = "smoke";
       await p.saveSettings();
       return p.api.status().ready === true;`,
    );
    if (!gesetzt) throw new Error("V24: sendefaehiger Zustand liess sich nicht herstellen — Messung ungueltig");
    await warte(300);

    await evaluieren(
      cdp,
      `window.__ms_probe = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].api.send({
         callerId: "gui-smoke-fremd", to: ["probe@example.invalid"], subject: "Smoke", body: "Textzeile" });
       return true;`,
    );
    const modalDa = await pollUntil<boolean>(
      cdp, `return !!document.querySelector(".mailstone-consent-body");`, 8000, 200);
    if (modalDa !== true) {
      pruefe("V24 Erstkontakt oeffnet das Bestaetigungs-Modal", false, "kein Modal binnen 8 s");
      await evaluieren(cdp, `delete window.__ms_probe; return true;`).catch(() => undefined);
    } else {
      await clickReal(
        cdp,
        `[...document.querySelectorAll(".modal-button-container button")].find(b => /Abbrechen|Cancel/.test(b.textContent))`,
        150,
      );
      const ausgang = await evaluieren<string>(cdp, `const r = await window.__ms_probe; delete window.__ms_probe; return JSON.stringify(r);`);
      pruefe("V24 Erstkontakt oeffnet das Modal, Abbrechen liefert declined",
        ausgang.includes("declined"), ausgang);
    }
  } finally {
    // Zurueckgeben, was da war — und am Ergebnis belegen, nicht annehmen (dieselbe Doktrin
    // wie beim TaskNotes-Slot weiter oben). Ein fehlgeschlagener Restore darf nicht
    // stillschweigend durchrutschen.
    const zurueck = await evaluieren<boolean>(
      cdp,
      `const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
       p.settings.accounts = JSON.parse(${JSON.stringify(vorherigeKonten)});
       await p.saveSettings();
       return JSON.stringify(p.settings.accounts) === ${JSON.stringify(vorherigeKonten)};`,
    ).catch(() => false);
    if (!zurueck) {
      throw new Error(
        "Versand-API-Abschnitt: Kontenliste NICHT auf den Vorzustand zurueckgesetzt — " +
          "der Vault-Zustand ist veraendert.",
      );
    }
  }
}

async function main(): Promise<void> {
  const cdp = await attachTo("workspace", PORT, VAULT);
  offeneVerbindung = cdp;
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

  // Vor JEDER Messung: laeuft dieser Lauf gegen den eigenen Build? `manifest.version` ist
  // dafuer strukturell blind (Store- und Repo-Build tragen dieselbe Nummer) — Fix-Runde 1,
  // Task 8: ein Zwischenlauf gegen einen alten deployten Stand faerbte alle fuenf neuen
  // TaskNotes-Punkte rot mit "Kommando nicht registriert", obwohl der Pruefling intakt war.
  // Zweiarmig (mit REPO_ROOT/main.js): der einarmige Aufruf koennte nur eine Store-Installation
  // *positiv* erkennen (nosourcemap-Suffix) und liesse einen alten EIGENEN Deploy als
  // "ungeklaert" durch — genau der Fehlfall von oben.
  requireEigenerBuild(
    join(vaultPfad, konfigVerzeichnis, "plugins", PLUGIN_ID, "main.js"),
    join(REPO_ROOT, "main.js"),
  );

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
    await v9b_hilfeZeile(cdp);
    console.log("");

    console.log("── Posteingang (Hub-Tabs)");
    await v11_inboxTabOeffnetInhalt(cdp);
    await v12_leererOrdnerZeigtEmptyState(cdp);
    await v13_tabWahlUeberlebtWechsel(cdp);
    console.log("");

    console.log("── TaskNotes-Kopplung (M5, Stub statt echtem Nachbarplugin)");
    await taskNotesNotizAnlegenUndOeffnen(cdp);
    try {
      await ta_kommandoFehltOhneTaskNotes(cdp);
      await tb_kommandoErscheintMitStub(cdp);
      await tc_modalZeigtTitelUndFaelligkeit(cdp);
      await td_bestaetigungRuftTasksCreate(cdp);
      await te_postfachKnopfNurMitTaskNotes(cdp);
    } finally {
      await taskNotesNotizAufraeumen(cdp);
      // Einziger Ort, der den Vorzustand zurueckschreibt (s. Kommentar an der Funktion) — ein
      // fehlgeschlagener Restore darf hier NICHT stillschweigend durchrutschen: er ist der
      // konkrete Schaden, vor dem der Critical-Befund warnt (ein fremdes, echtes Plugin bleibt
      // zerstoert zurueck), und ohne den Wurf waere ein gruener Lauf trotzdem gruen.
      const { beruehrt, wiederhergestellt } = await taskNotesOriginalWiederherstellen(cdp);
      if (beruehrt && !wiederhergestellt) {
        throw new Error(
          "TaskNotes-Slot nach dem Lauf NICHT identisch wiederhergestellt — " +
            "eine evtl. echte TaskNotes-Registrierung im Vault ist moeglicherweise beschaedigt.",
        );
      }
    }
    console.log("");

    console.log("── Versand-Plugin-API (kein echter Versand, s. Kommentar an der Funktion)");
    await versandApiPruefen(cdp);
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
  // Ohne das haengt der Prozess am offenen Socket, statt sich zu beenden (s. offeneVerbindung).
  offeneVerbindung?.close();
});
