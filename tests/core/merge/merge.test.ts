import { describe, it, expect } from "vitest";
import { mergeFrontmatterOnly, mergeNote, newNote, setFrontmatterField } from "../../../src/core/merge/merge";
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

describe("mergeFrontmatterOnly", () => {
  const note = [
    "---",
    "mail_id: a@x",
    "in_reply_to: b@x",
    "references:",
    "  - c@x",
    "eigenes: bleibt",
    "# ein Kommentar",
    "---",
    "## Notizen",
    "",
    "%% mailstone:begin %%",
    "## Nachricht",
    "Hallo",
    "%% mailstone:end %%",
    "",
  ].join("\n");

  it("ersetzt einen einzelnen Key und laesst den Rest byte-identisch", () => {
    const r = mergeFrontmatterOnly({ existing: note, values: { in_reply_to: "[[Mail/2026/b]]" } });
    expect(r).toMatchObject({ ok: true, changed: true });
    if (!r.ok) return;
    expect(r.content).toContain("in_reply_to: \"[[Mail/2026/b]]\"");
    expect(r.content).toContain("eigenes: bleibt");
    expect(r.content).toContain("# ein Kommentar");
    expect(r.content).toContain("%% mailstone:begin %%");
  });

  it("laesst die Zone unangetastet", () => {
    const r = mergeFrontmatterOnly({ existing: note, values: { in_reply_to: "[[Mail/2026/b]]" } });
    expect(r.ok && r.content.slice(r.content.indexOf("## Notizen"))).toBe(note.slice(note.indexOf("## Notizen")));
  });

  it("legt keinen Key an, den es im Frontmatter nicht gibt", () => {
    const r = mergeFrontmatterOnly({ existing: note, values: { cc: ["x@y"] } });
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(r.ok && r.content).toBe(note);
  });

  it("meldet changed: false, wenn der Wert schon stimmt", () => {
    expect(mergeFrontmatterOnly({ existing: note, values: { in_reply_to: "b@x" } })).toMatchObject({ ok: true, changed: false });
  });

  it("meldet frontmatter-unparseable bei einem Block-Skalar", () => {
    const mitBlock = "---\nin_reply_to: |\n  mehrzeilig\n---\ntext";
    expect(mergeFrontmatterOnly({ existing: mitBlock, values: { in_reply_to: "x" } })).toEqual({ ok: false, code: "frontmatter-unparseable" });
  });

  it("meldet frontmatter-unparseable, wenn der Block nicht geschlossen ist", () => {
    expect(mergeFrontmatterOnly({ existing: "---\nmail_id: a@x\nohne Ende", values: { mail_id: "b" } })).toEqual({ ok: false, code: "frontmatter-unparseable" });
  });

  it("laesst eine Notiz ohne Frontmatter unveraendert", () => {
    expect(mergeFrontmatterOnly({ existing: "nur Text", values: { mail_id: "a" } })).toEqual({ ok: true, content: "nur Text", changed: false });
  });

  it("laesst einen leeren Block unveraendert, statt ihn als unlesbar zu melden", () => {
    expect(mergeFrontmatterOnly({ existing: "---\n---\ntext", values: { mail_id: "a" } })).toEqual({ ok: true, content: "---\n---\ntext", changed: false });
  });

  // Verhaltenswechsel (Kit-Uebernahme): der Zeilenleser erkennt einen Schluessel mit Nicht-ASCII-Zeichen
  // nicht als Schluessel. Der alte Code fand ihn deshalb nie und ignorierte ihn still (`ok, changed: false`);
  // `patchFrontmatter` meldet ihn als `invalid-key`, und der Relink fuehrt die Notiz als uebersprungen.
  it("meldet einen Schluessel mit Nicht-ASCII-Zeichen als frontmatter-unparseable statt ihn still zu ignorieren", () => {
    expect(mergeFrontmatterOnly({ existing: note, values: { "zustand-ä": "x" } })).toEqual({ ok: false, code: "frontmatter-unparseable" });
  });

  it("meldet einen Wert mit Zeilenumbruch als frontmatter-unparseable", () => {
    expect(mergeFrontmatterOnly({ existing: note, values: { in_reply_to: "a\nb" } })).toEqual({ ok: false, code: "frontmatter-unparseable" });
  });
});

