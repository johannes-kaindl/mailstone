import { describe, it, expect, vi } from "vitest";
import { createInboxHost, type InboxHostDeps } from "../../src/obsidian/views/inbox-host";
import { newAccount, type Account } from "../../src/core/settings";
import type { InboxFetchResult } from "../../src/core/inbox/fetch";
import type { InboxActionResult } from "../../src/core/inbox/actions";

function acc(id: string): Account {
  return newAccount(id);
}

const ZEILE = { uid: 1, from: "A", subject: "S", date: "", imVault: false, ungelesen: true };

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
