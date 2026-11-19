// Die Verkettung Plugin -> Host -> Panel, die kein Task-Review sah.
//
// `tests/obsidian/main.test.ts` prueft nur die aus main.ts exportierten reinen Helfer und
// instanziiert das Plugin nirgends (Ruling A der Plan-Runde). Genau dort lagen aber die vier
// Uebergangsdefekte des Abschluss-Reviews: jede Schicht fuer sich korrekt, die Verkettung nicht.
// Der vendorte Plugin-Mock traegt einen brauchbaren Konstruktor, `onload()` braucht es dafuer
// nicht — die Felder, die `runSync`/`saveSettings`/`cockpitHost` anfassen, werden hier direkt
// gesetzt. `as any` fuer die privaten Methoden: sie sind der Gegenstand, nicht ein Umweg.
import { describe, it, expect, vi } from "vitest";
import MailstonePlugin, { syncTargets, waitingCheckAvailable } from "../../src/main";
import { makeFakeEl } from "../vendor/kit/obsidian-mock";
import { CockpitPanel, type CockpitHost } from "../../src/obsidian/views/cockpit-panel";
import { newAccount, type Account } from "../../src/core/settings";
import type { SyncCounts } from "../../src/core/sync/events";
import type { SyncRunResult } from "../../src/core/sync/service";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

const NIX: SyncCounts = { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, waiting: 0, errors: 0 };

function acc(id: string, enabled = true): Account {
  const a = newAccount(id);
  a.label = id;
  a.sync = { enabled, intervalMin: 5, followThreads: false };
  return a;
}

interface Aufbau {
  plugin: any;
  host: CockpitHost;
  notify: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  syncAccount: ReturnType<typeof vi.fn>;
}

function aufbau(accounts: Account[], syncAccount?: (id: string) => Promise<SyncRunResult>, app: any = {}): Aufbau {
  const plugin: any = new MailstonePlugin(app, { id: "mailstone", name: "Mailstone", version: "0.1.0" } as any);
  plugin.settings.accounts = accounts;
  // Der Eintrag laeuft ueber den Kit-Baustein; hier genuegt ein Handle, das nichts zeichnet (runSync ruft nur `set`).
  plugin.status = { set: () => {}, setVisible: () => {}, reveal: () => () => {}, refresh: () => {}, shown: false, el: null, destroy: () => {} };
  plugin.uidCache = { data: () => ({}) };
  const spy = vi.fn(syncAccount ?? (async (id: string): Promise<SyncRunResult> => ({ ok: true, accountId: id, counts: NIX })));
  plugin.syncService = { syncAccount: spy, syncAll: vi.fn() };
  const notify = { info: vi.fn(), error: vi.fn() };
  return { plugin, host: plugin.cockpitHost(notify) as CockpitHost, notify, syncAccount: spy };
}

