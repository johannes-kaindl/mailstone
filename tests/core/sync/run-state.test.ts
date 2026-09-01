// tests/core/sync/run-state.test.ts
import { describe, it, expect } from "vitest";
import { recordRun, parseRunState, nextDueAt, type RunState } from "../../../src/core/sync/run-state";
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
});
