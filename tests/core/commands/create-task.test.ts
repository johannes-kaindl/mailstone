import { describe, it, expect } from "vitest";
import { CREATE_TASK_COMMAND } from "../../../src/core/commands/create-task";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { CommandContext } from "../../../src/core/commands/types";

const profile = defaultMailProfile();

function ctx(fm: Record<string, unknown>, mailId = "a@x"): CommandContext {
  return {
    now: new Date("2026-09-05T08:00:00Z"), profile,
    target: { mailId, path: "Mail/2026/x.md", source: "acc/Vault", state: "live" },
    content: "", frontmatter: { mail_id: mailId, ...fm }, zoneHash: null,
    linkFor: () => null, attachmentPathFor: (n) => `Anhaenge/${n}`, existingAttachment: () => null,
  };
}

describe("CREATE_TASK_COMMAND", () => {
  it("uebernimmt den Betreff als Titel", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "Angebot pruefen", due: "" }, ctx({ subject: "Angebot pruefen" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.createTask?.title).toBe("Angebot pruefen");
  });

  it("traegt die Faelligkeit als ISO-Datum ein", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "X", due: "2026-12-24" }, ctx({ subject: "X" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.createTask?.due).toBe("2026-12-24");
  });

  it("macht aus einer leeren Faelligkeit null, nicht den leeren String", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "X", due: "" }, ctx({ subject: "X" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.createTask?.due).toBeNull();
  });

  it("verlinkt die Mail-Notiz ueber ihren Pfad", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "X", due: "" }, ctx({ subject: "X" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.createTask?.noteLink).toContain("Mail/2026/x");
  });

  it("schreibt NICHTS ins Vault", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "X", due: "" }, ctx({ subject: "X" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.notes).toEqual([]);
      expect(r.plan.diff).toEqual([]);
      expect(r.plan.attachment).toBeUndefined();
    }
  });

  it("lehnt einen leeren Titel ab", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "   ", due: "" }, ctx({ subject: "X" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid-input");
  });

  it("lehnt ein Datum in falscher Form ab", () => {
    const r = CREATE_TASK_COMMAND.plan({ title: "X", due: "24.12.2026" }, ctx({ subject: "X" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid-input");
  });

  it("gilt fuer jede Mail-Notiz — die TaskNotes-Pruefung sitzt in der Obsidian-Schicht", () => {
    expect(CREATE_TASK_COMMAND.appliesTo({ profile, target: ctx({}).target, frontmatter: { mail_id: "a@x" } })).toBe(true);
  });

  it("belegt das Titelfeld im Schema mit dem Betreff vor (Spec § 3)", () => {
    const schema = CREATE_TASK_COMMAND.schemaFor?.(ctx({ subject: "Angebot pruefen" }));
    expect(schema?.properties["title"]).toMatchObject({ default: "Angebot pruefen" });
  });

  it("hat kein default am Titelfeld, wenn kein Betreff vorliegt", () => {
    const schema = CREATE_TASK_COMMAND.schemaFor?.(ctx({}));
    expect(schema?.properties["title"]).not.toHaveProperty("default");
  });
});
