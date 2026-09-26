/**
 * Aufnahme-Treiber fuer die README-Bilder — faehrt den Vertrag aus `docs/images/README.md`
 * gegen ein **laufendes** Obsidian, statt die Bilder von Hand zu klicken.
 *
 * Bruecke, Aufnahme-Primitive und Fixture→Vault liegen zentral im Dach
 * (`obsidian-plugins/tools/obsidian-cdp/`); hier steht nur, welches Bild was zeigt.
 *
 * ## Ablauf (Zweitinstanz, nie die reguelaere Instanz)
 *
 * ```bash
 * npm run build
 * npm run shots -- --setup                 # Vault aus dem Fixture bauen
 * # Vault in $UD/obsidian.json eintragen, Zweitinstanz mit eigenem Profil und Port starten,
 * # Oberflaechensprache Englisch (obsidian.json language UND localStorage language)
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label mailstone --intent "shots.ts" --exclusive focus --port <port>
 * npm run shots -- --port <port>           # alles aufnehmen
 * npm run shots -- --port <port> --only hero.png
 * npm run shots -- --list
 * ```
 *
 * Aufnahme-Vault ist `<vault-name>-shots` neben dem Staging-Vault des GUI-Smokes — nicht
 * derselbe: `buildVault` raeumt einen Vault leer, und der Smoke-Vault traegt
 * `calendar-notes`/`tasknotes` fuer `smoke:e2e`.
 *
 * ## Was dieser Treiber selbst herstellt
 *
 * Die Mails entstehen ueber das echte Kommando **Import .eml files from a vault folder** aus
 * synthetischen `.eml` (nur example.org/.net/.com). Das Konto samt Laufzustand des
 * Seitenpanels wird dagegen **gesetzt**: ein erfolgreicher Sync braucht ein echtes Postfach
 * (TLS-Pflicht, Zertifikate lassen sich nicht abschalten), und ein echtes Postfach kommt in
 * kein Bild. Der Vertrag nennt das bei den betroffenen Bildern.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, exit } from "node:process";

import { attachTo, Cdp, closeExtraLeaves, openExisting, pollUntil, requireVisible } from "../../tools/obsidian-cdp/cdp.js";
import { boxOf, capture, setWindowSize, writeShot, type Rect, type ShotOptions } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const PLUGIN_ID = "mailstone";
const REPO_NAME = "mailstone";
const VAULT_NAME = `${REPO_NAME}-shots`;
const OUT_DIR = "docs/images";
const OPTS: ShotOptions = { outDir: OUT_DIR, captureWidth: 1200, thumbWidth: 380 };
const ACCOUNT_ID = "shots-demo";
const SECRET_ID = "mailstone-shots-demo";

function arg(flag: string, fallback: string): string {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] !== undefined ? String(argv[i + 1]) : fallback;
}
const PORT = Number(arg("--port", "9327"));
const ONLY = arg("--only", "");

const wollen = (name: string): boolean => ONLY === "" || ONLY === name;
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── Vertrag ─────────────────────────────────────────────────────────────────────────────

const VERTRAG = ["hero.png", "mail-note.png", "relink-preview.png", "settings.png", "account.png"] as const;

// ── Vault und Zustand ───────────────────────────────────────────────────────────────────

function setup(): void {
  const repoRoot = cwd();
  const vaultDir = `${stagingVaultDir(REPO_NAME)}-shots`;
  for (const zeile of buildVault({ repoRoot, vaultDir, fixtureDir: join(repoRoot, OUT_DIR, "fixture"), pluginId: PLUGIN_ID })) {
    console.log(`  ${zeile}`);
  }
  console.log(`\nVault: ${vaultDir}\nJetzt in der Zweitinstanz oeffnen (Eintrag in <profil>/obsidian.json, dort neu starten).`);
}

async function pruefeSprache(cdp: Cdp): Promise<void> {
  const sprache = await cdp.evaluate<string>(`return String(window.localStorage.getItem("language") ?? "") + "|" + document.documentElement.lang;`);
  if (!/^en\b/.test(sprache) && !sprache.startsWith("en|") && !sprache.endsWith("|en")) {
    throw new Error(`Oberflaeche nicht Englisch (localStorage|lang = "${sprache}"): obsidian.json language UND localStorage language setzen, neu starten.`);
  }
}

/** Import ueber das echte Kommando, danach Konto + Laufzustand setzen und das Plugin neu laden. */
async function zustandHerstellen(cdp: Cdp): Promise<void> {
  const vorhanden = await cdp.evaluate<number>(`return app.vault.getMarkdownFiles().filter(f => f.path.startsWith("Mail/")).length;`);
  if (vorhanden === 0) {
    await cdp.evaluate(`app.commands.executeCommandById("${PLUGIN_ID}:import-eml-folder"); return true;`);
    const ok = await pollUntil(cdp, `return document.querySelector(".modal input[type=text]") ? true : null;`, 8000, 200);
    if (!ok) throw new Error("Import-Dialog erschien nicht");
    await cdp.evaluate(`
      const input = document.querySelector(".modal input[type=text]");
      input.value = "Import"; input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(".modal .mod-cta").click();
      return true;`);
    const fertig = await pollUntil(cdp, `return app.vault.getMarkdownFiles().filter(f => f.path.startsWith("Mail/")).length >= 3 ? true : null;`, 15000, 300);
    if (!fertig) throw new Error("Import lieferte keine drei Notizen");
    await pause(800);
    // Threads verknuepfen ueber das echte Kommando: der Import allein laesst in_reply_to
    // als Message-ID stehen, ein Relink macht daraus Wikilinks (Notiz muss offen sein).
    await openExisting(cdp, await notizPfad(cdp, "-1140-"), "preview");
    await cdp.evaluate(`app.commands.executeCommandById("${PLUGIN_ID}:mail-relink"); return true;`);
    const vorschau = await pollUntil(cdp, `return /Review before writing/.test(document.querySelector(".modal")?.textContent ?? "") ? true : null;`, 8000, 200);
    if (!vorschau) throw new Error("Relink-Vorschau erschien nicht");
    // Die Vorschau ist selbst ein Motiv, und sie gibt es nur im ersten Lauf nach --setup: danach sind
    // die Threads verknuepft und das Kommando hat nichts mehr zu planen.
    if (wollen("relink-preview.png")) {
      await pause(600);
      await schreibe(cdp, "relink-preview.png", await boxOf(cdp, ".modal", 6));
    }
    await cdp.evaluate(`document.querySelector(".modal .mod-cta").click(); return true;`);
    await pause(1200);
  } else if (ONLY === "relink-preview.png") {
    throw new Error("relink-preview.png braucht den ersten Lauf nach --setup (Threads sind schon verknuepft)");
  }
  await cdp.evaluate(`
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    app.secretStorage.setSecret(${JSON.stringify(SECRET_ID)}, "demo-not-a-real-password");
    const konto = (id, label, host, adresse, name) => ({
      id, label,
      imap: { host: "imap." + host, port: 993, tls: "implicit" },
      smtp: { host: "smtp." + host, port: 465, tls: "implicit" },
      username: adresse, secretId: ${JSON.stringify(SECRET_ID)},
      identities: [{ id: "id-" + id, name, address: adresse }], defaultIdentityId: "id-" + id,
      folders: { inbox: "INBOX", allowlist: "Vault", archive: "Archive", sent: "Sent" },
      // Intervall gross: ein Wecker-Lauf gegen den toten Host wuerde den gesetzten Laufzustand ueberschreiben.
      sync: { enabled: true, intervalMin: 600 },
    });
    p.settings.accounts = [
      konto(${JSON.stringify(ACCOUNT_ID)}, "Work mail", "example.net", "alex@example.net", "Alex Sample"),
      konto("shots-demo-2", "Personal", "example.org", "alex.sample@example.org", "Alex Sample"),
    ];
    const leer = { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 };
    p.runState = {
      [${JSON.stringify(ACCOUNT_ID)}]: { at: Date.now() - 4 * 60000, ok: true, counts: { ...leer, created: 3 } },
      "shots-demo-2": { at: Date.now() - 12 * 60000, ok: true, counts: leer },
    };
    await p.saveSettings();
    await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
    await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
    return true;`);
  await pause(1500);
}

