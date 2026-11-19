import { describe, it, expect } from "vitest";
import { ALIGN_THREAD_FIELDS_COMMAND } from "../../../src/core/commands/align-thread-fields";
import { MAIL_COMMANDS } from "../../../src/core/commands/mail-commands";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { CommandContext, MailNoteRef } from "../../../src/core/commands/types";

const profile = { ...defaultMailProfile(), inheritFields: ["projekt"] };
const ZONE = "%% mailstone:begin %%\n## Nachricht\nHallo\n%% mailstone:end %%\n";
const cmd = ALIGN_THREAD_FIELDS_COMMAND;

/** `fm` ist der Frontmatter-Text (YAML), `parsed` der Wert, wie ihn der Metadata-Cache lieferte. */
interface N { id: string; date?: string; inReplyTo?: string[]; fm?: string[]; parsed?: Record<string, unknown>; zone?: boolean }
function note(n: N): MailNoteRef {
  return {
    mailId: n.id, path: `Mail/${n.id}.md`, zoneHash: n.zone === false ? null : "h",
    content: `---\nmail_id: ${n.id}\n${(n.fm ?? []).map((l) => `${l}\n`).join("")}---\n\n${n.zone === false ? "keine Zone\n" : ZONE}`,
    frontmatter: { mail_id: n.id, date: n.date ?? "2026-08-01", time: "10:00", ...n.parsed },
    thread: { inReplyTo: n.inReplyTo ?? [], references: [], valueId: null },
  };
}
function ctx(notes: MailNoteRef[], active: string, p = profile): CommandContext {
  const a = notes.find((x) => x.mailId === active)!;
  return {
    now: new Date(0), profile: p, target: { mailId: a.mailId, path: a.path, source: "s", state: "live" },
    content: a.content, frontmatter: a.frontmatter, zoneHash: "h", linkFor: () => null,
    attachmentPathFor: (x) => x, existingAttachment: () => null, notes,
  };
}
function ok(r: ReturnType<typeof cmd.plan>) {
  if (!r.ok) throw new Error(`kein Plan: ${r.code}`);
  return r.plan;
}
const contentOf = (p: { notes: { kind: string; path: string; content?: string }[] }, mailId: string): string => {
  const n = p.notes.find((x) => x.path === `Mail/${mailId}.md`);
  if (!n || n.kind !== "update") throw new Error(`kein update fuer ${mailId}`);
  return n.content ?? "";
};
const root = (extra: Partial<N> = {}) => note({ id: "a@x", fm: ["projekt: Alpha"], parsed: { projekt: "Alpha" }, ...extra });
const reply = (id: string, extra: Partial<N> = {}) => note({ id, date: "2026-08-02", inReplyTo: ["a@x"], ...extra });

