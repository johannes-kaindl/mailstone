import { describe, it, expect } from "vitest";
import { buildDerivedFrontmatter } from "../../../src/core/render/frontmatter";
import { defaultMailProfile, withOwnAddresses } from "../../../src/core/mirror/profile";
import { parseEml } from "../../../src/core/mime/parse";
import { loadFixture } from "../../helpers/fixtures";

describe("Lokalzeit im Frontmatter (TZ=Europe/Berlin)", () => {
  it("rechnet UTC in Lokalzeit: date, time und mail_synced mit Offset", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    const fm = buildDerivedFrontmatter(defaultMailProfile(), { mail: { ...m, date: new Date("2026-08-19T22:30:00.000Z") }, source: "s", state: "live", syncedAt: new Date("2026-08-19T22:30:00.000Z") });
    expect(fm["date"]).toBe("2026-08-20");
    expect(fm["time"]).toBe("00:30");
    expect(fm["mail_synced"]).toBe("2026-08-20T00:30:00+02:00");
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
      subject: "Hallo Welt", in_reply_to: "", references: [], attachments: [], richtung: "eingehend",
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

describe("richtung (eingehend | ausgehend) aus den eigenen Identitäten", () => {
  const args = { source: "s", state: "live" as const, syncedAt: new Date(0) };
  it("Absender ist eine eigene Identität: ausgehend (Groß-/Kleinschreibung und Namensteil egal)", async () => {
    const m = await parseEml(loadFixture("utf8-plain")); // from: Erika Beispiel <erika@example.org>
    expect(buildDerivedFrontmatter(withOwnAddresses(defaultMailProfile(), ["ERIKA@example.org"]), { ...args, mail: m })["richtung"]).toBe("ausgehend");
    expect(buildDerivedFrontmatter(withOwnAddresses(defaultMailProfile(), [" erika@example.org "]), { ...args, mail: m })["richtung"]).toBe("ausgehend");
  });
  it("Absender ist keine eigene Identität: eingehend; auch ein Empfänger-Treffer macht keine ausgehende Mail", async () => {
    const m = await parseEml(loadFixture("utf8-plain")); // to: max@example.net
    expect(buildDerivedFrontmatter(withOwnAddresses(defaultMailProfile(), ["max@example.net"]), { ...args, mail: m })["richtung"]).toBe("eingehend");
  });
  it("ohne Identitäten oder ohne Absender: eingehend", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    expect(buildDerivedFrontmatter(defaultMailProfile(), { ...args, mail: m })["richtung"]).toBe("eingehend");
    expect(buildDerivedFrontmatter(withOwnAddresses(defaultMailProfile(), ["erika@example.org"]), { ...args, mail: { ...m, from: null } })["richtung"]).toBe("eingehend");
  });
  it("das Feld lässt sich im Profil abschalten (kein Schlüssel) und umbenennen", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    const off = { ...defaultMailProfile(), fields: { ...defaultMailProfile().fields, richtung: null } };
    expect(buildDerivedFrontmatter(off, { ...args, mail: m })).not.toHaveProperty("richtung");
    const renamed = { ...defaultMailProfile(), fields: { ...defaultMailProfile().fields, richtung: "direction" } };
    expect(buildDerivedFrontmatter(renamed, { ...args, mail: m })["direction"]).toBe("eingehend");
  });
});