async function notizPfad(cdp: Cdp, teil: string): Promise<string> {
  const pfad = await cdp.evaluate<string | null>(`return app.vault.getMarkdownFiles().map(f => f.path).find(p => p.startsWith("Mail/") && p.includes(${JSON.stringify(teil)})) ?? null;`);
  if (!pfad) throw new Error(`Keine Mail-Notiz mit "${teil}" im Vault`);
  return pfad;
}

async function fensterVorbereiten(cdp: Cdp, hoehe = 900): Promise<void> {
  await requireVisible(cdp);
  await setWindowSize(cdp, 1400, hoehe);
  await cdp.evaluate(`
    for (const l of app.workspace.getLeavesOfType(${JSON.stringify("mailstone-cockpit")})) l.detach();
    if (app.workspace.rightSplit.collapsed) app.workspace.rightSplit.expand();
    if (app.workspace.leftSplit.collapsed) app.workspace.leftSplit.expand();
    return true;`);
  await closeExtraLeaves(cdp);
}

async function panelOeffnen(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`app.commands.executeCommandById("${PLUGIN_ID}:open-cockpit"); return true;`);
  const ok = await pollUntil(cdp, `const b = document.querySelector(".workspace-leaf-content[data-type*=mail] .view-content"); return b && b.getBoundingClientRect().width > 100 && b.textContent.trim().length > 0 ? true : null;`, 8000, 200);
  if (!ok) throw new Error("Seitenpanel rendert nicht");
  await pause(600);
}

