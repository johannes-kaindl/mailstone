import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildMailTransport,
  createCalendarNotesBridge,
  readCalendarNotesApi,
} from "../../src/obsidian/calendar-notes-bridge";
import type { Account } from "../../src/core/settings";
import type { SendService } from "../../src/core/send/service";

function makeApp(api?: unknown) {
  return {
    plugins: {
      plugins: api === undefined ? {} : { "calendar-notes": { api } },
    },
  } as unknown as import("obsidian").App;
}

function makeAccounts(): Account[] {
  return [
    {
      id: "privat",
      label: "Privat",
      imap: { host: "", port: 993, tls: "implicit" },
      smtp: { host: "", port: 465, tls: "implicit" },
      username: "",
      secretId: "mailstone-privat",
      identities: [{ id: "mail", address: "privat@example.com", name: "Privat" }],
      defaultIdentityId: "mail",
      folders: { inbox: "INBOX", allowlist: "Vault", archive: "Archive" },
      sync: { enabled: true, intervalMin: 5 },
    },
    {
      id: "arbeit",
      label: "Arbeit",
      imap: { host: "", port: 993, tls: "implicit" },
      smtp: { host: "", port: 465, tls: "implicit" },
      username: "",
      secretId: "mailstone-arbeit",
      identities: [{ id: "mail", address: "arbeit@example.com", name: "Arbeit" }],
      defaultIdentityId: "mail",
      folders: { inbox: "INBOX", allowlist: "Vault", archive: "Archive" },
      sync: { enabled: true, intervalMin: 5 },
    },
  ];
}

describe("readCalendarNotesApi", () => {
  it("liefert null ohne Nachbar-Plugin", () => {
    expect(readCalendarNotesApi(makeApp(undefined))).toBeNull();
  });

  it("liefert null bei falscher Version", () => {
    const api = { version: 2, registerMailTransport: vi.fn(), unregisterMailTransport: vi.fn() };
    expect(readCalendarNotesApi(makeApp(api))).toBeNull();
  });

  it("liefert null wenn unregisterMailTransport fehlt", () => {
    const api = { version: 1, registerMailTransport: vi.fn() };
    expect(readCalendarNotesApi(makeApp(api))).toBeNull();
  });

  it("liefert die API bei korrekter Form", () => {
    const api = { version: 1, registerMailTransport: vi.fn(), unregisterMailTransport: vi.fn() };
    expect(readCalendarNotesApi(makeApp(api))).toBe(api);
  });
});

