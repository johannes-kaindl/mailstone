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
