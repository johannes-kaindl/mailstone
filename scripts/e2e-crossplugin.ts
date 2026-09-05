/**
 * Naht-Lauf: die TaskNotes-Kopplung gegen ein ECHT installiertes TaskNotes, nicht gegen den
 * Stub aus `scripts/gui-smoke.ts`. M5 Task 9 (`.superpowers/sdd/2026-09-05-m5-tasknotes/
 * task-9-brief.md`), Design: `docs/superpowers/specs/2026-09-05-m5-tasknotes-design.md` § 8.1/§ 9.
 *
 * ## Warum es diesen Lauf gibt
 *
 * `smoke:gui` prueft mailstones Haelfte mit einem Stub auf `app.plugins.plugins.tasknotes`.
 * TaskNotes selbst kennt mailstone gar nicht. Wo zwei Repos je ihre Haelfte pruefen, prueft
 * niemand die Naht — dieser Lauf ist die einzige Stelle, die belegt, dass eine Aufgabe wirklich
 * als Datei im Vault ankommt, mit welcher Feldform, und ob ein Fehlschlag als Wert oder als
 * Ausnahme zurueckkommt.
 *
 * **Deshalb bewusst NICHT Teil von `gate` oder `smoke:gui`**: der Lauf setzt ein zweites,
 * echtes Plugin im Staging-Vault voraus (Task 0) und gehoert nicht in die Pflichtstrecke.
 *
 * ## Fremden Zustand nicht beschaedigen
 *
 * TaskNotes selbst wird NICHT deaktiviert (andere Sessions bauen darauf) — Pruefpunkt (f)
 * "ohne TaskNotes fehlt das Kommando" entfaellt deshalb hier bewusst; er ist bereits mit einem
 * Stub in `scripts/gui-smoke.ts` (T-A) abgedeckt, wo das Deaktivieren den eigenen Stub trifft,
 * kein fremdes Plugin.
 *
 * Machbar waere (f) auch hier — gegen ein ECHTES TaskNotes statt des Stubs —, aber nur ueber
 * eine ZWEITINSTANZ von Obsidian (eigenes `--user-data-dir`, eigener Debug-Port; Rezept in der
 * Dach-`AGENTS.md` unter "Staging-Vaults"): dort darf deaktiviert werden, ohne eine fremde
 * Sitzung zu treffen. Nicht gebaut, weil dieser Lauf schon ohne Zweitinstanz auskommt — ein
 * Zeiger fuer den naechsten, der die Luecke wirklich schliessen will.
 *
 * Einzige Beruehrung von geteiltem Zustand: `api.tasks.create` wird gewrappt (nicht ersetzt),
 * der Original-Wert vorher gesichert und im `finally` per Identitaetsvergleich (`===`)
 * zurueckgeschrieben — bei Abweichung wirft der Lauf, statt still durchzulaufen (Vorlage:
 * `TASKNOTES_SICHERN`/`taskNotesOriginalWiederherstellen` in `scripts/gui-smoke.ts`).
 *
 * ## CDP-Lock
 *
 * ```bash
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label mailstone --intent "…" \
 *   --exclusive focus --ttl 1200
 * npm run deploy && npm run smoke:e2e
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py release
 * ```
 */

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { attachTo, clearNotices, clickReal, notices, requireVisible, type Cdp } from "../../tools/obsidian-cdp/cdp.js";
import { requireEigenerBuild } from "../../tools/obsidian-cdp/vault.js";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PLUGIN_ID = "mailstone";
const TASKNOTES_ID = "tasknotes";
const COMMAND_ID = `${PLUGIN_ID}:mail-createTask`;
const NOTE_PATH = "e2e-crossplugin-notiz.md";
/** Titel, an dem der Spy eine SYNTHETISCHE Anbieter-Stoerung ausloest, statt durchzureichen —
 *  s. Pruefpunkt (e) weiter unten fuer die Begruendung dieser einen Ausnahme von "wrap und
 *  reiche durch". */
const SYNTHETISCHER_FEHLER_TITEL = "__E2E_SYNTHETISCHE_ANBIETER_STOERUNG__";

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

function argWert(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? String(process.argv[i + 1]) : fallback;
}

const PORT = Number(argWert("--port", "9222"));
const VAULT = argWert("--vault", "mailstone");