describe("mail.alignThreadFields", () => {
  it("ist ein eingebauter Befehl und braucht alle Notizen samt aufgeloester Verweise", () => {
    expect(cmd.id).toBe("mail.alignThreadFields");
    expect(cmd.needs).toEqual({ allNotes: true, threads: true });
    expect(MAIL_COMMANDS).toContain(cmd);
    expect(cmd.titleKey).toBe("cmd.mail.alignThreadFields.title");
  });

  it("gilt fuer jede Mail-Notiz", () => {
    expect(cmd.appliesTo({ profile, target: { mailId: "a@x", path: "p", source: "s", state: null }, frontmatter: {} })).toBe(true);
    expect(cmd.appliesTo({ profile, target: { mailId: "", path: "p", source: "", state: null }, frontmatter: {} })).toBe(false);
  });

  it("ohne gueltige inheritFields: nothing-to-do mit Hinweis auf die Einstellung", () => {
    for (const inheritFields of [[], ["mail_id"], ["prüfung"], [""]]) {
      expect(cmd.plan({}, ctx([root(), reply("b@x")], "b@x", { ...profile, inheritFields })), JSON.stringify(inheritFields))
        .toEqual({ ok: false, code: "nothing-to-do", hintKey: "error.command.inherit-fields-off" });
    }
  });

  it("setzt den Wert der Wurzel in alle Notizen des Vorgangs, nicht in die Wurzel und nicht in andere Vorgaenge", () => {
    const notes = [root(), reply("b@x", { fm: ["projekt: Beta"], parsed: { projekt: "Beta" } }), reply("c@x"), note({ id: "z@x", fm: ["projekt: Zeta"], parsed: { projekt: "Zeta" } })];
    const plan = ok(cmd.plan({}, ctx(notes, "c@x")));
    expect(plan.notes.map((n) => n.path).sort()).toEqual(["Mail/b@x.md", "Mail/c@x.md"]);
    expect(contentOf(plan, "b@x")).toContain("\nprojekt: Alpha\n");
    expect(contentOf(plan, "b@x")).not.toContain("Beta");
  });

  it("legt ein Feld an, das in der Notiz FEHLTE (E1)", () => {
    const plan = ok(cmd.plan({}, ctx([root(), reply("b@x")], "b@x")));
    const c = contentOf(plan, "b@x");
    expect(c).toContain("\nprojekt: Alpha\n");
    expect(c).toContain("mail_id: b@x");
  });

  it("laesst eine Liste von Wikilinks eine Liste von Wikilinks bleiben", () => {
    const liste = ["[[A]]", "[[B]]"];
    const plan = ok(cmd.plan({}, ctx([root({ fm: ['projekt: ["[[A]]", "[[B]]"]'], parsed: { projekt: liste } }), reply("b@x", { fm: ["projekt: Alt"], parsed: { projekt: "Alt" } })], "b@x")));
    expect(contentOf(plan, "b@x")).toContain('\nprojekt: ["[[A]]", "[[B]]"]\n');
  });

  it("schreibt einen Wahrheitswert als Literal ohne Anfuehrungszeichen (E2), eine Zahl als Zahl", () => {
    const p = { ...profile, inheritFields: ["privat", "prio"] };
    const plan = ok(cmd.plan({}, ctx([root({ fm: ["privat: true", "prio: 2"], parsed: { privat: true, prio: 2 } }), reply("b@x", { fm: ['privat: "false"'], parsed: { privat: "false" } })], "b@x", p)));
    const c = contentOf(plan, "b@x");
    expect(c).toContain("\nprivat: true\n");
    expect(c).not.toContain('"true"');
    expect(c).toContain("\nprio: 2\n");
  });

  it("der Vergleich ist typgenau (Kit valueEquals, typed): gleiche Werte bleiben unberuehrt, ein Text \"true\" oder \"2\" gilt nicht als Wahrheitswert oder Zahl", () => {
    const p = { ...profile, inheritFields: ["privat", "prio", "projekt"] };
    const typed = { privat: true, prio: 2, projekt: ["[[A]]"] };
    const fm = ["privat: true", "prio: 2", 'projekt: ["[[A]]"]'];
    const gleich = ok(cmd.plan({}, ctx([
      root({ fm, parsed: typed }),
      reply("b@x", { fm, parsed: typed }),
      reply("c@x", { fm: ["privat: x"], parsed: { privat: "true", prio: "2", projekt: "[[A]]" } }),
    ], "b@x", p)));
    expect(gleich.notes.map((n) => n.path)).toEqual(["Mail/c@x.md"]);
    const c = contentOf(gleich, "c@x");
    expect(c).toContain("\nprivat: true\n");
    expect(c).toContain("\nprio: 2\n");
    expect(c).toContain('\nprojekt: ["[[A]]"]\n');
  });

  it("ein fehlender Wurzelwert loescht nichts: nur Felder, die die Wurzel hat, werden gesetzt", () => {
    const p = { ...profile, inheritFields: ["projekt", "kunde"] };
    const plan = ok(cmd.plan({}, ctx([root(), reply("b@x", { fm: ["kunde: Acme"], parsed: { kunde: "Acme" } })], "b@x", p)));
    const c = contentOf(plan, "b@x");
    expect(c).toContain("kunde: Acme");
    expect(c).toContain("projekt: Alpha");
  });

  it("hat die Wurzel gar keinen Wert, gibt es nichts zu tun", () => {
    expect(cmd.plan({}, ctx([note({ id: "a@x" }), reply("b@x", { fm: ["projekt: Beta"], parsed: { projekt: "Beta" } })], "b@x"))).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("ein verschachtelter Wurzelwert wird uebersprungen", () => {
    expect(cmd.plan({}, ctx([root({ parsed: { projekt: { tief: 1 } } }), reply("b@x")], "b@x"))).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("sind alle Werte schon gleich, gibt es nichts zu tun", () => {
    const gleich = reply("b@x", { fm: ["projekt: Alpha"], parsed: { projekt: "Alpha" } });
    expect(cmd.plan({}, ctx([root(), gleich], "b@x"))).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("eine Notiz mit dem gleichen Wert wird nicht angefasst, die abweichende schon", () => {
    const notes = [root(), reply("b@x", { fm: ["projekt: Alpha"], parsed: { projekt: "Alpha" } }), reply("c@x", { fm: ["projekt: Beta"], parsed: { projekt: "Beta" } })];
    expect(ok(cmd.plan({}, ctx(notes, "c@x"))).notes.map((n) => n.path)).toEqual(["Mail/c@x.md"]);
  });

  it("die Zone, ihr gespeicherter Hash und der gelesene Inhalt bleiben stehen", () => {
    const plan = ok(cmd.plan({}, ctx([root(), reply("b@x")], "b@x")));
    const n = plan.notes[0]!;
    expect(n.kind).toBe("update");
    if (n.kind !== "update") return;
    expect(n.content).toContain(ZONE);
    expect(n.zoneHash).toBe("h");
    expect(n.expectedContent).toBe(reply("b@x").content);
    expect(n.mailId).toBe("b@x");
  });

  it("eine Notiz ohne Zone wird mit Grund uebersprungen, die uebrigen werden geschrieben", () => {
    const plan = ok(cmd.plan({}, ctx([root(), reply("b@x", { zone: false }), reply("c@x")], "c@x")));
    expect(plan.notes.find((n) => n.path === "Mail/b@x.md")).toMatchObject({ kind: "skip", reason: "fences-missing" });
    expect(plan.notes.find((n) => n.path === "Mail/c@x.md")?.kind).toBe("update");
  });

  it("sind nur Notizen ohne Zone betroffen, gibt es nichts zu schreiben", () => {
    expect(cmd.plan({}, ctx([root(), reply("b@x", { zone: false })], "b@x"))).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("die Vorschau nennt Zahl und Felder", () => {
    const p = { ...profile, inheritFields: ["projekt", "kunde", "ungenutzt"] };
    const notes = [root({ fm: ["projekt: Alpha", "kunde: Acme"], parsed: { projekt: "Alpha", kunde: "Acme" } }), reply("b@x"), reply("c@x", { fm: ["projekt: Beta"], parsed: { projekt: "Beta" } })];
    const plan = ok(cmd.plan({}, ctx(notes, "b@x", p)));
    expect(plan.commandId).toBe("mail.alignThreadFields");
    expect(plan.summaryKey).toBe("plan.mail.alignThreadFields.summary");
    expect(plan.summaryArgs).toEqual([2, "projekt, kunde"]);
    expect(plan.diff).toContainEqual({ field: "Mail/c@x.md: projekt", before: "Beta", after: "Alpha" });
    expect(plan.diff).toContainEqual({ field: "Mail/b@x.md: kunde", after: "Acme" });
  });

  it("begrenzt die Vorschau auf zwanzig Zeilen", () => {
    const viele = Array.from({ length: 30 }, (_, i) => reply(`m${String(i)}@x`));
    expect(ok(cmd.plan({}, ctx([root(), ...viele], "m3@x"))).diff).toHaveLength(20);
  });

  it("lehnt ungueltige Eingaben ab", () => {
    expect(cmd.plan({ x: 1 }, ctx([root(), reply("b@x")], "b@x"))).toMatchObject({ ok: false, code: "invalid-input" });
  });

  it("die Wurzel des Vorgangs der AKTIVEN Notiz zaehlt, auch wenn diese mittendrin steht", () => {
    const notes = [root(), reply("b@x", { fm: ["projekt: B"], parsed: { projekt: "B" } }), note({ id: "c@x", date: "2026-08-03", inReplyTo: ["b@x"], fm: ["projekt: C"], parsed: { projekt: "C" } })];
    const plan = ok(cmd.plan({}, ctx(notes, "b@x")));
    expect(plan.notes.map((n) => n.path).sort()).toEqual(["Mail/b@x.md", "Mail/c@x.md"]);
    expect(contentOf(plan, "c@x")).toContain("\nprojekt: Alpha\n");
  });
});