async function schreibe(cdp: Cdp, name: string, clip: Rect | null, thumb = false): Promise<void> {
  if (!clip) throw new Error(`${name}: Ausschnitt nicht bestimmbar`);
  const png = await capture(cdp, clip, 2);
  console.log(`  ${await writeShot(cdp, name, png, { ...OPTS, thumb })}`);
}

// ── Motive ──────────────────────────────────────────────────────────────────────────────

async function hero(cdp: Cdp): Promise<void> {
  await fensterVorbereiten(cdp, 640);
  // Der Hero zeigt den Text der Mail, nicht das Eigenschaften-Fenster (das ist Sache von mail-note.png).
  await cdp.evaluate(`app.vault.setConfig("propertiesInDocument", "hidden"); return true;`);
  await openExisting(cdp, await notizPfad(cdp, "-1140-"), "preview");
  await panelOeffnen(cdp);
  // Datei-Explorer: Mail und Mail/2026 aufklappen (zwei Durchgaenge, der Unterordner
  // entsteht erst nach dem ersten Klick).
  for (let i = 0; i < 2; i++) {
    await cdp.evaluate(`
      for (const t of document.querySelectorAll(".nav-folder-title")) {
        const p = t.getAttribute("data-path") ?? "";
        if ((p === "Mail" || p === "Mail/2026") && t.parentElement.classList.contains("is-collapsed")) t.click();
      }
      return true;`);
    await pause(500);
  }
  await schreibe(cdp, "hero.png", await boxOf(cdp, ".horizontal-main-container"));
}

async function mailNote(cdp: Cdp): Promise<void> {
  await fensterVorbereiten(cdp, 1040);
  await cdp.evaluate(`app.vault.setConfig("propertiesInDocument", "visible"); return true;`);
  await cdp.evaluate(`app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); return true;`);
  await openExisting(cdp, await notizPfad(cdp, "-1140-"), "preview");
  await pause(800);
  // Ausschnitt auf den Inhalt der Notiz (Eigenschaften bis erster Absatz), ohne die leeren Raender
  // und ohne die Statusleiste des Fensters.
  // Die Lesevorschau rendert Abschnitte nacheinander; erst messen, wenn der Schluss ("Alex") steht.
  await pollUntil(cdp, `return /Alex\\s*$/.test(document.querySelector(".workspace-leaf.mod-active .markdown-preview-view")?.textContent ?? "") ? true : null;`, 8000, 200);
  const raw = await cdp.evaluate<string | null>(`
    const wurzel = document.querySelector(".workspace-leaf.mod-active");
    const kopf = wurzel?.querySelector(".metadata-container")?.getBoundingClientRect();
    const absaetze = [...(wurzel?.querySelectorAll(".markdown-preview-view p") ?? [])].filter((p) => p.getBoundingClientRect().height > 1);
    const ende = absaetze[absaetze.length - 1]?.getBoundingClientRect();
    if (!kopf || !ende) return null;
    const rand = 28;
    return JSON.stringify({ x: Math.max(0, kopf.x - rand), y: Math.max(0, kopf.y - rand), width: kopf.width + 2 * rand, height: ende.bottom - kopf.y + 2 * rand });`);
  await schreibe(cdp, "mail-note.png", raw ? (JSON.parse(raw) as Rect) : null);
}

