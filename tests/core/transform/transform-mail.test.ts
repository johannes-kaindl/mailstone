import { describe, it, expect } from "vitest";
import { transformMail, transformWith, rebuildMail, type PortOutcome } from "../../../src/core/transform/transform-mail";
import { defaultMailProfile, withOwnAddresses, type MailProfile, type PseudonymizeMode } from "../../../src/core/mirror/profile";
import { originalFactsOf } from "../../../src/core/transform/original-facts";
import { bodyMarkdown } from "../../../src/core/render/body";
import type { ParsedMail } from "../../../src/core/mime/types";
import type { TransformRequest, TransformResult } from "../../../src/vendor/kit/pseudonymizer-source";

const att = (key: string, name: string) => ({ key, name, type: "application/pdf", size: 10, inline: false });
const mail = (over: Partial<ParsedMail> = {}): ParsedMail => ({
  id: "a@example.org", messageIdRaw: "<a@example.org>", inReplyTo: "p@example.org", references: ["r1@example.org"],
  from: { name: "Erika Muster", address: "erika@kunde.example" },
  to: [{ name: "Ich", address: "ich@eigen.example" }, { name: "", address: "zweite@kunde.example" }],
  cc: [{ name: "Kai Kopie", address: "kai@kunde.example" }],
  subject: "Re: [Ticket#4711] Rechnung fuer Erika Muster", date: new Date("2026-08-29T08:00:00Z"),
  text: "Hallo,\nbitte Rechnung an Erika Muster.", html: null,
  attachments: [att("0:rechnung-erika.pdf", "rechnung-erika.pdf"), att("cid1@x", "logo.png")], attachmentData: new Map([["0:rechnung-erika.pdf", new Uint8Array([1])], ["cid1@x", new Uint8Array([2])]]), rawSize: 99, ...over,
});
const profile = (mode: PseudonymizeMode = "if-available", own: string[] = ["ich@eigen.example"]): MailProfile => ({ ...withOwnAddresses(defaultMailProfile(), own), pseudonymize: mode });

/** Ein Fake-Port, der jeden Wert nach dem Muster `P(<wert>)` ersetzt und alle Anfragen aufzeichnet. */
function fakePort(map: (id: string, value: string) => string = (_id, v) => `P(${v})`) {
  const requests: TransformRequest[] = [];
  const port = (req: TransformRequest): Promise<PortOutcome> => {
    requests.push(req);
    const result: TransformResult = { parts: req.parts.map((p) => ({ id: p.id, value: map(p.id, p.value) })), entities: [], applied: req.parts.length };
    return Promise.resolve({ kind: "pseudonymized", result });
  };
  return { port, requests };
}
const fixed = (out: PortOutcome) => ({ port: () => Promise.resolve(out) });

