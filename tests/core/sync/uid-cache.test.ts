import { describe, it, expect } from "vitest";
import { createUidCache } from "../../../src/core/sync/uid-cache";

describe("createUidCache", () => {
  it("liefert gemerkte Paare zurueck", () => {
    const c = createUidCache(undefined);
    c.remember("acc", "Vault", 42, 7, "a@b");
    expect(c.known("acc", "Vault", 42).get(7)).toBe("a@b");
  });

  it("verwirft den Eintrag bei geaenderter UIDVALIDITY", () => {
    const c = createUidCache(undefined);
    c.remember("acc", "Vault", 42, 7, "a@b");
    expect(c.known("acc", "Vault", 43).size).toBe(0);
    c.remember("acc", "Vault", 43, 1, "c@d");
    expect(c.known("acc", "Vault", 43).get(1)).toBe("c@d");
    expect(c.known("acc", "Vault", 43).has(7)).toBe(false);
  });

  it("haelt Konten und Ordner getrennt", () => {
    const c = createUidCache(undefined);
    c.remember("a", "Vault", 1, 7, "x@y");
    c.remember("b", "Vault", 1, 7, "z@y");
    expect(c.known("a", "Vault", 1).get(7)).toBe("x@y");
    expect(c.known("b", "Vault", 1).get(7)).toBe("z@y");
    expect(c.known("a", "Archive", 1).size).toBe(0);
  });

  it("retain wirft verschwundene UIDs weg", () => {
    const c = createUidCache(undefined);
    c.remember("acc", "Vault", 1, 7, "a@b");
    c.remember("acc", "Vault", 1, 8, "c@d");
    c.retain("acc", "Vault", 1, [8]);
    const known = c.known("acc", "Vault", 1);
    expect(known.has(7)).toBe(false);
    expect(known.get(8)).toBe("c@d");
  });

  it("uebersteht kaputte persistierte Daten, ohne zu werfen", () => {
    const c = createUidCache({ "acc|Vault": { uidValidity: "nope", map: 5 }, broken: null });
    expect(c.known("acc", "Vault", 1).size).toBe(0);
    expect(() => c.data()).not.toThrow();
  });

  it("data() ist rundreisefaehig", () => {
    const c = createUidCache(undefined);
    c.remember("acc", "Vault", 42, 7, "a@b");
    expect(createUidCache(JSON.parse(JSON.stringify(c.data()))).known("acc", "Vault", 42).get(7)).toBe("a@b");
  });
});

// M3-Nachlese, Abdeckungsluecke: `retain` bei GEAENDERTER UIDVALIDITY war ungeprueft. Der Fall ist
// der gefaehrlichste des Moduls: nach einem Wechsel bezeichnet dieselbe Zahl eine ANDERE Mail.
// Ein `retain`, das nur gegen die uebergebene UID-Liste filtert, statt den Bestand zu verwerfen,
// fuehrte alte Zuordnungen unter neuen UIDs weiter — und ein falscher Message-ID-Abgleich ist der
// teuerste Fehler, den dieser Cache machen kann.
describe("createUidCache — retain nach einem UIDVALIDITY-Wechsel", () => {
  it("verwirft den alten Bestand, auch wenn dieselben UIDs uebergeben werden", () => {
    const c = createUidCache(undefined);
    c.remember("acc", "Vault", 42, 7, "alt@x");
    c.remember("acc", "Vault", 42, 8, "auch-alt@x");

    // Neue Generation, zufaellig dieselben UID-Zahlen: nichts davon darf ueberleben.
    c.retain("acc", "Vault", 99, [7, 8]);

    expect(c.known("acc", "Vault", 99).size).toBe(0);
    expect(c.known("acc", "Vault", 99).get(7)).toBeUndefined();
    // Auch rueckwaerts nicht: die alte Generation ist fort, nicht bloss verdeckt.
    expect(c.known("acc", "Vault", 42).size).toBe(0);
  });

  it("haelt den Bestand, wenn die UIDVALIDITY gleich bleibt", () => {
    const c = createUidCache(undefined);
    c.remember("acc", "Vault", 42, 7, "bleibt@x");
    c.remember("acc", "Vault", 42, 8, "geht@x");
    c.retain("acc", "Vault", 42, [7]);
    expect(c.known("acc", "Vault", 42).get(7)).toBe("bleibt@x");
    expect(c.known("acc", "Vault", 42).get(8)).toBeUndefined();
  });

  it("schreibt die neue Generation in die persistierten Daten", () => {
    const c = createUidCache(undefined);
    c.remember("acc", "Vault", 42, 7, "alt@x");
    c.retain("acc", "Vault", 99, [7]);
    expect(c.data()["acc|Vault"]).toEqual({ uidValidity: 99, map: {} });
  });
});
