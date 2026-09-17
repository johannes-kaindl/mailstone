import { describe, it, expect } from "vitest";
import { syncFailureStatus, syncNotices, syncIdleStatus, createPersister, safeRunCommand, suppressDoneNotice, staleSkipCount, taskCreatedNotice, networkFeaturesAvailable } from "../../src/main";
import type { SyncRunResult } from "../../src/core/sync/service";
import type { RunResult } from "../../src/obsidian/command-flow";
import type { CommandExecuteResult } from "../../src/core/commands/execute";
import type { NotePlan } from "../../src/core/mirror/plan";
import { t } from "../../src/vendor/code-kit/i18n";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

// M3b-Nachlese, Fund 3: `runMailCommand` fing frueher nichts um seinen `runCommand()`-Aufruf
// ab; der Aufrufer startet ihn ueber `void this.runMailCommand(...)`, also blieb ein Wurf
// eine unbeobachtete Promise-Ablehnung — kein Notice, kein Status, nichts. `safeRunCommand`
// ist reine Logik (kein Obsidian-Zugriff), deshalb direkt testbar.
describe("safeRunCommand", () => {
  it("faengt einen werfenden runCommand ab und liefert einen Fehler-Wert statt zu werfen", async () => {
    await expect(safeRunCommand(() => { throw new Error("kaputt"); })).resolves.toEqual({ kind: "error", code: "unexpected" });
  });

  it("faengt auch eine abgelehnte Promise ab", async () => {
    await expect(safeRunCommand(() => Promise.reject(new Error("kaputt")))).resolves.toEqual({ kind: "error", code: "unexpected" });
  });

  it("reicht das Ergebnis unveraendert durch, wenn runCommand nicht wirft", async () => {
    const ok: RunResult = { kind: "cancelled" };
    await expect(safeRunCommand(() => Promise.resolve(ok))).resolves.toEqual(ok);
  });
});

function okResult(over: Partial<Extract<CommandExecuteResult, { ok: true }>> = {}): Extract<CommandExecuteResult, { ok: true }> {
  return { ok: true, created: 0, updated: 0, stateChanged: 0, skipped: [], ...over };
}

// M3b-Nachlese, Sammel-Review: mail.replyExternal plant keine Notizen (nur eine URL) — ohne
// diese Bedingung meldete `runMailCommand` "Done: 0 note(s) written, 0 skipped." nach jeder
// Antwort im externen Mailprogramm, was wie ein Fehlschlag aussieht statt wie ein Erfolg.
describe("suppressDoneNotice", () => {
  it("unterdrueckt, wenn NUR eine URL geoeffnet wurde und sonst nichts geschrieben ist", () => {
    expect(suppressDoneNotice(okResult({ openedUrl: true }))).toBe(true);
  });

  it("unterdrueckt NICHT, wenn ausserdem Notizen geschrieben wurden", () => {
    expect(suppressDoneNotice(okResult({ openedUrl: true, updated: 1 }))).toBe(false);
  });

  it("unterdrueckt NICHT, wenn Plaene uebersprungen wurden (die Zahl bleibt sichtbar)", () => {
    const skipped: NotePlan[] = [{ kind: "skip", path: "Mail/x.md", mailId: "a@x", reason: "unchanged" }];
    expect(suppressDoneNotice(okResult({ openedUrl: true, skipped }))).toBe(false);
  });

  it("unterdrueckt NICHT ohne geoeffnete URL, auch wenn nichts geschrieben wurde", () => {
    expect(suppressDoneNotice(okResult())).toBe(false);
  });

  // Fix-Runde 1, Task 5: mail.createTask plant wie mail.replyExternal keine Notizen — ohne
  // diesen Fall zeigte runMailCommand "Fertig: 0 Notizen geschrieben, 0 uebersprungen." NEBEN
  // der eigenen "Aufgabe angelegt: …"-Notice.
  it("unterdrueckt, wenn NUR eine Aufgabe angelegt wurde und sonst nichts geschrieben ist", () => {
    expect(suppressDoneNotice(okResult({ taskPath: "TaskNotes/Tasks/x.md" }))).toBe(true);
  });

  it("unterdrueckt NICHT, wenn zusaetzlich zur Aufgabe Notizen geschrieben wurden", () => {
    expect(suppressDoneNotice(okResult({ taskPath: "TaskNotes/Tasks/x.md", updated: 1 }))).toBe(false);
  });

  // Fix-Runde 2, Important 1: ein leerer taskPath (Bruecke kennt keinen Pfad) muss genauso
  // unterdruecken wie ein bekannter — sonst liefe die generische "Fertig: 0 Notizen..."-Notice
  // neben (oder statt) einer eigenen Aufgaben-Notice.
  it("unterdrueckt auch mit einem LEEREN taskPath — die Aufgabe wurde trotzdem angelegt", () => {
    expect(suppressDoneNotice(okResult({ taskPath: "" }))).toBe(true);
  });
});

