// uebernommen (Testmuster) aus calendar-notes/tests/obsidian/secrets.test.ts, 2026-08-23
import { describe, it, expect } from "vitest";
import { obsidianSecretStore, MemorySecretStore } from "../../src/obsidian/secrets";
import type { App } from "obsidian";

function fakeApp(opts?: { setSecret?: (id: string, v: string) => void }): App {
  const store = new Map<string, string>();
  return {
    secretStorage: {
      getSecret: (id: string) => store.get(id) ?? null,
      setSecret: (id: string, v: string) => {
        if (opts?.setSecret) opts.setSecret(id, v);
        else store.set(id, v);
      },
      listSecrets: () => [...store.keys()],
    },
  } as unknown as App;
}

describe("MemorySecretStore", () => {
  it("set/get/has roundtrip", () => {
    const s = new MemorySecretStore();
    expect(s.has("a")).toBe(false);
    expect(s.get("a")).toBeNull();
    s.set("a", "geheim");
    expect(s.has("a")).toBe(true);
    expect(s.get("a")).toBe("geheim");
  });

  it("ein leeres Secret gilt als fehlend (has() ist false)", () => {
    const s = new MemorySecretStore();
    s.set("a", "");
    expect(s.has("a")).toBe(false);
    expect(s.get("a")).toBe("");
  });
});

describe("obsidianSecretStore", () => {
  it("get/set/has laufen ueber app.secretStorage", () => {
    const app = fakeApp();
    const s = obsidianSecretStore(app);
    expect(s.has("id1")).toBe(false);
    s.set("id1", "geheim");
    expect(s.has("id1")).toBe(true);
    expect(s.get("id1")).toBe("geheim");
  });

  it("set() wirft, wenn das Rueck-Lesen den Wert nicht bestaetigt (TaskNotes-Kniff)", () => {
    const app = fakeApp({ setSecret: () => {} }); // schluckt den Wert stillschweigend
    const s = obsidianSecretStore(app);
    expect(() => s.set("id1", "geheim")).toThrow("Obsidian SecretStorage did not persist id1");
  });

  it("ein leeres Secret gilt als fehlend (has() ist false)", () => {
    const app = fakeApp();
    const s = obsidianSecretStore(app);
    s.set("id1", "");
    expect(s.has("id1")).toBe(false);
    expect(s.get("id1")).toBe("");
  });
});