async function einstellungen(cdp: Cdp, port: number): Promise<Cdp> {
  // Die Einstellungen sind ein eigenes Fenster; es oeffnet ueber die App des Workspace-Fensters.
  await cdp.evaluate(`app.setting.open(); app.setting.openTabById(${JSON.stringify(PLUGIN_ID)}); return true;`);
  await pause(1500);
  const fenster = await attachTo("settings", port, VAULT_NAME);
  if (!fenster) throw new Error("Einstellungen-Fenster nicht gefunden");
  await setWindowSize(fenster, 1100, 940);
  await pollUntil(fenster, `return document.querySelector(".vertical-tab-content .setting-item") ? true : null;`, 8000, 200);
  await pause(600);
  return fenster;
}

async function settingsBild(cdp: Cdp, port: number): Promise<void> {
  const fenster = await einstellungen(cdp, port);
  await schreibe(fenster, "settings.png", await boxOf(fenster, ".vertical-tab-content", 0), true);
  fenster.close();
}

async function dialogSchliessen(fenster: Cdp): Promise<void> {
  await fenster.evaluate(`
    const abbrechen = [...document.querySelectorAll(".modal:not(.mod-settings) button")].find((b) => b.textContent.trim() === "Cancel");
    abbrechen?.click();
    return Boolean(abbrechen);`);
  const zu = await pollUntil(fenster, `return document.querySelector(".modal:not(.mod-settings)") ? null : true;`, 4000, 200);
  if (!zu) throw new Error("Konto-Dialog liess sich nicht schliessen");
}

async function konto(cdp: Cdp, port: number): Promise<void> {
  const fenster = await einstellungen(cdp, port);
  await fenster.evaluate(`
    const knopf = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Edit");
    knopf?.click(); return Boolean(knopf);`);
  const ok = await pollUntil(fenster, `return document.querySelector(".modal:not(.mod-settings) input") ? true : null;`, 8000, 200);
  if (!ok) throw new Error("Konto-Dialog erschien nicht");
  await pause(600);
  // Der Dialog ist hoeher als das Fenster (er scrollt innen): auf den sichtbaren Teil begrenzen,
  // sonst haengt ein schwarzer Streifen unter dem Bild.
  const raw = await fenster.evaluate<string | null>(`
    const r = document.querySelector(".modal:not(.mod-settings)")?.getBoundingClientRect();
    if (!r) return null;
    const x = Math.max(0, r.x - 6), y = Math.max(0, r.y - 6);
    return JSON.stringify({ x, y, width: Math.min(r.width + 12, window.innerWidth - x), height: Math.min(r.height + 12, window.innerHeight - y) });`);
  await schreibe(fenster, "account.png", raw ? (JSON.parse(raw) as Rect) : null);
  await dialogSchliessen(fenster);
  fenster.close();
}

// ── main ────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (argv.includes("--list")) { console.log(VERTRAG.join("\n")); return; }
  if (argv.includes("--setup")) { setup(); return; }
  if (!existsSync(join(cwd(), OUT_DIR, "fixture"))) throw new Error("Fixture fehlt (docs/images/fixture)");
  void readFileSync;

  const cdp = await attachTo("workspace", PORT, VAULT_NAME);
  if (!cdp) throw new Error(`Kein Fenster fuer Vault "${VAULT_NAME}" auf Port ${String(PORT)}.`);
  await requireVisible(cdp);
  await pruefeSprache(cdp);
  await zustandHerstellen(cdp);

  const motive: Record<string, () => Promise<void>> = {
    "hero.png": () => hero(cdp),
    "mail-note.png": () => mailNote(cdp),
    "relink-preview.png": () => Promise.resolve(), // entsteht in zustandHerstellen()
    "settings.png": () => settingsBild(cdp, PORT),
    "account.png": () => konto(cdp, PORT),
  };
  for (const name of VERTRAG) {
    if (ONLY && ONLY !== name) continue;
    console.log(`── ${name}`);
    await motive[name]!();
  }
  cdp.close?.();
}

main().then(() => exit(0), (e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); exit(1); });
