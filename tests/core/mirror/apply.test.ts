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

  it("saveEml: false: kein emlPath im Plan, die belegten .eml-Pfade tragen aber weiter zur Kollisionsfreiheit bei", () => {
    const off = { ...profile, saveEml: false };
    const a = mail("eins@x");
    const b = { ...mail("zwei@x"), subject: a.subject, date: a.date };
    const plans = planSync({ profile: off, source: SOURCE, syncedAt, index: new Map(), takenPaths: new Set(), fetched: [{ mail: a, eml }, { mail: b, eml }], onServer: new Set(["eins@x", "zwei@x"]) });
    expect(plans.every((p) => p.kind === "create" && p.emlPath === null)).toBe(true);
    const base = `${mailFolder(profile, a)}/${mailFilename(profile, a)}`;
    expect(plans.map((p) => p.path)).toEqual([`${base}.md`, `${base}-2.md`]);
    // Eine verwaiste .eml am Konventionspfad schiebt die Notiz auf -2.
    const verwaist = planSync({ profile: off, source: SOURCE, syncedAt, index: new Map(), takenPaths: new Set([`${mailFolder(profile, a)}/_eml/${mailFilename(profile, a)}.eml`]), fetched: [{ mail: a, eml }], onServer: new Set(["eins@x"]) });
    expect(verwaist[0]?.path).toBe(`${base}-2.md`);
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

// A3 (Welle 36): der Vorgangswert beim Anlegen (E24).
describe("planSync — Vorgangswert beim Anlegen", () => {
  const on = { ...profile, threadField: "vorgang" };
  const base = { source: SOURCE, syncedAt, index: new Map() as MailIndex, takenPaths: new Set<string>() };
  const at = (id: string, day: string, extra: Partial<ParsedMail> = {}): ParsedMail => ({ ...mail(id), date: new Date(`2026-08-${day}T08:00:00Z`), ...extra });
  const create = (plans: ReturnType<typeof planSync>, id: string) => {
    const p = plans.find((x) => x.mailId === id);
    if (!p || p.kind !== "create") throw new Error(`kein create-Plan fuer ${id}`);
    return p;
  };
  const vorgang = (p: { content: string }): string | undefined => p.content.split("\n").find((l) => l.startsWith("vorgang:"));

  it("ohne threadField traegt keine neue Notiz ein Vorgangsfeld und der Index wird nicht gebaut", () => {
    let gebaut = 0;
    const plans = planSync({ ...base, profile, fetched: [{ mail: mail("a@x"), eml }], onServer: new Set(["a@x"]), threadNotes: () => { gebaut++; return []; } });
    expect(create(plans, "a@x").content).not.toContain("vorgang");
    expect(gebaut).toBe(0);
  });

  it("ein unbrauchbarer Feldname (verwalteter Schluessel) gilt als aus", () => {
    const plans = planSync({ ...base, profile: { ...profile, threadField: "mail_id" }, fetched: [{ mail: mail("a@x"), eml }], onServer: new Set(["a@x"]) });
    expect(create(plans, "a@x").content.match(/^mail_id:/gm)).toHaveLength(1);
  });

  it("baut den Index nur, wenn der Lauf neue Mails hat", () => {
    let gebaut = 0;
    const index: MailIndex = new Map([["da@x", { path: "Mail/2026/d.md", state: "live", source: SOURCE }]]);
    planSync({ ...base, index, profile: on, fetched: [], onServer: new Set(["da@x"]), threadNotes: () => { gebaut++; return []; } });
    expect(gebaut).toBe(0);
    planSync({ ...base, profile: on, fetched: [{ mail: mail("a@x"), eml }], onServer: new Set(["a@x"]), threadNotes: () => { gebaut++; return []; } });
    expect(gebaut).toBe(1);
  });

  it("eine Mail ohne Vorgaengerin ist ihre eigene Wurzel", () => {
    const plans = planSync({ ...base, profile: on, fetched: [{ mail: mail("a@x"), eml }], onServer: new Set(["a@x"]) });
    const p = create(plans, "a@x");
    expect(vorgang(p)).toBe(`vorgang: "[[${p.path.replace(/\.md$/, "")}]]"`);
  });

  it("uebernimmt den Wert der Vorgaengerin im Vault", () => {
    const b = at("b@x", "09", { inReplyTo: "p@x" });
    const plans = planSync({ ...base, profile: on, fetched: [{ mail: b, eml }], onServer: new Set(["b@x"]),
      threadNotes: () => [{ mailId: "p@x", path: "Mail/2026/p", subject: "Betreff p@x", date: "2026-08-01", time: "10:00", value: "[[Mail/2026/wurzel]]" }] });
    expect(vorgang(create(plans, "b@x"))).toBe('vorgang: "[[Mail/2026/wurzel]]"');
  });

  describe("Kennung im Betreff", () => {
    const tNote = (mailId: string, value: string, subject: string) => ({ mailId, path: `Mail/2026/${mailId}`, subject, date: "2026-08-01", time: "10:00", value });
    const planFor = (p: typeof on, m: ParsedMail, known: ReturnType<typeof tNote>[]) =>
      vorgang(create(planSync({ ...base, profile: p, fetched: [{ mail: m, eml }], onServer: new Set([m.id]), threadNotes: () => known }), m.id));

    it("uebernimmt ohne Header-Bezug den Wert der juengsten fruehere Notiz mit derselben Kennung", () => {
      const m = at("n@x", "09", { subject: "AW: [Ticket#7] Drucker" });
      expect(planFor(on, m, [tNote("t@x", "[[Mail/2026/wurzel]]", "[Ticket#7] Drucker"), tNote("o@x", "[[Mail/2026/fremd]]", "[Ticket#8] Monitor")]))
        .toBe('vorgang: "[[Mail/2026/wurzel]]"');
    });

    it("ein Header, der auf eine Notiz trifft, geht der Kennung vor", () => {
      const m = at("n@x", "09", { subject: "AW: [Ticket#7] Drucker", inReplyTo: "p@x" });
      expect(planFor(on, m, [tNote("t@x", "[[Mail/2026/ticket]]", "[Ticket#7] Drucker"), tNote("p@x", "[[Mail/2026/header]]", "Anderes")]))
        .toBe('vorgang: "[[Mail/2026/header]]"');
    });

    it("leerer oder unbrauchbarer Ausdruck: nur die Header gelten, die Mail ist ihre eigene Wurzel", () => {
      const m = at("n@x", "09", { subject: "AW: [Ticket#7] Drucker" });
      const known = [tNote("t@x", "[[Mail/2026/wurzel]]", "[Ticket#7] Drucker")];
      for (const pattern of ["", "[", "(a+)+$"]) {
        expect(planFor({ ...on, threadTokenPattern: pattern }, m, known), JSON.stringify(pattern)).toMatch(/^vorgang: "\[\[Mail\//);
        expect(planFor({ ...on, threadTokenPattern: pattern }, m, known), JSON.stringify(pattern)).not.toContain("wurzel");
      }
    });
  });

  it("die Vorgaengerin darf eine Notiz desselben Laufs sein, auch wenn die Antwort zuerst geliefert wird", () => {
    const a = at("a@x", "01");
    const b = at("b@x", "02", { inReplyTo: "a@x", references: ["a@x"] });
    const plans = planSync({ ...base, profile: on, fetched: [{ mail: b, eml }, { mail: a, eml }], onServer: new Set(["a@x", "b@x"]) });
    const pa = create(plans, "a@x");
    const erwartet = `vorgang: "[[${pa.path.replace(/\.md$/, "")}]]"`;
    expect(vorgang(pa)).toBe(erwartet);
    expect(vorgang(create(plans, "b@x"))).toBe(erwartet);
  });

  it("der Wert zeigt auf -2, wenn die Wurzel auf einen belegten Namen ausweicht", () => {
    const a = at("a@x", "01");
    const b = at("b@x", "02", { inReplyTo: "a@x" });
    const stamm = `${mailFolder(profile, a)}/${mailFilename(profile, a)}`;
    const plans = planSync({ ...base, takenPaths: new Set([`${stamm}.md`]), profile: on, fetched: [{ mail: b, eml }, { mail: a, eml }], onServer: new Set(["a@x", "b@x"]) });
    expect(vorgang(create(plans, "b@x"))).toBe(`vorgang: "[[${stamm}-2]]"`);
  });

  it("ein Preset mit demselben Namen verliert gegen den Vorgangswert", () => {
    const preset = { ...on, onCreate: { type: "mail", vorgang: "preset" } };
    const plans = planSync({ ...base, profile: preset, fetched: [{ mail: mail("a@x"), eml }], onServer: new Set(["a@x"]) });
    expect(create(plans, "a@x").content).not.toContain("preset");
  });
});

