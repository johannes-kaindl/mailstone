import { describe, it, expect } from "vitest";
import { vaultPlanExecutor, findMailNotes } from "../../src/obsidian/vault-notes";
import { makeApp } from "../helpers/memory-vault";

describe("vaultPlanExecutor", () => {
  it("create legt .md und .eml an und merkt den Zone-Hash", async () => {
    const app = makeApp();
    const hashes = new Map<string, string>();
    const ex = vaultPlanExecutor(app, { get: (k) => hashes.get(k) ?? null, set: (k, v) => { hashes.set(k, v); } });
    const r = await ex.execute([{ kind: "create", path: "Mail/2026/x.md", emlPath: "Mail/2026/_eml/x.eml", content: "---\nmail_id: a@x\n---\nbody", eml: new Uint8Array([1, 2]), mailId: "a@x", zoneHash: "h1" }]);
    expect(r.created).toBe(1);
    expect(await app.vault.adapter.exists("Mail/2026/x.md")).toBe(true);
    expect(await app.vault.adapter.exists("Mail/2026/_eml/x.eml")).toBe(true);
    expect(hashes.get("a@x")).toBe("h1");
  });
  it("setState aendert nur mail_state", async () => {
    const app = makeApp();
    await app.vault.create("Mail/y.md", "---\nmail_id: b@x\nmail_state: live\nup: \"[[P]]\"\n---\ntext");
    const ex = vaultPlanExecutor(app, { get: () => null, set: () => {} });
    await ex.execute([{ kind: "setState", path: "Mail/y.md", mailId: "b@x", state: "detached" }]);
    const c = await app.vault.adapter.read("Mail/y.md");
    expect(c).toContain("mail_state: detached");
    expect(c).toContain('up: "[[P]]"');
  });
  it("findMailNotes indiziert ueber metadataCache", async () => {
    const app = makeApp();
    await app.vault.create("Mail/z.md", "---\nmail_id: c@x\n---\n");
    const idx = findMailNotes(app, "mail_id");
    expect(idx.get("c@x")?.path).toBe("Mail/z.md");
  });
});
