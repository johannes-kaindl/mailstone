import { describe, it, expect } from "vitest";
import { FakeSocketTransport } from "../../helpers/fake-socket";
import { newAccount } from "../../../src/core/settings";
import { createSendService, type SendDeps } from "../../../src/core/send/service";
import type { OutgoingMessage } from "../../../src/core/send/outgoing";
import type { RestorePort } from "../../../src/core/transform/restore";
import { fakeRestorePort, GONE, MAIL, NAME, GONE_MAIL } from "../../helpers/restore-port";

// A5, Schritt 5: der Versanddienst wandelt Platzhalter zurueck, BEVOR er die Nachricht baut (iMIP-Bruecke, Testmail und jeder Aufrufer ohne Modal).

const fakePort = (gone: string[] = []): ReturnType<typeof fakeRestorePort> => fakeRestorePort({ gone });

function transport(): FakeSocketTransport {
  return new FakeSocketTransport(
    ["220 smtp.example.net ESMTP"],
    [
      { expect: /^EHLO /, send: ["250-smtp.example.net", "250 AUTH PLAIN"] },
      { expect: /^AUTH PLAIN /, send: ["235 2.7.0 ok"] },
      { expect: "MAIL FROM:<mail@example.net>", send: ["250 ok"] },
      { expect: "RCPT TO:<gast@example.org>", send: ["250 ok"] },
      { expect: "DATA", send: ["354 go"] },
      { expect: /^\.$/, send: ["250 2.0.0 queued as abc"] },
      { expect: "QUIT", send: ["221 bye"] },
    ],
  );
}

function setup(restore?: RestorePort): { send: (m: OutgoingMessage, opts?: { restored?: boolean }) => ReturnType<ReturnType<typeof createSendService>["send"]>; t: FakeSocketTransport } {
  const a = newAccount("privat");
  a.username = "user";
  a.secretId = "s";
  a.smtp = { host: "smtp.example.net", port: 587, tls: "implicit" };
  a.identities = [{ id: "mail", address: "mail@example.net", name: "Max Muster" }];
  a.defaultIdentityId = "mail";
  const t = transport();
  const deps: SendDeps = { accounts: () => [a], secret: () => "geheim", transport: () => t, now: () => new Date("2026-08-23T13:00:00.000Z"), randomId: () => "m1", ...(restore ? { restore } : {}) };
  const svc = createSendService(deps);
  return { send: (m, opts) => svc.send("privat", m, opts), t };
}

const base: OutgoingMessage = { from: "mail", to: [MAIL], subject: `Termin ${NAME}`, text: `Hallo ${NAME},` };

describe("SendService: Rueckwandlung vor dem Bauen (A5, Schritt 5)", () => {
  it("release: Empfaenger, Betreff und Text gehen im Klartext hinaus", async () => {
    const { send, t } = setup(fakePort());
    const r = await send(base);
    expect(r.ok).toBe(true);
    expect(t.written).toContain("RCPT TO:<gast@example.org>");
    expect(t.written).toContain("To: gast@example.org");
    expect(t.written).toContain("Subject: Termin Max Mustermann");
    expect(t.written).toContain("Hallo Max Mustermann,");
    expect(t.written.join("\n")).not.toContain(NAME);
  });

  it("hold: nichts wird gesendet, kein Connect, Code pseudonym-unresolved", async () => {
    const { send, t } = setup(fakePort());
    const r = await send({ ...base, text: "Person_aaaaaaaaaa" });
    expect(r).toEqual({ ok: false, code: "pseudonym-unresolved", detail: "held" });
    expect(t.connectCalls.length).toBe(0);
  });

  it("hold nur in einem Empfaengerfeld: nichts wird gesendet", async () => {
    const { send, t } = setup(fakePort());
    expect(await send({ ...base, to: ["Person_aaaaaaaaaa_Mail"], text: "t", subject: "s" })).toEqual({ ok: false, code: "pseudonym-unresolved", detail: "held" });
    expect(t.connectCalls.length).toBe(0);
  });

  it("vergessener Platzhalter in einem Adressfeld: Fehler, kein Connect", async () => {
    const { send, t } = setup(fakePort([GONE_MAIL]));
    expect(await send({ ...base, to: [GONE_MAIL] })).toEqual({ ok: false, code: "pseudonym-unresolved", detail: "forgotten-address" });
    expect(t.connectCalls.length).toBe(0);
  });

  it("Adresse ohne @ nach der Rueckwandlung: Fehler, kein Connect", async () => {
    const { send, t } = setup(fakePort());
    expect(await send({ ...base, to: [NAME] })).toEqual({ ok: false, code: "pseudonym-unresolved", detail: "address-unresolved" });
    expect(t.connectCalls.length).toBe(0);
  });

  it("vergessener Platzhalter im Text geht als Platzhalter hinaus (Spec 8.7)", async () => {
    const { send, t } = setup(fakePort(["Person_xxxxxxxxxx"]));
    const r = await send({ ...base, to: ["gast@example.org"], text: "Gruss Person_xxxxxxxxxx" });
    expect(r.ok).toBe(true);
    expect(t.written).toContain("Gruss Person_xxxxxxxxxx");
  });

  it("restored: true (die API hat schon zurueckgewandelt) ruft den Port nicht noch einmal", async () => {
    const port = fakePort();
    const { send } = setup(port);
    await send({ ...base, to: ["gast@example.org"], subject: "s", text: "t" }, { restored: true });
    expect(port.calls).toEqual([]);
  });

  it("ohne Port und ohne Platzhalter: byte-gleich zu heute", async () => {
    const { send, t } = setup();
    const r = await send({ from: "mail", to: ["gast@example.org"], subject: "Hallo", text: "Hi" });
    expect(r.ok).toBe(true);
    expect(t.written).toContain("To: gast@example.org");
  });

  it("Aus ohne Platzhalter: der Port laeuft, aendert aber nichts", async () => {
    const port = fakePort();
    const { send, t } = setup(port);
    const r = await send({ from: "mail", to: ["gast@example.org"], subject: "Hallo", text: "Hi" });
    expect(r.ok).toBe(true);
    expect(t.written).toContain("Hi");
  });

  it("die Reihenfolge der Pruefungen bleibt: eine unbekannte Identitaet meldet unknown-identity vor jeder Rueckwandlung", async () => {
    const port = fakePort();
    const { send } = setup(port);
    expect(await send({ ...base, from: "nope" })).toEqual({ ok: false, code: "unknown-identity" });
    expect(port.calls).toEqual([]);
  });
});

