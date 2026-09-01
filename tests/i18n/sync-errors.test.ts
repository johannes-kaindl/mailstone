import { describe, it, expect } from "vitest";
import { en, de } from "../../src/i18n/strings";
import { SYNC_ERROR_CODES } from "../../src/core/sync/errors";

// SYNC_ERROR_CODES ist seit dem Abschluss-Review die QUELLE des Typs, nicht seine Kopie —
// eine Aufzaehlung wie in commands.test.ts waere hier also ein Rueckschritt. Was die Liste
// noch nicht sichert: dass zu jedem Code auch ein Erklaertext existiert. `parseRunState`
// laesst genau diese Codes durch, die Anzeige baut daraus `error.sync.<code>`, und `t()` gibt
// bei fehlendem Schluessel den Schluessel selbst zurueck — ein neuer Code ohne Text stuende
// sonst als rohes "error.sync.neu" auf dem Bildschirm.
const dicts: [string, Record<string, string>][] = [["en", en], ["de", de]];

describe("i18n-Paritaet der Sync-Fehlercodes", () => {
  it.each(dicts)("%s kennt jeden Code aus SYNC_ERROR_CODES", (_lang, dict) => {
    for (const code of SYNC_ERROR_CODES) expect(dict[`error.sync.${code}`], code).toBeTruthy();
  });
});
