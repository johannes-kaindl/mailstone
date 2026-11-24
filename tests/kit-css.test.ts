import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findVendoredCss, missingKitCss } from "./vendor/kit/kit-css";

// Kit-Vertrag: vendort wird das Verhalten, die Darstellung (`*_CSS`) ist eine Kopie in styles.css.
// Vorlage: koda-agent/tests/kit_css.test.ts, obsidian-transmute/tests/kit-css.test.ts.
describe("Kit-CSS in styles.css", () => {
  const vendorDir = "src/vendor/kit-obsidian";
  it("der Waechter findet gevendorte Konstanten (sonst bewacht er nichts)", () => {
    expect(findVendoredCss(vendorDir).map((c) => c.name).sort()).toEqual(["HUB_CSS", "SEGMENTED_CONTROL_CSS"]);
  });
  it("jede steht wortgleich in styles.css", () => {
    expect(missingKitCss(vendorDir, readFileSync("styles.css", "utf8"))).toEqual([]);
  });
  it("styles.css traegt keine Einsetzung `${...}` (Rohtext-Kopie einer Kit-Konstante mit Einsetzung: Store-Scorecard \"Caution\", Unknown word)", () => {
    expect(readFileSync("styles.css", "utf8")).not.toContain("${");
  });
});
