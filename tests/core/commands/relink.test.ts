import { describe, it, expect } from "vitest";
import { relinkOne, relinkValues, RELINK_COMMAND } from "../../../src/core/commands/relink";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { CommandContext, MailNoteRef } from "../../../src/core/commands/types";

const profile = defaultMailProfile();
const NOW = new Date("2026-08-30T22:00:00Z");
const ZONE = "%% mailstone:begin %%\n## Nachricht\nHallo\n%% mailstone:end %%\n";

function note(mailId: string, fm: Record<string, unknown>, zoneHash: string | null = "h"): MailNoteRef {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : String(v)}`);
  return { mailId, path: `Mail/2026/${mailId}.md`, frontmatter: { mail_id: mailId, ...fm }, zoneHash,
    content: `---\nmail_id: ${mailId}\n${lines.join("\n")}\n---\n\n${ZONE}` };
}

const links: Record<string, string> = { "b@x": "Mail/2026/b@x", "c@x": "Mail/2026/c@x" };
const linkFor = (id: string): string | null => links[id] ?? null;

function ctx(notes: MailNoteRef[]): CommandContext {
  return {
    now: NOW, profile,
    target: { mailId: "a@x", path: "Mail/2026/a@x.md", source: "acc/Vault", state: "live" },
    content: notes[0]?.content ?? "", frontmatter: notes[0]?.frontmatter ?? {}, zoneHash: "h",
    linkFor, attachmentPathFor: (n) => `Anhaenge/${n}`, notes,
  };
}

describe("relinkOne", () => {
  it("macht aus einer bekannten Message-ID einen Wikilink", () => {
    expect(relinkOne("b@x", linkFor)).toBe("[[Mail/2026/b@x]]");
  });
  it("laesst eine unbekannte ID stehen", () => {
    expect(relinkOne("unbekannt@x", linkFor)).toBe("unbekannt@x");
  });
  it("fasst einen bestehenden Wikilink nicht an — auch nicht, wenn das Ziel fehlt", () => {
    expect(relinkOne("[[Mail/2026/geloescht]]", linkFor)).toBe("[[Mail/2026/geloescht]]");
  });
  it("laesst einen leeren Wert leer", () => {
    expect(relinkOne("", linkFor)).toBe("");
  });
});

describe("relinkValues", () => {
  it("verlinkt in_reply_to und references gemeinsam", () => {
    const out = relinkValues({ in_reply_to: "b@x", references: ["c@x", "weg@x"] }, ["in_reply_to", "references"], linkFor);
    expect(out).toEqual({ in_reply_to: "[[Mail/2026/b@x]]", references: ["[[Mail/2026/c@x]]", "weg@x"] });
  });
  it("liefert null, wenn sich nichts aendert", () => {
    expect(relinkValues({ in_reply_to: "[[Mail/2026/b@x]]" }, ["in_reply_to", "references"], linkFor)).toBeNull();
  });
  it("uebergeht Werte, die weder String noch String-Liste sind", () => {
    expect(relinkValues({ in_reply_to: 42 }, ["in_reply_to"], linkFor)).toBeNull();
  });
});

describe("mail.relink", () => {
  it("braucht alle Notizen, aber keine .eml", () => {
    expect(RELINK_COMMAND.needs).toEqual({ allNotes: true });
  });

  it("plant je betroffener Notiz ein update", () => {
    const r = RELINK_COMMAND.plan({}, ctx([note("a@x", { in_reply_to: "b@x" }), note("d@x", { in_reply_to: "unbekannt@x" })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.notes).toHaveLength(1);
    expect(r.plan.notes[0]).toMatchObject({ kind: "update", path: "Mail/2026/a@x.md", mailId: "a@x" });
    expect(r.plan.summaryArgs).toEqual([1]);
  });

  it("traegt den GESPEICHERTEN Zone-Hash weiter, statt ihn neu zu berechnen", () => {
    const r = RELINK_COMMAND.plan({}, ctx([note("a@x", { in_reply_to: "b@x" }, "gespeicherter-hash")]));
    expect(r.ok && (r.plan.notes[0] as { zoneHash: string }).zoneHash).toBe("gespeicherter-hash");
  });

  it("ueberspringt eine Notiz ohne Fences", () => {
    const ohne: MailNoteRef = { mailId: "a@x", path: "Mail/2026/a@x.md", zoneHash: null,
      frontmatter: { mail_id: "a@x", in_reply_to: "b@x" }, content: "---\nmail_id: a@x\nin_reply_to: b@x\n---\nnur Text" };
    expect(RELINK_COMMAND.plan({}, ctx([ohne]))).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("meldet nothing-to-do, wenn alles schon verlinkt ist", () => {
    expect(RELINK_COMMAND.plan({}, ctx([note("a@x", { in_reply_to: "[[Mail/2026/b@x]]" })]))).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("traegt expectedContent = ref.content in den Plan (Fund 2, M3b-Nachlese)", () => {
    const n = note("a@x", { in_reply_to: "b@x" });
    const r = RELINK_COMMAND.plan({}, ctx([n]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.notes[0]).toMatchObject({ kind: "update", expectedContent: n.content });
  });

  it("formatiert die 'after'-Seite der Diff-Zeile mit show(), genau wie 'before' — Arrays einheitlich mit Leerzeichen (Fund 6, M3b-Nachlese)", () => {
    const r = RELINK_COMMAND.plan({}, ctx([note("a@x", { references: ["b@x", "c@x"] })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.diff[0]).toMatchObject({ before: "b@x, c@x", after: "[[Mail/2026/b@x]], [[Mail/2026/c@x]]" });
  });

  it("zeigt hoechstens 20 Diff-Zeilen, zaehlt aber alle", () => {
    const viele = Array.from({ length: 25 }, (_, i) => note(`m${i}@x`, { in_reply_to: "b@x" }));
    const r = RELINK_COMMAND.plan({}, ctx(viele));
    expect(r.ok && r.plan.notes).toHaveLength(25);
    expect(r.ok && r.plan.diff).toHaveLength(20);
    expect(r.ok && r.plan.summaryArgs).toEqual([25]);
  });
});
