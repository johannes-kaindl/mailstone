import { describe, it, expect } from "vitest";
import { emlPathFor, verifyEml } from "../../../src/core/commands/eml";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { ParsedMail } from "../../../src/core/mime/types";

const profile = defaultMailProfile();
const mail = { id: "a@x" } as ParsedMail;

describe("emlPathFor", () => {
  it("legt die .eml in den _eml-Unterordner NEBEN der Notiz", () => {
    expect(emlPathFor(profile, "Mail/2026/2026-08-30-1432-test.md")).toBe("Mail/2026/_eml/2026-08-30-1432-test.eml");
  });

  it("kommt ohne Jahres-Unterordner aus (yearSubfolder: false)", () => {
    expect(emlPathFor(profile, "Mail/test.md")).toBe("Mail/_eml/test.eml");
  });

  it("respektiert einen abweichenden emlSubfolder aus dem Profil", () => {
    expect(emlPathFor({ ...profile, emlSubfolder: "roh" }, "Mail/2026/t.md")).toBe("Mail/2026/roh/t.eml");
  });

  it("kommt mit einer Notiz im Vault-Wurzelverzeichnis zurecht", () => {
    expect(emlPathFor(profile, "t.md")).toBe("_eml/t.eml");
  });
});

describe("verifyEml", () => {
  it("nimmt eine .eml mit passender Message-ID an", () => {
    expect(verifyEml(mail, "a@x")).toEqual({ ok: true });
  });

  it("weist eine .eml ab, die zu einer anderen Mail gehoert", () => {
    expect(verifyEml(mail, "b@x")).toEqual({ ok: false, code: "eml-mismatch" });
  });
});
