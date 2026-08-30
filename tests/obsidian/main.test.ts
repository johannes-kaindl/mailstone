import { describe, it, expect } from "vitest";
import { syncFailureStatus, syncNotices, syncIdleStatus, createPersister } from "../../src/main";
import type { SyncRunResult } from "../../src/core/sync/service";
import { t } from "../../src/vendor/code-kit/i18n";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

// Fix-Runde 1, Finding 1: `runSync` verliess sich fuer den Statusleisten-Reset allein auf das
// "synced"-Event, das der Sync-Service nur auf dem Erfolgspfad EINES Kontos feuert — scheiterten
// ALLE aktivierten Konten, blieb "Mailstone: synchronisiert…" dauerhaft stehen. `syncFailureStatus`
// ist reine Logik (kein Obsidian-Zugriff), deshalb direkt ohne Plugin-/App-Mock testbar.
describe("syncFailureStatus", () => {
  it("liefert einen Fehlertext, wenn ALLE Ergebnisse fehlgeschlagen sind", () => {
    const results: SyncRunResult[] = [{ ok: false, accountId: "a1", code: "no-secret" }];
    expect(syncFailureStatus(results)).toBe(`Mailstone: ${t("error.sync.no-secret")}`);
  });

  it("liefert null, wenn mindestens ein Konto erfolgreich war (das \"synced\"-Event hat den Status schon gesetzt)", () => {
    const results: SyncRunResult[] = [
      { ok: false, accountId: "a1", code: "auth" },
      { ok: true, accountId: "a2", counts: { created: 1, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 } },
    ];
    expect(syncFailureStatus(results)).toBeNull();
  });

  it("liefert null ohne Ergebnisse (keine aktivierten Konten)", () => {
    expect(syncFailureStatus([])).toBeNull();
  });
});

// M3-Nachlese: `detachSkipped` steckte im `!silent`-Zweig und war damit im unbeaufsichtigten
// Intervall-Lauf unsichtbar — genau dort, wo der Fall auftritt und wo niemand zusieht. Die
// Auswahl der Meldungen ist jetzt eine reine Funktion, damit sie ohne Obsidian pruefbar ist.
function okRun(counts: Partial<Extract<SyncRunResult, { ok: true }>["counts"]>): SyncRunResult {
  return { ok: true, accountId: "a1", counts: { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0, ...counts } };
}

describe("syncNotices", () => {
  it("meldet ausgelassene Abloesungen AUCH im stillen Lauf", () => {
    expect(syncNotices([okRun({ detachSkipped: 2 })], true).notices).toEqual([
      { key: "notice.sync.detachSkipped", args: [2] },
    ]);
  });

  it("schweigt im stillen Lauf, wenn es nichts Ausgelassenes gab", () => {
    expect(syncNotices([okRun({ created: 3 })], true).notices).toEqual([]);
  });

  it("meldet im lauten Lauf die Zusammenfassung und die Abloesungen getrennt", () => {
    expect(syncNotices([okRun({ created: 1, reattached: 2, detached: 3, errors: 4, detachSkipped: 5 })], false).notices).toEqual([
      { key: "notice.sync.done", args: [1, 2, 3, 4] },
      { key: "notice.sync.detachSkipped", args: [5] },
    ]);
  });

  it("summiert ueber mehrere Konten und ignoriert fehlgeschlagene", () => {
    const results: SyncRunResult[] = [okRun({ created: 1, detachSkipped: 1 }), { ok: false, accountId: "a2", code: "auth" }, okRun({ created: 2, detachSkipped: 3 })];
    expect(syncNotices(results, false).notices).toEqual([
      { key: "notice.sync.done", args: [3, 0, 0, 0] },
      { key: "notice.sync.detachSkipped", args: [4] },
    ]);
  });

  it("meldet nichts, wenn kein Konto erfolgreich war (der Fehlertext kommt aus syncFailureStatus)", () => {
    expect(syncNotices([{ ok: false, accountId: "a1", code: "auth" }], false).notices).toEqual([]);
  });
});

// M3-Nachlese: die Statusleiste fuellte "{0} Notizen" mit `created + reattached` des letzten
// Laufs — einem LAUF-Zaehler in der Form einer Bestandszahl. Nach einem Lauf ohne Aenderungen
// stand dort "0 Notizen", was wie ein leerer Vault aussieht. Der Text beschreibt jetzt den Lauf.
describe("syncIdleStatus", () => {
  it("nennt die Zahl, wenn der Lauf etwas geaendert hat", () => {
    expect(syncIdleStatus({ created: 2, reattached: 1 }, "14:48")).toBe(t("status.sync.idle", "3", "14:48"));
  });

  it("sagt \"keine Aenderungen\" statt \"0 Notizen\"", () => {
    const text = syncIdleStatus({ created: 0, reattached: 0 }, "14:48");
    expect(text).toBe(t("status.sync.idleNoChange", "14:48"));
    expect(text).not.toMatch(/\b0\b/);
  });
});

