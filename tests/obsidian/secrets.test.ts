// Testmuster uebernommen aus calendar-notes/tests/obsidian/secrets.test.ts, 2026-09-16 (Kit-Vendoring)
import { describe, it, expect } from "vitest";
import { obsidianSecretStore } from "../../src/vendor/kit-obsidian/secrets";
import { MemorySecretStore } from "../../src/vendor/kit/secrets";
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

  it("entfernt ein Secret vollstaendig (delete)", () => {
    const s = new MemorySecretStore();
    s.set("a", "geheim");
    s.delete("a");
    expect(s.has("a")).toBe(false);
    expect(s.get("a")).toBeNull();
  });

  it("entfernt einen abschliessenden Zeilenumbruch aus einem eingefuegten Passwort (pbcopy < datei)", () => {
    const s = new MemorySecretStore();
    s.set("a", "geheim\n");
    expect(s.get("a")).toBe("geheim");
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

  it("ein leeres Secret gilt als fehlend (has() ist false, get() ist null)", () => {
    // Kit-Fassung (0.37.1) normalisiert einen leeren Wert bei get() zusaetzlich auf null
    // (vorher: der rohe Leerstring) — Verhaltensaenderung durch das Vendoring: sync/send
    // haetten mit dem rohen Leerstring vorher einen Login mit leerem Passwort versucht statt
    // "no-secret" zu melden (beide Callsites pruefen nur strikt auf null).
    const app = fakeApp();
    const s = obsidianSecretStore(app);
    s.set("id1", "");
    expect(s.has("id1")).toBe(false);
    expect(s.get("id1")).toBeNull();
  });

  it("delete() loescht ueber den Leerstring (Obsidian kennt kein echtes delete)", () => {
    const app = fakeApp();
    const s = obsidianSecretStore(app);
    s.set("id1", "geheim");
    s.delete("id1");
    expect(s.has("id1")).toBe(false);
    expect(s.get("id1")).toBeNull();
  });
});