// M3-Nachlese, Befund aus der Live-Probe am echten Postfach (2026-08-30): der Zustandswechsel
// lief ueber `fileManager.processFrontMatter`, und das re-serialisiert den GANZEN
// Frontmatter-Block — aus `to: [adresse]` wurde eine Block-Liste. Einmalig und ohne
// Datenverlust, aber sobald ein Nutzer eigene Felder mit bewusster Formatierung fuehrt
// (Block-Skalare, Kommentare, Flow-Listen), schreibt die API sie um. Der Rest dieses Moduls
// arbeitet aus genau diesem Grund zeilenweise; setState war die letzte Ausnahme.
describe("setFrontmatterField", () => {
  const note = [
    "---",
    "mail_id: a@x",
    "to: [wer@example.net]",
    "mail_state: live",
    "beschreibung: |",
    "  mehrzeilig",
    "  und handgesetzt",
    "# ein Kommentar",
    "---",
    "## Notizen",
    "",
    "%% mailstone:begin %%",
    "## Nachricht",
    "%% mailstone:end %%",
    "",
  ].join("\n");

  it("ersetzt genau die eine Zeile und laesst den Rest byte-identisch", () => {
    const r = setFrontmatterField({ existing: note, key: "mail_state", value: "detached" });
    expect(r).toMatchObject({ ok: true, changed: true });
    if (!r.ok) return;
    expect(r.content).toContain("mail_state: detached");
    // Das ist der Befund: eine Flow-Liste bleibt eine Flow-Liste, ein fremdes Block-Skalar
    // bleibt eines, und der Kommentar ueberlebt.
    expect(r.content).toContain("to: [wer@example.net]");
    expect(r.content).toContain("beschreibung: |");
    expect(r.content).toContain("  und handgesetzt");
    expect(r.content).toContain("# ein Kommentar");
    expect(r.content.slice(r.content.indexOf("## Notizen"))).toBe(note.slice(note.indexOf("## Notizen")));
  });

  it("legt den Key an, wenn er fehlt — anders als mergeFrontmatterOnly", () => {
    const ohne = "---\nmail_id: a@x\n---\ntext\n";
    const r = setFrontmatterField({ existing: ohne, key: "mail_state", value: "detached" });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(r.ok && r.content).toBe("---\nmail_id: a@x\nmail_state: detached\n---\ntext\n");
  });

  it("meldet changed: false, wenn der Wert schon stimmt", () => {
    expect(setFrontmatterField({ existing: note, key: "mail_state", value: "live" })).toMatchObject({ ok: true, changed: false });
  });

  it("meldet frontmatter-unparseable, wenn der Key selbst ein Block-Skalar ist", () => {
    expect(setFrontmatterField({ existing: note, key: "beschreibung", value: "x" }))
      .toEqual({ ok: false, code: "frontmatter-unparseable" });
  });

  it("meldet frontmatter-unparseable, wenn der Block nicht geschlossen ist", () => {
    expect(setFrontmatterField({ existing: "---\nmail_id: a@x\nohne Ende", key: "mail_state", value: "live" }))
      .toEqual({ ok: false, code: "frontmatter-unparseable" });
  });

  it("stellt einer Notiz ohne Frontmatter einen frischen Block voran", () => {
    const r = setFrontmatterField({ existing: "nur Text", key: "mail_state", value: "detached" });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(r.ok && r.content).toBe("---\nmail_state: detached\n---\nnur Text");
  });

  it("beschreibt einen leeren Block, statt ihn als unlesbar zu melden", () => {
    const r = setFrontmatterField({ existing: "---\n---\ntext", key: "mail_state", value: "detached" });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(r.ok && r.content).toBe("---\nmail_state: detached\n---\ntext");
  });

  // Der Zeilenleser erkennt `zustand-ä` nicht als Schluessel: der alte Code haengte ihn bei jedem Lauf
  // wieder an. Jetzt meldet `patchFrontmatter` `invalid-key`; der Aufrufer faellt auf die API zurueck.
  it("meldet einen Schluessel mit Nicht-ASCII-Zeichen als frontmatter-unparseable", () => {
    expect(setFrontmatterField({ existing: note, key: "zustand-ä", value: "detached" }))
      .toEqual({ ok: false, code: "frontmatter-unparseable" });
  });

  // `patchFrontmatter` schuetzt `created` von sich aus; ein Zustandsfeld darf so heissen. Ohne
  // `protect: []` im Adapter schriebe diese Funktion es nicht.
  it("schreibt auch den Key `created`, den das Kit sonst schuetzt", () => {
    const r = setFrontmatterField({ existing: "---\ncreated: 2026-01-01\nmail_id: a@x\n---\ntext", key: "created", value: "detached" });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(r.ok && r.content).toBe("---\ncreated: detached\nmail_id: a@x\n---\ntext");
  });
});

