import { describe, it, expect } from "vitest";
import { replySubject, buildMailtoUrl, REPLY_EXTERNAL_COMMAND } from "../../../src/core/commands/reply";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { CommandContext } from "../../../src/core/commands/types";
import { fakeRestorePort, GONE, GONE_MAIL, MAIL, NAME, NAME_2 } from "../../helpers/restore-port";

const profile = defaultMailProfile();

function ctx(fm: Record<string, unknown>, mailId = "a@x"): CommandContext {
  return {
    now: new Date("2026-08-30T22:00:00Z"), profile,
    target: { mailId, path: "Mail/2026/x.md", source: "acc/Vault", state: "live" },
    content: "", frontmatter: { mail_id: mailId, ...fm }, zoneHash: null,
    linkFor: () => null, attachmentPathFor: (n) => `Anhaenge/${n}`, existingAttachment: () => null,
  };
}

describe("replySubject", () => {
  it("stellt Re: voran", () => {
    expect(replySubject("Quartalsreview")).toBe("Re: Quartalsreview");
  });
  it("verdoppelt ein vorhandenes Re: nicht", () => {
    expect(replySubject("Re: Quartalsreview")).toBe("Re: Quartalsreview");
  });
  it("erkennt auch das deutsche AW:", () => {
    expect(replySubject("AW: Quartalsreview")).toBe("AW: Quartalsreview");
  });
  it("behandelt einen leeren Betreff", () => {
    expect(replySubject("")).toBe("Re:");
  });
});

describe("buildMailtoUrl", () => {
  it("baut Adresse, Betreff und In-Reply-To", () => {
    expect(buildMailtoUrl({ to: "erika@example.org", subject: "Termin", inReplyTo: "a@x" }))
      .toBe("mailto:erika@example.org?subject=Re%3A%20Termin&in-reply-to=%3Ca%40x%3E");
  });
  it("laesst das @ der Adresse unkodiert", () => {
    expect(buildMailtoUrl({ to: "a+b@example.org", subject: "x", inReplyTo: null })).toContain("mailto:a%2Bb@example.org");
  });
  it("laesst In-Reply-To weg, wenn es keine gibt", () => {
    expect(buildMailtoUrl({ to: "a@x.org", subject: "x", inReplyTo: null })).not.toContain("in-reply-to");
  });
});