function warte(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function evaluieren<T>(cdp: Cdp, ausdruck: string): Promise<T> {
  return cdp.evaluate<T>(ausdruck);
}

/** Sucht ein Setting-Item im obersten Modal ueber seinen Namen (`SchemaFormModal` gibt den
 *  Schluessel unuebersetzt an `setName()` weiter — Muster aus `scripts/gui-smoke.ts`). */
function settingControlAusdruck(feld: string): string {
  return `[...document.querySelectorAll(".modal .setting-item")]
            .find(el => el.querySelector(".setting-item-name")?.textContent === ${JSON.stringify(feld)})
            ?.querySelector(".setting-item-control")`;
}

/** Sichert den Vorzustand von `api.tasks.create` EINMAL, vor dem allerersten Zugriff dieses
 *  Laufs — ein eigener Waechter statt eines Vergleichs gegen `undefined`/vorhandene Werte,
 *  weil ein legitimer Vorzustand nicht von "noch nicht gesichert" unterscheidbar waere.
 *
 *  Fix-Runde 1 (Review): ohne diesen Waechter schreibt `spyInstallieren` unbedingt
 *  `window.__e2eOriginalTasksCreate = api.tasks.create` — bricht ein Lauf ZWISCHEN dieser
 *  Zeile und `spyEntfernen()` ab (CDP-Verbindungsabriss, Prozess-Kill, Schlafmodus), bleibt
 *  die Methode im Renderer gewrappt, UND der naechste Lauf saehe den bereits gewrappten Stand
 *  als "Original" — die Wiederherstellungs-Zusage waere dann dauerhaft falsch, nicht nur fuer
 *  einen Lauf. Genau das Muster aus `TASKNOTES_SICHERN` in `scripts/gui-smoke.ts` (Zeile
 *  911 ff.), eine Ebene tiefer (eine Methode statt eines Plugin-Slots). */
const SPY_SICHERN = `if (!window.__e2eSpyCaptured) {
     window.__e2eSpyCaptured = true;
     window.__e2eOriginalTasksCreate = app.plugins.plugins[${JSON.stringify(TASKNOTES_ID)}]?.api?.tasks?.create;
   }`;

/** Installiert den Spy auf `api.tasks.create`: wrappt und reicht durch, sammelt jeden Aufruf
 *  in `window.__e2eSpyCalls`. Fuer `SYNTHETISCHER_FEHLER_TITEL` wirft er selbst, OHNE
 *  durchzureichen — die einzige geplante Abweichung von "wrap und reiche durch", s. (e). */
async function spyInstallieren(cdp: Cdp): Promise<void> {
  await evaluieren(
    cdp,
    `const api = app.plugins.plugins[${JSON.stringify(TASKNOTES_ID)}]?.api;
     if (!api) throw new Error("TaskNotes-API nicht da — Voraussetzung fehlt");
     ${SPY_SICHERN}
     window.__e2eSpyCalls = [];
     const original = window.__e2eOriginalTasksCreate.bind(api.tasks);
     api.tasks.create = async function (data, opts) {
       window.__e2eSpyCalls.push(data);
       if (data && data.title === ${JSON.stringify(SYNTHETISCHER_FEHLER_TITEL)}) {
         throw new Error("E2E: synthetische Anbieter-Stoerung (kein echter TaskNotes-Aufruf)");
       }
       return original(data, opts);
     };
     return true;`,
  );
}

/**
 * Schreibt den VORZUSTAND zurueck — Identitaetsvergleich (`===`), kein Struktur-/Feldvergleich
 * (ein Wrapper kann strukturell wie das Original aussehen), und wirft bei Abweichung statt
 * still durchzulaufen. Genau das Muster aus `taskNotesOriginalWiederherstellen()` in
 * `scripts/gui-smoke.ts`.
 */
async function spyEntfernen(cdp: Cdp): Promise<{ beruehrt: boolean; wiederhergestellt: boolean }> {
  return evaluieren(
    cdp,
    `if (!window.__e2eSpyCaptured) return { beruehrt: false, wiederhergestellt: true };
     const api = app.plugins.plugins[${JSON.stringify(TASKNOTES_ID)}]?.api;
     const original = window.__e2eOriginalTasksCreate;
     if (api) api.tasks.create = original;
     const wiederhergestellt = api ? api.tasks.create === original : false;
     delete window.__e2eOriginalTasksCreate;
     delete window.__e2eSpyCalls;
     delete window.__e2eSpyCaptured;
     return { beruehrt: true, wiederhergestellt };`,
  );
}

async function notizAnlegenUndOeffnen(cdp: Cdp): Promise<void> {
  await evaluieren(
    cdp,
    `const inhalt = "---\\nmail_id: e2e-crossplugin\\n---\\n\\nE2E-Naht-Lauf-Notiz.\\n";
     const bestehend = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE_PATH)});
     if (bestehend) await app.vault.delete(bestehend);
     const datei = await app.vault.create(${JSON.stringify(NOTE_PATH)}, inhalt);
     // getLeaf(true): NEUES Leaf statt des aktiven — sonst ersetzt der Lauf den Inhalt eines
     // fremden, schon offenen Leafs, ohne ihn hinterher wiederherzustellen (dieselbe Gattung
     // wie der behobene Critical in gui-smoke.ts, eine Stufe kleiner). gui-smoke.ts nimmt an
     // derselben Stelle bereits getLeaf(true) — hier nachgezogen (Fix-Runde 2, Punkt 7).
     const leaf = app.workspace.getLeaf(true);
     await leaf.openFile(datei);
     return true;`,
  );
  await warte(500);
}

async function notizAufraeumen(cdp: Cdp): Promise<void> {
  await evaluieren(
    cdp,
    `const datei = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE_PATH)});
     if (datei) await app.vault.delete(datei);
     return true;`,
  ).catch(() => undefined);
}

/** Loescht eine per Pfad bekannte, wirklich von TaskNotes angelegte Aufgaben-Notiz —
 *  Messrueckstand, kein Fixture (Spec § 8.1: der Messbefund gegen TaskNotes 4.12.5, nicht ein
 *  eigenes Skript — `scripts/probe-tasknotes-create.ts` existiert nicht mehr). */
async function aufgabeLoeschen(cdp: Cdp, pfad: string): Promise<void> {
  if (!pfad) return;
  await evaluieren(
    cdp,
    `const datei = app.vault.getAbstractFileByPath(${JSON.stringify(pfad)});
     if (datei) await app.vault.delete(datei);
     return true;`,
  ).catch(() => undefined);
}

function checkCallback(cdp: Cdp): Promise<boolean | null> {
  return evaluieren<boolean | null>(
    cdp,
    `const cmd = app.commands.commands[${JSON.stringify(COMMAND_ID)}];
     return cmd && typeof cmd.checkCallback === "function" ? cmd.checkCallback(true) : null;`,
  );
}

interface SpyAufruf {
  title?: string;
  due?: string;
  dueDate?: string;
  details?: string;
}

/** Fuellt das offene Formular-Modal und bestaetigt zweimal (Formular, dann die
 *  Vorschau/Bestaetigung) — Muster aus `td_bestaetigungRuftTasksCreate` in `gui-smoke.ts`. */
async function modalAusfuellenUndBestaetigen(cdp: Cdp, titel: string, faelligkeit: string | null): Promise<void> {
  await warte(800);
  const gefuellt = await evaluieren<boolean>(
    cdp,
    `const titelInput = (${settingControlAusdruck("title")})?.querySelector("input");
     if (!titelInput) return false;
     const setzen = (el, wert) => {
       const proto = Object.getPrototypeOf(el);
       Object.getOwnPropertyDescriptor(proto, "value").set.call(el, wert);
       el.dispatchEvent(new Event("input", { bubbles: true }));
     };
     setzen(titelInput, ${JSON.stringify(titel)});
     ${faelligkeit !== null
       ? `const faelligkeitInput = (${settingControlAusdruck("due")})?.querySelector("input[type=date]");
          if (!faelligkeitInput) return false;
          setzen(faelligkeitInput, ${JSON.stringify(faelligkeit)});`
       : ""}
     return true;`,
  );
  if (!gefuellt) throw new Error("Formularfelder im Modal nicht gefunden");
  await clickReal(cdp, `document.querySelector(".modal .modal-button-container .mod-cta")`, 150);
  await warte(800);
  const planModalDa = await evaluieren<boolean>(cdp, `return !!document.querySelector(".modal");`);
  if (planModalDa) {
    await clickReal(cdp, `document.querySelector(".modal .modal-button-container .mod-cta")`, 150);
    await warte(800);
  }
}

// ── Prüfpunkte ──────────────────────────────────────────────────────────────────────────

async function pruefeA(cdp: Cdp): Promise<void> {
  const sichtbar = await checkCallback(cdp);
  pruefe(
    "(a) mail.createTask erscheint mit echtem TaskNotes",
    sichtbar === true,
    sichtbar === null ? "Kommando nicht registriert" : `checkCallback(true) lieferte ${String(sichtbar)}`,
  );
}

/** (b)+(c)+(d) zusammen: ein echter Erfolgslauf über die UI, geprüft an drei unabhängigen
 *  Stellen — dem Spy-Aufruf (Feldform), dem Rückgabewert (Pfad) und der entstandenen Datei
 *  im Vault (Titel, Fälligkeit, Notiz-Link). */
async function pruefeBCD(cdp: Cdp): Promise<string> {
  await clearNotices(cdp);
  const titel = `E2E Naht-Lauf ${String(Date.now())}`;
  const faelligkeit = "2026-12-24";
  await evaluieren(cdp, `app.commands.executeCommandById(${JSON.stringify(COMMAND_ID)}); return true;`);
  await modalAusfuellenUndBestaetigen(cdp, titel, faelligkeit);

  const aufrufe = await evaluieren<SpyAufruf[]>(cdp, `return window.__e2eSpyCalls ?? [];`);
  const aufruf = aufrufe.find((a) => a.title === titel);
  const notizName = NOTE_PATH.replace(/\.md$/, "");
  const erwartetesDetails = `[[${notizName}]]`;
  pruefe(
    "(b) tasks.create bekommt title/due/details — nicht dueDate",
    aufruf !== undefined &&
      aufruf.title === titel &&
      aufruf.due === faelligkeit &&
      aufruf.dueDate === undefined &&
      aufruf.details === erwartetesDetails,
    aufruf === undefined
      ? "kein Spy-Aufruf mit diesem Titel gesehen"
      : `gemessen: ${JSON.stringify(aufruf)} (erwartet due=${faelligkeit}, details=${erwartetesDetails}, kein dueDate)`,
  );

  const meldung = await notices(cdp);
  const treffer = /(?:Aufgabe angelegt|Task created): (.+?)\.$/.exec(meldung.trim());
  const pfad = treffer?.[1] ?? "";
  pruefe(
    "(c) Notice nennt einen Pfad, Aufgabe liegt als Datei im Vault",
    pfad !== "",
    `Notice-Text: ${JSON.stringify(meldung)}`,
  );
  if (pfad === "") return "";

  const dateiInhalt = await evaluieren<string | null>(
    cdp,
    `const datei = app.vault.getAbstractFileByPath(${JSON.stringify(pfad)});
     return datei ? await app.vault.read(datei) : null;`,
  );
  const dateiDa = dateiInhalt !== null;
  // Abweichung von Spec § 8.1, hier gemessen (2026-09-05): `title` landet NICHT im
  // Frontmatter der Aufgaben-Notiz, nur im DATEINAMEN — `api.tasks.create` liefert `title`
  // zwar im Rückgabewert, aber die geschriebene Datei trägt es ausschließlich über `path`
  // (`TaskNotes/Tasks/<title>.md`). Der Titel-Beleg prüft deshalb den Pfad, nicht den Inhalt.
  const titelDa = pfad.includes(titel);
  const faelligkeitDa = dateiDa && dateiInhalt.includes(faelligkeit);
  pruefe(
    "(c) Aufgaben-Datei trägt Titel (im Pfad) und Fälligkeit (im Frontmatter)",
    dateiDa && titelDa && faelligkeitDa,
    !dateiDa
      ? `Datei unter "${pfad}" nicht lesbar`
      : `Titel im Pfad: ${String(titelDa)}, Fälligkeit "${faelligkeit}" im Inhalt: ${String(faelligkeitDa)}`,
  );

  const linkDa = dateiDa && dateiInhalt.includes(erwartetesDetails);
  pruefe(
    "(d) Notiz-Link im Aufgaben-Rumpf auffindbar",
    linkDa,
    dateiDa ? `gesucht: ${erwartetesDetails}` : `Datei unter "${pfad}" nicht lesbar`,
  );

  return pfad;
}

/** (e): ein Fehlschlag kommt als Wert zurück, nicht als Ausnahme. Der Spy löst dafür eine
 *  SYNTHETISCHE Störung aus (s. Kommentar am Modul-Kopf) — TaskNotes' echter Wurf bei leerem
 *  Titel ist über die UI nicht erreichbar, weil mailstones eigenes Schema (minLength: 1) das
 *  Formular vorher blockiert (Spec § 8.1 haelt den echten Wurf als Messbefund gegen
 *  TaskNotes 4.12.5 fest, Task 0 — hier zählt nur, dass mailstones Bruecke ihn NICHT
 *  weiterreicht). */
async function pruefeE(cdp: Cdp): Promise<void> {
  await clearNotices(cdp);
  await evaluieren(cdp, `app.commands.executeCommandById(${JSON.stringify(COMMAND_ID)}); return true;`);
  await modalAusfuellenUndBestaetigen(cdp, SYNTHETISCHER_FEHLER_TITEL, null);

  const meldung = await notices(cdp);
  const fehlerNotice = /TaskNotes hat die Aufgabe abgelehnt|TaskNotes rejected or failed/.test(meldung);
  // Kein Renderer-Fehler: eine unbehandelte Ausnahme würde NICHT als Notice erscheinen,
  // sondern die Befehlspalette/den Aufrufer stumm scheitern lassen — die Abwesenheit einer
  // Fehler-Notice wäre also selbst schon ein (negativer) Befund, kein Fehlen von Beweis.
  pruefe(
    "(e) Fehlschlag kommt als Wert zurück (Fehler-Notice, kein unbehandelter Wurf)",
    fehlerNotice,
    `Notice-Text: ${JSON.stringify(meldung)}`,
  );

  const dateiGefunden = await evaluieren<boolean>(
    cdp,
    `return app.vault.getFiles().some(f => f.path.includes(${JSON.stringify(SYNTHETISCHER_FEHLER_TITEL)}));`,
  );
  pruefe(
    "(e) keine Aufgaben-Datei für den fehlgeschlagenen Versuch angelegt",
    !dateiGefunden,
    `gefunden: ${String(dateiGefunden)}`,
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
  requireEigenerBuild(
    join(vaultPfad, konfigVerzeichnis, "plugins", PLUGIN_ID, "main.js"),
    join(REPO_ROOT, "main.js"),
  );

  const taskNotesDa = await evaluieren<boolean>(
    cdp,
    `const p = app.plugins.plugins[${JSON.stringify(TASKNOTES_ID)}];
     return !!(p && p.api && typeof p.api.tasks?.create === "function");`,
  );
  if (!taskNotesDa) {
    throw new Error(
      "TaskNotes ist im Staging-Vault nicht aktiv — Voraussetzung dieses Laufs (s. Task 0). " +
        "Dieser Lauf deaktiviert es NICHT selbst und installiert es nicht.",
    );
  }

  try {
    await requireVisible(cdp);
    // Frisch geladenes mailstone: das eigene main.js soll der gerade deployte Stand sein, nicht
    // ein aelterer, im Speicher gehaltener (Muster: scripts/gui-smoke.ts).
    await evaluieren(
      cdp,
      `await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
       await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
       return true;`,
    );
    await warte(1500);

    await spyInstallieren(cdp);
    try {
      await notizAnlegenUndOeffnen(cdp);
      let pfad = "";
      try {
        await pruefeA(cdp);
        pfad = await pruefeBCD(cdp);
        await pruefeE(cdp);
      } finally {
        await notizAufraeumen(cdp);
        await aufgabeLoeschen(cdp, pfad);
      }
    } finally {
      const { beruehrt, wiederhergestellt } = await spyEntfernen(cdp);
      if (beruehrt && !wiederhergestellt) {
        throw new Error(
          "api.tasks.create nach dem Lauf NICHT identisch wiederhergestellt — " +
            "die echte TaskNotes-Registrierung im Vault ist möglicherweise beschädigt.",
        );
      }
    }

    console.log("");
    const fehlgeschlagen = ergebnisse.filter((p) => !p.ok);
    console.log(`${String(ergebnisse.length - fehlgeschlagen.length)}/${String(ergebnisse.length)} Prüfpunkte grün.`);
    if (fehlgeschlagen.length > 0) {
      console.log("Rot:");
      for (const p of fehlgeschlagen) console.log(`  - ${p.name}: ${p.detail}`);
      process.exitCode = 1;
    }
  } finally {
    // Ohne das haelt die offene WebSocket-Verbindung den Node-Prozess am Leben — der Lauf
    // wirkt "fertig" (letzte Aktion im Vault laengst geschehen), haengt aber am Event-Loop,
    // bis irgendeine Seite die Verbindung von sich aus schliesst. Gemessen 2026-09-05: ein
    // fehlendes cdp.close() liess den ersten Lauf mehrere Minuten laenger laufen, als seine
    // Pruefpunkte brauchten.
    cdp.close();
  }
}

main().catch((e: Error) => {
  console.error("FEHLER:", e.message);
  process.exitCode = 1;
});