// M1-Nachlese Punkt 1, das Ende-zu-Ende-Stueck: eine CRLF-Notiz bleibt nach einem Sync-Merge
// vollstaendig CRLF, und der Zonen-Hash traegt ueber den Wechsel hinweg — sonst meldete der
// naechste Lauf einen Konflikt, den niemand verursacht hat.
describe("mergeNote in einer CRLF-Notiz", () => {
  const crlf = [
    "---",
    "mail_id: a@x",
    "---",
    "eigene Notiz",
    "",
    "%% mailstone:begin %%",
    "## Nachricht",
    "alt",
    "%% mailstone:end %%",
    "",
  ].join("\r\n");

  it("schreibt die Zone mit CRLF und mischt keine Zeilenenden", () => {
    const r = mergeNote({
      existing: crlf,
      derived: { mail_id: "a@x" },
      managed: ["mail_id"],
      block: "## Nachricht\nneu",
      expectedZoneHash: null,
    });
    expect(r).toMatchObject({ ok: true, changed: true });
    if (!r.ok) return;
    expect(r.content).toContain("## Nachricht\r\nneu");
    expect(/[^\r]\n/.test(r.content)).toBe(false);
  });

  it("meldet beim naechsten Lauf keinen Zonen-Konflikt", () => {
    const erst = mergeNote({
      existing: crlf,
      derived: { mail_id: "a@x" },
      managed: ["mail_id"],
      block: "## Nachricht\nneu",
      expectedZoneHash: null,
    });
    expect(erst.ok).toBe(true);
    if (!erst.ok) return;
    // Zweiter Lauf mit dem Hash, den der erste zurueckgegeben hat — genau so haelt der Sync ihn.
    const zweit = mergeNote({
      existing: erst.content,
      derived: { mail_id: "a@x" },
      managed: ["mail_id"],
      block: "## Nachricht\nneu",
      expectedZoneHash: erst.zoneHash,
    });
    expect(zweit).toMatchObject({ ok: true, changed: false });
  });
});


