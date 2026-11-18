import { describe, it, expect } from "vitest";
import { planSync, type MailIndex } from "../../../src/core/mirror/apply";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { ParsedMail } from "../../../src/core/mime/types";
import { mailFilename, mailFolder } from "../../../src/core/render/filename";

const profile = defaultMailProfile();
const syncedAt = new Date("2026-08-30T09:00:00Z");
const SOURCE = "acc/Vault";

function mail(id: string): ParsedMail {
  return {
    id, messageIdRaw: `<${id}>`, inReplyTo: null, references: [],
    from: { name: "A", address: "a@example.net" }, to: [], cc: [],
    subject: `Betreff ${id}`, date: new Date("2026-08-29T08:00:00Z"),
    text: "Hallo", html: null, attachments: [], attachmentData: new Map(), rawSize: 10,
  };
}
const eml = new TextEncoder().encode("From: a@example.net\r\n\r\nHallo\r\n");

describe("planSync", () => {
  it("legt fuer eine unbekannte Mail eine Notiz an", () => {
    const plans = planSync({ profile, source: SOURCE, syncedAt, index: new Map(), takenPaths: new Set(), fetched: [{ mail: mail("neu@x"), eml }], onServer: new Set(["neu@x"]) });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ kind: "create", mailId: "neu@x" });
  });

  it("setzt detached, wenn eine bekannte Mail den Ordner verlassen hat", () => {
    const index: MailIndex = new Map([["weg@x", { path: "Mail/2026/weg.md", state: "live", source: SOURCE }]]);
    const plans = planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(), fetched: [], onServer: new Set() });
    expect(plans).toEqual([{ kind: "setState", path: "Mail/2026/weg.md", mailId: "weg@x", state: "detached", stateField: "mail_state" }]);
  });

  it("setzt live, wenn eine detachte Mail zurueckkehrt", () => {
    const index: MailIndex = new Map([["zurueck@x", { path: "Mail/2026/z.md", state: "detached", source: SOURCE }]]);
    const plans = planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(), fetched: [], onServer: new Set(["zurueck@x"]) });
    expect(plans).toEqual([{ kind: "setState", path: "Mail/2026/z.md", mailId: "zurueck@x", state: "live", stateField: "mail_state" }]);
  });

  it("laesst eine live-Notiz, die weiter im Ordner liegt, unberuehrt", () => {
    const index: MailIndex = new Map([["bleibt@x", { path: "Mail/2026/b.md", state: "live", source: SOURCE }]]);
    expect(planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(), fetched: [], onServer: new Set(["bleibt@x"]) })).toEqual([]);
  });

  it("fasst Notizen eines ANDEREN Kontos nicht an", () => {
    const index: MailIndex = new Map([["fremd@x", { path: "Mail/2026/f.md", state: "live", source: "anderes-konto/Vault" }]]);
    expect(planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(), fetched: [], onServer: new Set() })).toEqual([]);
  });

  it("laesst eine Notiz ohne mail_source unberuehrt (Altbestand aus dem Import)", () => {
    const index: MailIndex = new Map([["alt@x", { path: "Mail/2026/a.md", state: "live", source: null }]]);
    expect(planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(), fetched: [], onServer: new Set() })).toEqual([]);
  });

  it("rendert eine bestehende Notiz nie neu, auch wenn die Mail mitgeliefert wird", () => {
    const index: MailIndex = new Map([["da@x", { path: "Mail/2026/d.md", state: "live", source: SOURCE }]]);
    const plans = planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(), fetched: [{ mail: mail("da@x"), eml }], onServer: new Set(["da@x"]) });
    expect(plans.some((p) => p.kind === "update")).toBe(false);
  });

  // Invariante "hoechstens ein Plan je Mail-ID": zwei Server-Mails koennen dieselbe normalisierte
  // Message-ID tragen (zurueckkopierte Mail, Sieve-Kopie) oder ueber fallbackId auf denselben Wert
  // fallen. Ohne den Riegel entstuenden zwei create-Plaene mit verschiedenen Pfaden und gleichem
  // mail_id — die zweite Notiz waere im mailIndex dauerhaft unerreichbar.
  it("plant fuer dieselbe Mail-ID nur einen create-Plan, auch wenn sie zweimal geliefert wird", () => {
    const a = mail("doppelt@x");
    const b = { ...mail("doppelt@x"), subject: "Anderer Betreff" };
    const plans = planSync({ profile, source: SOURCE, syncedAt, index: new Map(), takenPaths: new Set(), fetched: [{ mail: a, eml }, { mail: b, eml }], onServer: new Set(["doppelt@x"]) });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ kind: "create", mailId: "doppelt@x" });
  });

  it("vergibt kollisionsfreie Pfade fuer zwei Mails desselben Betreffs am selben Zeitpunkt", () => {
    const a = mail("eins@x");
    const b = { ...mail("zwei@x"), subject: a.subject, date: a.date };
    const plans = planSync({ profile, source: SOURCE, syncedAt, index: new Map(), takenPaths: new Set(), fetched: [{ mail: a, eml }, { mail: b, eml }], onServer: new Set(["eins@x", "zwei@x"]) });
    const paths = plans.flatMap((p) => (p.kind === "create" ? [p.path, p.emlPath] : []));
    expect(new Set(paths).size).toBe(paths.length);
  });

  // B1 (Welle 36): Antwort und Bezugsmail im selben Lauf. Die Antwort steht in `fetched` VOR der
  // Bezugsmail; der Link muss trotzdem auf den Pfad zeigen, den die Bezugsmail in diesem Lauf bekommt.
  describe("Verweise innerhalb eines Laufs", () => {
    const linkFor = (id: string): string | null => (id === "alt@example.org" ? "Mail/2026/alt-im-index" : null);
    const A = (): ParsedMail => mail("a@example.org");
    const B = (extra: Partial<ParsedMail>): ParsedMail => ({ ...mail("b@example.org"), subject: "Re: Betreff", ...extra });
    const create = (plans: ReturnType<typeof planSync>, id: string) => {
      const p = plans.find((x) => x.mailId === id);
      if (!p || p.kind !== "create") throw new Error(`kein create-Plan fuer ${id}`);
      return p;
    };

    it("References: die Antwort traegt den Wikilink auf die Bezugsmail, auch wenn sie vor ihr geliefert wird", () => {
      const a = A(); const b = B({ references: ["a@example.org"] });
      const plans = planSync({ profile, source: SOURCE, syncedAt, index: new Map(), takenPaths: new Set(),
        fetched: [{ mail: b, eml }, { mail: a, eml }], onServer: new Set(["a@example.org", "b@example.org"]), linkFor });
      const pa = create(plans, "a@example.org");
      expect(create(plans, "b@example.org").content).toContain(`[[${pa.path.replace(/\.md$/, "")}]]`);
    });

    it("In-Reply-To: dasselbe", () => {
      const a = A(); const b = B({ inReplyTo: "a@example.org" });
      const plans = planSync({ profile, source: SOURCE, syncedAt, index: new Map(), takenPaths: new Set(),
        fetched: [{ mail: b, eml }, { mail: a, eml }], onServer: new Set(["a@example.org", "b@example.org"]), linkFor });
      const pa = create(plans, "a@example.org");
      const zeile = create(plans, "b@example.org").content.split("\n").find((l) => l.startsWith("in_reply_to:"));
      expect(zeile).toContain(`[[${pa.path.replace(/\.md$/, "")}]]`);
    });

    it("weicht die Bezugsmail auf -2 aus (Basisname belegt), zeigt der Link auf -2", () => {
      const a = A(); const b = B({ inReplyTo: "a@example.org", references: ["a@example.org"] });
      const base = `${mailFolder(profile, a)}/${mailFilename(profile, a)}`;
      const plans = planSync({ profile, source: SOURCE, syncedAt, index: new Map(), takenPaths: new Set([`${base}.md`]),
        fetched: [{ mail: b, eml }, { mail: a, eml }], onServer: new Set(["a@example.org", "b@example.org"]), linkFor });
      expect(create(plans, "a@example.org").path).toBe(`${base}-2.md`);
      const body = create(plans, "b@example.org").content;
      expect(body).toContain(`[[${base}-2]]`);
      expect(body).not.toContain(`[[${base}]]`);
    });

    it("kennt weiter den Index: eine Bezugsmail von frueher wird verlinkt", () => {
      const b = B({ inReplyTo: "alt@example.org" });
      const index: MailIndex = new Map([["alt@example.org", { path: "Mail/2026/alt-im-index.md", state: "live", source: SOURCE }]]);
      const plans = planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(),
        fetched: [{ mail: b, eml }], onServer: new Set(["alt@example.org", "b@example.org"]), linkFor });
      expect(create(plans, "b@example.org").content).toContain("[[Mail/2026/alt-im-index]]");
    });

    it("eine Mail, die ihre eigene ID in References und In-Reply-To traegt, verlinkt nicht auf sich selbst", () => {
      const a = { ...A(), inReplyTo: "a@example.org", references: ["a@example.org", "alt@example.org"] };
      const plans = planSync({ profile, source: SOURCE, syncedAt, index: new Map(), takenPaths: new Set(),
        fetched: [{ mail: a, eml }], onServer: new Set(["a@example.org"]), linkFor });
      const p = create(plans, "a@example.org");
      expect(p.content).not.toContain(`[[${p.path.replace(/\.md$/, "")}]]`);
      expect(p.content).toContain("a@example.org");
      expect(p.content).toContain("[[Mail/2026/alt-im-index]]");
    });

    it("haelt die Invariante: eine doppelt gelieferte Mail-ID bekommt einen Plan und einen Pfad", () => {
      const a = A();
      const plans = planSync({ profile, source: SOURCE, syncedAt, index: new Map(), takenPaths: new Set(),
        fetched: [{ mail: a, eml }, { mail: { ...a, subject: "Anders" }, eml }], onServer: new Set(["a@example.org"]), linkFor });
      expect(plans.filter((p) => p.mailId === "a@example.org")).toHaveLength(1);
    });
  });
});
