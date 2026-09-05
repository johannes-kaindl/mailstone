import { describe, it, expect } from "vitest";
import { buildDerivedFrontmatter, localDateParts } from "../../../src/core/render/frontmatter";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import { parseEml } from "../../../src/core/mime/parse";
import { loadFixture } from "../../helpers/fixtures";

describe("localDateParts (TZ=Europe/Berlin)", () => {
  it("rechnet UTC in Lokalzeit", () => {
    expect(localDateParts(new Date("2026-08-19T22:30:00.000Z"))).toEqual({ date: "2026-08-20", time: "00:30" });
  });
});
describe("buildDerivedFrontmatter", () => {
  it("utf8-plain: alle Felder nach Default-Profil", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    const fm = buildDerivedFrontmatter(defaultMailProfile(), { mail: m, source: "privat/Vault", state: "live", syncedAt: new Date("2026-08-23T13:00:00.000Z") });
    expect(fm).toEqual({
      mail_id: "utf8-plain-001@mail.example.org", mail_source: "privat/Vault", mail_state: "live", mail_synced: "2026-08-23T15:00:00+02:00",
      title: "Hallo Welt", date: "2026-08-19", time: "14:32",
      from: "Erika Beispiel <erika@example.org>", to: ["Max Muster <max@example.net>"], cc: ["team@example.com"],
      subject: "Hallo Welt", in_reply_to: "", references: [], attachments: [],
    });
  });
  it("thread-reply: Wikilink nur wenn linkFor ein Ziel liefert", async () => {
    const m = await parseEml(loadFixture("thread-reply"));
    const p = defaultMailProfile();
    const noLink = buildDerivedFrontmatter(p, { mail: m, source: "s", state: "live", syncedAt: new Date(0) });
    expect(noLink["in_reply_to"]).toBe("alt-001@mail.example.org");
    const withLink = buildDerivedFrontmatter(p, { mail: m, source: "s", state: "live", syncedAt: new Date(0), linkFor: (id) => id === "alt-001@mail.example.org" ? "Mail/2026/2026-08-19-1000-termin" : null });
    expect(withLink["in_reply_to"]).toBe("[[Mail/2026/2026-08-19-1000-termin]]");
    expect(withLink["references"]).toEqual(["root-000@mail.example.org", "[[Mail/2026/2026-08-19-1000-termin]]"]);
  });
  it("attachments als 'name (type, size)'-Strings", async () => {
    const m = await parseEml(loadFixture("multipart-mixed-attachments"));
    const fm = buildDerivedFrontmatter(defaultMailProfile(), { mail: m, source: "s", state: "live", syncedAt: new Date(0) });
    expect(fm["attachments"]).toEqual(["bericht.pdf (application/pdf, 5 B)", "notiz.txt (text/plain, 5 B)"]);
  });
});

describe("Wikilinks aus linkFor (M3b-Nachlese, geparkter Befund 1)", () => {
  const p = defaultMailProfile();
  const args = { source: "s", state: "live" as const, syncedAt: new Date(0) };

  it("laesst die Message-ID stehen, wenn der Zielpfad ein wikilink-brechendes Zeichen traegt", async () => {
    const m = await parseEml(loadFixture("thread-reply"));
    const fm = buildDerivedFrontmatter(p, { ...args, mail: m, linkFor: () => "Mail/2026/Rechnung [final]" });
    expect(fm["in_reply_to"]).toBe("alt-001@mail.example.org");
  });

  it("klammert einen unauffaelligen Pfad weiterhin", async () => {
    const m = await parseEml(loadFixture("thread-reply"));
    const fm = buildDerivedFrontmatter(p, { ...args, mail: m, linkFor: () => "Mail/2026/b" });
    expect(fm["in_reply_to"]).toBe("[[Mail/2026/b]]");
  });
});
