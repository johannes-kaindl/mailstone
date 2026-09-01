import { describe, it, expect } from "vitest";
import { buildCockpitViewModel } from "../../../src/core/view/cockpit-vm";
import { newAccount, type Account } from "../../../src/core/settings";
import type { RunState } from "../../../src/core/sync/run-state";
import type { SyncCounts } from "../../../src/core/sync/events";

const NIX: SyncCounts = { created: 0, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 };

function acc(id: string, label = id, enabled = true): Account {
  const a = newAccount(id);
  a.label = label;
  a.sync = { enabled, intervalMin: 5 };
  return a;
}

const keineFaelligkeit = (): number | null => null;

describe("buildCockpitViewModel — Zustandszuordnung", () => {
  it("ok bei erfolgreichem Lauf ohne Fehler", () => {
    const rs: RunState = { a: { at: 100, ok: true, counts: NIX } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.state).toBe("ok");
  });

  it("warning bei erfolgreichem Lauf mit Fehlern in den Zaehlern", () => {
    // Der Fall, fuer den is-warning im §8-Katalog steht: der Lauf ging durch und hat
    // trotzdem etwas ausgelassen — weder ok noch Fehler.
    const rs: RunState = { a: { at: 100, ok: true, counts: { ...NIX, errors: 2 } } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.state).toBe("warning");
  });

  it("warning auch bei ausgelassenen Abloesungen", () => {
    const rs: RunState = { a: { at: 100, ok: true, counts: { ...NIX, detachSkipped: 1 } } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.state).toBe("warning");
  });

  it("error bei gescheitertem Lauf, mit Schluessel error.sync.<code>", () => {
    const rs: RunState = { a: { at: 100, ok: false, code: "auth", counts: NIX } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.state).toBe("error");
    expect(vm.rows[0]?.errorKey).toBe("error.sync.auth");
  });

  it("never ohne Eintrag — und KEIN Indikatorzustand, den es nicht gibt", () => {
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: {}, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.state).toBe("never");
    expect(vm.rows[0]?.lastRunAt).toBeNull();
  });

  it("checking schlaegt jeden anderen Zustand, solange ein Lauf haengt", () => {
    const rs: RunState = { a: { at: 100, ok: false, code: "auth", counts: NIX } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: true });
    expect(vm.rows[0]?.state).toBe("checking");
    expect(vm.busy).toBe(true);
  });
});

describe("buildCockpitViewModel — Zaehlerverdichtung", () => {
  it("nennt nur die Zaehler ungleich null", () => {
    const rs: RunState = { a: { at: 100, ok: true, counts: { ...NIX, created: 3, reattached: 1 } } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.countsKey).toBe("cockpit.counts.created cockpit.counts.reattached");
    expect(vm.rows[0]?.countsArgs).toEqual([3, 1]);
  });

  it("sagt bei einem Lauf ohne Aenderung genau das — nicht sechs Nullen", () => {
    const rs: RunState = { a: { at: 100, ok: true, counts: NIX } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.countsKey).toBe("cockpit.counts.none");
    expect(vm.rows[0]?.countsArgs).toEqual([]);
  });

  it("zeigt fuer einen gescheiterten Lauf keine Zaehler", () => {
    const rs: RunState = { a: { at: 100, ok: false, code: "connect", counts: NIX } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.countsKey).toBeNull();
  });
});

describe("buildCockpitViewModel — Zeilen und Empty-State", () => {
  it("meldet leer, wenn kein Konto eingerichtet ist", () => {
    const vm = buildCockpitViewModel({ accounts: [], runState: {}, nextDue: keineFaelligkeit, busy: false });
    expect(vm.empty).toBe(true);
    expect(vm.rows).toEqual([]);
  });

  it("ist NICHT leer, wenn ein Konto existiert und nur noch nie lief", () => {
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: {}, nextDue: keineFaelligkeit, busy: false });
    expect(vm.empty).toBe(false);
  });

  it("behaelt die Reihenfolge der Kontoliste und traegt das Label", () => {
    const accounts = [acc("z", "Zweitkonto"), acc("a", "Hauptkonto")];
    const vm = buildCockpitViewModel({ accounts, runState: {}, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows.map((r) => r.label)).toEqual(["Zweitkonto", "Hauptkonto"]);
  });

  it("markiert ein abgeschaltetes Konto als disabled und reicht die Faelligkeit durch", () => {
    const accounts = [acc("aus", "Aus", false), acc("an", "An")];
    const vm = buildCockpitViewModel({
      accounts,
      runState: {},
      nextDue: (id) => (id === "an" ? 500 : null),
      busy: false,
    });
    expect(vm.rows[0]?.disabled).toBe(true);
    expect(vm.rows[0]?.nextRunAt).toBeNull();
    expect(vm.rows[1]?.disabled).toBe(false);
    expect(vm.rows[1]?.nextRunAt).toBe(500);
  });
});
