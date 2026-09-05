import { describe, it, expect, vi } from "vitest";
import { createInboxHost, type InboxHostDeps } from "../../src/obsidian/views/inbox-host";
import { newAccount, type Account } from "../../src/core/settings";
import type { InboxFetchResult } from "../../src/core/inbox/fetch";
import type { InboxActionResult } from "../../src/core/inbox/actions";

function acc(id: string): Account {
  return newAccount(id);
}

const ZEILE = { uid: 1, mailId: "a@example.invalid", from: "A", subject: "S", date: "", imVault: false, ungelesen: true };

function deps(over: Partial<InboxHostDeps> = {}): InboxHostDeps {
  return {
    accounts: () => [acc("a")],
    isBusy: () => false,
    fetchInbox: vi.fn(async (): Promise<InboxFetchResult> => ({ ok: true, rows: [ZEILE], kannVerschieben: true })),
    adopt: vi.fn(async (): Promise<InboxActionResult> => ({ ok: true })),
    archive: vi.fn(async (): Promise<InboxActionResult> => ({ ok: true })),
    confirmMove: vi.fn(async () => true),
    targetFolder: () => "Allowlist",
    syncNow: vi.fn(async () => undefined),
    notifyError: vi.fn(),
    openSettings: vi.fn(),
    onChange: () => () => undefined,
    taskNotesAvailable: () => false,
    createTask: vi.fn(async () => ({ kind: "done" as const })),
    ...over,
  };
}

describe("createInboxHost — I1: kein Busy-Zusammenstoss nach 'Uebernehmen'", () => {
  it("wartet auf syncNow, BEVOR es selbst neu laedt", async () => {
    const reihenfolge: string[] = [];
    const syncNow = vi.fn(async () => {
      reihenfolge.push("sync-start");
      await Promise.resolve();
      reihenfolge.push("sync-ende");
    });
    const fetchInbox = vi.fn(async (): Promise<InboxFetchResult> => {
      reihenfolge.push("laden");
      return { ok: true, rows: [ZEILE], kannVerschieben: true };
    });
    const h = createInboxHost(deps({ syncNow, fetchInbox }));
    h.adopt(7);
    // Mikrotask-Warteschlange leerlaufen lassen, bis alle async-Ketten fertig sind.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(reihenfolge.indexOf("sync-ende")).toBeLessThan(reihenfolge.lastIndexOf("laden"));
  });

  it("haelt bei code 'busy' den vorherigen Zustand statt in 'fehler' zu kippen", async () => {
    let liefereBusy = false;
    const fetchInbox = vi.fn(async (): Promise<InboxFetchResult> =>
      liefereBusy ? { ok: false, code: "busy", detail: "x" } : { ok: true, rows: [ZEILE], kannVerschieben: true },
    );
    const h = createInboxHost(deps({ fetchInbox }));
    h.refresh();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.viewModel().state).toBe("gefuellt");
    liefereBusy = true;
    h.refresh();
    await new Promise((r) => setTimeout(r, 0));
    // Weiterhin "gefuellt" mit den alten Zeilen — kein "fehler" fuer einen blossen Zusammenstoss.
    expect(h.viewModel().state).toBe("gefuellt");
    expect(h.viewModel().fehlerCode).toBeNull();
  });
});

describe("createInboxHost — I2: ensureLoaded laedt nur beim ersten Mal", () => {
  it("ruft fetchInbox beim ersten ensureLoaded auf, danach nicht mehr", async () => {
    const fetchInbox = vi.fn(async (): Promise<InboxFetchResult> => ({ ok: true, rows: [], kannVerschieben: true }));
    const h = createInboxHost(deps({ fetchInbox }));
    h.ensureLoaded();
    h.ensureLoaded();
    h.ensureLoaded();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchInbox).toHaveBeenCalledTimes(1);
  });

  it("ein synced/changed-Event laedt neu, statt nur neu zu zeichnen — aber erst NACH dem ersten Oeffnen", async () => {
    // Ein Objekt statt einer nackten Variable — sonst narrowt TS `cb` ueber die
    // Closure-Zuweisung hinweg faelschlich auf `never` (bekannte CFA-Falle bei `let`).
    const box: { cb: (() => void) | null } = { cb: null };
    const fetchInbox = vi.fn(async (): Promise<InboxFetchResult> => ({ ok: true, rows: [], kannVerschieben: true }));
    const h = createInboxHost(deps({ fetchInbox, onChange: (c) => { box.cb = c; return () => undefined; } }));
    // VOR dem ersten Oeffnen: ein Sync im Hintergrund darf keine IMAP-Verbindung fuer einen
    // Tab ausloesen, den niemand je gesehen hat (das erste Laden bleibt lazy, Spec § 8).
    box.cb?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchInbox).toHaveBeenCalledTimes(0);
    // NACH dem ersten Oeffnen macht ein Sync die Liste veraltet und muss neu laden.
    h.ensureLoaded();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchInbox).toHaveBeenCalledTimes(1);
    box.cb?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchInbox).toHaveBeenCalledTimes(2);
  });
});

