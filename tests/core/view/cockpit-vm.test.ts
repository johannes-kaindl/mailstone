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

  it("die Zeile BEHAELT Zustand, Zaehler und Fehler, waehrend ein Lauf haengt", () => {
    // Spec „Status-Indikator", Bekannte Grenze: der BusyGuard ist global und weiss nicht,
    // WELCHES Konto laeuft — is-checking gehoert deshalb in die Kopfzeile, und die Zeilen
    // behalten ihren letzten Stand. Die frueher gebaute Fassung setzte jede Zeile auf
    // „checking" und warf dabei countsKey und errorKey weg: bei zwei Konten zwei Spinner
    // fuer einen Lauf, und der letzte bekannte Stand war waehrenddessen unsichtbar.
    const rs: RunState = {
      a: { at: 100, ok: true, counts: { ...NIX, created: 2 } },
      b: { at: 100, ok: false, code: "auth", counts: NIX },
    };
    const vm = buildCockpitViewModel({ accounts: [acc("a"), acc("b")], runState: rs, nextDue: keineFaelligkeit, busy: true });
    expect(vm.busy).toBe(true);
    expect(vm.rows[0]?.state).toBe("ok");
    expect(vm.rows[0]?.countsKey).toBe("cockpit.counts.created");
    expect(vm.rows[0]?.countsArgs).toEqual([2]);
    expect(vm.rows[0]?.lastRunAt).toBe(100);
    expect(vm.rows[1]?.state).toBe("error");
    expect(vm.rows[1]?.errorKey).toBe("error.sync.auth");
  });

  it("faellt bei unbekanntem Fehlercode auf protocol zurueck", () => {
    // Der Rueckfall deckt den defensiven Parse-Pfad: parseRunState wirft einen unbekannten
    // Code weg, die Zeile bleibt trotzdem eine Fehlerzeile mit lesbarem Text.
    const rs: RunState = { a: { at: 100, ok: false, counts: NIX } };
    const vm = buildCockpitViewModel({ accounts: [acc("a")], runState: rs, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.errorKey).toBe("error.sync.protocol");
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
    // Der Stub liefert fuer BEIDE Konten eine Zahl. Frueher gab er fuer das abgeschaltete
    // Konto `null` und der Test sicherte `nextRunAt === null` zu — das belegte nichts ueber
    // dieses Modul, die null kam aus der Testdatei selbst. Dass ein abgeschaltetes Konto keine
    // Faelligkeit hat, entscheidet `nextDueAt` (dort und im Host getestet); hier gehoert nur
    // die Frage hin, ob durchgereicht wird, was der Aufrufer liefert.
    const accounts = [acc("aus", "Aus", false), acc("an", "An")];
    const vm = buildCockpitViewModel({
      accounts,
      runState: {},
      nextDue: (id) => (id === "an" ? 500 : 900),
      busy: false,
    });
    expect(vm.rows[0]?.disabled).toBe(true);
    expect(vm.rows[0]?.nextRunAt).toBe(900);
    expect(vm.rows[1]?.disabled).toBe(false);
    expect(vm.rows[1]?.nextRunAt).toBe(500);
  });

  it("nimmt die Konto-Id als Namen, wenn das Label leer ist", () => {
    // Ein leeres Label ist ein VORGESEHENER Zustand: addAccount() setzt es auf "" und das
    // Konto-Modal erzwingt nichts. Ohne Rueckfall traegt die Zeile nur Indikator und Knopf,
    // und bei zwei Konten ist nicht erkennbar, welches man synchronisiert.
    const ohneNamen = acc("kto-2", "");
    const vm = buildCockpitViewModel({ accounts: [ohneNamen, acc("kto-3", "Zweitkonto")], runState: {}, nextDue: keineFaelligkeit, busy: false });
    expect(vm.rows[0]?.label).toBe("kto-2");
    expect(vm.rows[1]?.label).toBe("Zweitkonto");
  });
});