describe("buildMailTransport", () => {
  it("accounts() liefert privat/mail-Ids aus den Konten", async () => {
    const sendService: SendService = { send: vi.fn() };
    const transport = buildMailTransport({ accounts: () => makeAccounts(), sendService, label: "mailstone" });
    const accounts = await transport.accounts();
    expect(accounts.map((a) => a.id)).toEqual(["privat/mail", "arbeit/mail"]);
  });

  it("send() ruft sendService.send mit accountId auf und meldet Erfolg", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, messageId: "abc@example.com" });
    const sendService: SendService = { send };
    const transport = buildMailTransport({ accounts: () => makeAccounts(), sendService, label: "mailstone" });
    const result = await transport.send({
      method: "REQUEST",
      from: "privat/mail",
      to: ["x@example.com"],
      subject: "Termin",
      text: "Text",
      ics: "BEGIN:VCALENDAR",
    });
    expect(send).toHaveBeenCalledWith("privat", expect.objectContaining({ from: "mail" }));
    expect(result).toEqual({ ok: true, messageId: "abc@example.com" });
  });

  it("send() mit ungueltigem from meldet bad-from ohne sendService aufzurufen", async () => {
    const send = vi.fn();
    const sendService: SendService = { send };
    const transport = buildMailTransport({ accounts: () => makeAccounts(), sendService, label: "mailstone" });
    const result = await transport.send({
      method: "REQUEST",
      from: "x",
      to: ["x@example.com"],
      subject: "Termin",
      text: "Text",
      ics: "BEGIN:VCALENDAR",
    });
    expect(result).toEqual({ ok: false, error: "bad-from" });
    expect(send).not.toHaveBeenCalled();
  });

  it("send() meldet den SendService-Fehlercode", async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, code: "auth" });
    const sendService: SendService = { send };
    const transport = buildMailTransport({ accounts: () => makeAccounts(), sendService, label: "mailstone" });
    const result = await transport.send({
      method: "REQUEST",
      from: "privat/mail",
      to: ["x@example.com"],
      subject: "Termin",
      text: "Text",
      ics: "BEGIN:VCALENDAR",
    });
    expect(result).toEqual({ ok: false, error: "auth" });
  });

  // iMIP-Waechter (Ruling P8, Zusatz zu Task 4): die Spec sagt zu, dass der bestehende
  // iMIP-Weg (calendar-notes) NICHT durch die neue Versand-API-Bestaetigung laeuft — sonst
  // wuerde eine heute funktionierende Funktion ploetzlich Modals werfen. Ein GUI-Smoke-Punkt
  // dafuer waere blind: CalendarNotesBridge exponiert keinen `transport`-Zugriff nach aussen
  // (nur tryRegister/unregister/registered). Der Wachtgegenstand ist deshalb strukturell.
  it("send() ruft sendService.send DIREKT — kein Consent-Schritt dazwischen", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, messageId: "abc@example.com" });
    const sendService: SendService = { send };
    const transport = buildMailTransport({ accounts: () => makeAccounts(), sendService, label: "mailstone" });

    const ergebnis = transport.send({
      method: "REQUEST",
      from: "privat/mail",
      to: ["x@example.com"],
      subject: "Termin",
      text: "Text",
      ics: "BEGIN:VCALENDAR",
    });

    // Ein Consent-Schritt waere asynchron VOR dem SendService-Aufruf (Modal-Open, Nutzer-
    // Interaktion) — hier ist sendService.send bereits synchron aufgerufen, bevor auf das
    // Ergebnis gewartet wird. Kein Modal-Mock, kein Timer, keine Zustimmungs-Option im
    // Deps-Objekt von buildMailTransport ueberhaupt vorhanden.
    expect(send).toHaveBeenCalledTimes(1);
    await ergebnis;
  });

  it("importiert kein Modal/Consent-Modul (strukturelle Trennung vom Versand-API-Adapter)", () => {
    const quelle = readFileSync(
      resolve(__dirname, "../../src/obsidian/calendar-notes-bridge.ts"),
      "utf8",
    );
    expect(quelle).not.toMatch(/send-consent-modal/);
    expect(quelle).not.toMatch(/askSendConsent/);
  });
});

