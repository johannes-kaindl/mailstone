// vendored from obsidian-kit@0.100.0, tests/pseudonymizer-source.types.test.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { describe, it, expect } from "vitest";
import type {
  ApiError, PseudonymizerApi, RestoreResult, TransformEntity, TransformPart, TransformRequest, TransformResult,
} from "../../../src/vendor/kit/pseudonymizer-source";

/** Vendorbar: diese Datei importiert NUR `pseudonymizer-source`, sonst nichts (kein Index `../src/pure`, kein Testwerkzeug). Ein Konsument vendort sie mit `kit-sync`
 *  (`"from": "tests"`, Modul `pseudonymizer-source.types.test.ts`, `rewrite` `../src/pure/` auf den Ordner, in dem er `pseudonymizer-source` trägt) und hat damit den Wächter, der bei einer nicht
 *  additiven Änderung der API v1 schon beim Übersetzen bricht. Dass der Index-Alias `PseudonymizerApiError` derselbe Typ ist, prüft `tests/pseudonymizer-source.index.test.ts` (nicht vendorbar,
 *  weil es den Index braucht).
 *
 *  Typ-Test zum Freeze der Pseudonymizer-API v1 (Spec 2026-11-18, § 8.7; Kopf von `src/pure/pseudonymizer-source.ts`). Geprüft wird beim Übersetzen, nicht beim Lauf: `npm run typecheck` bricht,
 *  sobald eine Änderung nicht additiv ist.
 *  (a) Je Typ ein Objekt mit GENAU den heutigen Pflichtfeldern muss zuweisbar sein: ein neues PFLICHTfeld bricht das (ein neues optionales Feld nicht).
 *  (b) Je Feld eine Zuweisung in die Gegenrichtung, vom Typ in den einfachen Typ: ein entferntes, umbenanntes oder umgetyptes Feld bricht das.
 *  Der Laufteil ist eine Kontrolle, dass die Beispiele wirklich gebaut werden (ein Test ohne Lauf bliebe ungesehen). */

// ── (a) Objekte mit genau den heutigen Pflichtfeldern ──
const part: TransformPart = { id: "p1", kind: "text", value: "v" };
const partLine: TransformPart = { id: "p2", kind: "line", value: "v" };          // alle drei heutigen Werte von `kind` müssen bleiben (ein entfernter bricht das)
const partName: TransformPart = { id: "p3", kind: "filename", value: "v" };
const entity: TransformEntity = {};                                              // beide Felder sind optional
const entityFull: TransformEntity = { name: "n", email: "e" };
const req: TransformRequest = { caller: "c", documentKey: "k", interactive: false, parts: [part] };
const reqFull: TransformRequest = { caller: "c", documentKey: "k", interactive: true, title: "t", parts: [part, partLine, partName], entities: [entityFull], keep: ["x"] };
const transformResult: TransformResult = { parts: [{ id: "p1", value: "w" }], entities: [entity], applied: 1 };
const restoreResult: RestoreResult = { text: "t", restored: 1, unknown: [], forgotten: [] };
const errors: ApiError[] = [   // alle sechs heutigen Werte müssen bleiben (ein entfernter Wert bricht das)
  { error: "not-ready", message: "m" }, { error: "locked", message: "m" }, { error: "cancelled", message: "m" },
  { error: "deferred", message: "m" }, { error: "invalid-input", message: "m" }, { error: "storage-failed", message: "m" },
];
const api: PseudonymizerApi = {
  version: 1,
  status: () => ({ state: "ready" }),
  transform: (r) => Promise.resolve({ parts: r.parts.map((p) => ({ id: p.id, value: p.value })), entities: [], applied: 0 }),
  restore: (text, opts) => ({ text: `${text}${opts.caller}`, restored: 0, unknown: [], forgotten: [] }),
  containsPlaceholder: () => false,
};

// ── (b) je Feld die Gegenrichtung ──
const pId: string = part.id;
const pKind: "text" | "line" | "filename" = part.kind;
const pValue: string = part.value;
const eName: string | undefined = entityFull.name;
const eEmail: string | undefined = entityFull.email;
const rCaller: string = req.caller;
const rKey: string = req.documentKey;
const rInteractive: boolean = req.interactive;
const rTitle: string | undefined = reqFull.title;
const rParts: TransformPart[] = req.parts;
const rEntities: TransformEntity[] | undefined = reqFull.entities;
const rKeep: string[] | undefined = reqFull.keep;
const tParts: { id: string; value: string }[] = transformResult.parts;
const tEntities: TransformEntity[] = transformResult.entities;
const tApplied: number = transformResult.applied;
const sText: string = restoreResult.text;
const sRestored: number = restoreResult.restored;
const sUnknown: string[] = restoreResult.unknown;
const sForgotten: string[] = restoreResult.forgotten;
const eError: string = errors[0].error;                   // eine Zeichenkette (ein neuer Wert ist additiv, ein entfernter bricht (a))
const eMessage: string = errors[0].message;
const aVersion: 1 = api.version;
// Aufrufform und Rückgabe der Methoden: ein neuer Pflichtparameter oder ein neuer Rückgabefall bricht das.
const state: "ready" | "locked" | "not-set-up" = api.status().state;
const transformed: Promise<TransformResult | ApiError> = api.transform(req);
const restored: RestoreResult | ApiError = api.restore("x", { caller: "c" });
const contains: boolean = api.containsPlaceholder("x");

describe("Pseudonymizer-API v1 ist eingefroren (Typ-Test, gilt beim Übersetzen)", () => {
  it("die Beispiele werden gebaut und tragen ihre Werte", async () => {
    expect([pId, pKind, pValue, eName, eEmail, rCaller, rKey, rInteractive, rTitle, rKeep]).toEqual(["p1", "text", "v", "n", "e", "c", "k", false, "t", ["x"]]);
    expect([rParts.length, rEntities?.length, tParts.length, tEntities.length, tApplied]).toEqual([1, 1, 1, 1, 1]);
    expect([sText, sRestored, sUnknown, sForgotten, eError, eMessage, aVersion]).toEqual(["t", 1, [], [], "not-ready", "m", 1]);
    expect(errors.map((e) => e.error)).toEqual(["not-ready", "locked", "cancelled", "deferred", "invalid-input", "storage-failed"]);
    expect([partLine.kind, partName.kind]).toEqual(["line", "filename"]);
    expect([state, contains]).toEqual(["ready", false]);
    expect(await transformed).toEqual({ parts: [{ id: "p1", value: "v" }], entities: [], applied: 0 });
    expect("text" in restored && restored.text).toBe("xc");
  });
});
