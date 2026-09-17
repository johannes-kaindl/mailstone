// tests/core/sync/run-state.test.ts
import { describe, it, expect } from "vitest";
import { recordRun, parseRunState, nextDueAt, latestSuccessfulSyncAt, type RunState } from "../../../src/core/sync/run-state";
import { dueAccounts } from "../../../src/core/sync/schedule";
import { newAccount, type Account } from "../../../src/core/settings";
import type { SyncCounts } from "../../../src/core/sync/events";

const MIN = 60_000;
const NIX: SyncCounts = { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 };

function acc(id: string, intervalMin: number, enabled = true): Account {
  const a = newAccount(id);
  a.sync = { enabled, intervalMin };
  return a;
}

describe("recordRun", () => {
  it("haelt Erfolg mit Zaehlern und ohne Code", () => {
    const next = recordRun({}, [{ ok: true, accountId: "a", counts: { ...NIX, created: 3 } }], 1000);
    expect(next["a"]).toEqual({ at: 1000, ok: true, counts: { ...NIX, created: 3 } });
    expect(next["a"]?.code).toBeUndefined();
  });

  it("haelt den Fehlercode, damit die Anzeige error.sync.<code> aufloesen kann", () => {
    const next = recordRun({}, [{ ok: false, accountId: "a", code: "auth" }], 2000);
    expect(next["a"]?.ok).toBe(false);
    expect(next["a"]?.code).toBe("auth");
  });

  it("ersetzt den Vorlauf desselben Kontos und laesst fremde Konten unberuehrt", () => {
    const vorher: RunState = { a: { at: 1, ok: false, code: "connect", counts: NIX }, b: { at: 5, ok: true, counts: NIX } };
    const next = recordRun(vorher, [{ ok: true, accountId: "a", counts: NIX }], 9);
    expect(next["a"]).toEqual({ at: 9, ok: true, counts: NIX });
    expect(next["b"]).toBe(vorher["b"]);
  });

  it("mutiert den Eingabezustand nicht", () => {
    const vorher: RunState = { a: { at: 1, ok: true, counts: NIX } };
    recordRun(vorher, [{ ok: true, accountId: "a", counts: NIX }], 9);
    expect(vorher["a"]?.at).toBe(1);
  });

  it("bucht einen busy-Lauf NICHT als Lauf", () => {
    // `busy` heisst: ein anderer Lauf hielt die Sperre, dieses Konto wurde gar nicht
    // synchronisiert. Es als Lauf zu buchen ueberschriebe den letzten echten Stand mit
    // einem Nicht-Ereignis — dieselbe Ueberlegung, aus der runDueSyncs den lastRun-Stempel
    // bei `busy` zuruecknimmt (main.ts).
    const vorher: RunState = { a: { at: 1, ok: true, counts: NIX } };
    const next = recordRun(vorher, [{ ok: false, accountId: "a", code: "busy" }], 9);
    expect(next["a"]).toEqual({ at: 1, ok: true, counts: NIX });
  });
});

describe("parseRunState", () => {
  it("liefert leer bei Unsinn statt zu werfen", () => {
    expect(parseRunState(undefined)).toEqual({});
    expect(parseRunState(null)).toEqual({});
    expect(parseRunState("kaputt")).toEqual({});
    expect(parseRunState(42)).toEqual({});
    expect(parseRunState([1, 2])).toEqual({});
  });

  it("wirft einzelne unbrauchbare Eintraege weg und behaelt die guten", () => {
    const raw = {
      gut: { at: 5, ok: true, counts: NIX },
      ohneAt: { ok: true, counts: NIX },
      atText: { at: "gestern", ok: true, counts: NIX },
      ohneCounts: { at: 5, ok: true },
      // unvollstaendige counts (fehlende Schluessel) muessen denselben Weg gehen wie
      // ganz fehlende counts — sonst prueft der Test nur "vorhanden ja/nein", nicht die Form.
      kaputteCounts: { at: 5, ok: true, counts: { created: 1 } },
      keinObjekt: 7,
    };
    expect(Object.keys(parseRunState(raw))).toEqual(["gut"]);
  });

  it("behaelt den Code nur, wenn er eine Zeichenkette ist", () => {
    const raw = { a: { at: 5, ok: false, code: 42, counts: NIX } };
    expect(parseRunState(raw)["a"]?.code).toBeUndefined();
  });

  it("wirft einen UNBEKANNTEN Code weg — sonst zeigt die Anzeige rohes error.sync.xyz", () => {
    // Die Anzeige baut aus dem Code den i18n-Schluessel `error.sync.<code>`, und t() gibt bei
    // unbekanntem Schluessel den Schluessel selbst zurueck. Ein hand-editiertes data.json
    // brachte damit "error.sync.xyz" auf den Bildschirm. Der Eintrag bleibt erhalten (der Lauf
    // IST gescheitert), nur der undeutbare Code faellt weg — die Anzeige nimmt dann ihren
    // protocol-Rueckfall.
    const raw = { a: { at: 5, ok: false, code: "xyz", counts: NIX } };
    const gelesen = parseRunState(raw);
    expect(gelesen["a"]?.ok).toBe(false);
    expect(gelesen["a"]?.code).toBeUndefined();
  });

  it("GEGENPROBE: einen gueltigen Code behaelt es", () => {
    // Ohne diese Haelfte bestuende der Test darueber auch, wenn JEDER Code weggeworfen wuerde.
    expect(parseRunState({ a: { at: 5, ok: false, code: "folder-missing", counts: NIX } })["a"]?.code).toBe("folder-missing");
  });
});

