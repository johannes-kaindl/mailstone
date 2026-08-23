import { describe, it, expect } from "vitest";
import { importEmlFolder } from "../../src/obsidian/import-eml";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { makeApp } from "../helpers/memory-vault";
import { loadFixture } from "../helpers/fixtures";

describe("importEmlFolder", () => {
  it("importiert alle .eml eines Vault-Ordners, zweiter Lauf ist idempotent", async () => {
    const app = makeApp();
    for (const f of ["utf8-plain", "thread-reply"]) await app.vault.createBinary(`Import/${f}.eml`, loadFixture(f).buffer);
    const hashes = new Map<string, string>();
    const deps = { app, profile: defaultMailProfile(), hashes: { get: (k: string) => hashes.get(k) ?? null, set: (k: string, v: string) => { hashes.set(k, v); } }, now: () => new Date("2026-08-23T13:00:00Z") };
    const r1 = await importEmlFolder(deps, "Import");
    expect(r1.created).toBe(2); expect(r1.errors).toEqual([]);
    expect(await app.vault.adapter.exists("Mail/2026/2026-08-19-1432-hallo-welt.md")).toBe(true);
    expect(await app.vault.adapter.exists("Mail/2026/_eml/2026-08-19-1432-hallo-welt.eml")).toBe(true);
    const r2 = await importEmlFolder(deps, "Import");
    expect(r2.created).toBe(0); expect(r2.skipped.every((p) => p.kind === "skip" && p.reason === "unchanged")).toBe(true);
  });
  it("kaputte Datei landet in errors, Rest wird importiert", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/ok.eml", loadFixture("utf8-plain").buffer);
    await app.vault.createBinary("Import/leer.eml", new ArrayBuffer(0));
    const r = await importEmlFolder({ app, profile: defaultMailProfile(), hashes: { get: () => null, set: () => {} }, now: () => new Date(0) }, "Import");
    // leere Datei: parseEml liefert eine Mail ohne alles → wird als noid-Notiz angelegt ODER als Fehler gefuehrt; beides ok, aber kein Throw:
    expect(r.created).toBeGreaterThanOrEqual(1);
    expect(r.created + r.errors.length).toBe(2);
  });
});
