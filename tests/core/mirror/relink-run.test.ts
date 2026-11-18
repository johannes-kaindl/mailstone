import { describe, it, expect } from "vitest";
import { planRunRelinks, type RelinkHead } from "../../../src/core/mirror/relink-run";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import { splitBody } from "../../../src/core/merge/fences";

// Vorspann zu A3 (Welle 36, Entscheidung Johannes 2026-11-18): ein Sync-Lauf verlinkt in BESTEHENDEN
// Notizen rohe IDs auf Notizen, die er selbst angelegt hat, und sonst nichts.
const profile = defaultMailProfile();
const ZONE = "%% mailstone:begin %%\n## Nachricht\nHallo Welt\n%% mailstone:end %%";

function noteText(mailId: string, fm: Record<string, string>): string {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
  return `---\nmail_id: ${mailId}\n${lines.join("\n")}\n---\n\n## Notizen\n\nmeine Notiz\n\n${ZONE}\n`;
}

function setup(notes: { mailId: string; fm: Record<string, string>; frontmatter?: Record<string, unknown> }[]) {
  const texts = new Map<string, string>();
  const heads: RelinkHead[] = notes.map((n) => {
    const path = `Mail/2026/${n.mailId}.md`;
    texts.set(path, noteText(n.mailId, n.fm));
    return { mailId: n.mailId, path, frontmatter: n.frontmatter ?? { mail_id: n.mailId, ...n.fm } };
  });
  return {
    texts,
    deps: {
      heads: () => heads,
      read: (path: string) => Promise.resolve(texts.has(path) ? { content: texts.get(path)!, zoneHash: "gespeichert" } : null),
    },
  };
}

describe("planRunRelinks", () => {
  it("verlinkt in einer aelteren Notiz die rohe ID einer Notiz, die dieser Lauf angelegt hat", async () => {
    const { deps } = setup([{ mailId: "alt@x", fm: { in_reply_to: "neu@x", references: "[neu@x]" }, frontmatter: { mail_id: "alt@x", in_reply_to: "neu@x", references: ["neu@x"] } }]);
    const r = await planRunRelinks(profile, new Map([["neu@x", "Mail/2026/neu"]]), deps);
    expect(r.errors).toBe(0);
    expect(r.plans).toHaveLength(1);
    const p = r.plans[0]!;
    expect(p.kind).toBe("update");
    if (p.kind !== "update") return;
    expect(p.content).toContain("in_reply_to: \"[[Mail/2026/neu]]\"");
    expect(p.content).toContain("[[Mail/2026/neu]]");
    expect(p.content).not.toContain("in_reply_to: neu@x");
  });

  it("laesst eine rohe ID unberuehrt, deren Notiz dieser Lauf NICHT angelegt hat", async () => {
    const { deps } = setup([{ mailId: "alt@x", fm: { in_reply_to: "irgendwo@x" } }]);
    const r = await planRunRelinks(profile, new Map([["neu@x", "Mail/2026/neu"]]), deps);
    expect(r.plans).toEqual([]);
    expect(r.errors).toBe(0);
  });

  it("verlinkt nur die IDs des Laufs, wenn die Liste auch eine fremde ID traegt", async () => {
    const { deps } = setup([{ mailId: "alt@x", fm: { references: "[irgendwo@x, neu@x]" }, frontmatter: { mail_id: "alt@x", references: ["irgendwo@x", "neu@x"] } }]);
    const r = await planRunRelinks(profile, new Map([["neu@x", "Mail/2026/neu"]]), deps);
    const p = r.plans[0]!;
    expect(p.kind === "update" && p.content.includes("references: [irgendwo@x, \"[[Mail/2026/neu]]\"]")).toBe(true);
  });

  it("laesst die Zone Byte fuer Byte stehen und uebernimmt den gespeicherten Zone-Hash", async () => {
    const { deps, texts } = setup([{ mailId: "alt@x", fm: { in_reply_to: "neu@x" } }]);
    const vorher = texts.get("Mail/2026/alt@x.md")!;
    const r = await planRunRelinks(profile, new Map([["neu@x", "Mail/2026/neu"]]), deps);
    const p = r.plans[0]!;
    if (p.kind !== "update") throw new Error("update erwartet");
    expect(splitBody(p.content.slice(p.content.indexOf("\n---\n") + 5)).block).toBe(splitBody(vorher.slice(vorher.indexOf("\n---\n") + 5)).block);
    expect(p.content.endsWith(vorher.slice(vorher.indexOf("\n---\n")))).toBe(true);
    expect(p.zoneHash).toBe("gespeichert");
    expect(p.expectedContent).toBe(vorher);
  });

  it("verlinkt eine Notiz nie auf sich selbst und fasst Notizen des Laufs nicht an", async () => {
    const { deps } = setup([
      { mailId: "neu@x", fm: { references: "neu@x" }, frontmatter: { mail_id: "neu@x", references: ["neu@x"] } },
      { mailId: "eigen@x", fm: {}, frontmatter: { mail_id: "eigen@x", references: ["eigen@x"] } },
    ]);
    const r = await planRunRelinks(profile, new Map([["neu@x", "Mail/2026/neu"], ["eigen@x", "Mail/2026/eigen"]]), deps);
    expect(r.plans).toEqual([]);
  });

  it("fasst einen bestehenden Wikilink nicht an", async () => {
    const { deps } = setup([{ mailId: "alt@x", fm: {}, frontmatter: { mail_id: "alt@x", in_reply_to: "[[Mail/2026/anders]]" } }]);
    const r = await planRunRelinks(profile, new Map([["neu@x", "Mail/2026/neu"]]), deps);
    expect(r.plans).toEqual([]);
  });

  it("fuehrt eine Notiz ohne Zone mit Grund als skip und liest sie nicht halb an", async () => {
    const { deps, texts } = setup([{ mailId: "alt@x", fm: { in_reply_to: "neu@x" } }]);
    texts.set("Mail/2026/alt@x.md", "---\nmail_id: alt@x\nin_reply_to: neu@x\n---\n\nkeine Zone\n");
    const r = await planRunRelinks(profile, new Map([["neu@x", "Mail/2026/neu"]]), { ...deps, read: (p) => Promise.resolve({ content: texts.get(p)!, zoneHash: null }) });
    expect(r.plans).toEqual([{ kind: "skip", path: "Mail/2026/alt@x.md", mailId: "alt@x", reason: "fences-missing" }]);
  });

  it("zaehlt eine Notiz, die sich nicht lesen laesst, als Fehler und macht mit den anderen weiter", async () => {
    const { deps } = setup([
      { mailId: "kaputt@x", fm: { in_reply_to: "neu@x" } },
      { mailId: "gut@x", fm: { in_reply_to: "neu@x" } },
    ]);
    const r = await planRunRelinks(profile, new Map([["neu@x", "Mail/2026/neu"]]), {
      ...deps,
      read: (p) => (p.includes("kaputt") ? Promise.reject(new Error("weg")) : deps.read(p)),
    });
    expect(r.errors).toBe(1);
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0]).toMatchObject({ kind: "update", mailId: "gut@x" });
  });

  it("liest keine Datei, solange kein Lauf eine Notiz angelegt hat", async () => {
    let gelesen = 0;
    const { deps } = setup([{ mailId: "alt@x", fm: { in_reply_to: "neu@x" } }]);
    const r = await planRunRelinks(profile, new Map(), { ...deps, read: (p) => { gelesen++; return deps.read(p); } });
    expect(r.plans).toEqual([]);
    expect(gelesen).toBe(0);
  });
});
