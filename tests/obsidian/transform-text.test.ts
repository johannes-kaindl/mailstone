// Die Gruende einer wartenden oder gescheiterten Pseudonymisierung (A5): die Texte zu "Plugin fehlt / nicht eingerichtet / gesperrt" kommen aus dem Kit
// (`pseudonymizer-call-strings`, EN/DE), nicht aus einer eigenen Tabelle; eigene Texte bleiben nur dort, wo Mailstone einen eigenen Kontext sagt.
import { afterEach, describe, expect, it } from "vitest";
import { noMailText, restoreFailureText } from "../../src/obsidian/transform-text";
import { de as deStrings, en as enStrings, initI18n } from "../../src/i18n/strings";
import { PSEUDONYMIZER_CALL_STRINGS_DE, PSEUDONYMIZER_CALL_STRINGS_EN } from "../../src/vendor/kit-obsidian/pseudonymizer-call-strings";

afterEach(() => initI18n("de"));

const KIT_GRUENDE = ["absent", "not-set-up", "locked"] as const;

describe("noMailText", () => {
  it.each(KIT_GRUENDE)("%s: die Meldung des Kits, nicht eine eigene Tabelle", (reason) => {
    initI18n("de");
    expect(noMailText({ kind: "wait", reason, message: "Meldung des Kits" })).toBe("Meldung des Kits");
  });

  it("Mailstones eigener Kontext bleibt uebersetzt (deferred, cancelled, locked-fields ...)", () => {
    initI18n("de");
    expect(noMailText({ kind: "wait", reason: "deferred", message: "Meldung des Plugins" })).toBe("Die Mail hat Stellen, die der Pseudonymizer erst von dir prüfen lassen will.");
    expect(noMailText({ kind: "error", reason: "locked-fields", message: "x" })).toBe("Der Pseudonymizer hat Felder verändert, die Mailstone unverändert braucht.");
    initI18n("en");
    expect(noMailText({ kind: "wait", reason: "deferred", message: "Meldung des Plugins" })).toBe("The mail has passages the pseudonymizer wants you to review first.");
  });

  it("unbekannter Grund: die Meldung selbst", () => {
    expect(noMailText({ kind: "wait", reason: "unbekannt-xyz", message: "Meldung des Plugins" })).toBe("Meldung des Plugins");
  });
});

describe("restoreFailureText", () => {
  it.each(KIT_GRUENDE)("held/%s: der Grundtext kommt aus dem Kit in der Oberflaechensprache, die Anzahl steht einmal", (reason) => {
    initI18n("de");
    const de = restoreFailureText({ kind: "held", reason, count: 2, message: "wird nicht gezeigt" });
    expect(de).toContain(PSEUDONYMIZER_CALL_STRINGS_DE.unavailable[reason]);
    expect(de).not.toContain("wird nicht gezeigt");
    expect(de.match(/2/g)).toHaveLength(1);
    initI18n("en");
    const en = restoreFailureText({ kind: "held", reason, count: 2, message: "wird nicht gezeigt" });
    expect(en).toContain(PSEUDONYMIZER_CALL_STRINGS_EN.unavailable[reason]);
  });

  it("held/unknown: Mailstones Ursache (Tabelle) bleibt, held ohne Zaehler zeigt die Meldung", () => {
    initI18n("en");
    expect(restoreFailureText({ kind: "held", reason: "unknown", count: 3, message: "3 placeholders cannot be resolved." })).toContain("The placeholders are not in the pseudonymizer's table.");
    expect(restoreFailureText({ kind: "held", reason: "unbekannt-xyz", count: 0, message: "boom" })).toContain("boom");
  });
});

describe("keine eigene Tabelle fuer die Kit-Gruende", () => {
  it.each(KIT_GRUENDE)("%s steht nicht mehr in strings.ts", (reason) => {
    expect(Object.keys(enStrings)).not.toContain(`pseudonymize.reason.${reason}`);
    expect(Object.keys(deStrings)).not.toContain(`pseudonymize.reason.${reason}`);
  });
});