// M3-Nachlese: `saveSettings()` lief in jedem Intervall-Tick, auch wenn der Lauf nichts geaendert
// hatte — alle fuenf Minuten ein Schreibvorgang auf eine Datei, die Obsidian Sync und Git
// beobachten. Der Persister vergleicht den serialisierten Zustand und schreibt nur bei Aenderung.
describe("createPersister", () => {
  function spy() {
    const seen: string[] = [];
    return { seen, save: (s: unknown) => { seen.push(JSON.stringify(s)); return Promise.resolve(); } };
  }

  it("schreibt den ersten Stand", async () => {
    const s = spy();
    const persist = createPersister(s.save);
    expect(await persist({ a: 1 })).toBe(true);
    expect(s.seen).toHaveLength(1);
  });

  it("schreibt nicht, wenn sich nichts geaendert hat", async () => {
    const s = spy();
    const persist = createPersister(s.save);
    await persist({ a: 1 });
    expect(await persist({ a: 1 })).toBe(false);
    expect(s.seen).toHaveLength(1);
  });

  it("schreibt wieder, sobald sich etwas aendert", async () => {
    const s = spy();
    const persist = createPersister(s.save);
    await persist({ a: 1 });
    await persist({ a: 2 });
    expect(s.seen).toHaveLength(2);
  });

  // Der Stand darf erst NACH erfolgreichem Schreiben als geschrieben gelten: merkt er ihn sich
  // vorher, gilt eine Aenderung, deren Schreibvorgang gescheitert ist, als persistiert — und der
  // naechste Aufruf mit demselben Zustand tut nichts mehr. Die Aenderung waere still verloren.
  it("merkt sich einen Stand nicht, wenn das Schreiben fehlschlaegt", async () => {
    let fail = true;
    const seen: unknown[] = [];
    const persist = createPersister((s) => { if (fail) return Promise.reject(new Error("Platte voll")); seen.push(s); return Promise.resolve(); });
    await expect(persist({ a: 1 })).rejects.toThrow("Platte voll");
    fail = false;
    expect(await persist({ a: 1 })).toBe(true);
    expect(seen).toHaveLength(1);
  });
});

// Review-Befunde (2026-08-30) zur Fix-Welle selbst:
describe("syncNotices — Wiederholungssperre im stillen Lauf", () => {
  function okRun2(detachSkipped: number): SyncRunResult {
    return { ok: true, accountId: "a1", counts: { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped, errors: 0 } };
  }

  // `undetermined > 0` haelt sich von Natur aus ueber viele Laeufe: ein Erstbestand braucht
  // Dutzende, und eine Mail ohne bestimmbare ID bleibt es dauerhaft. Bei einem Takt von einer
  // Minute waere das ein Popup pro Minute, stundenlang — schlimmer als der Befund, der die
  // Meldung ueberhaupt in den stillen Lauf gebracht hat.
  it("meldet denselben Stand im stillen Lauf nur einmal", () => {
    const erst = syncNotices([okRun2(3)], true, null);
    expect(erst.notices).toEqual([{ key: "notice.sync.detachSkipped", args: [3] }]);
    expect(erst.detachSkipped).toBe(3);
    expect(syncNotices([okRun2(3)], true, 3).notices).toEqual([]);
  });

  it("meldet erneut, sobald sich die Zahl aendert", () => {
    expect(syncNotices([okRun2(5)], true, 3).notices).toEqual([{ key: "notice.sync.detachSkipped", args: [5] }]);
  });

  it("meldet im lauten Lauf immer, auch bei unveraendertem Stand", () => {
    expect(syncNotices([okRun2(3)], false, 3).notices).toContainEqual({ key: "notice.sync.detachSkipped", args: [3] });
  });
});

// `busy` heisst: ein anderer Lauf arbeitet gerade. Das ist kein Fehler des Kontos und darf im
// unbeaufsichtigten Takt nicht die Statusleiste uebernehmen — schon gar nicht, WAEHREND der
// manuelle Lauf, der die Sperre haelt, noch laeuft.
describe("syncFailureStatus — busy im stillen Lauf", () => {
  it("schweigt, wenn im stillen Lauf alle Fehler nur 'busy' sind", () => {
    expect(syncFailureStatus([{ ok: false, accountId: "a1", code: "busy" }], true)).toBeNull();
  });

  it("meldet weiterhin, wenn im stillen Lauf ein echter Fehler dabei ist", () => {
    const results: SyncRunResult[] = [{ ok: false, accountId: "a1", code: "busy" }, { ok: false, accountId: "a2", code: "auth" }];
    expect(syncFailureStatus(results, true)).toBe(`Mailstone: ${t("error.sync.auth")}`);
  });

  it("meldet busy im beaufsichtigten Lauf unveraendert", () => {
    expect(syncFailureStatus([{ ok: false, accountId: "a1", code: "busy" }], false)).toBe(`Mailstone: ${t("error.sync.busy")}`);
  });
});