describe("transformMail — Zweig pseudonymisiert", () => {
  it("ersetzt Body, Betreff, Namen, Adressen und Anhangsnamen; html wird null; Identitaet und Anhangsschluessel bleiben", async () => {
    const { port } = fakePort();
    const m = mail();
    const r = await transformMail(m, profile(), port, { interactive: false });
    expect(r.kind).toBe("mail");
    if (r.kind !== "mail") return;
    const t = r.mail;
    expect(t.text).toBe(`P(${bodyMarkdown(m)})`);
    expect(t.html).toBeNull();
    expect(t.subject).toBe("P(Re: [Ticket#4711] Rechnung fuer Erika Muster)");
    expect(t.from).toEqual({ name: "P(Erika Muster)", address: "P(erika@kunde.example)" });
    expect(t.to).toEqual([{ name: "P(Ich)", address: "P(ich@eigen.example)" }, { name: "", address: "P(zweite@kunde.example)" }]);
    expect(t.cc).toEqual([{ name: "P(Kai Kopie)", address: "P(kai@kunde.example)" }]);
    expect(t.attachments.map((a) => a.name)).toEqual(["P(rechnung-erika.pdf)", "P(logo.png)"]);
    expect(t.attachments.map((a) => a.key)).toEqual(["0:rechnung-erika.pdf", "cid1@x"]);
    expect(t.attachmentData).toBe(m.attachmentData);
    expect(t.id).toBe(m.id);
    expect(t.references).toEqual(m.references);
    expect(t.date).toBe(m.date);
  });

  it("die Anfrage: Aufrufer, Dokumentschluessel, interactive, Titel, stabile Teile-ids mit Art, Entitaeten aus dem Kopf", async () => {
    const { port, requests } = fakePort();
    await transformMail(mail(), profile(), port, { interactive: true });
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.caller).toBe("mailstone");
    expect(req.documentKey).toBe("a@example.org");
    expect(req.interactive).toBe(true);
    expect(req.title).toBe("Re: [Ticket#4711] Rechnung fuer Erika Muster");
    expect(req.parts).toEqual([
      { id: "body", kind: "text", value: bodyMarkdown(mail()) },
      { id: "subject", kind: "line", value: "Re: [Ticket#4711] Rechnung fuer Erika Muster" },
      { id: "from.name", kind: "line", value: "Erika Muster" },
      { id: "from.address", kind: "line", value: "erika@kunde.example" },
      { id: "to.0.name", kind: "line", value: "Ich" },
      { id: "to.0.address", kind: "line", value: "ich@eigen.example" },
      { id: "to.1.address", kind: "line", value: "zweite@kunde.example" },
      { id: "cc.0.name", kind: "line", value: "Kai Kopie" },
      { id: "cc.0.address", kind: "line", value: "kai@kunde.example" },
      { id: "attachment.0.name", kind: "filename", value: "rechnung-erika.pdf" },
      { id: "attachment.1.name", kind: "filename", value: "logo.png" },
    ]);
    expect(req.entities).toEqual([
      { name: "Erika Muster", email: "erika@kunde.example" },
      { name: "Ich", email: "ich@eigen.example" },
      { email: "zweite@kunde.example" },
      { name: "Kai Kopie", email: "kai@kunde.example" },
    ]);
  });

  it("interactive false wird so weitergereicht", async () => {
    const { port, requests } = fakePort();
    await transformMail(mail(), profile(), port, { interactive: false });
    expect(requests[0]!.interactive).toBe(false);
  });

  it("keep: eigene Adressen und das Vorgangs-Token der Original-Mail, ohne Doppelte", async () => {
    const { port, requests } = fakePort();
    await transformMail(mail(), profile("required", ["ich@eigen.example", "alias@eigen.example", "ich@eigen.example"]), port, { interactive: false });
    expect(requests[0]!.keep).toEqual(["ich@eigen.example", "alias@eigen.example", "[Ticket#4711]"]);
  });

  it("keep ohne eigene Adressen und ohne Token: leer", async () => {
    const { port, requests } = fakePort();
    const p = { ...defaultMailProfile(), pseudonymize: "if-available" as const, threadTokenPattern: "" };
    await transformMail(mail(), p, port, { interactive: false });
    expect(requests[0]!.keep ?? []).toEqual([]);
  });

  it("Mail ohne Absender, ohne Betreff, ohne Anhaenge: es gehen nur die vorhandenen Teile hinaus", async () => {
    const { port, requests } = fakePort();
    const r = await transformMail(mail({ from: null, subject: "", to: [], cc: [], attachments: [] }), profile(), port, { interactive: false });
    expect(requests[0]!.parts.map((p) => p.id)).toEqual(["body"]);
    expect(requests[0]!.title).toBeUndefined();
    expect(r.kind === "mail" && r.mail.from).toBeNull();
  });

  it("facts stammen aus dem Original: der Fake ersetzt Absender und Betreff durch Platzhalter, Richtung und Token bleiben die des Originals", async () => {
    const { port } = fakePort((id, v) => (id === "subject" ? "Person_x9" : id.startsWith("from.") ? "Person_k3" : v));
    const p = profile("required", ["erika@kunde.example"]);
    const m = mail();
    const r = await transformMail(m, p, port, { interactive: false });
    if (r.kind !== "mail") throw new Error("mail erwartet");
    expect(r.mail.subject).toBe("Person_x9");
    expect(r.mail.from?.address).toBe("Person_k3");
    // Aus dem transformierten Mail liessen sich weder Richtung noch Token ableiten ...
    expect(originalFactsOf(r.mail, p)).toEqual({ direction: "eingehend", threadToken: null });
    // ... die Fakten des Ergebnisses sind die des Originals.
    expect(r.facts).toEqual({ direction: "ausgehend", threadToken: "[Ticket#4711]" });
    expect(r.facts).toEqual(originalFactsOf(m, p));
  });

  it("die Fakten werden VOR dem Transformer bestimmt: ein Port, der die Mail-Felder im Aufruf veraendert, aendert sie nicht", async () => {
    const m = mail();
    const p = profile("required", ["erika@kunde.example"]);
    // Ein Port, der das Eingabeobjekt mutiert, bevor er antwortet: die Fakten duerfen davon nicht beruehrt sein.
    const port = (req: TransformRequest): Promise<PortOutcome> => {
      m.from = { name: "Person_x", address: "Person_x_Mail" };
      m.subject = "Person_y";
      return Promise.resolve({ kind: "pseudonymized", result: { parts: req.parts.map((x) => ({ id: x.id, value: x.value })), entities: [], applied: 0 } });
    };
    const r = await transformMail(m, p, port, { interactive: false });
    if (r.kind !== "mail") throw new Error("mail erwartet");
    expect(r.facts).toEqual({ direction: "ausgehend", threadToken: "[Ticket#4711]" });
  });
});