// --- Welle 27: mergeNote schreibt das Frontmatter ueber das Kit (patchFrontmatter), nicht mehr ueber eine eigene Zeilenlogik ---
describe("mergeNote: Frontmatter ueber das Kit", () => {
  const hash = zoneHash("## Nachricht\n\nalt");
  const koerper = (kopf: string): string => `${kopf}## Notizen\n\nMein Gedanke.\n\n${zone}\n`;
  const run = (existing: string, over: Partial<Parameters<typeof mergeNote>[0]> = {}) =>
    mergeNote({ existing, derived, managed, block: "## Nachricht\n\nalt", expectedZoneHash: hash, ...over });

  it("ein leerer Frontmatter-Block wird beschrieben, statt als unlesbar abgelehnt", () => {
    const r = run(koerper("---\n---\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.content.startsWith("---\nmail_id: a@x\nmail_source: s\nmail_state: live\nmail_synced: 2026-08-23T15:00:00+02:00\ntitle: Hi\nfrom: a@x\n---\n## Notizen\n\nMein Gedanke.\n")).toBe(true);
    expect(r.content.endsWith(`${zone}\n`)).toBe(true);
  });

  it("ein leerer Block in einer CRLF-Notiz bleibt CRLF", () => {
    const r = run(koerper("---\n---\n").replace(/\n/g, "\r\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.content.match(/(?<!\r)\n/g) ?? []).length).toBe(0);
  });

  it("ein Schluessel mit Nicht-ASCII-Zeichen in managed → frontmatter-unparseable (frueher: bei jedem Lauf noch einmal angehaengt)", () => {
    const existing = koerper("---\ntype: mail\n---\n");
    const r = run(existing, { derived: { ...derived, "Größe": "3" }, managed: [...managed, "Größe"] });
    expect(r).toEqual({ ok: false, code: "frontmatter-unparseable" });
  });

  it("ein Wert mit Zeilenumbruch → frontmatter-unparseable, kein kaputtes YAML in der Notiz", () => {
    const existing = koerper("---\ntype: mail\n---\n");
    const r = run(existing, { derived: { ...derived, title: "eins\nzwei" } });
    expect(r).toEqual({ ok: false, code: "frontmatter-unparseable" });
  });

  it("fehlende verwaltete Keys werden in der Reihenfolge von managed angehaengt, nicht in der von derived", () => {
    const umgekehrt = Object.fromEntries(Object.entries(derived).reverse());
    const r = run(koerper("---\ntype: mail\n---\n"), { derived: umgekehrt });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const kopf = r.content.slice(0, r.content.indexOf("\n---\n", 4));
    expect(kopf.split("\n")).toEqual(["---", "type: mail", "mail_id: a@x", "mail_source: s", "mail_state: live", "mail_synced: 2026-08-23T15:00:00+02:00", "title: Hi", "from: a@x"]);
  });

  it("eine Notiz ohne Frontmatter bekommt einen Block mit den verwalteten Keys", () => {
    const r = run(`## Notizen\n\nOhne Kopf.\n\n${zone}\n`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.startsWith("---\nmail_id: a@x\n")).toBe(true);
    expect(r.content).toContain("Ohne Kopf.");
    expect(r.changed).toBe(true);
  });

  it("eine CRLF-Notiz ohne Frontmatter bekommt einen CRLF-Block (frueher: LF-Kopf vor CRLF-Rumpf)", () => {
    const r = run(`## Notizen\n\nOhne Kopf.\n\n${zone}\n`.replace(/\n/g, "\r\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.startsWith("---\r\nmail_id: a@x\r\n")).toBe(true);
    expect((r.content.match(/(?<!\r)\n/g) ?? []).length).toBe(0);
  });

  it("Rangfolge der Fehler wie bisher: ein nie geschlossener Block gewinnt gegen einen Wert mit Zeilenumbruch und fehlende Fences", () => {
    expect(run("---\nmail_id: a@x\n\nfrei, ohne Zone", { derived: { ...derived, title: "eins\nzwei" } })).toEqual({ ok: false, code: "frontmatter-unparseable" });
  });

  it("das Zeilenende der Zone folgt dem Kopf der Notiz, wie bisher (LF-Kopf mit CRLF-Rumpf: die Zone wird mit LF geschrieben)", () => {
    const existing = `---\ntype: mail\n---\n${"## Notizen\n\nMein Gedanke.\n\n".replace(/\n/g, "\r\n")}${zone.replace(/\n/g, "\r\n")}\r\n`;
    const r = run(existing, { block: "## Nachricht\n\nneu" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("%% mailstone:begin %%\n## Nachricht\n\nneu\n%% mailstone:end %%");
  });

  it("`created` ist hier ein Schluessel wie jeder andere: ist er verwaltet, wird er geschrieben (das Kit schuetzt ihn sonst)", () => {
    const r = run(koerper("---\ntype: mail\ncreated: 2026-01-01\n---\n"), { derived: { ...derived, created: "2026-08-23" }, managed: [...managed, "created"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("created: 2026-08-23");
    expect(r.content).not.toContain("created: 2026-01-01");
  });

  it("Rangfolge der Fehler wie bisher: ein nie geschlossener Block gewinnt gegen fehlende Fences", () => {
    expect(run("---\nmail_id: a@x\n\nfrei, ohne Zone")).toEqual({ ok: false, code: "frontmatter-unparseable" });
  });

  it("Rangfolge der Fehler wie bisher: fehlende Fences gewinnen gegen einen Block-Skalar am verwalteten Key", () => {
    expect(run("---\ntitle: |\n  mehrzeilig\n---\nfrei, ohne Zone")).toEqual({ ok: false, code: "fences-missing" });
  });

  it("Rangfolge der Fehler wie bisher: eine editierte Zone gewinnt gegen einen Block-Skalar am verwalteten Key", () => {
    const existing = koerper("---\ntitle: |\n  mehrzeilig\n---\n").replace("alt", "alt (von Hand)");
    expect(run(existing)).toEqual({ ok: false, code: "zone-edited" });
  });

  it("fluechtige Keys, die es schon gibt, halten die Notiz unveraendert; fehlt der Key, zaehlt sein Anhaengen als Aenderung", () => {
    const spaeter = { ...derived, mail_synced: "2026-08-23T16:30:00+02:00" };
    const mit = newNote(derived, { type: "mail" }, "## Nachricht\n\nalt");
    expect(run(mit.content, { derived: spaeter, volatileKeys: ["mail_synced"] })).toMatchObject({ ok: true, changed: false, content: mit.content });
    const ohne = mit.content.replace(/mail_synced: .*\n/, "");
    const r = run(ohne, { derived: spaeter, volatileKeys: ["mail_synced"] });
    expect(r).toMatchObject({ ok: true, changed: true });
    if (r.ok) expect(r.content).toContain("mail_synced: 2026-08-23T16:30:00+02:00");
  });
});