describe("calendar-notes-bridge importiert plugin-api nicht", () => {
  // Zweite Haelfte des iMIP-Waechters: plugin-api.ts ist der Ort, an dem die neue
  // Zustimmungs-/Vertrauens-Logik lebt. Ein Import von dort waere der strukturelle Beleg,
  // dass der iMIP-Pfad ploetzlich an dieser Logik haengt — auch ohne dass ein einzelner Test
  // das Verhalten schon sichtbar bricht.
  //
  // ⚠️ Bekannte Grenze (Review Fix-Runde 1, Finding "minor", bewusst nicht behoben): dieser
  // Waechter liest den STATISCHEN Quelltext auf `^import `-Zeilen. Ein dynamischer Import
  // (`await import("./plugin-api")`) traegt keine solche Zeile und wuerde durchrutschen. Das
  // ist eine bekannte Notloesung, keine Luecke, die hier noch geschlossen werden soll — ein
  // echter Laufzeit-Beweis haette einen Angriffspunkt gebraucht, den CalendarNotesBridge
  // laut Ruling P8 nicht bietet (kein `transport`-Zugriff nach aussen).
  it("die Importzeilen von calendar-notes-bridge.ts nennen nur die vier bekannten Module", () => {
    const quelle = readFileSync(
      resolve(__dirname, "../../src/obsidian/calendar-notes-bridge.ts"),
      "utf8",
    );
    const importZeilen = quelle
      .split("\n")
      .filter((zeile) => /^import /.test(zeile));
    expect(importZeilen.some((z) => /plugin-api/.test(z))).toBe(false);
    expect(importZeilen.some((z) => /["']obsidian["']/.test(z))).toBe(true);
    expect(importZeilen.some((z) => /core\/settings/.test(z))).toBe(true);
    expect(importZeilen.some((z) => /core\/send\/service/.test(z))).toBe(true);
    expect(importZeilen.some((z) => /core\/send\/imip/.test(z))).toBe(true);
  });
});

describe("createCalendarNotesBridge", () => {
  const transport = buildMailTransport({
    accounts: () => makeAccounts(),
    sendService: { send: vi.fn() },
    label: "mailstone",
  });

  it("tryRegister() registriert den Transport und ist idempotent", () => {
    const registerMailTransport = vi.fn().mockReturnValue({ ok: true });
    const unregisterMailTransport = vi.fn();
    const app = makeApp({ version: 1, registerMailTransport, unregisterMailTransport });
    const bridge = createCalendarNotesBridge(app, transport);

    expect(bridge.tryRegister()).toBe(true);
    expect(registerMailTransport).toHaveBeenCalledTimes(1);
    expect(registerMailTransport).toHaveBeenCalledWith(expect.objectContaining({ id: "mailstone" }));
    expect(bridge.registered).toBe(true);

    expect(bridge.tryRegister()).toBe(true);
    expect(registerMailTransport).toHaveBeenCalledTimes(1);
  });

  it("tryRegister() liefert false ohne Nachbar-Plugin", () => {
    const app = makeApp(undefined);
    const bridge = createCalendarNotesBridge(app, transport);
    expect(bridge.tryRegister()).toBe(false);
    expect(bridge.registered).toBe(false);
  });

  it("unregister() nach Entladen des Nachbarn wirft nicht, ruft aber weiterhin die gemerkte Instanz", () => {
    const registerMailTransport = vi.fn().mockReturnValue({ ok: true });
    const unregisterMailTransport = vi.fn();
    const app: { plugins: { plugins: Record<string, { api?: unknown }> } } = {
      plugins: { plugins: { "calendar-notes": { api: { version: 1, registerMailTransport, unregisterMailTransport } } } },
    };
    const bridge = createCalendarNotesBridge(app as unknown as import("obsidian").App, transport);
    expect(bridge.tryRegister()).toBe(true);

    // Nachbar wird entladen: api verschwindet aus dem Plugin-Register. unregister() spricht
    // trotzdem die gemerkte Instanz an (die bei der Registrierung angenommen hat), nicht einen
    // frischen (jetzt leeren) Read — s. calendar-notes-bridge.ts.
    delete app.plugins.plugins["calendar-notes"];

    expect(() => bridge.unregister()).not.toThrow();
    expect(bridge.registered).toBe(false);
    expect(unregisterMailTransport).toHaveBeenCalledWith("mailstone");
  });

  it("unregister() nach einem Reload des Nachbarn spricht die urspruengliche Instanz an, nicht die neue", () => {
    const firstRegister = vi.fn().mockReturnValue({ ok: true });
    const firstUnregister = vi.fn();
    const secondRegister = vi.fn().mockReturnValue({ ok: true });
    const secondUnregister = vi.fn();
    const app: { plugins: { plugins: Record<string, { api?: unknown }> } } = {
      plugins: {
        plugins: { "calendar-notes": { api: { version: 1, registerMailTransport: firstRegister, unregisterMailTransport: firstUnregister } } },
      },
    };
    const bridge = createCalendarNotesBridge(app as unknown as import("obsidian").App, transport);
    expect(bridge.tryRegister()).toBe(true);

    // Der Nachbar laedt neu: gleiche Form, aber eine frische Objekt-Instanz — mailstone hat
    // davon nichts mitbekommen (kein unregister() dazwischen).
    app.plugins.plugins["calendar-notes"] = {
      api: { version: 1, registerMailTransport: secondRegister, unregisterMailTransport: secondUnregister },
    };

    bridge.unregister();

    // Angesprochen wird die Instanz, bei der tatsaechlich registriert wurde (die alte) — nicht
    // die neue, fremde Instanz, die zufaellig unter demselben Plugin-Key steht.
    expect(firstUnregister).toHaveBeenCalledWith("mailstone");
    expect(secondUnregister).not.toHaveBeenCalled();
  });

  it("unregister() ruft unregisterMailTransport wenn der Nachbar noch da ist", () => {
    const registerMailTransport = vi.fn().mockReturnValue({ ok: true });
    const unregisterMailTransport = vi.fn();
    const app = makeApp({ version: 1, registerMailTransport, unregisterMailTransport });
    const bridge = createCalendarNotesBridge(app, transport);
    bridge.tryRegister();
    bridge.unregister();
    expect(unregisterMailTransport).toHaveBeenCalledWith("mailstone");
    expect(bridge.registered).toBe(false);
  });

  it("unregister() faengt eine werfende unregisterMailTransport ab und crasht nicht (onunload darf nicht abbrechen)", () => {
    const registerMailTransport = vi.fn().mockReturnValue({ ok: true });
    const unregisterMailTransport = vi.fn().mockImplementation(() => {
      throw new Error("Nachbar bereits abgebaut");
    });
    const app = makeApp({ version: 1, registerMailTransport, unregisterMailTransport });
    const bridge = createCalendarNotesBridge(app, transport);
    bridge.tryRegister();

    expect(() => bridge.unregister()).not.toThrow();
    expect(unregisterMailTransport).toHaveBeenCalledWith("mailstone");
    expect(bridge.registered).toBe(false);
  });

  it("tryRegister() liefert false, wenn der Nachbar mit { error } ablehnt (invalid-mail-transport)", () => {
    const registerMailTransport = vi.fn().mockReturnValue({ error: "invalid-mail-transport" });
    const unregisterMailTransport = vi.fn();
    const app = makeApp({ version: 1, registerMailTransport, unregisterMailTransport });
    const bridge = createCalendarNotesBridge(app, transport);

    expect(bridge.tryRegister()).toBe(false);
    expect(bridge.registered).toBe(false);

    // Ablehnung ist kein Dauerzustand — ein erneuter Versuch bleibt moeglich (z. B. nachdem der
    // Nachbar den Grund der Ablehnung behoben hat).
    registerMailTransport.mockReturnValue({ ok: true });
    expect(bridge.tryRegister()).toBe(true);
    expect(bridge.registered).toBe(true);
  });

  it("tryRegister() faengt eine werfende registerMailTransport ab und crasht nicht", () => {
    const registerMailTransport = vi.fn().mockImplementation(() => {
      throw new Error("Nachbar kaputt");
    });
    const unregisterMailTransport = vi.fn();
    const app = makeApp({ version: 1, registerMailTransport, unregisterMailTransport });
    const bridge = createCalendarNotesBridge(app, transport);

    expect(() => bridge.tryRegister()).not.toThrow();
    expect(bridge.tryRegister()).toBe(false);
    expect(bridge.registered).toBe(false);
  });

  it("registered wird false, wenn ein Nachbar-Reload das api-Objekt durch eine neue Instanz ersetzt", () => {
    const firstRegister = vi.fn().mockReturnValue({ ok: true });
    const firstUnregister = vi.fn();
    const app: { plugins: { plugins: Record<string, { api?: unknown }> } } = {
      plugins: {
        plugins: { "calendar-notes": { api: { version: 1, registerMailTransport: firstRegister, unregisterMailTransport: firstUnregister } } },
      },
    };
    const bridge = createCalendarNotesBridge(app as unknown as import("obsidian").App, transport);

    expect(bridge.tryRegister()).toBe(true);
    expect(bridge.registered).toBe(true);

    // Der Nachbar laedt neu: gleiche Form, aber eine frische Objekt-Instanz — als haette er ein
    // Reload durchlaufen, ohne dass mailstone unregister() aufgerufen bekommen hat.
    const secondRegister = vi.fn().mockReturnValue({ ok: true });
    const secondUnregister = vi.fn();
    app.plugins.plugins["calendar-notes"] = {
      api: { version: 1, registerMailTransport: secondRegister, unregisterMailTransport: secondUnregister },
    };

    expect(bridge.registered).toBe(false);
    expect(bridge.tryRegister()).toBe(true);
    expect(secondRegister).toHaveBeenCalledTimes(1);
    expect(bridge.registered).toBe(true);
  });
});
