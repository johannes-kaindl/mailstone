// uebernommen (Muster) aus finance-ledger/tests/bundle.test.ts, 2026-08-23:
// Guard gegen untransformierte dynamische Builtin-Imports im Bundle (Registry § Node-Builtin desktop-only).
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
describe("main.js bundle", () => {
  it("enthaelt kein untransformiertes import(\"node:…\")", () => {
    if (!existsSync("main.js")) return; // vor dem ersten Build: nichts zu pruefen (gate baut zuletzt, der Test laeuft im naechsten gate gegen das Bundle)
    const js = readFileSync("main.js", "utf8");
    expect(/import\(\s*["']node:/.test(js)).toBe(false);
  });
});
