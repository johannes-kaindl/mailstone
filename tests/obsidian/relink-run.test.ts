import { describe, it, expect } from "vitest";
import { vaultRelinkDeps } from "../../src/obsidian/relink-run";
import { vaultPlanExecutor } from "../../src/obsidian/vault-notes";
import { planRunRelinks } from "../../src/core/mirror/relink-run";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { makeApp } from "../helpers/memory-vault";

const ZONE = "%% mailstone:begin %%\n## Nachricht\nHallo\n%% mailstone:end %%\n";
const profile = defaultMailProfile();

describe("vaultRelinkDeps + vaultPlanExecutor", () => {
  it("verlinkt die aeltere Notiz, laesst die Zone Byte fuer Byte und behaelt den gespeicherten Hash", async () => {
    const app = makeApp();
    const alt = `---\nmail_id: alt@x\nin_reply_to: neu@x\nsubject: Hallo\n---\n\n## Notizen\n\nmeine Notiz\n\n${ZONE}`;
    await app.vault.create("Mail/2026/alt.md", alt);
    await app.vault.create("Mail/2026/unbeteiligt.md", `---\nmail_id: u@x\nin_reply_to: weg@x\n---\n\n${ZONE}`);
    const hashes = new Map([["alt@x", "gespeichert"]]);
    const store = { get: (k: string) => hashes.get(k) ?? null, set: (k: string, v: string) => { hashes.set(k, v); } };
    const planned = await planRunRelinks(profile, new Map([["neu@x", "Mail/2026/neu"]]), vaultRelinkDeps(app, () => profile, store));
    expect(planned.plans).toHaveLength(1);
    const r = await vaultPlanExecutor(app, store).execute(planned.plans);
    expect(r.updated).toBe(1);
    const nachher = await app.vault.adapter.read("Mail/2026/alt.md");
    expect(nachher).toContain('in_reply_to: "[[Mail/2026/neu]]"');
    expect(nachher.slice(nachher.indexOf("## Notizen"))).toBe(alt.slice(alt.indexOf("## Notizen")));
    expect(hashes.get("alt@x")).toBe("gespeichert");
  });

  it("schreibt nicht, wenn die Datei sich zwischen Lesen und Schreiben geaendert hat", async () => {
    const app = makeApp();
    await app.vault.create("Mail/2026/alt.md", `---\nmail_id: alt@x\nin_reply_to: neu@x\n---\n\n${ZONE}`);
    const store = { get: () => "h", set: () => {} };
    const planned = await planRunRelinks(profile, new Map([["neu@x", "Mail/2026/neu"]]), vaultRelinkDeps(app, () => profile, store));
    const f = app.vault.getAbstractFileByPath("Mail/2026/alt.md");
    await app.vault.modify(f, `---\nmail_id: alt@x\nin_reply_to: neu@x\n---\n\nzwischendurch geaendert\n${ZONE}`);
    const r = await vaultPlanExecutor(app, store).execute(planned.plans);
    expect(r.updated).toBe(0);
    expect(r.skipped).toEqual([expect.objectContaining({ kind: "skip", reason: "content-changed" })]);
    expect(await app.vault.adapter.read("Mail/2026/alt.md")).toContain("zwischendurch geaendert");
  });
});
