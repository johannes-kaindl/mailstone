import { describe, it, expect } from "vitest";
import { syncFailureStatus } from "../../src/main";
import type { SyncRunResult } from "../../src/core/sync/service";
import { t } from "../../src/vendor/code-kit/i18n";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

// Fix-Runde 1, Finding 1: `runSync` verliess sich fuer den Statusleisten-Reset allein auf das
// "synced"-Event, das der Sync-Service nur auf dem Erfolgspfad EINES Kontos feuert — scheiterten
// ALLE aktivierten Konten, blieb "Mailstone: synchronisiert…" dauerhaft stehen. `syncFailureStatus`
// ist reine Logik (kein Obsidian-Zugriff), deshalb direkt ohne Plugin-/App-Mock testbar.
describe("syncFailureStatus", () => {
  it("liefert einen Fehlertext, wenn ALLE Ergebnisse fehlgeschlagen sind", () => {
    const results: SyncRunResult[] = [{ ok: false, accountId: "a1", code: "no-secret" }];
    expect(syncFailureStatus(results)).toBe(`Mailstone: ${t("error.sync.no-secret")}`);
  });

  it("liefert null, wenn mindestens ein Konto erfolgreich war (das \"synced\"-Event hat den Status schon gesetzt)", () => {
    const results: SyncRunResult[] = [
      { ok: false, accountId: "a1", code: "auth" },
      { ok: true, accountId: "a2", counts: { created: 1, reattached: 0, detached: 0, skipped: 0, detachSkipped: 0, errors: 0 } },
    ];
    expect(syncFailureStatus(results)).toBeNull();
  });

  it("liefert null ohne Ergebnisse (keine aktivierten Konten)", () => {
    expect(syncFailureStatus([])).toBeNull();
  });
});
