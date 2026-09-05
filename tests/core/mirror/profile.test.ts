import { describe, it, expect } from "vitest";
import { defaultMailProfile, identityKeys, managedKeys, fmKeyFor, withTaskPreset } from "../../../src/core/mirror/profile";
describe("MailProfile", () => {
  it("Default-Profil hat Identitaetsfelder und Mapping", () => {
    const p = defaultMailProfile();
    expect(identityKeys(p)).toEqual(["mail_id", "mail_source", "mail_state", "mail_synced"]);
    expect(fmKeyFor(p, "from")).toBe("from");
    expect(managedKeys(p)).toContain("subject");
    expect(managedKeys(p)).not.toContain("type"); // onCreate ist nicht managed
  });
  it("null-Mapping schaltet ein Feld ab", () => {
    const p = { ...defaultMailProfile(), fields: { ...defaultMailProfile().fields, cc: null } };
    expect(fmKeyFor(p, "cc")).toBeNull();
    expect(managedKeys(p)).not.toContain("cc");
  });
});

describe("withTaskPreset", () => {
  it("leeres Preset laesst das Profil unveraendert (identisches Objekt)", () => {
    const p = defaultMailProfile();
    expect(withTaskPreset(p, {})).toBe(p);
  });
  it("mischt das Preset additiv in onCreate", () => {
    const p = withTaskPreset(defaultMailProfile(), { status: "open" });
    expect(p.onCreate).toEqual({ type: "mail", status: "open" });
  });
  it("Profil-onCreate gewinnt bei einer Schluessel-Kollision gegen das Preset", () => {
    const p = withTaskPreset(defaultMailProfile(), { type: "task" });
    expect(p.onCreate.type).toBe("mail");
  });
});
