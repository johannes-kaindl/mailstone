import { describe, it, expect } from "vitest";
import { de, en } from "../../src/i18n/strings";

// A1 (Uebernahme): "Vorgaenge folgen" ist die erste Stelle, an der ein Sync-Lauf ohne Klick auf dem Server schreibt.
// Die Entscheidung (Johannes 2026-11-18) verlangt, dass der Einstellungstext das deutlich sagt: dass kopiert wird,
// dass es auf dem Mailserver geschieht, dass es standardmaessig aus ist und dass das Original bleibt.
describe("Einstellungstext Vorgang-Folgen", () => {
  it("sagt auf Englisch, dass auf dem Mailserver kopiert wird", () => {
    expect(en["settings.account.sync.follow"]).toMatch(/copies mails on the server/i);
    const d = en["settings.account.sync.follow.desc"];
    expect(d).toMatch(/Off by default/);
    expect(d).toMatch(/COPIES/);
    expect(d).toMatch(/ON YOUR MAIL SERVER/);
    expect(d).toMatch(/original stays/);
    expect(d).toMatch(/50 copies/);
  });
  it("sagt auf Deutsch, dass auf dem Mailserver kopiert wird", () => {
    expect(de["settings.account.sync.follow"]).toMatch(/kopiert Mails auf dem Server/);
    const d = de["settings.account.sync.follow.desc"];
    expect(d).toMatch(/Standardmäßig aus/);
    expect(d).toMatch(/KOPIERT/);
    expect(d).toMatch(/AUF DEINEM MAILSERVER/);
    expect(d).toMatch(/Original bleibt/);
    expect(d).toMatch(/50 Kopien/);
  });
});