describe("createInboxHost — I5: ein spaeter angelegtes erstes Konto wird gefunden", () => {
  it("waehlt beim naechsten laden() das erste verfuegbare Konto, wenn 'kontoId' leer blieb", async () => {
    let konten: Account[] = [];
    const fetchInbox = vi.fn(async (): Promise<InboxFetchResult> => ({ ok: true, rows: [ZEILE], kannVerschieben: true }));
    const h = createInboxHost(deps({ accounts: () => konten, fetchInbox }));
    expect(h.selectedAccountId()).toBe("");
    konten = [acc("neu")];
    h.refresh();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.selectedAccountId()).toBe("neu");
    expect(fetchInbox).toHaveBeenCalledWith("neu");
  });
});

describe("createInboxHost — Kleinbefund: fehlender Zielordner VOR der Bestaetigung", () => {
  it("fragt nicht erst nach Bestaetigung, wenn kein Zielordner konfiguriert ist", async () => {
    const confirmMove = vi.fn(async () => true);
    const notifyError = vi.fn();
    const h = createInboxHost(deps({ targetFolder: () => "", confirmMove, notifyError }));
    h.adopt(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(confirmMove).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledWith("no-target-folder");
  });
});

// Fix-Runde 1, Minor 6: bisher war `taskNotesAvailable: () => false` der Default in JEDEM
// Test — die dritte Aktion selbst (Bestaetigung, no-target-folder-Riegel, das
// `adopted`-gesteuerte Neuladen) war unbelegt.
describe("createInboxHost — Task 6: dritte Aktion 'Aufgabe erstellen'", () => {
  async function geladenerHost(over: Partial<InboxHostDeps> = {}) {
    const h = createInboxHost(deps({ taskNotesAvailable: () => true, ...over }));
    h.ensureLoaded();
    await new Promise((r) => setTimeout(r, 0));
    return h;
  }

  it("fragt vor dem Verschieben nach Bestaetigung und ruft dann createTask mit Konto, UID und Message-ID", async () => {
    const confirmMove = vi.fn(async () => true);
    const createTask = vi.fn(async () => ({ kind: "done" as const }));
    const h = await geladenerHost({ confirmMove, createTask });
    h.createTask(ZEILE.uid);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(confirmMove).toHaveBeenCalledWith("createTask", "Allowlist");
    expect(createTask).toHaveBeenCalledWith("a", ZEILE.uid, ZEILE.mailId);
  });

  it("ruft createTask nicht, wenn der Nutzer die Bestaetigung ablehnt", async () => {
    const confirmMove = vi.fn(async () => false);
    const createTask = vi.fn(async () => ({ kind: "done" as const }));
    const h = await geladenerHost({ confirmMove, createTask });
    h.createTask(ZEILE.uid);
    await new Promise((r) => setTimeout(r, 0));
    expect(createTask).not.toHaveBeenCalled();
  });

  it("bricht mit 'no-target-folder' ab, ohne zu bestaetigen und ohne createTask aufzurufen", async () => {
    const confirmMove = vi.fn(async () => true);
    const notifyError = vi.fn();
    const createTask = vi.fn();
    const h = await geladenerHost({ targetFolder: () => "", confirmMove, notifyError, createTask });
    h.createTask(ZEILE.uid);
    await new Promise((r) => setTimeout(r, 0));
    expect(confirmMove).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledWith("no-target-folder");
    expect(createTask).not.toHaveBeenCalled();
  });

  it("laedt NICHT neu, wenn der Fehler VOR der Uebernahme kam (adopted:false) — die Liste ist unveraendert", async () => {
    const fetchInbox = vi.fn(async (): Promise<InboxFetchResult> => ({ ok: true, rows: [ZEILE], kannVerschieben: true }));
    const notifyError = vi.fn();
    const createTask = vi.fn(async () => ({ kind: "error" as const, code: "busy", adopted: false }));
    const h = await geladenerHost({ fetchInbox, notifyError, createTask });
    h.createTask(ZEILE.uid);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(notifyError).toHaveBeenCalledWith("busy");
    expect(fetchInbox).toHaveBeenCalledTimes(1); // nur das initiale ensureLoaded()
  });

  it("laedt neu, wenn der Fehler NACH der Uebernahme kam (adopted:true) — die Mail hat den Posteingang verlassen", async () => {
    const fetchInbox = vi.fn(async (): Promise<InboxFetchResult> => ({ ok: true, rows: [ZEILE], kannVerschieben: true }));
    const notifyError = vi.fn();
    const createTask = vi.fn(async () => ({ kind: "error" as const, code: "error.command.task-create-failed", adopted: true }));
    const h = await geladenerHost({ fetchInbox, notifyError, createTask });
    h.createTask(ZEILE.uid);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(notifyError).toHaveBeenCalledWith("error.command.task-create-failed");
    expect(fetchInbox).toHaveBeenCalledTimes(2); // initiales ensureLoaded() + Neuladen danach
  });

  it("laedt neu bei 'done'", async () => {
    const fetchInbox = vi.fn(async (): Promise<InboxFetchResult> => ({ ok: true, rows: [ZEILE], kannVerschieben: true }));
    const createTask = vi.fn(async () => ({ kind: "done" as const }));
    const h = await geladenerHost({ fetchInbox, createTask });
    h.createTask(ZEILE.uid);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchInbox).toHaveBeenCalledTimes(2);
  });
});
