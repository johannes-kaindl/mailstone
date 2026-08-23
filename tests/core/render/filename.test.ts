import { describe, it, expect } from "vitest";
import { subjectSlug, mailFilename, mailFolder, emlFolder } from "../../../src/core/render/filename";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import { parseEml } from "../../../src/core/mime/parse";
import { loadFixture } from "../../helpers/fixtures";

describe("subjectSlug", () => {
  it("transliteriert, entfernt Re:/AW:/Fwd:/WG:, kuerzt auf 60", () => {
    expect(subjectSlug("Re: AW: Größe/Maß: Übersicht")).toBe("groesse-mass-uebersicht");
    expect(subjectSlug("x".repeat(100)).length).toBe(60);
    expect(subjectSlug("  ")).toBe("");
  });
});
describe("mailFilename/Folder", () => {
  it("Default-Template {date}-{time}-{slug}", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    const p = defaultMailProfile();
    expect(mailFilename(p, m)).toBe("2026-08-19-1432-hallo-welt");
    expect(mailFolder(p, m)).toBe("Mail/2026");
    expect(emlFolder(p, m)).toBe("Mail/2026/_eml");
  });
  it("leerer Betreff → Fallback 'mail'", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    expect(mailFilename(defaultMailProfile(), { ...m, subject: "" })).toBe("2026-08-19-1432-mail");
  });
  it("ohne Datum: Jahr-Unterordner entfaellt, Datum = 'undated'", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    expect(mailFolder(defaultMailProfile(), { ...m, date: null })).toBe("Mail");
    expect(mailFilename(defaultMailProfile(), { ...m, date: null })).toBe("undated-hallo-welt");
  });
});
