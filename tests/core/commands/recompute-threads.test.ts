import { describe, it, expect } from "vitest";
import { RECOMPUTE_THREADS_COMMAND } from "../../../src/core/commands/recompute-threads";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { CommandContext, MailNoteRef } from "../../../src/core/commands/types";

const profile = { ...defaultMailProfile(), threadField: "vorgang" };
const ZONE = "%% mailstone:begin %%\n## Nachricht\nHallo\n%% mailstone:end %%\n";

interface N { id: string; date?: string; time?: string; value?: string | null; valueId?: string | null; inReplyTo?: string[]; references?: string[]; subject?: string; zone?: boolean }
function note(n: N): MailNoteRef {
  const fm: string[] = [`mail_id: ${n.id}`];
  if (n.value !== undefined && n.value !== null) fm.push(`vorgang: "${n.value}"`);
  return {
    mailId: n.id, path: `Mail/${n.id}.md`, zoneHash: n.zone === false ? null : "h",
    content: `---\n${fm.join("\n")}\n---\n\n${n.zone === false ? "keine Zone\n" : ZONE}`,
    frontmatter: { mail_id: n.id, date: n.date ?? "2026-08-01", time: n.time ?? "10:00", subject: n.subject ?? `Betreff ${n.id}`, ...(n.value ? { vorgang: n.value } : {}) },
    thread: { inReplyTo: n.inReplyTo ?? [], references: n.references ?? [], valueId: n.valueId ?? null },
  };
}
function ctx(notes: MailNoteRef[], p = profile): CommandContext {
  const first = notes[0]!;
  return {
    now: new Date(0), profile: p, target: { mailId: first.mailId, path: first.path, source: "s", state: "live" },
    content: first.content, frontmatter: first.frontmatter, zoneHash: "h", linkFor: () => null,
    attachmentPathFor: (x) => x, existingAttachment: () => null, notes,
  };
}
const cmd = RECOMPUTE_THREADS_COMMAND;
function updates(r: ReturnType<typeof cmd.plan>) {
  if (!r.ok) throw new Error(`kein Plan: ${r.code}`);
  return r.plan.notes;
}

describe("mail.recomputeThreads", () => {
  it("braucht alle Notizen samt aufgeloester Verweise, aber keine .eml", () => {
    expect(cmd.id).toBe("mail.recomputeThreads");
    expect(cmd.needs).toEqual({ allNotes: true, threads: true });
  });

  it("ohne threadField: nothing-to-do mit Hinweis auf die Einstellung, nichts wird gelesen", () => {
    expect(cmd.plan({}, ctx([note({ id: "a@x" })], defaultMailProfile()))).toEqual({ ok: false, code: "nothing-to-do", hintKey: "error.command.thread-field-off" });
  });
  it("ein verwalteter Schluessel als threadField gilt als aus", () => {
    expect(cmd.plan({}, ctx([note({ id: "a@x" })], { ...profile, threadField: "mail_id" }))).toMatchObject({ ok: false, code: "nothing-to-do", hintKey: "error.command.thread-field-off" });
  });

  it("traegt das Feld nach, wo es im Bestand FEHLT (E1: das Feld wird angelegt)", () => {
    const r = cmd.plan({}, ctx([note({ id: "a@x" }), note({ id: "b@x", date: "2026-08-02", inReplyTo: ["a@x"] })]));
    const n = updates(r);
    expect(n).toHaveLength(2);
    for (const p of n) expect(p.kind === "update" && p.content).toContain('vorgang: "[[Mail/a@x]]"');
    const b = n.find((p) => p.mailId === "b@x")!;
    expect(b.kind === "update" && b.content).toContain(ZONE);
    expect(b.kind === "update" && b.zoneHash).toBe("h");
  });

  it("rechnet neu, wenn eine fruehere Mail des Vorgangs im Vault liegt (die Wurzel wechselt)", () => {
    const r = cmd.plan({}, ctx([
      note({ id: "a@x", date: "2026-08-01" }),
      note({ id: "b@x", date: "2026-08-02", inReplyTo: ["a@x"], value: "[[Mail/b@x]]", valueId: "b@x" }),
    ]));
    const n = updates(r);
    const b = n.find((p) => p.mailId === "b@x")!;
    expect(b.kind === "update" && b.content).toContain('vorgang: "[[Mail/a@x]]"');
    expect(b.kind === "update" && b.content.match(/^vorgang:/gm)).toHaveLength(1);
  });

  it("vergleicht aufgeloeste Ziele, nicht Zeichenketten: ein kurzer Link auf die richtige Wurzel bleibt", () => {
    const r = cmd.plan({}, ctx([
      note({ id: "a@x", value: "[[a]]", valueId: "a@x" }),
      note({ id: "b@x", date: "2026-08-02", inReplyTo: ["a@x"], value: "[[Alias-der-Wurzel]]", valueId: "a@x" }),
    ]));
    expect(r).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("keine Vorschau ohne Aenderung", () => {
    const r = cmd.plan({}, ctx([note({ id: "a@x", value: "[[Mail/a@x]]", valueId: "a@x" })]));
    expect(r).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("uebergeht eine Notiz ohne Zone mit Grund und schreibt sie nicht", () => {
    const r = cmd.plan({}, ctx([note({ id: "a@x" }), note({ id: "b@x", date: "2026-08-02", inReplyTo: ["a@x"], zone: false })]));
    const n = updates(r);
    expect(n.find((p) => p.mailId === "b@x")).toEqual({ kind: "skip", path: "Mail/b@x.md", mailId: "b@x", reason: "fences-missing" });
    expect(n.find((p) => p.mailId === "a@x")?.kind).toBe("update");
  });

  it("verbindet ueber den Betreff-Token, wenn die Header nichts verbinden", () => {
    const r = cmd.plan({}, ctx([
      note({ id: "a@x", subject: "[Ticket#7] Start" }),
      note({ id: "b@x", date: "2026-08-03", subject: "AW: [Ticket#7] Start" }),
    ]));
    for (const p of updates(r)) expect(p.kind === "update" && p.content).toContain('vorgang: "[[Mail/a@x]]"');
  });

  it("ein ungueltiger Token-Regex schaltet nur die Token-Regel ab", () => {
    const r = cmd.plan({}, ctx([
      note({ id: "a@x", subject: "[Ticket#7] Start" }),
      note({ id: "b@x", date: "2026-08-03", subject: "AW: [Ticket#7] Start" }),
    ], { ...profile, threadTokenPattern: "[" }));
    const n = updates(r);
    expect(n.find((p) => p.mailId === "b@x")?.kind === "update" && (n.find((p) => p.mailId === "b@x") as { content: string }).content).toContain('vorgang: "[[Mail/b@x]]"');
  });

  it("die Vorschau nennt die Zahl und enthaelt eine Zeile je Notiz (bis zum Deckel)", () => {
    const r = cmd.plan({}, ctx([note({ id: "a@x" }), note({ id: "b@x", date: "2026-08-02", inReplyTo: ["a@x"] })]));
    if (!r.ok) throw new Error("kein Plan");
    expect(r.plan.summaryArgs).toEqual([2, "vorgang"]);
    expect(r.plan.diff).toHaveLength(2);
  });
});
