import { describe, it, expect } from "vitest";
import { RESUME_FOLLOWING_COMMAND, STOP_FOLLOWING_COMMAND } from "../../../src/core/commands/follow-commands";
import { MAIL_COMMANDS } from "../../../src/core/commands/mail-commands";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { CommandContext, CommandDescriptor, MailNoteRef } from "../../../src/core/commands/types";

const profile = defaultMailProfile();
const ZONE = "%% mailstone:begin %%\n## Nachricht\nHallo\n%% mailstone:end %%\n";

interface N { id: string; date?: string; inReplyTo?: string[]; follow?: "false" | '"false"' | "true"; zone?: boolean }
function note(n: N): MailNoteRef {
  const fm = [`mail_id: ${n.id}`];
  if (n.follow) fm.push(`mail_follow: ${n.follow}`);
  const parsed: Record<string, unknown> = { mail_id: n.id, date: n.date ?? "2026-08-01", time: "10:00" };
  if (n.follow === "false") parsed.mail_follow = false;
  if (n.follow === '"false"') parsed.mail_follow = "false";
  if (n.follow === "true") parsed.mail_follow = true;
  return {
    mailId: n.id, path: `Mail/${n.id}.md`, zoneHash: n.zone === false ? null : "h",
    content: `---\n${fm.join("\n")}\n---\n\n${n.zone === false ? "keine Zone\n" : ZONE}`,
    frontmatter: parsed,
    thread: { inReplyTo: n.inReplyTo ?? [], references: [], valueId: null },
  };
}
/** Die aktive Notiz ist `active`, in der Liste stehen alle. */
function ctx(notes: MailNoteRef[], active: string, p = profile): CommandContext {
  const a = notes.find((x) => x.mailId === active)!;
  return {
    now: new Date(0), profile: p, target: { mailId: a.mailId, path: a.path, source: "s", state: "live" },
    content: a.content, frontmatter: a.frontmatter, zoneHash: "h", linkFor: () => null,
    attachmentPathFor: (x) => x, existingAttachment: () => null, notes,
  };
}
const thread = (): MailNoteRef[] => [note({ id: "a@x" }), note({ id: "b@x", date: "2026-08-02", inReplyTo: ["a@x"] })];
function ok(r: ReturnType<CommandDescriptor["plan"]>) {
  if (!r.ok) throw new Error(`kein Plan: ${r.code}`);
  return r.plan;
}

