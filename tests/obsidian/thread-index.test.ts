import { describe, it, expect } from "vitest";
import { mailIdOfValue, threadNotes, threadRefsFor } from "../../src/obsidian/thread-index";
import { buildContext } from "../../src/obsidian/command-flow";
import { vaultPlanExecutor } from "../../src/obsidian/vault-notes";
import { RECOMPUTE_THREADS_COMMAND } from "../../src/core/commands/recompute-threads";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { makeApp } from "../helpers/memory-vault";

const profile = { ...defaultMailProfile(), threadField: "vorgang" };
const ZONE = "%% mailstone:begin %%\n## Nachricht\nHallo\n%% mailstone:end %%\n";
const mailNote = (id: string, extra: string[] = [], date = "2026-08-01"): string =>
  `---\nmail_id: ${id}\ndate: ${date}\ntime: "10:00"\nsubject: Betreff ${id}\n${extra.join("\n")}${extra.length ? "\n" : ""}---\n\n${ZONE}`;

/** Obsidians Linkaufloesung nachgebildet: Dateiname (ohne Ordner und .md) oder voller Pfad. */
function withLinks(app: any): void {
  app.metadataCache.getFirstLinkpathDest = (linktext: string) => {
    const hit = app.vault.getMarkdownFiles().find((f: { path: string }) => f.path === `${linktext}.md` || f.path.endsWith(`/${linktext}.md`));
    return hit ?? null;
  };
}

describe("mailIdOfValue (E6)", () => {
  it("loest einen kurzen Link, einen Link mit Alias und einen Link mit Ueberschrift zur mail_id der Zieldatei auf", async () => {
    const app = makeApp(); withLinks(app);
    await app.vault.create("Mail/2026/umbenannt-neu.md", mailNote("a@x"));
    for (const v of ["[[umbenannt-neu]]", "[[Mail/2026/umbenannt-neu|Alias]]", "[[umbenannt-neu#Nachricht]]"]) {
      expect(mailIdOfValue(app, profile, "Mail/2026/b.md", v), v).toBe("a@x");
    }
  });
  it("liefert null fuer einen Link ins Leere, normalisiert eine rohe ID und laesst Leeres leer", () => {
    const app = makeApp(); withLinks(app);
    expect(mailIdOfValue(app, profile, "x.md", "[[gibt-es-nicht]]")).toBeNull();
    expect(mailIdOfValue(app, profile, "x.md", "<roh@x>")).toBe("roh@x");
    expect(mailIdOfValue(app, profile, "x.md", "  ")).toBeNull();
  });
});

describe("threadRefsFor / threadNotes", () => {
  it("loest Verweise und Vorgangswert auf, Wikilinks ins Leere fallen weg", async () => {
    const app = makeApp(); withLinks(app);
    await app.vault.create("Mail/2026/a.md", mailNote("a@x"));
    const fm = { in_reply_to: "[[a]]", references: ["[[a]]", "roh@x", "[[weg]]"], vorgang: "[[a]]" };
    expect(threadRefsFor(app, profile, "Mail/2026/b.md", fm)).toEqual({ inReplyTo: ["a@x"], references: ["a@x", "roh@x"], valueId: "a@x" });
  });
  it("threadNotes liefert Pfad ohne .md und den Vorgangswert", async () => {
    const app = makeApp();
    await app.vault.create("Mail/2026/a.md", mailNote("a@x", ['vorgang: "[[Mail/2026/a]]"']));
    await app.vault.create("Notizen/keine-mail.md", "---\ntitle: x\n---\n");
    expect(threadNotes(app, profile)).toEqual([{ mailId: "a@x", path: "Mail/2026/a", value: "[[Mail/2026/a]]" }]);
  });
});

describe("mail.recomputeThreads gegen einen Vault", () => {
  it("traegt das Feld nach, laesst einen kurzen Link auf die richtige Wurzel stehen und schreibt nur Frontmatter", async () => {
    const app = makeApp(); withLinks(app);
    await app.vault.create("Mail/2026/a.md", mailNote("a@x", ['vorgang: "[[Mail/2026/a]]"']));
    await app.vault.create("Mail/2026/b.md", mailNote("b@x", ['in_reply_to: "[[a]]"', "vorgang: \"[[a]]\""], "2026-08-02"));
    await app.vault.create("Mail/2026/c.md", mailNote("c@x", ['in_reply_to: "[[b]]"'], "2026-08-03"));
    const store = { get: () => "h", set: () => {} };
    const built = await buildContext({ app, profile: () => profile, hashes: store, now: () => new Date(0) }, RECOMPUTE_THREADS_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/c.md"));
    if (!built.ok) throw new Error(built.code);
    const planned = RECOMPUTE_THREADS_COMMAND.plan({}, built.ctx);
    if (!planned.ok) throw new Error(planned.code);
    expect(planned.plan.notes.map((n) => n.path)).toEqual(["Mail/2026/c.md"]);
    const r = await vaultPlanExecutor(app, store).execute(planned.plan.notes);
    expect(r.updated).toBe(1);
    const c = await app.vault.adapter.read("Mail/2026/c.md");
    expect(c).toContain('vorgang: "[[Mail/2026/a]]"');
    expect(c.endsWith(ZONE)).toBe(true);
    expect(await app.vault.adapter.read("Mail/2026/b.md")).toContain('vorgang: "[[a]]"');
  });

  it("nach einer Umbenennung der Wurzel zeigt der alte Link noch auf sie: nichts zu tun", async () => {
    const app = makeApp(); withLinks(app);
    await app.vault.create("Mail/2026/neuer-name.md", mailNote("a@x", ['vorgang: "[[neuer-name]]"']));
    await app.vault.create("Mail/2026/b.md", mailNote("b@x", ['in_reply_to: "[[neuer-name]]"', 'vorgang: "[[neuer-name]]"'], "2026-08-02"));
    const built = await buildContext({ app, profile: () => profile, hashes: { get: () => "h", set: () => {} }, now: () => new Date(0) }, RECOMPUTE_THREADS_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/b.md"));
    if (!built.ok) throw new Error(built.code);
    expect(RECOMPUTE_THREADS_COMMAND.plan({}, built.ctx)).toEqual({ ok: false, code: "nothing-to-do" });
  });
});