describe("transformMail — die anderen Zweige", () => {
  it("off: der Port wird gar nicht gerufen, Mail und Fakten unveraendert", async () => {
    let calls = 0;
    const port = (): Promise<PortOutcome> => { calls += 1; return Promise.resolve({ kind: "plain", reason: "off" }); };
    const m = mail();
    const r = await transformMail(m, profile("off"), port, { interactive: true });
    expect(calls).toBe(0);
    expect(r).toEqual({ kind: "mail", mail: m, facts: originalFactsOf(m, profile("off")) });
    expect(r.kind === "mail" && r.mail).toBe(m);
  });

  it("plain (Wenn verfuegbar, Plugin fehlt): die Original-Mail und ihre Fakten, unveraendert", async () => {
    const m = mail();
    const r = await transformMail(m, profile("if-available"), fixed({ kind: "plain", reason: "absent" }).port, { interactive: false });
    expect(r.kind).toBe("mail");
    if (r.kind !== "mail") return;
    expect(r.mail).toBe(m);
    expect(r.mail.html).toBeNull();
    expect(r.facts).toEqual(originalFactsOf(m, profile("if-available")));
  });

  it("wait: Grund und Meldung kommen als Wert zurueck, es gibt keine Mail", async () => {
    const r = await transformMail(mail(), profile("required"), fixed({ kind: "wait", reason: "absent", message: "Das Plugin pseudonymizer fehlt oder ist abgeschaltet." }).port, { interactive: false });
    expect(r).toEqual({ kind: "wait", reason: "absent", message: "Das Plugin pseudonymizer fehlt oder ist abgeschaltet." });
  });

  it("error: Grund und Meldung kommen als Wert zurueck", async () => {
    const r = await transformMail(mail(), profile(), fixed({ kind: "error", reason: "invalid-input", message: "kaputt" }).port, { interactive: false });
    expect(r).toEqual({ kind: "error", reason: "invalid-input", message: "kaputt" });
  });

  it("ein Port, der wirft, wird zu error/threw (der Aufruf wirft nie)", async () => {
    const r = await transformMail(mail(), profile(), () => Promise.reject(new Error("boom")), { interactive: false });
    expect(r).toEqual({ kind: "error", reason: "threw", message: "boom" });
  });

  it("ein Ergebnis, dem ein Teil fehlt, ist error/incomplete (alles oder nichts), nie eine halbe Mail", async () => {
    const port = (req: TransformRequest): Promise<PortOutcome> =>
      Promise.resolve({ kind: "pseudonymized", result: { parts: req.parts.filter((p) => p.id !== "subject").map((p) => ({ id: p.id, value: "x" })), entities: [], applied: 1 } });
    const r = await transformMail(mail(), profile(), port, { interactive: false });
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.reason).toBe("incomplete");
  });

  it("eine unbekannte Ausgangsart eines spaeteren Kits ist error, nie ein stilles Durchlassen", async () => {
    const r = await transformMail(mail(), profile(), () => Promise.resolve({ kind: "irgendwas" } as unknown as PortOutcome), { interactive: false });
    expect(r.kind).toBe("error");
  });
});

describe("transformWith — der Riegel gegen gesperrte Felder", () => {
  const rebuildChanging = (patch: (m: ParsedMail) => Partial<ParsedMail>) => (m: ParsedMail, r: TransformResult) => ({ ...rebuildMail(m, r)!, ...patch(m) });
  const run = (rebuild: Parameters<typeof transformWith>[4]) => transformWith(mail(), profile(), fakePort().port, { interactive: false }, rebuild);

  it("ein Wiederaufbau, der die id aendert, ist error/locked-fields; die Mail wird nicht herausgegeben", async () => {
    const r = await run(rebuildChanging(() => ({ id: "Person_x@example.org" })));
    expect(r).toEqual({ kind: "error", reason: "locked-fields", message: expect.stringContaining("id") });
  });
  it.each([
    ["messageIdRaw", () => ({ messageIdRaw: "<Person_x>" })],
    ["inReplyTo", () => ({ inReplyTo: null })],
    ["references", () => ({ references: [] })],
    ["attachments[].key", (m: ParsedMail) => ({ attachments: m.attachments.map((a, i) => (i === 0 ? { ...a, key: "0:Datei_x" } : a)) })],
    ["attachments.order", (m: ParsedMail) => ({ attachments: [...m.attachments].reverse() })],
  ] as const)("%s wird genannt", async (name, patch) => {
    const r = await run(rebuildChanging(patch));
    expect(r.kind).toBe("error");
    expect(r.kind === "error" && r.reason).toBe("locked-fields");
    expect(r.kind === "error" && r.message).toContain(name);
  });
  it("der echte Wiederaufbau laesst alle gesperrten Felder unveraendert (kein Fehlalarm)", async () => {
    const r = await run(rebuildMail);
    expect(r.kind).toBe("mail");
  });
});