// Fix-Runde 2, Important 1: `mail.createTask` kann still bleiben, wenn TaskNotes keinen Pfad
// zurueckliefert (`if (r.taskPath)` allein verschluckt den leeren String). taskCreatedNotice()
// ist die reine Entscheidung, welche Notice-Variante das behebt.
describe("taskCreatedNotice", () => {
  it("liefert null, wenn keine Aufgabe angelegt wurde", () => {
    expect(taskCreatedNotice(okResult())).toBeNull();
  });

  it("liefert die Pfad-Notice mit dem Pfad als Argument", () => {
    expect(taskCreatedNotice(okResult({ taskPath: "TaskNotes/Tasks/x.md" }))).toEqual({
      key: "notice.command.taskCreated",
      args: ["TaskNotes/Tasks/x.md"],
    });
  });

  it("liefert die pfadlose Notice, wenn taskPath ein LEERER String ist", () => {
    expect(taskCreatedNotice(okResult({ taskPath: "" }))).toEqual({
      key: "notice.command.taskCreatedNoPath",
      args: [],
    });
  });
});

// Fund 2, M3b-Nachlese: der Lost-Update-Schutz in vaultPlanExecutor erzeugt einen neuen
// Skip-Grund ("content-changed") — der reine Zaehler in "Done: … skipped" sagt nicht, warum.
describe("staleSkipCount", () => {
  it("zaehlt nur Skips mit reason \"content-changed\"", () => {
    const skipped: NotePlan[] = [
      { kind: "skip", path: "a.md", mailId: "a@x", reason: "content-changed" },
      { kind: "skip", path: "b.md", mailId: "b@x", reason: "unchanged" },
      { kind: "skip", path: "c.md", mailId: "c@x", reason: "content-changed" },
    ];
    expect(staleSkipCount(skipped)).toBe(2);
  });

  it("liefert 0 ohne Skips dieser Art", () => {
    const skipped: NotePlan[] = [{ kind: "skip", path: "a.md", mailId: "a@x", reason: "missing-target" }];
    expect(staleSkipCount(skipped)).toBe(0);
  });
});

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

// Welle 7, Owner-Task „Lesemodus auf Mobile": Sync-Befehl, periodischer Sync und der
// Versand-Befehl haengen alle an dieser Funktion (onload() selbst ist laut AGENTS.md nicht
// testbar) — deshalb hier direkt gegen ein Platform-Attrappe geprueft.
describe("networkFeaturesAvailable", () => {
  it("ist wahr am Desktop — Sync-/Versand-Befehle werden registriert", () => {
    expect(networkFeaturesAvailable({ isMobile: false })).toBe(true);
  });

  it("ist falsch auf Mobile — die Socket-Schicht laedt dort nicht (tls-transport.ts)", () => {
    expect(networkFeaturesAvailable({ isMobile: true })).toBe(false);
  });

  it("liest ohne Argument das echte Platform-Objekt", () => {
    expect(typeof networkFeaturesAvailable()).toBe("boolean");
  });
});