/** Alle Nachfahren mit dieser Klasse — wie in cockpit-panel.test.ts. */
function findAll(el: any, cls: string): any[] {
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

describe("Befund 1 — die offene Ansicht reagiert auf Kontoaenderungen", () => {
  it("verlaesst den Empty-State, sobald der Settings-Tab ein Konto gespeichert hat", async () => {
    // Der Erstnutzer-Pfad woertlich: leeres Cockpit -> „Einstellungen oeffnen" -> Konto
    // anlegen -> zurueck. Der Settings-Tab ruft AUSSCHLIESSLICH saveSettings(); der Emit lag
    // vorher nur am Ende von runSync. Die Ansicht blieb im Empty-State stehen — und weil dort
    // auch „Alle synchronisieren" gesperrt ist, gab es keinen Knopf mehr, der ein Re-Render
    // haette ausloesen koennen. Nur Schliessen und Neuoeffnen half.
    const { plugin, host } = aufbau([]);
    const el = makeFakeEl();
    new CockpitPanel(host).mount(el);
    expect(findAll(el, "mailstone-cockpit-empty")).toHaveLength(1);

    plugin.settings.accounts = [acc("neu")];
    await plugin.saveSettings();

    expect(findAll(el, "mailstone-cockpit-empty")).toHaveLength(0);
    expect(findAll(el, "mailstone-cockpit-row")).toHaveLength(1);
  });

  it("zeichnet auch beim Umlegen des Sync-Schalters neu", async () => {
    const { plugin, host } = aufbau([acc("a")]);
    const el = makeFakeEl();
    new CockpitPanel(host).mount(el);
    expect(String(findAll(el, "mailstone-cockpit-row")[0].textContent)).not.toContain("Automatischer Abgleich ist aus");

    plugin.settings.accounts[0].sync.enabled = false;
    await plugin.saveSettings();

    expect(String(findAll(el, "mailstone-cockpit-row")[0].textContent)).toContain("Automatischer Abgleich ist aus");
  });

  it("meldet EINE Aenderung je Lauf, nicht zwei", async () => {
    // runSync speichert im finally ohnehin; ein eigener Emit dort waere ein zweites
    // Re-Render fuer dieselbe Aenderung. Erwartet wird deshalb: einer beim Start des Laufs
    // (fuer den is-checking-Indikator), einer beim Speichern am Ende.
    const { plugin, host, notify } = aufbau([acc("a")]);
    const renders = vi.fn();
    host.onChange(renders);
    await plugin.runSync(notify, false, undefined);
    expect(renders).toHaveBeenCalledTimes(2);
  });
});

describe("Befund 2 — manuell heisst manuell", () => {
  it("synchronisiert ein ausdruecklich angefordertes Konto auch bei abgeschaltetem Auto-Abgleich", async () => {
    // Die plausibelste Konfiguration fuer jemanden, der nur von Hand synchronisieren will:
    // genau ein Konto, sync.enabled = false. Vorher erschien bloss die Notice „Kein Konto mit
    // aktivierter Synchronisierung", und beide Knoepfe sahen bedienbar aus und taten nichts.
    const { plugin, notify, syncAccount } = aufbau([acc("a", false)]);
    const results = await plugin.runSync(notify, false, ["a"]);
    expect(syncAccount).toHaveBeenCalledWith("a");
    expect(results).toHaveLength(1);
    expect(notify.info).not.toHaveBeenCalledWith("notice.sync.noAccounts");
  });

  it("verhaelt sich dabei UNABHAENGIG vom Nachbarkonto", async () => {
    // Der verschaerfende Teil des Befunds: mit einem zweiten, aktiven Konto passierte der
    // Riegel, und syncAccount prueft sync.enabled selbst nicht — derselbe Knopf verhielt sich
    // je nach Nachbarkonto anders.
    const mitNachbar = aufbau([acc("a", false), acc("b", true)]);
    await mitNachbar.plugin.runSync(mitNachbar.notify, false, ["a"]);
    const ohneNachbar = aufbau([acc("a", false)]);
    await ohneNachbar.plugin.runSync(ohneNachbar.notify, false, ["a"]);
    expect(mitNachbar.syncAccount.mock.calls).toEqual(ohneNachbar.syncAccount.mock.calls);
  });

  it("GEGENPROBE: OHNE ausdrueckliche Anforderung bleibt das abgeschaltete Konto aussen vor", async () => {
    // sync.enabled regelt weiterhin den Wecker — sonst belegte der Test darueber nur, dass
    // der Filter ueberhaupt weg ist.
    const { plugin, notify, syncAccount } = aufbau([acc("a", false)]);
    const results = await plugin.runSync(notify, false, undefined);
    expect(syncAccount).not.toHaveBeenCalled();
    expect(results).toEqual([]);
    expect(notify.info).toHaveBeenCalledWith("notice.sync.noAccounts");
  });
});

// A5, Schritt 4b: „Wartende Mails pruefen“ ist ein Sync-Lauf ueber alle Konten mit interactive: true; der Befehl „Synchronisieren“, der
// Wecker und das Cockpit laufen mit false (kein Pruefenster). onload() ist nicht testbar, deshalb steht der Befehl als Methode da.
describe("Wartende Mails pruefen (A5, Schritt 4b)", () => {
  const opts = (spy: ReturnType<typeof vi.fn>): unknown[] => spy.mock.calls.map((c) => (c[1] as { interactive?: boolean } | undefined)?.interactive === true);

  it("der Befehl fuehrt einen Lauf ueber alle aktiven Konten mit interactive: true und derselben Notice", async () => {
    const { plugin, notify, syncAccount } = aufbau([acc("a"), acc("b"), acc("c", false)]);
    plugin.settings.profile.pseudonymize = "required";
    const cmd = plugin.waitingCommand(notify);
    expect(cmd.checkCallback(false)).toBe(true);
    await vi.waitFor(() => { expect(syncAccount).toHaveBeenCalledTimes(2); });
    expect(syncAccount.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    expect(syncAccount.mock.calls.every((c) => (c[1] as { interactive?: boolean }).interactive === true)).toBe(true);
    await vi.waitFor(() => { expect(notify.info).toHaveBeenCalledWith("notice.sync.done", 0, 0, 0, 0); });
  });

  it("der normale Sync (runSync ohne Angabe) und der Intervall-Lauf fragen nie interaktiv", async () => {
    const { plugin, notify, syncAccount } = aufbau([acc("a")]);
    plugin.settings.profile.pseudonymize = "required";
    await plugin.runSync(notify);
    await plugin.runSync(notify, true, ["a"]);
    plugin.lastRun = {};
    await plugin.runDueSyncs(notify, {});
    await plugin.runSync(notify, false, ["a"]);
    expect(syncAccount).toHaveBeenCalledTimes(4);
    expect(opts(syncAccount)).toEqual([false, false, false, false]);
  });

  it("der Befehl fehlt bei Aus (checkCallback false, kein Lauf), steht bei Wenn verfuegbar und Verlangt", async () => {
    const { plugin, notify, syncAccount } = aufbau([acc("a")]);
    plugin.settings.profile.pseudonymize = "off";
    const cmd = plugin.waitingCommand(notify);
    expect(cmd.checkCallback(true)).toBe(false);
    expect(cmd.checkCallback(false)).toBe(false);
    expect(syncAccount).not.toHaveBeenCalled();
    plugin.settings.profile.pseudonymize = "if-available";
    expect(cmd.checkCallback(true)).toBe(true);
    plugin.settings.profile.pseudonymize = "required";
    expect(cmd.checkCallback(true)).toBe(true);
    expect(syncAccount).not.toHaveBeenCalled();
  });

  it("nur am Desktop und nur bei eingeschaltetem Schalter sichtbar", () => {
    expect(waitingCheckAvailable("required", { isMobile: false })).toBe(true);
    expect(waitingCheckAvailable("if-available", { isMobile: false })).toBe(true);
    expect(waitingCheckAvailable("off", { isMobile: false })).toBe(false);
    expect(waitingCheckAvailable("required", { isMobile: true })).toBe(false);
  });
});

// A5, Schritt 5: der Port der Rueckwandlung ist das echte Kit `restoreFor`, gebunden an den Schalter des Profils und die Plugin-API, frisch je Aufruf.
describe("Port der Rueckwandlung (A5, Schritt 5)", () => {
  const api = {
    version: 1,
    status: () => ({ state: "ready" }),
    transform: async () => ({ error: "not-ready", message: "x" }),
    restore: (text: string) => ({ text: text.replace("Person_k3x9m2ab7q", "Max"), restored: 1, unknown: [], forgotten: [] }),
    containsPlaceholder: () => true,
  };
  const mitApp = (pluginApi?: unknown): any => ({ plugins: { plugins: pluginApi ? { pseudonymizer: { api: pluginApi } } : {} } });

  it("mit bereitem Plugin loest er auf, auch bei Aus (eine alte Notiz kann Platzhalter tragen)", () => {
    const { plugin } = aufbau([], undefined, mitApp(api));
    plugin.settings.profile.pseudonymize = "off";
    expect(plugin.restorePort()("Hallo Person_k3x9m2ab7q")).toEqual({ kind: "release", text: "Hallo Max", forgotten: [] });
  });

  it("bei Aus ohne Plugin bleibt der Text unveraendert, auch mit Platzhalter", () => {
    const { plugin } = aufbau([], undefined, mitApp());
    plugin.settings.profile.pseudonymize = "off";
    expect(plugin.restorePort()("Hallo Person_k3x9m2ab7q")).toEqual({ kind: "release", text: "Hallo Person_k3x9m2ab7q", forgotten: [] });
  });

  it("bei Verlangt ohne Plugin haelt ein Text mit Platzhalter (hold), einer ohne geht durch", () => {
    const { plugin } = aufbau([], undefined, mitApp());
    plugin.settings.profile.pseudonymize = "required";
    expect(plugin.restorePort()("Hallo Person_k3x9m2ab7q")).toMatchObject({ kind: "hold", reason: "absent", unknown: ["Person_k3x9m2ab7q"] });
    expect(plugin.restorePort()("Hallo Welt")).toEqual({ kind: "release", text: "Hallo Welt", forgotten: [] });
  });

  it("die Meldung des Kits folgt der Oberflaechensprache (restore und transform)", async () => {
    const { plugin } = aufbau([], undefined, mitApp());
    plugin.settings.profile.pseudonymize = "required";
    try {
      initI18n("en");
      expect(plugin.restorePort()("Hallo Person_k3x9m2ab7q")).toMatchObject({ message: expect.stringContaining("The pseudonymizer plugin is missing or disabled.") });
      expect(await plugin.pseudonymizePort()({ parts: [] })).toMatchObject({ kind: "wait", reason: "absent", message: "The pseudonymizer plugin is missing or disabled." });
      initI18n("de");
      expect(plugin.restorePort()("Hallo Person_k3x9m2ab7q")).toMatchObject({ message: expect.stringContaining("Das Plugin pseudonymizer fehlt oder ist abgeschaltet.") });
      expect(await plugin.pseudonymizePort()({ parts: [] })).toMatchObject({ kind: "wait", reason: "absent", message: "Das Plugin pseudonymizer fehlt oder ist abgeschaltet." });
    } finally { initI18n("de"); }
  });

  it("liest den Schalter frisch je Aufruf", () => {
    const { plugin } = aufbau([], undefined, mitApp());
    const port = plugin.restorePort();
    plugin.settings.profile.pseudonymize = "off";
    expect(port("Person_k3x9m2ab7q").kind).toBe("release");
    plugin.settings.profile.pseudonymize = "if-available";
    expect(port("Person_k3x9m2ab7q").kind).toBe("hold");
  });
});

describe("syncTargets", () => {
  it("nimmt bei ausdruecklicher Anforderung genau die genannten Konten", () => {
    expect(syncTargets([acc("a", false), acc("b")], ["a"])).toEqual(["a"]);
  });

  it("nimmt ohne Anforderung nur die Konten mit aktiviertem Abgleich", () => {
    expect(syncTargets([acc("a", false), acc("b")])).toEqual(["b"]);
  });

  it("meldet leer, wenn kein Konto aktiviert ist", () => {
    expect(syncTargets([acc("a", false)])).toEqual([]);
  });
});

describe("Befund 4 — is-checking ist waehrend eines Laufs wirklich erreichbar", () => {
  it("meldet den Lauf, solange er haengt — und nimmt ihn danach zurueck", async () => {
    // Der BusyGuard allein taugt dafuer nicht: er wird erst IN syncAccount belegt und dort im
    // finally sofort wieder freigegeben. Beim Render war er darum immer frei, und
    // `cockpit.aria.checking`, `.is-checking` und @keyframes mailstone-spin waren praktisch
    // tot.
    let freigeben = (): void => undefined;
    const tor = new Promise<void>((r) => { freigeben = r; });
    const { plugin, host, notify } = aufbau([acc("a")], async (id) => {
      await tor;
      return { ok: true, accountId: id, counts: NIX };
    });
    const el = makeFakeEl();
    new CockpitPanel(host).mount(el);
    expect(host.isBusy()).toBe(false);

    const lauf: Promise<SyncRunResult[]> = plugin.runSync(notify, false, undefined);
    expect(host.isBusy()).toBe(true);
    const checking = findAll(el, "mailstone-cockpit-status").filter((s) => String(s.className).split(" ").includes("is-checking"));
    expect(checking).toHaveLength(1);
    // Kein Text-Hinweis mehr (Quicktask 2026-09-12): der is-checking-Spinner traegt den
    // "laeuft"-Zustand allein, ein zusaetzlicher volltextbreiter Hinweis war redundant und
    // verdeckte in schmalen Seitenleisten den Kopf.
    expect(findAll(el, "mailstone-cockpit-hint")).toHaveLength(0);

    freigeben();
    await lauf;
    expect(host.isBusy()).toBe(false);
    expect(findAll(el, "mailstone-cockpit-status").filter((s) => String(s.className).split(" ").includes("is-checking"))).toHaveLength(0);
  });

  it("ueberlebt einen zweiten Lauf, der sich mit dem ersten ueberlappt", async () => {
    // Ein Takt des Weckers und ein Handlauf koennen sich ueberlappen. Mit einem Bool loeschte
    // das finally des inneren Laufs die Anzeige des aeusseren.
    let freigeben = (): void => undefined;
    const tor = new Promise<void>((r) => { freigeben = r; });
    const { plugin, host, notify } = aufbau([acc("a")], async (id) => {
      await tor;
      return { ok: true, accountId: id, counts: NIX };
    });
    const erster: Promise<SyncRunResult[]> = plugin.runSync(notify, false, undefined);
    const zweiter: Promise<SyncRunResult[]> = plugin.runSync(notify, true, ["a"]);
    freigeben();
    await zweiter;
    await erster;
    expect(host.isBusy()).toBe(false);
  });
});

describe("plugin.api", () => {
  it("haengt am Plugin und traegt die Version", () => {
    const { plugin } = aufbau([acc("privat")]);
    plugin.sendService = { send: async () => ({ ok: true, messageId: "x@y", sentCopy: "ok" }) };
    plugin.wireApi();
    expect(plugin.api?.apiVersion).toBe(1);
    expect(typeof plugin.api?.send).toBe("function");
    expect(typeof plugin.api?.status).toBe("function");
  });

  it("meldet ohne Konto not-configured", () => {
    const { plugin } = aufbau([]);
    plugin.sendService = { send: async () => ({ ok: true, messageId: "x@y", sentCopy: "ok" }) };
    plugin.wireApi();
    expect(plugin.api?.status()).toEqual({ ready: false, reason: "not-configured" });
  });

  // Fix-Runde 2, Important 1 — die ganze Kette, die keine Einzelpruefung sah: `api.send`
  // oeffnet das ECHTE Modal (kein Stub), `onunload` schliesst es, und der Adapter meldet
  // `unloaded`. Vorher blieb der Dialog stehen, ein Klick auf „Senden und immer erlauben"
  // verschickte die Mail aus der toten Instanz und `saveSettings()` schrieb deren gesamten
  // Snapshot (settings, zoneHashes, uidCache, runState) nach data.json.
  it("onunload schliesst das offene Zustimmungs-Modal, der Aufruf endet als unloaded", async () => {
    const konto = acc("privat");
    konto.identities = [{ id: "mail", address: "max@example.net", name: "Max" }];
    konto.defaultIdentityId = "mail";
    const send = vi.fn(async () => ({ ok: true, messageId: "x@y", sentCopy: "ok" }));
    const { plugin } = aufbau([konto]);
    plugin.sendService = { send };
    // `saveData` ist der Boden, auf dem `remember` → `saveSettings()` → `persist` landet:
    // wird er beruehrt, hat die tote Instanz geschrieben.
    plugin.saveData = vi.fn(async () => {});
    plugin.wireApi();

    const laufend = plugin.api.send({
      callerId: "fremd", to: ["gast@example.org"], subject: "Betreff", body: "Text",
    });
    await Promise.resolve();
    plugin.onunload();

    await expect(laufend).resolves.toEqual({ ok: false, reason: "unloaded" });
    expect(send).not.toHaveBeenCalled();
    expect(plugin.saveData).not.toHaveBeenCalled();
  });
});

describe("Befund 5 — openSettings landet auf dem eigenen Tab", () => {
  it("oeffnet die Einstellungen UND waehlt den Mailstone-Tab", () => {
    const open = vi.fn();
    const openTabById = vi.fn();
    const { host } = aufbau([], undefined, { setting: { open, openTabById } });
    host.openSettings();
    expect(open).toHaveBeenCalledTimes(1);
    expect(openTabById).toHaveBeenCalledWith("mailstone");
  });

  it("wirft nicht, wenn Obsidian die undokumentierte setting-Flaeche einmal nicht hat", () => {
    const { host } = aufbau([], undefined, {});
    expect(() => host.openSettings()).not.toThrow();
  });
});
