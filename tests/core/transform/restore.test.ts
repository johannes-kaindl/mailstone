import { describe, it, expect } from "vitest";
import { findPlaceholders } from "../../../src/vendor/kit/placeholder";
import { restoreAddress, restoreFormatted, restoreMessage, restoreText, type RestoreOutcome, type RestorePort } from "../../../src/core/transform/restore";

// Ein Fake-Port mit der Tabelle des Pseudonymizers: bekannte Platzhalter werden ersetzt, vergessene bleiben stehen und werden gemeldet, jeder andere
// Platzhalter ist unbekannt (hold). Die Platzhalter lesen wir mit der echten Grammatik des Kits.
const NAME = "Person_k3x9m2ab7q";
const MAIL = "Person_k3x9m2ab7q_Mail";
const NAME_2 = "Person_k3x9m2ab7q_2";
const ORPHAN = "Mail_m4t8c6r2vp"; // Wert ohne Traeger
const FORGOTTEN = "Person_zzzzzzzzzz".replace(/z/g, "x"); // gueltige Grammatik, in der Tabelle als vergessen
const FORGOTTEN_MAIL = `${FORGOTTEN}_Mail`;
const TABLE = new Map<string, string>([[NAME, "Max Mustermann"], [MAIL, "max@example.org"], [NAME_2, "Max"]]);

