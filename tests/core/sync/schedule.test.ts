import { describe, it, expect } from "vitest";
import { dueAccounts, TICK_MS } from "../../../src/core/sync/schedule";
import { newAccount, type Account } from "../../../src/core/settings";

const MIN = 60_000;

function acc(id: string, intervalMin: number, enabled = true): Account {
  const a = newAccount(id);
  a.id = id;
  a.sync = { enabled, intervalMin };
  return a;
}

// M3-Nachlese: der Intervall war das MINIMUM ueber alle Konten (auch deaktivierte) und loeste
// dann `syncAll()` aus — ein Konto mit 60 Minuten wurde alle 5 synchronisiert, sobald ein
// zweites 5 eintrug. Das Feld sitzt im Konto-Modal, verspricht also ausdruecklich eine
// Einstellung je Konto. Jetzt entscheidet ein fester Takt, welche Konten faellig SIND.
describe("dueAccounts", () => {
  it("laesst ein Konto mit langem Intervall in Ruhe, waehrend ein kurzes laeuft", () => {
    const accounts = [acc("schnell", 5), acc("langsam", 60)];
    const last = { schnell: 0, langsam: 0 };
    expect(dueAccounts(accounts, last, 5 * MIN)).toEqual(["schnell"]);
    expect(dueAccounts(accounts, last, 60 * MIN)).toEqual(["schnell", "langsam"]);
  });

  it("ueberspringt deaktivierte Konten, auch wenn ihr Intervall das kuerzeste ist", () => {
    const accounts = [acc("aus", 1, false), acc("an", 30)];
    expect(dueAccounts(accounts, {}, 5 * MIN)).toEqual(["an"]);
  });

  it("haelt ein Konto ohne bekannten letzten Lauf fuer faellig", () => {
    expect(dueAccounts([acc("neu", 60)], {}, 1000)).toEqual(["neu"]);
  });

  it("ist genau am Intervall faellig, nicht erst danach", () => {
    const accounts = [acc("a", 5)];
    expect(dueAccounts(accounts, { a: 0 }, 5 * MIN - 1)).toEqual([]);
    expect(dueAccounts(accounts, { a: 0 }, 5 * MIN)).toEqual(["a"]);
  });

  // Ein Konto mit 0 oder negativem Wert (von Hand in data.json geraten) darf keinen Dauerlauf
  // ausloesen: der Takt selbst ist die Untergrenze.
  it("klemmt unsinnige Intervalle auf einen Takt", () => {
    const accounts = [acc("null", 0), acc("negativ", -5)];
    expect(dueAccounts(accounts, { null: 0, negativ: 0 }, TICK_MS - 1)).toEqual([]);
    expect(dueAccounts(accounts, { null: 0, negativ: 0 }, TICK_MS)).toEqual(["null", "negativ"]);
  });

  // Der Kern der Reparatur des zweiten Teils: die Kadenz wurde in onload() EINMAL berechnet, eine
  // Aenderung wirkte erst nach einem Neustart. Weil jeder Tick die Konten frisch liest, wirkt eine
  // Aenderung jetzt beim naechsten Takt — hier gezeigt an derselben Liste mit geaendertem Wert.
  it("nimmt eine geaenderte Einstellung beim naechsten Takt an", () => {
    const accounts = [acc("a", 60)];
    const last = { a: 0 };
    expect(dueAccounts(accounts, last, 10 * MIN)).toEqual([]);
    accounts[0]!.sync.intervalMin = 5;
    expect(dueAccounts(accounts, last, 10 * MIN)).toEqual(["a"]);
  });
});

// Review-Befund (2026-08-30): `repairAccount` uebernimmt `sync` ungeprueft aus data.json, der Wert
// kann also Unsinn sein. `Math.max(TICK_MS, NaN)` ist NaN, und JEDER Vergleich mit NaN ist false —
// das Konto waere nie wieder faellig, ohne Fehler, ohne Notice, ohne Spur in der Statusleiste.
// Die alte Fassung fiel in denselben Fall laut auf (Dauerlauf); diese hier faellt still aus, und
// das ist der schlechtere Ausgang.
describe("dueAccounts — unbrauchbare Werte", () => {
  function kaputt(id: string, wert: unknown): Account {
    const a = acc(id, 5);
    (a.sync as { intervalMin: unknown }).intervalMin = wert;
    return a;
  }

  it("behandelt NaN wie einen Takt statt das Konto stillzulegen", () => {
    expect(dueAccounts([kaputt("nan", NaN)], { nan: 0 }, TICK_MS)).toEqual(["nan"]);
  });

  it("behandelt eine nicht-numerische Zeichenkette wie einen Takt", () => {
    expect(dueAccounts([kaputt("text", "bald")], { text: 0 }, TICK_MS)).toEqual(["text"]);
  });

  it("behandelt Infinity wie einen Takt (sonst nie wieder faellig)", () => {
    expect(dueAccounts([kaputt("inf", Infinity)], { inf: 0 }, TICK_MS)).toEqual(["inf"]);
  });

  it("nimmt eine numerische Zeichenkette beim Wort", () => {
    const accounts = [kaputt("zahl", "10")];
    expect(dueAccounts(accounts, { zahl: 0 }, 5 * MIN)).toEqual([]);
    expect(dueAccounts(accounts, { zahl: 0 }, 10 * MIN)).toEqual(["zahl"]);
  });
});