describe("mail.replyExternal", () => {
  it("ist anwendbar, wenn from eine Adresse traegt", () => {
    expect(REPLY_EXTERNAL_COMMAND.appliesTo(ctx({ from: "Erika <erika@example.org>" }))).toBe(true);
  });
  it("ist nicht anwendbar ohne Absender", () => {
    expect(REPLY_EXTERNAL_COMMAND.appliesTo(ctx({ from: "" }))).toBe(false);
  });
  it("braucht weder .eml noch alle Notizen", () => {
    expect(REPLY_EXTERNAL_COMMAND.needs).toBeUndefined();
  });
  it("plant eine URL und keinen einzigen Schreibvorgang", () => {
    const r = REPLY_EXTERNAL_COMMAND.plan({}, ctx({ from: "Erika <erika@example.org>", subject: "Termin" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.notes).toEqual([]);
    expect(r.plan.openUrl).toBe("mailto:erika@example.org?subject=Re%3A%20Termin&in-reply-to=%3Ca%40x%3E");
  });
  it("nimmt die eigene mail_id als In-Reply-To, nicht das Feld in_reply_to", () => {
    const r = REPLY_EXTERNAL_COMMAND.plan({}, ctx({ from: "e@example.org", subject: "T", in_reply_to: "vorgaenger@x" }));
    expect(r.ok && r.plan.openUrl).toContain("in-reply-to=%3Ca%40x%3E");
  });
  it("laesst In-Reply-To bei einer Ersatz-ID weg", () => {
    const r = REPLY_EXTERNAL_COMMAND.plan({}, ctx({ from: "e@example.org", subject: "T" }, "noid-9f2c"));
    expect(r.ok && r.plan.openUrl).not.toContain("in-reply-to");
  });
  it("meldet no-recipient, wenn die Absenderzeile keine Adresse enthaelt", () => {
    expect(REPLY_EXTERNAL_COMMAND.plan({}, ctx({ from: "Erika ohne Adresse" }))).toEqual({ ok: false, code: "no-recipient" });
  });
});

// A5, Schritt 5: in einer pseudonymisierten Notiz steht in `from` "Person_… <Person_…_Mail>"; `addressOf` findet dort kein `@`. Die Antwort wandelt
// Empfaenger und Betreff zurueck, bevor die mailto:-URL entsteht; ein Platzhalter, der sich nicht aufloesen laesst, oeffnet nichts.
describe("mail.replyExternal: Rueckwandlung (A5, Schritt 5)", () => {
  const mitPort = (fm: Record<string, unknown>, restore = fakeRestorePort(), mailId = "a@x"): CommandContext => ({ ...ctx(fm, mailId), restore });

  it("ist auch fuer eine Absenderzeile aus Platzhaltern anwendbar (kein @ vor der Rueckwandlung)", () => {
    expect(REPLY_EXTERNAL_COMMAND.appliesTo(ctx({ from: `${NAME} <${MAIL}>` }))).toBe(true);
  });
  it("GEGENPROBE: eine Zeile ohne Adresse und ohne Platzhalter bleibt nicht anwendbar", () => {
    expect(REPLY_EXTERNAL_COMMAND.appliesTo(ctx({ from: "Erika ohne Adresse" }))).toBe(false);
  });

  it("release: Empfaenger und Betreff der URL sind Klartext", () => {
    const r = REPLY_EXTERNAL_COMMAND.plan({}, mitPort({ from: `${NAME} <${MAIL}>`, subject: `Termin ${NAME_2}` }));
    expect(r.ok && r.plan.openUrl).toBe("mailto:gast@example.org?subject=Re%3A%20Termin%20Max&in-reply-to=%3Ca%40x%3E");
    expect(r.ok && r.plan.summaryArgs).toEqual(["gast@example.org"]);
  });

  it("hold (unbekannter Platzhalter im Betreff): keine URL, restore-held", () => {
    const r = REPLY_EXTERNAL_COMMAND.plan({}, mitPort({ from: `${NAME} <${MAIL}>`, subject: "Person_aaaaaaaaaa" }));
    expect(r).toEqual({ ok: false, code: "restore-held" });
  });
  it("hold (Plugin fehlt) bei Platzhalter-Absender: keine URL", () => {
    expect(REPLY_EXTERNAL_COMMAND.plan({}, mitPort({ from: `${NAME} <${MAIL}>` }, fakeRestorePort({ absent: true })))).toEqual({ ok: false, code: "restore-held" });
  });
  it("ein vergessener Platzhalter im Absender (wird zur Adresse): Fehler, keine URL", () => {
    expect(REPLY_EXTERNAL_COMMAND.plan({}, mitPort({ from: `${GONE} <${GONE_MAIL}>` }, fakeRestorePort({ gone: [GONE, GONE_MAIL] })))).toEqual({ ok: false, code: "restore-held" });
  });
  it("ein vergessener Platzhalter im Betreff geht als Platzhalter in die URL", () => {
    const r = REPLY_EXTERNAL_COMMAND.plan({}, mitPort({ from: "e@example.org", subject: `Hallo ${GONE}` }, fakeRestorePort({ gone: [GONE] })));
    expect(r.ok && r.plan.openUrl).toContain(`Re%3A%20Hallo%20${GONE}`);
  });
  it("nach der Rueckwandlung ohne @ (Name statt Adresse): keine URL", () => {
    expect(REPLY_EXTERNAL_COMMAND.plan({}, mitPort({ from: NAME }))).toEqual({ ok: false, code: "restore-held" });
  });
  it("ohne Port bleibt eine Zeile ohne Adresse no-recipient, mit Platzhaltern restore-held", () => {
    expect(REPLY_EXTERNAL_COMMAND.plan({}, ctx({ from: "Erika ohne Adresse" }))).toEqual({ ok: false, code: "no-recipient" });
    expect(REPLY_EXTERNAL_COMMAND.plan({}, ctx({ from: `${NAME} <${MAIL}>` }))).toEqual({ ok: false, code: "restore-held" });
  });
  it("Aus ohne Platzhalter: die URL ist byte-gleich zu heute, auch mit Port", () => {
    const r = REPLY_EXTERNAL_COMMAND.plan({}, mitPort({ from: "Erika <erika@example.org>", subject: "Termin" }));
    expect(r.ok && r.plan.openUrl).toBe("mailto:erika@example.org?subject=Re%3A%20Termin&in-reply-to=%3Ca%40x%3E");
  });
});