// P13: ICS-Teil und Textanhaenge werden nicht zurueckgewandelt (Zeilenfaltung, Injektionsrisiko), aber ein Platzhalter darin haelt den Versand an.
describe("SendService: Platzhalter im ICS-Teil oder in Anhaengen halten den Versand an (P13)", () => {
  const ICS = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Treffen\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const einladung = (ics: string): OutgoingMessage => ({ from: "mail", to: ["gast@example.org"], subject: "Termin", text: "Hallo", calendar: { method: "REQUEST", ics } });
  const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

  it("Platzhalter im ICS: nichts wird gesendet, kein Connect, Code pseudonym-unresolved mit Anzahl", async () => {
    const { send, t } = setup(fakePort());
    const r = await send(einladung(ICS.replace("Treffen", `Treffen mit ${NAME} und ${GONE}`)));
    expect(r).toEqual({ ok: false, code: "pseudonym-unresolved", detail: "unrestorable-part", count: 2 });
    expect(t.connectCalls.length).toBe(0);
  });

  it("derselbe Platzhalter mehrfach zaehlt einmal; die Meldung traegt nie den Platzhalter", async () => {
    const { send } = setup(fakePort());
    const r = await send(einladung(ICS.replace("Treffen", `${NAME} ${NAME} ${NAME}`)));
    expect(r).toMatchObject({ ok: false, count: 1 });
    expect(JSON.stringify(r)).not.toContain(NAME);
  });

  it("Platzhalter in einem Textanhang (text/*, ics, json, xml): nichts wird gesendet", async () => {
    for (const type of ["text/plain", "text/calendar", "application/ics", "application/json", "application/ld+json", "application/xml"]) {
      const { send, t } = setup(fakePort());
      const r = await send({ ...base, to: ["gast@example.org"], subject: "s", text: "t", attachments: [{ name: "a.txt", type, data: bytes(`Gruss ${NAME}`) }] });
      expect(r).toEqual({ ok: false, code: "pseudonym-unresolved", detail: "unrestorable-part", count: 1 });
      expect(t.connectCalls.length).toBe(0);
    }
  });

  it("Platzhalter im Namen eines Anhangs: nichts wird gesendet", async () => {
    const { send, t } = setup(fakePort());
    const r = await send({ ...base, to: ["gast@example.org"], subject: "s", text: "t", attachments: [{ name: `${NAME}.pdf`, type: "application/pdf", data: bytes("%PDF") }] });
    expect(r).toMatchObject({ ok: false, code: "pseudonym-unresolved", detail: "unrestorable-part" });
    expect(t.connectCalls.length).toBe(0);
  });

  it("Binaeranhang (kein Textformat) wird nicht gelesen, auch wenn Bytes wie ein Platzhalter aussehen", async () => {
    const { send } = setup(fakePort());
    const r = await send({ ...base, to: ["gast@example.org"], subject: "s", text: "t", attachments: [{ name: "a.bin", type: "application/octet-stream", data: bytes(NAME) }] });
    expect(r.ok).toBe(true);
  });

  it("zaehlt ICS und Anhaenge zusammen", async () => {
    const { send } = setup(fakePort());
    const r = await send({ ...einladung(ICS.replace("Treffen", NAME)), attachments: [{ name: "a.txt", type: "text/plain", data: bytes(GONE) }] });
    expect(r).toMatchObject({ ok: false, count: 2 });
  });

  it("restored: true schuetzt nicht: die API wandelt ICS und Anhaenge nie zurueck", async () => {
    const { send, t } = setup(fakePort());
    const r = await send(einladung(ICS.replace("Treffen", NAME)), { restored: true });
    expect(r).toMatchObject({ ok: false, code: "pseudonym-unresolved", detail: "unrestorable-part" });
    expect(t.connectCalls.length).toBe(0);
  });

  it("ICS und Textanhang ohne Platzhalter: byte-gleich zu einem Versand ohne Port", async () => {
    const msg: OutgoingMessage = { ...einladung(ICS), attachments: [{ name: "n.txt", type: "text/plain", data: bytes("Notiz") }] };
    const mit = setup(fakePort());
    const ohne = setup();
    expect((await mit.send(msg)).ok).toBe(true);
    expect((await ohne.send(msg)).ok).toBe(true);
    expect(mit.t.written.join("\n")).toBe(ohne.t.written.join("\n"));
  });

  it("ohne Port (kein Pseudonymisieren verdrahtet) geht ein ICS wie bisher hinaus", async () => {
    const { send } = setup();
    expect((await send(einladung(ICS.replace("Treffen", NAME)))).ok).toBe(true);
  });
});
