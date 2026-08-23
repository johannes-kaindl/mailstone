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
  it("verwalteter Key, der in derived fehlt, bleibt unangetastet (Ledger T6)", () => {
    const ohneTitle: Record<string, string> = { ...derived };
    delete ohneTitle["title"];
    const r = mergeNote({ existing: base.content, derived: ohneTitle, managed, block: "## Nachricht\n\nneu", expectedZoneHash: base.zoneHash });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("title: Hi");
  });
});

// --- C1: Frontmatter wird in-place umgeschrieben, nie neu serialisiert -------------
const alt = newNote(derived, { type: "mail" }, "## Nachricht\n\nalt");
const zone = "%% mailstone:begin %%\n## Nachricht\n\nalt\n%% mailstone:end %%";
const reich = [
  "---",
  "# Kommentar",
  "type: mail",
  "mail_id: a@x",
  "mail_source: s",
  "mail_state: live",
  "mail_synced: 2026-08-23T15:00:00+02:00",
  "title: Alt",
  "from: a@x",
  "projekt:",
  "  name: Alpha",
  "  phase: 2",
  "notiz: |",
  "  Zeile 1",
  "  Zeile 2",
  "tags:",
  "  - a",
  "  - b",
  "---",
  "## Notizen",
  "",
  "Mein Gedanke.",
  "",
  zone,
  "",
].join("\n");

describe("mergeNote: Frontmatter in-place", () => {
  const h = zoneHash("## Nachricht\n\nalt");
  it("Kommentar, verschachtelte Map, Block-Skalar und Block-Liste bleiben byte-identisch", () => {
    const r = mergeNote({ existing: reich, derived: { ...derived, title: "Neu" }, managed, block: "## Nachricht\n\nneu", expectedZoneHash: h });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("\n# Kommentar\n");
    expect(r.content).toContain("\nprojekt:\n  name: Alpha\n  phase: 2\n");
    expect(r.content).toContain("\nnotiz: |\n  Zeile 1\n  Zeile 2\n");
    expect(r.content).toContain("\ntags:\n  - a\n  - b\n");
    expect(r.content).toContain("\ntitle: Neu\n");
    expect(r.content).not.toContain("title: Alt");
    expect(r.content).toContain("Mein Gedanke.");
    expect(r.content).toContain("## Nachricht\n\nneu");
  });
  it("fehlender verwalteter Key wird vor dem schliessenden --- ergaenzt", () => {
    const ohneFrom = reich.replace("from: a@x\n", "");
    const r = mergeNote({ existing: ohneFrom, derived, managed, block: "## Nachricht\n\nalt", expectedZoneHash: h });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("\n  - b\nfrom: a@x\n---\n");
  });
  it("verwalteter Key als Block-Liste wird als Einheit ersetzt", () => {
    const mitTo = reich.replace("title: Alt\n", "title: Alt\nto:\n  - x\n  - y\n");
    const r = mergeNote({ existing: mitTo, derived: { ...derived, to: ["z@x"] }, managed: [...managed, "to"], block: "## Nachricht\n\nalt", expectedZoneHash: h });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("to: [z@x]");
    expect(r.content).not.toContain("- x");
    expect(r.content).not.toContain("- y");
    expect(r.content).toContain("\ntags:\n  - a\n  - b\n");
  });
  it("verwalteter Key als Block-Skalar → frontmatter-unparseable", () => {
    const kaputt = reich.replace("title: Alt", "title: |\n  mehrzeilig");
    const r = mergeNote({ existing: kaputt, derived, managed, block: "## Nachricht\n\nalt", expectedZoneHash: h });
    expect(r).toEqual({ ok: false, code: "frontmatter-unparseable" });
  });
});

// --- I2: fluechtige Keys (mail_synced) machen den Lauf nicht "geaendert" ------------
describe("mergeNote: volatileKeys", () => {
  const spaeter = { ...derived, mail_synced: "2026-08-23T16:30:00+02:00" };
  it("nur der Zeitstempel unterscheidet sich → changed=false, Inhalt unveraendert", () => {
    const r = mergeNote({ existing: alt.content, derived: spaeter, managed, block: "## Nachricht\n\nalt", expectedZoneHash: alt.zoneHash, volatileKeys: ["mail_synced"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(false);
    expect(r.content).toBe(alt.content);
    expect(r.content).toContain("mail_synced: 2026-08-23T15:00:00+02:00");
  });
  it("geaenderter Block → changed=true und der neue Zeitstempel steht drin", () => {
    const r = mergeNote({ existing: alt.content, derived: spaeter, managed, block: "## Nachricht\n\nneu", expectedZoneHash: alt.zoneHash, volatileKeys: ["mail_synced"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.content).toContain("mail_synced: 2026-08-23T16:30:00+02:00");
  });
});