describe("nextDueAt", () => {
  it("rechnet Intervall auf den letzten Lauf", () => {
    expect(nextDueAt(acc("a", 5), 10 * MIN)).toBe(15 * MIN);
  });

  it("liefert null fuer ein deaktiviertes Konto — es wird nie faellig", () => {
    expect(nextDueAt(acc("a", 5, false), 10 * MIN)).toBeNull();
  });

  it("liefert null ohne bekannten letzten Lauf — faellig heisst sofort, nicht irgendwann", () => {
    expect(nextDueAt(acc("a", 5), undefined)).toBeNull();
  });

  it("klemmt einen unbrauchbaren Intervallwert auf einen Takt, wie dueAccounts", () => {
    // Gleiche Begruendung wie in schedule.ts: NaN-Vergleiche sind immer false, ein Konto
    // waere sonst nie wieder faellig — ein stiller Ausfall ist der schlechtere Ausgang.
    const kaputt = acc("a", Number.NaN);
    expect(nextDueAt(kaputt, 10 * MIN)).toBe(11 * MIN);
  });

  it("rechnet mit DERSELBEN Klemmung wie der Wecker — fuer jeden krummen Wert", () => {
    // Die Formel stand bis zum Abschluss-Review byte-gleich in run-state.ts und schedule.ts,
    // mit dem Kommentar „damit Anzeige und Wecker nicht auseinanderlaufen" — gesichert war das
    // nicht. Jetzt teilen sich beide `intervalMs`, und dieser Test misst die Zusage direkt:
    // was nextDueAt als naechsten Termin nennt, ist genau der Moment, ab dem dueAccounts das
    // Konto faellig meldet.
    for (const wert of [Number.NaN, 0, -5, 0.25, 1, 5, Number.POSITIVE_INFINITY]) {
      const a = acc("a", wert);
      const faellig = nextDueAt(a, 10 * MIN);
      expect(faellig, `intervalMin=${String(wert)}`).not.toBeNull();
      const t = faellig ?? 0;
      expect(dueAccounts([a], { a: 10 * MIN }, t - 1), `intervalMin=${String(wert)} kurz davor`).toEqual([]);
      expect(dueAccounts([a], { a: 10 * MIN }, t), `intervalMin=${String(wert)} genau dann`).toEqual(["a"]);
    }
  });
});

describe("latestSuccessfulSyncAt", () => {
  it("liefert null ohne jeden Lauf", () => {
    expect(latestSuccessfulSyncAt({})).toBeNull();
  });

  it("ignoriert gescheiterte Laeufe — sie haben nichts synchronisiert", () => {
    const state: RunState = { a: { at: 100, ok: false, code: "auth", counts: NIX } };
    expect(latestSuccessfulSyncAt(state)).toBeNull();
  });

  it("nimmt den juengsten erfolgreichen Lauf ueber mehrere Konten", () => {
    const state: RunState = {
      a: { at: 100, ok: true, counts: NIX },
      b: { at: 300, ok: true, counts: NIX },
      c: { at: 200, ok: false, code: "connect", counts: NIX },
    };
    expect(latestSuccessfulSyncAt(state)).toBe(300);
  });
});
