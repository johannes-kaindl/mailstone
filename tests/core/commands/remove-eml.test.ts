import { describe, it, expect } from "vitest";
import { REMOVE_EML_COMMAND } from "../../../src/core/commands/remove-eml";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { CommandContext, MailNoteRef } from "../../../src/core/commands/types";

const profile = { ...defaultMailProfile(), saveEml: false };
const NOW = new Date("2026-11-18T22:00:00Z");

function note(id: string, eml?: MailNoteRef["eml"], path = `Mail/2026/${id}.md`): MailNoteRef {
  return { mailId: id, path, content: "x", frontmatter: { mail_id: id }, zoneHash: null, ...(eml ? { eml } : {}) };
}
const emlOf = (id: string, status: "match" | "mismatch" | "unreadable" = "match") => ({ path: `Mail/2026/_eml/${id}.eml`, status });

function ctx(notes: MailNoteRef[], p = profile): CommandContext {
  return {
    now: NOW, profile: p,
    target: { mailId: "a@x", path: "Mail/2026/a@x.md", source: "acc/Vault", state: "live" },
    content: "", frontmatter: {}, zoneHash: null,
    linkFor: () => null, attachmentPathFor: (n) => n, existingAttachment: () => null, notes,
  };
}

describe("mail.removeEml", () => {
  it("braucht alle Notizen und die .eml-Probe, aber keine geparste .eml", () => {
    expect(REMOVE_EML_COMMAND.needs).toEqual({ allNotes: true, emlProbe: true });
  });

  it("erscheint nur bei saveEml: false und nur auf einer Mail-Notiz", () => {
    const probe = (p: typeof profile, mailId = "a@x") => ({ profile: p, target: { mailId, path: "x.md", source: "", state: null }, frontmatter: {} });
    expect(REMOVE_EML_COMMAND.appliesTo(probe(profile))).toBe(true);
    expect(REMOVE_EML_COMMAND.appliesTo(probe({ ...profile, saveEml: true }))).toBe(false);
    expect(REMOVE_EML_COMMAND.appliesTo(probe(profile, ""))).toBe(false);
  });

  it("erscheint auch bei saveEml: true, sobald pseudonymisiert wird (dort entsteht keine .eml mehr)", () => {
    const probe = (p: typeof profile) => ({ profile: p, target: { mailId: "a@x", path: "x.md", source: "", state: null }, frontmatter: {} });
    expect(REMOVE_EML_COMMAND.appliesTo(probe({ ...profile, saveEml: true, pseudonymize: "required" }))).toBe(true);
    expect(REMOVE_EML_COMMAND.appliesTo(probe({ ...profile, saveEml: true, pseudonymize: "off" }))).toBe(false);
  });

  it("plant nur die passenden .eml zum Papierkorb und fasst keine Notiz an", () => {
    const r = REMOVE_EML_COMMAND.plan({}, ctx([note("a@x", emlOf("a@x")), note("b@x", emlOf("b@x")), note("c@x")]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.trash).toEqual([
      { kind: "trash", path: "Mail/2026/_eml/a@x.eml", mailId: "a@x" },
      { kind: "trash", path: "Mail/2026/_eml/b@x.eml", mailId: "b@x" },
    ]);
    expect(r.plan.notes).toEqual([]);
    expect(r.plan.summaryArgs).toEqual([2, 0]);
  });

  it("uebergeht eine .eml mit anderer Message-ID oder unlesbarem Kopf, mit Grund in der Vorschau, und loescht sie nie", () => {
    const r = REMOVE_EML_COMMAND.plan({}, ctx([note("a@x", emlOf("a@x")), note("b@x", emlOf("b@x", "mismatch")), note("c@x", emlOf("c@x", "unreadable"))]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.trash?.map((t) => t.mailId)).toEqual(["a@x"]);
    expect(r.plan.summaryArgs).toEqual([1, 2]);
    expect(r.plan.diff).toEqual(expect.arrayContaining([
      { field: "trash", before: "Mail/2026/_eml/a@x.eml" },
      { field: "skipped", before: "Mail/2026/_eml/b@x.eml", after: "mismatch" },
      { field: "skipped", before: "Mail/2026/_eml/c@x.eml", after: "unreadable" },
    ]));
  });

  it("fasst nur den Konventionspfad an: ein anderer Pfad in der Probe wird nie zum Papierkorb", () => {
    const r = REMOVE_EML_COMMAND.plan({}, ctx([note("a@x", { path: "Import/a.eml", status: "match" }), note("b@x", emlOf("b@x"))]));
    expect(r.ok && r.plan.trash?.map((t) => t.path)).toEqual(["Mail/2026/_eml/b@x.eml"]);
  });

  it("meldet nothing-to-do ohne eine passende .eml", () => {
    expect(REMOVE_EML_COMMAND.plan({}, ctx([note("a@x"), note("b@x", emlOf("b@x", "mismatch"))]))).toEqual({ ok: false, code: "nothing-to-do" });
    expect(REMOVE_EML_COMMAND.plan({}, ctx([]))).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("zeigt hoechstens 20 Pfade, zaehlt aber alle", () => {
    const viele = Array.from({ length: 25 }, (_, i) => note(`m${i}@x`, emlOf(`m${i}@x`)));
    const r = REMOVE_EML_COMMAND.plan({}, ctx(viele));
    expect(r.ok && r.plan.trash).toHaveLength(25);
    expect(r.ok && r.plan.diff.filter((d) => d.field === "trash")).toHaveLength(20);
    expect(r.ok && r.plan.summaryArgs).toEqual([25, 0]);
  });

  it("verweigert Eingaben, die das Schema nicht kennt", () => {
    expect(REMOVE_EML_COMMAND.plan({ x: 1 }, ctx([note("a@x", emlOf("a@x"))]))).toEqual({ ok: false, code: "invalid-input" });
  });
});
