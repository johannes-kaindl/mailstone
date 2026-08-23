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
});

describe("createCalendarNotesBridge", () => {
  const transport = buildMailTransport({
    accounts: () => makeAccounts(),
    sendService: { send: vi.fn() },
    label: "mailstone",
  });

  it("tryRegister() registriert den Transport und ist idempotent", () => {
    const registerMailTransport = vi.fn();
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

  it("unregister() nach Entladen des Nachbarn wirft nicht und setzt registered zurueck", () => {
    const registerMailTransport = vi.fn();
    const unregisterMailTransport = vi.fn();
    const app: { plugins: { plugins: Record<string, { api?: unknown }> } } = {
      plugins: { plugins: { "calendar-notes": { api: { version: 1, registerMailTransport, unregisterMailTransport } } } },
    };
    const bridge = createCalendarNotesBridge(app as unknown as import("obsidian").App, transport);
    expect(bridge.tryRegister()).toBe(true);

    // Nachbar wird entladen: api verschwindet.
    delete app.plugins.plugins["calendar-notes"];

    expect(() => bridge.unregister()).not.toThrow();
    expect(bridge.registered).toBe(false);
    expect(unregisterMailTransport).not.toHaveBeenCalled();
  });

  it("unregister() ruft unregisterMailTransport wenn der Nachbar noch da ist", () => {
    const registerMailTransport = vi.fn();
    const unregisterMailTransport = vi.fn();
    const app = makeApp({ version: 1, registerMailTransport, unregisterMailTransport });
    const bridge = createCalendarNotesBridge(app, transport);
    bridge.tryRegister();
    bridge.unregister();
    expect(unregisterMailTransport).toHaveBeenCalledWith("mailstone");
    expect(bridge.registered).toBe(false);
  });
});