function port(opts: { gone?: string[]; absent?: boolean } = {}): RestorePort & { calls: string[] } {
  const calls: string[] = [];
  const fn = ((text: string): RestoreOutcome => {
    calls.push(text);
    const found = findPlaceholders(text);
    if (opts.absent && found.length > 0) return { kind: "hold", reason: "absent", unknown: [...new Set(found.map((p) => p.raw))], message: "fehlt" };
    const unknown = [...new Set(found.filter((p) => !TABLE.has(p.raw) && !(opts.gone ?? []).includes(p.raw)).map((p) => p.raw))];
    if (unknown.length > 0) return { kind: "hold", reason: "unknown", unknown, message: `${String(unknown.length)} Platzhalter` };
    let out = text;
    const forgotten: string[] = [];
    for (const p of [...found].sort((a, b) => b.start - a.start)) {
      const v = TABLE.get(p.raw);
      if (v === undefined) { if (!forgotten.includes(p.raw)) forgotten.push(p.raw); continue; }
      out = out.slice(0, p.start) + v + out.slice(p.end);
    }
    return { kind: "release", text: out, forgotten };
  }) as RestorePort & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe("restoreText", () => {
  it("setzt Platzhalter ein", () => {
    expect(restoreText(`Hallo ${NAME_2},`, port())).toEqual({ ok: true, text: "Hallo Max,", forgotten: 0 });
  });
  it("laesst Text ohne Platzhalter unveraendert", () => {
    expect(restoreText("Hallo Welt", port())).toEqual({ ok: true, text: "Hallo Welt", forgotten: 0 });
  });
  it("hold: scheitert mit der Anzahl, nie mit dem Klartext oder dem Platzhalter", () => {
    const r = restoreText(`${NAME} und Person_aaaaaaaaaa und Person_bbbbbbbbbb`, port());
    expect(r).toEqual({ ok: false, failure: { kind: "held", reason: "unknown", count: 2, message: "2 Platzhalter" } });
  });
  it("ein vergessener Platzhalter im Text bleibt stehen und wird gezaehlt", () => {
    expect(restoreText(`Gruss an ${FORGOTTEN}`, port({ gone: [FORGOTTEN] }))).toEqual({ ok: true, text: `Gruss an ${FORGOTTEN}`, forgotten: 1 });
  });
});

describe("restoreAddress", () => {
  it("loest eine Platzhalter-Adresse auf", () => {
    expect(restoreAddress(MAIL, port())).toEqual({ ok: true, text: "max@example.org", forgotten: 0 });
  });
  it("laesst eine gewoehnliche Adresse und eine kaputte Adresse ohne Platzhalter unberuehrt (die Pruefung der Adressgrammatik bleibt bei validateOutgoing)", () => {
    expect(restoreAddress("a@example.org", port())).toEqual({ ok: true, text: "a@example.org", forgotten: 0 });
    expect(restoreAddress("max.mustermann", port())).toEqual({ ok: true, text: "max.mustermann", forgotten: 0 });
  });
  it("ein vergessener Platzhalter in einer Adresse ist ein Fehler", () => {
    expect(restoreAddress(FORGOTTEN_MAIL, port({ gone: [FORGOTTEN_MAIL] }))).toEqual({ ok: false, failure: { kind: "forgotten-address", count: 1 } });
  });
  it("eine Adresse ohne @ nach der Rueckwandlung ist ein Fehler (Platzhalter ohne Aufloesung, auch ein traegerloser)", () => {
    // Der Pseudonymizer loest den Platzhalter auf einen Namen auf, der keine Adresse ist: Person_..., nicht Person_..._Mail.
    expect(restoreAddress(NAME, port())).toEqual({ ok: false, failure: { kind: "address-unresolved", count: 1 } });
    // Ein Port, der einen traegerlosen Platzhalter unveraendert zurueckgibt (wie ein "gehoert niemandem"-Eintrag ohne Mail-Wert).
    const bleibt: RestorePort = (text) => ({ kind: "release", text, forgotten: [] });
    expect(restoreAddress(ORPHAN, bleibt)).toEqual({ ok: false, failure: { kind: "address-unresolved", count: 1 } });
  });
  it("hold in einer Adresse scheitert als held", () => {
    expect(restoreAddress("Person_aaaaaaaaaa_Mail", port())).toMatchObject({ ok: false, failure: { kind: "held", count: 1 } });
  });
});

describe("restoreFormatted", () => {
  it("setzt in einer formatierten Absenderzeile Name und Adresse ein", () => {
    expect(restoreFormatted(`${NAME} <${MAIL}>`, port())).toEqual({ ok: true, text: "Max Mustermann <max@example.org>", forgotten: 0 });
  });
  it("vergessener Platzhalter in der Zeile ist ein Fehler (sie wird zur Adresse)", () => {
    expect(restoreFormatted(`${FORGOTTEN} <${FORGOTTEN_MAIL}>`, port({ gone: [FORGOTTEN, FORGOTTEN_MAIL] }))).toEqual({ ok: false, failure: { kind: "forgotten-address", count: 2 } });
  });
});

describe("restoreMessage", () => {
  const base = { to: [MAIL], cc: ["b@example.org"], bcc: [`${MAIL}`], subject: `Termin ${NAME_2}`, text: `Hallo ${NAME_2},\n${NAME}`, html: `<p>${NAME}</p>` };

  it("wandelt Empfaenger, Betreff, Text und HTML zurueck", () => {
    const r = restoreMessage(base, port());
    expect(r).toEqual({ ok: true, forgotten: 0, msg: { to: ["max@example.org"], cc: ["b@example.org"], bcc: ["max@example.org"], subject: "Termin Max", text: "Hallo Max,\nMax Mustermann", html: "<p>Max Mustermann</p>" } });
  });
  it("laesst Felder aus, die fehlen (kein cc, kein bcc, kein html bleibt kein Feld)", () => {
    const r = restoreMessage({ to: ["a@example.org"], subject: "x", text: "y" }, port());
    expect(r).toEqual({ ok: true, forgotten: 0, msg: { to: ["a@example.org"], subject: "x", text: "y" } });
    expect(Object.keys((r as { msg: object }).msg)).toEqual(["to", "subject", "text"]);
  });
  it("traegt weitere Felder der Nachricht unveraendert weiter (from, Anhaenge, Termin)", () => {
    const m = { ...base, from: "id", inReplyTo: "<x@y>", attachments: [{ name: "a", type: "t", data: new Uint8Array([1]) }] };
    const r = restoreMessage(m, port());
    expect(r.ok && r.msg.from).toBe("id");
    expect(r.ok && r.msg.attachments).toBe(m.attachments);
    expect(r.ok && r.msg.inReplyTo).toBe("<x@y>");
  });
  it("hold bei IRGENDEINEM Teil scheitert die ganze Nachricht, mit der Summe der Platzhalter", () => {
    const r = restoreMessage({ ...base, subject: "Person_aaaaaaaaaa", text: "Person_bbbbbbbbbb Person_cccccccccc" }, port());
    expect(r).toMatchObject({ ok: false, failure: { kind: "held", count: 3 } });
  });
  it("hold nur im HTML scheitert ebenso", () => {
    expect(restoreMessage({ ...base, html: "<p>Person_aaaaaaaaaa</p>" }, port())).toMatchObject({ ok: false, failure: { kind: "held" } });
  });
  it("ein vergessener Platzhalter in einem Adressfeld scheitert, in cc und bcc ebenso", () => {
    const gone = [FORGOTTEN_MAIL];
    expect(restoreMessage({ ...base, to: [FORGOTTEN_MAIL] }, port({ gone }))).toMatchObject({ ok: false, failure: { kind: "forgotten-address" } });
    expect(restoreMessage({ ...base, cc: [FORGOTTEN_MAIL] }, port({ gone }))).toMatchObject({ ok: false, failure: { kind: "forgotten-address" } });
    expect(restoreMessage({ ...base, bcc: [FORGOTTEN_MAIL] }, port({ gone }))).toMatchObject({ ok: false, failure: { kind: "forgotten-address" } });
  });
  it("ein vergessener Platzhalter in Betreff, Text oder HTML geht als Platzhalter hinaus und wird gezaehlt", () => {
    const r = restoreMessage({ ...base, subject: `Re ${FORGOTTEN}`, text: `${FORGOTTEN} und ${FORGOTTEN_MAIL}`, html: `<p>${FORGOTTEN}</p>` }, port({ gone: [FORGOTTEN, FORGOTTEN_MAIL] }));
    expect(r).toMatchObject({ ok: true, forgotten: 4, msg: { subject: `Re ${FORGOTTEN}` } });
  });
  it("eine Empfaengeradresse ohne @ nach der Rueckwandlung scheitert", () => {
    expect(restoreMessage({ ...base, to: [NAME] }, port())).toEqual({ ok: false, failure: { kind: "address-unresolved", count: 1 } });
  });
  it("ohne Plugin (hold/absent) scheitert eine Nachricht mit Platzhaltern, eine ohne geht durch", () => {
    expect(restoreMessage(base, port({ absent: true }))).toMatchObject({ ok: false, failure: { kind: "held", reason: "absent" } });
    expect(restoreMessage({ to: ["a@example.org"], subject: "s", text: "t" }, port({ absent: true }))).toMatchObject({ ok: true });
  });
  it("Text ohne Platzhalter ist wertgleich", () => {
    const m = { to: ["a@example.org"], cc: ["c@example.org"], subject: "Betreff", text: "Text" };
    const r = restoreMessage(m, port());
    expect(r.ok && r.msg).toEqual(m);
  });
});
