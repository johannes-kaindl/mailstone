import { describe, it, expect } from "vitest";
import { planSync, type MailIndex } from "../../../src/core/mirror/apply";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { ParsedMail } from "../../../src/core/mime/types";

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
});
