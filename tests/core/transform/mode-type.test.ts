import { describe, it, expectTypeOf } from "vitest";
import type { PseudonymizeMode as KitMode, PseudonymizeOutcome as KitOutcome, ReleaseOutcome as KitRelease } from "../../../src/vendor/kit-obsidian/pseudonymizer-call";
import type { PseudonymizeMode as CoreMode } from "../../../src/core/mirror/profile";
import { PSEUDONYMIZE_MODES } from "../../../src/core/mirror/profile";
import type { PortOutcome } from "../../../src/core/transform/transform-mail";
import type { RestoreOutcome } from "../../../src/core/transform/restore";

// `src/core` darf aus der obsidian-Schicht nichts importieren (check:pure): der Typ steht im Kern doppelt. Dieser Test haelt beide
// gleich; `npm run typecheck:test` bricht, sobald das Kit eine Stellung oder eine Ausgangsart hinzufuegt oder entfernt.
describe("Schalter und Ausgang: Kern und Kit sind gleich", () => {
  it("PseudonymizeMode ist im Kern dieselbe Vereinigung wie im Kit", () => {
    expectTypeOf<CoreMode>().toEqualTypeOf<KitMode>();
    expectTypeOf(PSEUDONYMIZE_MODES).toEqualTypeOf<readonly KitMode[]>();
  });
  it("jeder Ausgang des Kit-Aufrufs passt in den Port des Kerns", () => {
    expectTypeOf<KitOutcome>().toExtend<PortOutcome>();
  });
  it("jeder Ausgang der Rueckwandlung im Kit passt in den Port des Kerns (A5, Schritt 5)", () => {
    expectTypeOf<KitRelease>().toExtend<RestoreOutcome>();
  });
});
