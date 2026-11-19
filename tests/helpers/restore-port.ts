import { findPlaceholders } from "../../src/vendor/kit/placeholder";
import type { RestoreOutcome, RestorePort } from "../../src/core/transform/restore";

/** Platzhalter und ihr Klartext fuer die Rueckwandlungs-Tests (A5, Schritt 5). IDs in der Grammatik des Kits (10 Zeichen, ohne i, l, o, u). */
export const NAME = "Person_k3x9m2ab7q";
export const NAME_2 = "Person_k3x9m2ab7q_2";
export const MAIL = "Person_k3x9m2ab7q_Mail";
export const GONE = "Person_xxxxxxxxxx";
export const GONE_MAIL = "Person_xxxxxxxxxx_Mail";
export const TABLE = new Map<string, string>([[NAME, "Max Mustermann"], [NAME_2, "Max"], [MAIL, "gast@example.org"]]);

/** Ein Fake-Port mit der Tabelle des Pseudonymizers: bekannte Platzhalter werden ersetzt, `gone` sind vergessen (bleiben stehen und werden
 *  gemeldet), jeder andere Platzhalter ist unbekannt (`hold`). `absent` laesst jeden Platzhalter als `hold/absent` scheitern (Plugin fehlt). */
export function fakeRestorePort(opts: { gone?: string[]; absent?: boolean } = {}): RestorePort & { calls: string[] } {
  const calls: string[] = [];
  const fn = ((text: string): RestoreOutcome => {
    calls.push(text);
    const found = findPlaceholders(text);
    if (opts.absent && found.length > 0) return { kind: "hold", reason: "absent", unknown: [...new Set(found.map((p) => p.raw))], message: "fehlt" };
    const unknown = [...new Set(found.filter((p) => !TABLE.has(p.raw) && !(opts.gone ?? []).includes(p.raw)).map((p) => p.raw))];
    if (unknown.length > 0) return { kind: "hold", reason: "unknown", unknown, message: `${String(unknown.length)} Platzhalter` };
    let out = text;
    const forgotten: string[] = [];
    for (const p of [...found].sort((a, b) => b.start - a.start)) {
      const v = TABLE.get(p.raw);
      if (v === undefined) { if (!forgotten.includes(p.raw)) forgotten.push(p.raw); continue; }
      out = out.slice(0, p.start) + v + out.slice(p.end);
    }
    return { kind: "release", text: out, forgotten };
  }) as RestorePort & { calls: string[] };
  fn.calls = calls;
  return fn;
}
