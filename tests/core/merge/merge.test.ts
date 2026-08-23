import { describe, it, expect } from "vitest";
import { mergeNote, newNote } from "../../../src/core/merge/merge";
import { zoneHash } from "../../../src/core/merge/fences";

const derived = { mail_id: "a@x", mail_source: "s", mail_state: "live", mail_synced: "2026-08-23T15:00:00+02:00", title: "Hi", from: "a@x" };
const managed = Object.keys(derived);

describe("newNote", () => {
  it("Frontmatter (onCreate + derived), Notizen-Kopf, Block", () => {
    const { content, zoneHash: h } = newNote(derived, { type: "mail" }, "## Nachricht\n\nText");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("type: mail");
    expect(content).toContain("mail_id: a@x");
    expect(content).toContain("## Notizen\n\n%% mailstone:begin %%\n## Nachricht\n\nText\n%% mailstone:end %%");
    expect(h).toBe(zoneHash("## Nachricht\n\nText"));
  });
});
describe("mergeNote", () => {
  const base = newNote(derived, { type: "mail" }, "## Nachricht\n\nalt");
  it("ersetzt nur die Zone, Aussenbereich byte-identisch, unbekannte Keys bleiben", () => {
    const existing = base.content.replace("## Notizen\n\n", "## Notizen\n\nMein Gedanke.\n\n").replace("type: mail\n", "type: mail\nup: \"[[Projekt]]\"\n");
    const r = mergeNote({ existing, derived: { ...derived, title: "Neu" }, managed, block: "## Nachricht\n\nneu", expectedZoneHash: base.zoneHash });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("Mein Gedanke.");
    expect(r.content).toContain('up: "[[Projekt]]"');
    expect(r.content).toContain("title: Neu");
    expect(r.content).toContain("## Nachricht\n\nneu");
    expect(r.content).not.toContain("alt");
    expect(r.changed).toBe(true);
  });
  it("umsortiertes Frontmatter ist keine Manipulation", () => {
    const lines = base.content.split("\n"); // Frontmatter-Zeilen 1..n rotieren
    const end = lines.indexOf("---", 1);
    const fm = lines.slice(1, end); fm.push(fm.shift() as string);
    const existing = ["---", ...fm, ...lines.slice(end)].join("\n");
    const r = mergeNote({ existing, derived, managed, block: "## Nachricht\n\nalt", expectedZoneHash: base.zoneHash });
    expect(r.ok).toBe(true);
  });
  it("fehlende Fences → fences-missing, kein Inhalt", () => {
    const r = mergeNote({ existing: "---\nmail_id: a@x\n---\n\nfrei", derived, managed, block: "x", expectedZoneHash: null });
    expect(r).toEqual({ ok: false, code: "fences-missing" });
  });
  it("editierte Zone (Hash weicht ab) → zone-edited", () => {
    const existing = base.content.replace("## Nachricht\n\nalt", "## Nachricht\n\nalt (von Hand geaendert)");
    const r = mergeNote({ existing, derived, managed, block: "## Nachricht\n\nneu", expectedZoneHash: base.zoneHash });
    expect(r).toEqual({ ok: false, code: "zone-edited" });
  });
  it("expectedZoneHash null: Zone wird ohne Hash-Pruefung uebernommen (Adoption)", () => {
    const existing = base.content.replace("## Nachricht\n\nalt", "## Nachricht\n\nfremd");
    const r = mergeNote({ existing, derived, managed, block: "## Nachricht\n\nneu", expectedZoneHash: null });
    expect(r.ok).toBe(true);
  });
  it("idempotent: gleicher Input → changed=false, Inhalt identisch", () => {
    const r = mergeNote({ existing: base.content, derived, managed, block: "## Nachricht\n\nalt", expectedZoneHash: base.zoneHash });
    expect(r.ok && !r.changed && r.content === base.content).toBe(true);
  });
});
