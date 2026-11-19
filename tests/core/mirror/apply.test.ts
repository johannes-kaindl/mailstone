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


// A5, Schritt 1: Werte aus dem Original-Mail, vorberechnet, bevor ein Transformer `from` und `subject` ersetzt.
describe("planSync — Werte aus dem Original (facts)", () => {
  const own = { ...profile, ownAddresses: ["ich@example.org"], threadField: "vorgang" };
  const base = { source: SOURCE, syncedAt, index: new Map() as MailIndex, takenPaths: new Set<string>() };
  const create = (plans: ReturnType<typeof planSync>, id: string) => {
    const p = plans.find((x) => x.mailId === id);
    if (!p || p.kind !== "create") throw new Error(`kein create-Plan fuer ${id}`);
    return p;
  };
  const platzhalter = (id: string, over: Partial<ParsedMail> = {}): ParsedMail => ({
    ...mail(id), from: { name: "Person_k3x9m2ab7q", address: "Person_k3x9m2ab7q_Mail" }, subject: "Person_x Re: Anfrage", ...over,
  });

  it("Charakterisierung: ohne facts ist alles wie bisher (richtung aus from, Kennung aus dem Betreff)", () => {
    const m = { ...mail("a@x"), from: { name: "Ich", address: "ich@example.org" } };
    const p = create(planSync({ ...base, profile: own, fetched: [{ mail: m, eml }], onServer: new Set(["a@x"]) }), "a@x");
    expect(p.content).toContain("richtung: ausgehend");
    const q = create(planSync({ ...base, profile: own, fetched: [{ mail: platzhalter("b@x"), eml }], onServer: new Set(["b@x"]) }), "b@x");
    expect(q.content).toContain("richtung: eingehend");
  });
  it("Platzhalter-from plus facts aus dem Original mit eigener Adresse: richtung ausgehend", () => {
    const facts = new Map([["b@x", { direction: "ausgehend" as const, threadToken: null }]]);
    const q = create(planSync({ ...base, profile: own, fetched: [{ mail: platzhalter("b@x"), eml }], onServer: new Set(["b@x"]), facts }), "b@x");
    expect(q.content).toContain("richtung: ausgehend");
  });
  it("facts einer anderen Mail gelten nicht", () => {
    const facts = new Map([["anders@x", { direction: "ausgehend" as const, threadToken: null }]]);
    const q = create(planSync({ ...base, profile: own, fetched: [{ mail: platzhalter("b@x"), eml }], onServer: new Set(["b@x"]), facts }), "b@x");
    expect(q.content).toContain("richtung: eingehend");
  });
  it("Platzhalter-Betreff plus Kennung aus dem Original: die Vorgaengerin wird wie aus dem Original gefunden", () => {
    const known = [{ mailId: "t@x", path: "Mail/2026/t", subject: "[Ticket#1] Anfrage", date: "2026-08-01", time: "10:00", value: "[[Mail/2026/wurzel]]" }];
    const m = platzhalter("n@x", { date: new Date("2026-08-10T08:00:00Z") });
    const ohne = create(planSync({ ...base, profile: own, fetched: [{ mail: m, eml }], onServer: new Set(["n@x"]), threadNotes: () => known }), "n@x");
    expect(ohne.content).not.toContain("wurzel");
    const facts = new Map([["n@x", { direction: "eingehend" as const, threadToken: "[Ticket#1]" }]]);
    const mit = create(planSync({ ...base, profile: own, fetched: [{ mail: m, eml }], onServer: new Set(["n@x"]), threadNotes: () => known, facts }), "n@x");
    expect(mit.content).toContain('vorgang: "[[Mail/2026/wurzel]]"');
  });
});