describe("Befehle zum Folgen eines Vorgangs (A1, Vorstufe)", () => {
  it("sind registriert, brauchen alle Notizen samt aufgeloester Verweise und passen zu einer Mail-Notiz", () => {
    for (const [c, id] of [[STOP_FOLLOWING_COMMAND, "mail.stopFollowing"], [RESUME_FOLLOWING_COMMAND, "mail.resumeFollowing"]] as const) {
      expect(c.id).toBe(id);
      expect(MAIL_COMMANDS).toContain(c);
      expect(c.needs).toEqual({ allNotes: true, threads: true });
      expect(c.titleKey).toBe(`cmd.${id}.title`);
    }
  });

  describe("mail.stopFollowing", () => {
    const cmd = STOP_FOLLOWING_COMMAND;

    it("setzt die Markierung an der WURZEL, auch wenn die aktive Notiz eine Antwort ist; der Schluessel fehlte vorher (E1) und false steht ohne Anfuehrungszeichen (E2)", () => {
      const plan = ok(cmd.plan({}, ctx(thread(), "b@x")));
      expect(plan.notes).toHaveLength(1);
      const n = plan.notes[0]!;
      expect(n.kind).toBe("update");
      if (n.kind !== "update") return;
      expect(n.path).toBe("Mail/a@x.md");
      expect(n.mailId).toBe("a@x");
      expect(n.content).toContain("\nmail_follow: false\n");
      expect(n.content).not.toContain('"false"');
      expect(n.content).toContain(ZONE); // Zone unberuehrt
      expect(n.zoneHash).toBe("h");
      expect(n.expectedContent).toBe(thread()[0]!.content);
    });

    it("zeigt die Vorschau: Feld, vorher leer, nachher false, und benennt die Wurzel", () => {
      const plan = ok(cmd.plan({}, ctx(thread(), "b@x")));
      expect(plan.diff).toEqual([{ field: "mail_follow", after: "false" }]);
      expect(plan.summaryArgs).toEqual(["Mail/a@x"]);
      expect(plan.summaryKey).toBe("plan.mail.stopFollowing.summary");
      expect(plan.commandId).toBe("mail.stopFollowing");
    });

    it("an der Wurzel selbst wirkt es ebenso; ein anderer Vorgang bleibt unberuehrt", () => {
      const plan = ok(cmd.plan({}, ctx([...thread(), note({ id: "z@x" })], "a@x")));
      expect(plan.notes.map((n) => n.path)).toEqual(["Mail/a@x.md"]);
    });

    it("ist die Wurzel schon beendet (false oder \"false\"), gibt es nichts zu tun", () => {
      for (const f of ["false", '"false"'] as const) {
        const notes = [note({ id: "a@x", follow: f }), note({ id: "b@x", date: "2026-08-02", inReplyTo: ["a@x"] })];
        expect(cmd.plan({}, ctx(notes, "b@x")), f).toEqual({ ok: false, code: "nothing-to-do" });
      }
    });

    it("ist ein Mitglied beendet, auch wenn die Wurzel keine Markierung traegt (fruehere Mail kam spaeter dazu), gibt es nichts zu tun", () => {
      const notes = [note({ id: "z@x", date: "2026-07-30" }), note({ id: "a@x", follow: "false", inReplyTo: ["z@x"] }), note({ id: "b@x", date: "2026-08-02", inReplyTo: ["a@x"] })];
      expect(cmd.plan({}, ctx(notes, "b@x"))).toEqual({ ok: false, code: "nothing-to-do" });
    });

    it("ersetzt eine vorhandene andere Markierung (true) durch false", () => {
      const plan = ok(cmd.plan({}, ctx([note({ id: "a@x", follow: "true" })], "a@x")));
      const n = plan.notes[0]!;
      expect(n.kind === "update" && n.content).toContain("\nmail_follow: false\n");
      expect(plan.diff).toEqual([{ field: "mail_follow", before: "true", after: "false" }]);
    });

    it("ohne wirksames Feld (leer oder verwaltet): nothing-to-do mit Hinweis auf die Einstellung", () => {
      for (const followField of ["", "mail_id"]) {
        expect(cmd.plan({}, ctx(thread(), "b@x", { ...profile, followField })), followField).toEqual({ ok: false, code: "nothing-to-do", hintKey: "error.command.follow-field-off" });
      }
    });

    it("eine Wurzel ohne Zone wird nicht angefasst: fences-missing", () => {
      expect(cmd.plan({}, ctx([note({ id: "a@x", zone: false })], "a@x"))).toEqual({ ok: false, code: "fences-missing" });
    });

    it("lehnt ungueltige Eingaben ab", () => {
      expect(cmd.plan({ x: 1 }, ctx(thread(), "a@x"))).toMatchObject({ ok: false, code: "invalid-input" });
    });

    it("gilt fuer jede Mail-Notiz", () => {
      expect(cmd.appliesTo({ profile, target: { mailId: "a@x", path: "p", source: "s", state: null }, frontmatter: {} })).toBe(true);
      expect(cmd.appliesTo({ profile, target: { mailId: "", path: "p", source: "", state: null }, frontmatter: {} })).toBe(false);
    });
  });

  describe("mail.resumeFollowing", () => {
    const cmd = RESUME_FOLLOWING_COMMAND;

    it("entfernt die Markierung samt Zeile an der Wurzel", () => {
      const notes = [note({ id: "a@x", follow: "false" }), note({ id: "b@x", date: "2026-08-02", inReplyTo: ["a@x"] })];
      const plan = ok(cmd.plan({}, ctx(notes, "b@x")));
      const n = plan.notes[0]!;
      expect(n.kind).toBe("update");
      if (n.kind !== "update") return;
      expect(n.path).toBe("Mail/a@x.md");
      expect(n.content).not.toContain("mail_follow");
      expect(n.content).toContain("mail_id: a@x");
      expect(n.content).toContain(ZONE);
      expect(plan.diff).toEqual([{ field: "mail_follow", before: "false" }]);
      expect(plan.summaryKey).toBe("plan.mail.resumeFollowing.summary");
    });

    it("entfernt auch die als Text gequotete Markierung", () => {
      const plan = ok(cmd.plan({}, ctx([note({ id: "a@x", follow: '"false"' })], "a@x")));
      expect(plan.notes[0]!.kind === "update" && plan.notes[0]!.content).not.toContain("mail_follow");
    });

    it("steht keine Markierung an der Wurzel, gibt es nichts zu tun (auch bei true)", () => {
      expect(cmd.plan({}, ctx(thread(), "b@x"))).toEqual({ ok: false, code: "nothing-to-do" });
      expect(cmd.plan({}, ctx([note({ id: "a@x", follow: "true" })], "a@x"))).toEqual({ ok: false, code: "nothing-to-do" });
    });

    it("raeumt die Markierung an ALLEN Mitgliedern ab, nicht nur an der Wurzel", () => {
      const notes = [
        note({ id: "z@x", date: "2026-07-30", follow: "false" }),
        note({ id: "a@x", follow: '"false"', inReplyTo: ["z@x"] }),
        note({ id: "b@x", date: "2026-08-02", inReplyTo: ["a@x"] }),
        note({ id: "y@x", follow: "false" }), // anderer Vorgang
      ];
      const plan = ok(cmd.plan({}, ctx(notes, "b@x")));
      expect(plan.notes.map((n) => n.path).sort()).toEqual(["Mail/a@x.md", "Mail/z@x.md"]);
      for (const n of plan.notes) expect(n.kind === "update" && n.content).not.toContain("mail_follow");
      expect(plan.diff).toEqual([{ field: "mail_follow", before: "false" }]);
    });

    it("steht die Markierung nur an einem spaeteren Mitglied, wird sie dort entfernt", () => {
      const notes = [note({ id: "a@x" }), note({ id: "b@x", date: "2026-08-02", inReplyTo: ["a@x"], follow: "false" })];
      const plan = ok(cmd.plan({}, ctx(notes, "a@x")));
      expect(plan.notes.map((n) => n.path)).toEqual(["Mail/b@x.md"]);
    });

    it("ein markiertes Mitglied ohne Zone haelt die ganze Wiederaufnahme an (fences-missing), es wird nichts halb geraeumt", () => {
      const notes = [note({ id: "a@x", follow: "false" }), note({ id: "b@x", date: "2026-08-02", inReplyTo: ["a@x"], follow: "false", zone: false })];
      expect(cmd.plan({}, ctx(notes, "a@x"))).toEqual({ ok: false, code: "fences-missing" });
    });

    it("ohne wirksames Feld: nothing-to-do mit Hinweis", () => {
      expect(cmd.plan({}, ctx(thread(), "b@x", { ...profile, followField: "" }))).toEqual({ ok: false, code: "nothing-to-do", hintKey: "error.command.follow-field-off" });
    });
  });

  it("Stopp und Wiederaufnahme sind Gegenstuecke: nach dem Stopp liest die Wiederaufnahme den Zustand zurueck", () => {
    const stop = ok(STOP_FOLLOWING_COMMAND.plan({}, ctx(thread(), "b@x")));
    const n = stop.notes[0]!;
    if (n.kind !== "update") throw new Error("unreachable");
    const after = thread().map((r) => (r.mailId === "a@x" ? { ...r, content: n.content, frontmatter: { ...r.frontmatter, mail_follow: false } } : r));
    const resume = ok(RESUME_FOLLOWING_COMMAND.plan({}, ctx(after, "b@x")));
    const m = resume.notes[0]!;
    expect(m.kind === "update" && m.content).toBe(thread()[0]!.content);
  });
});
