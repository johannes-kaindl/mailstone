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
    expect(r.errors).toEqual([]);
    expect(await app.vault.adapter.exists("Mail/2026/x.md")).toBe(true);
    expect(await app.vault.adapter.exists("Mail/2026/_eml/x.eml")).toBe(true);
    expect(hashes.get("a@x")).toBe("h1");
  });
  it("setState schreibt in das Profil-Feld (stateField), nicht in ein fest verdrahtetes", async () => {
    const app = makeApp();
    await app.vault.create("Mail/y.md", "---\nmail_id: b@x\nzustand: live\nup: \"[[P]]\"\n---\ntext");
    const ex = vaultPlanExecutor(app, { get: () => null, set: () => {} });
    const r = await ex.execute([{ kind: "setState", path: "Mail/y.md", mailId: "b@x", state: "detached", stateField: "zustand" }]);
    expect(r.stateChanged).toBe(1);
    const c = await app.vault.adapter.read("Mail/y.md");
    expect(c).toContain("zustand: detached");
    expect(c).toContain('up: "[[P]]"');
  });
  it("Fehler bei einem Plan stoppt die anderen nicht und landet in errors", async () => {
    const app = makeApp();
    const echt = app.vault.create;
    app.vault.create = async (path: string, content: string) => {
      if (path === "Mail/kaputt.md") throw new Error("Schreibfehler");
      return echt(path, content);
    };
    const ex = vaultPlanExecutor(app, { get: () => null, set: () => {} });
    const r = await ex.execute([
      { kind: "create", path: "Mail/kaputt.md", emlPath: "Mail/_eml/kaputt.eml", content: "x", eml: new Uint8Array([1]), mailId: "k@x", zoneHash: "h" },
      { kind: "create", path: "Mail/gut.md", emlPath: "Mail/_eml/gut.eml", content: "y", eml: new Uint8Array([2]), mailId: "g@x", zoneHash: "h2" },
    ]);
    expect(r.created).toBe(1);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]?.message).toContain("Schreibfehler");
    expect(r.errors[0]?.plan.path).toBe("Mail/kaputt.md");
    expect(await app.vault.adapter.exists("Mail/gut.md")).toBe(true);
  });
  it("nicht auffindbares Ziel → skip mit reason missing-target", async () => {
    const app = makeApp();
    const ex = vaultPlanExecutor(app, { get: () => null, set: () => {} });
    const r = await ex.execute([
      { kind: "setState", path: "Mail/fehlt.md", mailId: "b@x", state: "detached", stateField: "mail_state" },
      { kind: "update", path: "Mail/fehlt-auch.md", content: "x", mailId: "c@x", zoneHash: "h" },
    ]);
    expect(r.stateChanged).toBe(0);
    expect(r.updated).toBe(0);
    expect(r.skipped.length).toBe(2);
    expect(r.skipped[0]?.kind === "skip" && r.skipped[0].reason).toBe("missing-target");
    expect(r.skipped[1]?.kind === "skip" && r.skipped[1].reason).toBe("missing-target");
  });
  it("findMailNotes indiziert ueber metadataCache", async () => {
    const app = makeApp();
    await app.vault.create("Mail/z.md", "---\nmail_id: c@x\n---\n");
    const idx = findMailNotes(app, "mail_id");
    expect(idx.get("c@x")?.path).toBe("Mail/z.md");
  });
});