// A2 (Welle 36): Felder erben beim Anlegen.
describe("planSync — geerbte Felder beim Anlegen", () => {
  const on = { ...profile, inheritFields: ["projekt"] };
  const base = { source: SOURCE, syncedAt, index: new Map() as MailIndex, takenPaths: new Set<string>() };
  const at = (id: string, day: string, extra: Partial<ParsedMail> = {}): ParsedMail => ({ ...mail(id), date: new Date(`2026-08-${day}T08:00:00Z`), ...extra });
  const create = (plans: ReturnType<typeof planSync>, id: string) => {
    const p = plans.find((x) => x.mailId === id);
    if (!p || p.kind !== "create") throw new Error(`kein create-Plan fuer ${id}`);
    return p;
  };
  const line = (p: { content: string }, key: string): string | undefined => p.content.split("\n").find((l) => l.startsWith(`${key}:`));
  const vorgaengerin = (inherit: Record<string, unknown>) => () => [{ mailId: "p@x", path: "Mail/2026/p", value: null, inherit, subject: "Betreff p@x", date: "2026-08-01", time: "10:00" }];

  it("eine neue Notiz traegt eine Liste von Wikilinks unveraendert als Liste von ihrer Vorgaengerin", () => {
    const b = at("b@x", "09", { inReplyTo: "p@x" });
    const plans = planSync({ ...base, profile: on, fetched: [{ mail: b, eml }], onServer: new Set(["b@x"]), threadNotes: vorgaengerin({ projekt: ["[[A]]", "[[B]]"] }) });
    expect(line(create(plans, "b@x"), "projekt")).toBe('projekt: ["[[A]]", "[[B]]"]');
  });

  it("ein Wahrheitswert kommt als Wahrheitswert an: true ohne Anfuehrungszeichen (E2)", () => {
    const b = at("b@x", "09", { inReplyTo: "p@x" });
    const plans = planSync({ ...base, profile: { ...profile, inheritFields: ["privat", "offen"] }, fetched: [{ mail: b, eml }], onServer: new Set(["b@x"]), threadNotes: vorgaengerin({ privat: true, offen: false }) });
    const p = create(plans, "b@x");
    expect(line(p, "privat")).toBe("privat: true");
    expect(line(p, "offen")).toBe("offen: false");
  });

  it("ein Text und eine Zahl kommen unveraendert an", () => {
    const b = at("b@x", "09", { inReplyTo: "p@x" });
    const plans = planSync({ ...base, profile: { ...profile, inheritFields: ["projekt", "prio"] }, fetched: [{ mail: b, eml }], onServer: new Set(["b@x"]), threadNotes: vorgaengerin({ projekt: "Alpha", prio: 2 }) });
    const p = create(plans, "b@x");
    expect(line(p, "projekt")).toBe("projekt: Alpha");
    expect(line(p, "prio")).toBe("prio: 2");
  });

  it("ein verschachtelter Wert wird uebersprungen", () => {
    const b = at("b@x", "09", { inReplyTo: "p@x" });
    const plans = planSync({ ...base, profile: on, fetched: [{ mail: b, eml }], onServer: new Set(["b@x"]), threadNotes: vorgaengerin({ projekt: { a: 1 } }) });
    expect(create(plans, "b@x").content).not.toContain("projekt");
  });

  it("die Vorgaengerin darf eine Notiz desselben Laufs sein: deren geerbter Wert gilt, auch wenn die Antwort zuerst geliefert wird", () => {
    const b = at("b@x", "10", { inReplyTo: "a@x" });
    const a = at("a@x", "09", { inReplyTo: "p@x" });
    const plans = planSync({ ...base, profile: on, fetched: [{ mail: b, eml }, { mail: a, eml }], onServer: new Set(["a@x", "b@x"]), threadNotes: vorgaengerin({ projekt: ["[[A]]"] }) });
    expect(line(create(plans, "a@x"), "projekt")).toBe('projekt: ["[[A]]"]');
    expect(line(create(plans, "b@x"), "projekt")).toBe('projekt: ["[[A]]"]');
  });

  it("onCreate verliert gegen das Geerbte, das Geerbte verliert nie gegen onCreate", () => {
    const b = at("b@x", "09", { inReplyTo: "p@x" });
    const plans = planSync({ ...base, profile: { ...on, onCreate: { type: "mail", projekt: "preset" } }, fetched: [{ mail: b, eml }], onServer: new Set(["b@x"]), threadNotes: vorgaengerin({ projekt: "Alpha" }) });
    const p = create(plans, "b@x");
    expect(line(p, "projekt")).toBe("projekt: Alpha");
    expect(p.content).not.toContain("preset");
  });

  it("ein verwalteter Schluessel in der Liste wirkt nicht: die Mail behaelt ihre eigenen Werte", () => {
    const b = at("b@x", "09", { inReplyTo: "p@x" });
    const plans = planSync({ ...base, profile: { ...profile, inheritFields: ["mail_id", "subject", "projekt"] }, fetched: [{ mail: b, eml }], onServer: new Set(["b@x"]),
      threadNotes: vorgaengerin({ mail_id: "p@x", subject: "Fremd", projekt: "Alpha" }) });
    const p = create(plans, "b@x");
    expect(p.content.match(/^mail_id:/gm)).toHaveLength(1);
    expect(line(p, "mail_id")).toBe("mail_id: b@x");
    expect(p.content).not.toContain("Fremd");
    expect(line(p, "projekt")).toBe("projekt: Alpha");
  });

  it("ohne Vorgaengerin erbt eine Mail nichts", () => {
    const plans = planSync({ ...base, profile: on, fetched: [{ mail: mail("a@x"), eml }], onServer: new Set(["a@x"]), threadNotes: vorgaengerin({ projekt: "Alpha" }) });
    expect(create(plans, "a@x").content).not.toContain("projekt");
  });

  it("traegt Vorgangsfeld und geerbte Felder zugleich, das Vorgangsfeld bleibt Wikilink auf die Wurzel", () => {
    const b = at("b@x", "09", { inReplyTo: "p@x" });
    const plans = planSync({ ...base, profile: { ...on, threadField: "vorgang" }, fetched: [{ mail: b, eml }], onServer: new Set(["b@x"]),
      threadNotes: () => [{ mailId: "p@x", path: "Mail/2026/p", value: "[[Mail/2026/wurzel]]", inherit: { projekt: "Alpha" }, subject: "Betreff p@x", date: "2026-08-01", time: "10:00" }] });
    const p = create(plans, "b@x");
    expect(line(p, "vorgang")).toBe('vorgang: "[[Mail/2026/wurzel]]"');
    expect(line(p, "projekt")).toBe("projekt: Alpha");
  });

  it("ohne Header erbt eine Mail ueber die Kennung im Betreff, und die Kennung aus dem Original geht dem Betreff vor (A5)", () => {
    const known = () => [{ mailId: "t@x", path: "Mail/2026/t", value: null, inherit: { projekt: "Alpha" }, subject: "[Ticket#7] Drucker", date: "2026-08-01", time: "10:00" }];
    const n = at("n@x", "09", { subject: "AW: [Ticket#7] Drucker" });
    const mitBetreff = planSync({ ...base, profile: on, fetched: [{ mail: n, eml }], onServer: new Set(["n@x"]), threadNotes: known });
    expect(line(create(mitBetreff, "n@x"), "projekt")).toBe("projekt: Alpha");
    const facts = new Map([["n@x", { direction: "eingehend" as const, threadToken: "[Ticket#8]" }]]);
    const mitFacts = planSync({ ...base, profile: on, fetched: [{ mail: n, eml }], onServer: new Set(["n@x"]), threadNotes: known, facts });
    expect(create(mitFacts, "n@x").content).not.toContain("projekt");
  });

  it("baut den Index nur, wenn inheritFields nicht leer ist und der Lauf neue Mails hat", () => {
    let gebaut = 0;
    const zaehle = () => { gebaut++; return []; };
    planSync({ ...base, profile, fetched: [{ mail: mail("a@x"), eml }], onServer: new Set(["a@x"]), threadNotes: zaehle });
    expect(gebaut).toBe(0);
    planSync({ ...base, profile: on, fetched: [], onServer: new Set(), threadNotes: zaehle });
    expect(gebaut).toBe(0);
    planSync({ ...base, profile: { ...profile, inheritFields: ["mail_id"] }, fetched: [{ mail: mail("a@x"), eml }], onServer: new Set(["a@x"]), threadNotes: zaehle });
    expect(gebaut).toBe(0); // nur ein abgelehnter Name: nichts zu erben
    planSync({ ...base, profile: on, fetched: [{ mail: mail("a@x"), eml }], onServer: new Set(["a@x"]), threadNotes: zaehle });
    expect(gebaut).toBe(1);
  });
});
