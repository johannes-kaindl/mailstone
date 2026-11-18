import { describe, it, expect } from "vitest";
import { followContext } from "../../src/obsidian/follow-context";
import { buildContext } from "../../src/obsidian/command-flow";
import { vaultPlanExecutor } from "../../src/obsidian/vault-notes";
import { STOP_FOLLOWING_COMMAND, RESUME_FOLLOWING_COMMAND } from "../../src/core/commands/follow-commands";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { makeApp } from "../helpers/memory-vault";

const profile = defaultMailProfile();
const ZONE = "%% mailstone:begin %%\n## Nachricht\nHallo\n%% mailstone:end %%\n";
const mailNote = (id: string, extra: string[] = [], date = "2026-08-01"): string =>
  `---\nmail_id: ${id}\ndate: ${date}\ntime: "10:00"\nsubject: Betreff ${id}\n${extra.join("\n")}${extra.length ? "\n" : ""}---\n\n${ZONE}`;

function withLinks(app: any): void {
  app.metadataCache.getFirstLinkpathDest = (linktext: string) =>
    app.vault.getMarkdownFiles().find((f: { path: string }) => f.path === `${linktext}.md` || f.path.endsWith(`/${linktext}.md`)) ?? null;
}

async function vaultMit(...notes: [string, string][]): Promise<any> {
  const app = makeApp(); withLinks(app);
  for (const [path, content] of notes) await app.vault.create(path, content);
  return app;
}

describe("followContext", () => {
  it("kennt jede Mail-Notiz als Vorgangsmitglied und fuehrt Notizen ohne mail_id nicht", async () => {
    const app = await vaultMit(
      ["Mail/a.md", mailNote("a@x")],
      ["Mail/b.md", mailNote("b@x", ['in_reply_to: "[[a]]"'], "2026-08-02")],
      ["Notizen/x.md", "---\ntitle: x\n---\n"],
    );
    const c = followContext(app, profile);
    expect([...c.index.rootOf]).toEqual([["a@x", "a@x"], ["b@x", "a@x"]]);
    expect([...c.stopped]).toEqual([]);
  });

  it("nimmt die Wurzel in stopped, wenn dort false steht (Wahrheitswert oder Text); eine Antwort mit false beendet nichts", async () => {
    const app = await vaultMit(
      ["Mail/a.md", mailNote("a@x", ["mail_follow: false"])],
      ["Mail/b.md", mailNote("b@x", ['in_reply_to: "[[a]]"', "mail_follow: false"], "2026-08-02")],
      ["Mail/c.md", mailNote("c@x", ['mail_follow: "false"'])],
      ["Mail/d.md", mailNote("d@x", ["mail_follow: true"])],
    );
    expect([...followContext(app, profile).stopped].sort()).toEqual(["a@x", "c@x"]);
  });

  it("ohne wirksames Feld ist nichts beendet", async () => {
    const app = await vaultMit(["Mail/a.md", mailNote("a@x", ["mail_follow: false"])]);
    expect([...followContext(app, { ...profile, followField: "" }).stopped]).toEqual([]);
  });

  it("liefert den Pfad der Wurzel-Notiz zur Mail-ID, fuer den Link im Dialog", async () => {
    const app = await vaultMit(["Mail/2026/a.md", mailNote("a@x")]);
    const c = followContext(app, profile);
    expect(c.pathOf("a@x")).toBe("Mail/2026/a.md");
    expect(c.pathOf("nope@x")).toBeNull();
  });
});

describe("mail.stopFollowing / resumeFollowing gegen einen Vault", () => {
  it("setzt false an der Wurzel (Schluessel fehlte), danach liest followContext sie als beendet, und die Wiederaufnahme macht es rueckgaengig", async () => {
    const app = await vaultMit(
      ["Mail/a.md", mailNote("a@x")],
      ["Mail/b.md", mailNote("b@x", ['in_reply_to: "[[a]]"'], "2026-08-02")],
    );
    const store = { get: () => "h", set: () => {} };
    const flow = { app, profile: () => profile, hashes: store, now: () => new Date(0) };

    const built = await buildContext(flow, STOP_FOLLOWING_COMMAND, app.vault.getAbstractFileByPath("Mail/b.md"));
    if (!built.ok) throw new Error(built.code);
    const planned = STOP_FOLLOWING_COMMAND.plan({}, built.ctx);
    if (!planned.ok) throw new Error(planned.code);
    const r = await vaultPlanExecutor(app, store).execute(planned.plan.notes);
    expect(r.updated).toBe(1);
    const a = await app.vault.adapter.read("Mail/a.md");
    expect(a).toContain("\nmail_follow: false\n");
    expect(a.endsWith(ZONE)).toBe(true);
    expect(await app.vault.adapter.read("Mail/b.md")).toBe(mailNote("b@x", ['in_reply_to: "[[a]]"'], "2026-08-02"));
    expect([...followContext(app, profile).stopped]).toEqual(["a@x"]);

    const built2 = await buildContext(flow, RESUME_FOLLOWING_COMMAND, app.vault.getAbstractFileByPath("Mail/b.md"));
    if (!built2.ok) throw new Error(built2.code);
    const planned2 = RESUME_FOLLOWING_COMMAND.plan({}, built2.ctx);
    if (!planned2.ok) throw new Error(planned2.code);
    await vaultPlanExecutor(app, store).execute(planned2.plan.notes);
    expect(await app.vault.adapter.read("Mail/a.md")).toBe(mailNote("a@x"));
    expect([...followContext(app, profile).stopped]).toEqual([]);
  });
});
