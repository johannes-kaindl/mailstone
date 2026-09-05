import { describe, it, expect } from "vitest";
import { attachmentLink, insertAttachmentLink, EXTRACT_ATTACHMENT_COMMAND } from "../../../src/core/commands/extract";
import { schemaOf, type CommandContext } from "../../../src/core/commands/types";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { ParsedMail } from "../../../src/core/mime/types";

const profile = defaultMailProfile();
const NOW = new Date("2026-08-30T22:00:00Z");
const NOTE = "---\nmail_id: a@x\nattachments:\n  - \"einladung.ics (text/calendar, 2.8 KB)\"\n---\n## Notizen\n\n%% mailstone:begin %%\n## Nachricht\nHallo\n%% mailstone:end %%\n";

function mail(): ParsedMail {
  return {
    id: "a@x", messageIdRaw: "<a@x>", inReplyTo: null, references: [],
    from: { name: "E", address: "e@example.org" }, to: [], cc: [],
    subject: "Termin", date: new Date("2026-08-29T08:00:00Z"), text: "Hallo", html: null,
    attachments: [
      { name: "einladung.ics", type: "text/calendar", size: 2800, inline: false, key: "0:einladung.ics" },
      { name: "logo.png", type: "image/png", size: 100, contentId: "logo@cid", inline: true, key: "logo@cid" },
    ],
    attachmentData: new Map([["0:einladung.ics", new Uint8Array([66, 69])], ["logo@cid", new Uint8Array([1])]]),
    rawSize: 3000,
  };
}

/** Zwei NICHT-inline Anhaenge mit demselben Dateinamen, aber verschiedenem key — der Fall aus
 *  Fund 1 der M3b-Nachlese: eine weitergeleitete Mail mit zwei "invoice.pdf". */
function mailWithDuplicateAttachments(): ParsedMail {
  return {
    id: "a@x", messageIdRaw: "<a@x>", inReplyTo: null, references: [],
    from: { name: "E", address: "e@example.org" }, to: [], cc: [],
    subject: "Zwei Rechnungen", date: new Date("2026-08-29T08:00:00Z"), text: "Hallo", html: null,
    attachments: [
      { name: "invoice.pdf", type: "application/pdf", size: 2, inline: false, key: "0:invoice.pdf" },
      { name: "invoice.pdf", type: "application/pdf", size: 2, inline: false, key: "1:invoice.pdf" },
    ],
    attachmentData: new Map([
      ["0:invoice.pdf", new Uint8Array([1, 1])],
      ["1:invoice.pdf", new Uint8Array([2, 2])],
    ]),
    rawSize: 500,
  };
}

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    now: NOW, profile,
    target: { mailId: "a@x", path: "Mail/2026/x.md", source: "acc/Vault", state: "live" },
    content: NOTE,
    frontmatter: { mail_id: "a@x", attachments: ["einladung.ics (text/calendar, 2.8 KB)"] },
    zoneHash: "gespeichert",
    linkFor: () => null,
    attachmentPathFor: (n) => `Anhaenge/${n}`,
    existingAttachment: () => null,
    mail: mail(),
    ...over,
  };
}

describe("attachmentLink", () => {
  it("bettet Bilder ein", () => {
    expect(attachmentLink("Anhaenge/b.png", "image/png")).toBe("![[Anhaenge/b.png]]");
  });
  it("bettet PDFs ein", () => {
    expect(attachmentLink("Anhaenge/b.pdf", "application/pdf")).toBe("![[Anhaenge/b.pdf]]");
  });
  it("verlinkt alles andere ohne Einbettung", () => {
    expect(attachmentLink("Anhaenge/b.ics", "text/calendar")).toBe("[[Anhaenge/b.ics]]");
  });
});

describe("insertAttachmentLink", () => {
  it("setzt den Link VOR die verwaltete Zone", () => {
    const r = insertAttachmentLink(NOTE, "[[Anhaenge/einladung.ics]]");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.indexOf("[[Anhaenge/einladung.ics]]")).toBeLessThan(r.content.indexOf("%% mailstone:begin %%"));
    expect(r.content.slice(r.content.indexOf("%% mailstone:begin %%"))).toBe(NOTE.slice(NOTE.indexOf("%% mailstone:begin %%")));
  });
  it("meldet fences-missing ohne Zone", () => {
    expect(insertAttachmentLink("---\nmail_id: a@x\n---\ntext", "[[x]]")).toEqual({ ok: false, code: "fences-missing" });
  });
  it("meldet nothing-to-do, wenn genau dieser Link schon dasteht", () => {
    const einmal = insertAttachmentLink(NOTE, "[[Anhaenge/einladung.ics]]");
    expect(einmal.ok && insertAttachmentLink(einmal.content, "[[Anhaenge/einladung.ics]]")).toEqual({ ok: false, code: "nothing-to-do" });
  });
});

describe("mail.extractAttachment", () => {
  it("ist anwendbar, wenn das Frontmatter Anhaenge fuehrt — ohne die .eml zu brauchen", () => {
    const ohneEml = ctx();
    delete ohneEml.mail;
    expect(EXTRACT_ATTACHMENT_COMMAND.appliesTo(ohneEml)).toBe(true);
  });

  it("ist nicht anwendbar ohne Anhaenge im Frontmatter", () => {
    expect(EXTRACT_ATTACHMENT_COMMAND.appliesTo(ctx({ frontmatter: { mail_id: "a@x", attachments: [] } }))).toBe(false);
  });

  it("bietet im Schema nur die NICHT-inline Anhaenge an", () => {
    const schema = schemaOf(EXTRACT_ATTACHMENT_COMMAND, ctx());
    expect(schema.properties["name"]).toMatchObject({ type: "string", enum: ["einladung.ics"] });
    expect(schema.required).toEqual(["name"]);
  });

  it("plant Datei plus Notiz-Update", () => {
    const r = EXTRACT_ATTACHMENT_COMMAND.plan({ name: "einladung.ics" }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.attachment).toEqual({ path: "Anhaenge/einladung.ics", data: new Uint8Array([66, 69]) });
    expect(r.plan.notes[0]).toMatchObject({ kind: "update", path: "Mail/2026/x.md", zoneHash: "gespeichert", expectedContent: NOTE });
  });

  it("weist einen Namen ab, der nicht in der Mail steckt", () => {
    expect(EXTRACT_ATTACHMENT_COMMAND.plan({ name: "erfunden.pdf" }, ctx())).toEqual({ ok: false, code: "invalid-input" });
  });

  it("meldet attachment-missing, wenn zum Namen keine Bytes vorliegen", () => {
    const m = mail();
    m.attachmentData.delete("0:einladung.ics");
    expect(EXTRACT_ATTACHMENT_COMMAND.plan({ name: "einladung.ics" }, ctx({ mail: m }))).toEqual({ ok: false, code: "attachment-missing" });
  });

  it("meldet eml-missing ohne geladene .eml", () => {
    const c = ctx();
    delete c.mail;
    expect(EXTRACT_ATTACHMENT_COMMAND.plan({ name: "einladung.ics" }, c)).toEqual({ ok: false, code: "eml-missing" });
  });

  it("verwendet fmKeyFor statt eines fest verdrahteten \"attachments\" — respektiert ein umbenanntes Feld", () => {
    const custom = { ...profile, fields: { ...profile.fields, attachments: "anhaenge" } };
    const probeCtx = ctx({ profile: custom, frontmatter: { mail_id: "a@x", anhaenge: ["x.pdf"] } });
    expect(EXTRACT_ATTACHMENT_COMMAND.appliesTo(probeCtx)).toBe(true);
  });

  it("ist nicht anwendbar, wenn das Attachments-Feld im Profil abgeschaltet ist (null)", () => {
    const disabled = { ...profile, fields: { ...profile.fields, attachments: null } };
    const probeCtx = ctx({ profile: disabled, frontmatter: { mail_id: "a@x", attachments: ["x.pdf"] } });
    expect(EXTRACT_ATTACHMENT_COMMAND.appliesTo(probeCtx)).toBe(false);
  });

  describe("zwei Anhaenge mit demselben Dateinamen (Fund 1, M3b-Nachlese)", () => {
    it("zeigt sie im Enum als unterscheidbare Labels", () => {
      const schema = schemaOf(EXTRACT_ATTACHMENT_COMMAND, ctx({ mail: mailWithDuplicateAttachments() }));
      expect(schema.properties["name"]).toMatchObject({ type: "string", enum: ["invoice.pdf", "invoice.pdf (2)"] });
    });

    it("extrahiert fuer JEDE Auswahl die EIGENEN Bytes, nicht die des jeweils anderen Anhangs", () => {
      const c = ctx({ mail: mailWithDuplicateAttachments() });
      const erste = EXTRACT_ATTACHMENT_COMMAND.plan({ name: "invoice.pdf" }, c);
      const zweite = EXTRACT_ATTACHMENT_COMMAND.plan({ name: "invoice.pdf (2)" }, c);
      expect(erste.ok).toBe(true);
      expect(zweite.ok).toBe(true);
      if (!erste.ok || !zweite.ok) return;
      expect(erste.plan.attachment?.data).toEqual(new Uint8Array([1, 1]));
      expect(zweite.plan.attachment?.data).toEqual(new Uint8Array([2, 2]));
    });
  });
});

describe("derselbe Anhang ein zweites Mal (M3b-Nachlese, entschieden 2026-09-05)", () => {
  const gleicheBytes = new Uint8Array([66, 69]);

  /** Zweiter Aufruf auf denselben Anhang: am unnummerierten Zielnamen liegt bereits eine Datei,
   *  und `getAvailablePathForAttachment` weicht deshalb auf " 1" aus. */
  function zweiterAufruf(over: Partial<CommandContext> = {}): CommandContext {
    return ctx({
      attachmentPathFor: () => "Anhaenge/einladung 1.ics",
      existingAttachment: () => ({ path: "Anhaenge/einladung.ics", data: gleicheBytes }),
      ...over,
    });
  }

  it("verlinkt die vorhandene Datei, statt eine byte-gleiche Kopie zu schreiben", () => {
    const r = EXTRACT_ATTACHMENT_COMMAND.plan({ name: "einladung.ics" }, zweiterAufruf());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.attachment).toBeUndefined();
    expect(r.plan.diff).toEqual([{ field: "attachment", after: "Anhaenge/einladung.ics" }]);
    const note = r.plan.notes[0];
    expect(note?.kind).toBe("update");
    if (note?.kind !== "update") return;
    expect(note.content).toContain("[[Anhaenge/einladung.ics]]");
    expect(note.content).not.toContain("einladung 1.ics");
  });

  it("meldet nothing-to-do, wenn der Link auf die vorhandene Datei schon steht", () => {
    const mitLink = insertAttachmentLink(NOTE, "[[Anhaenge/einladung.ics]]");
    expect(mitLink.ok).toBe(true);
    if (!mitLink.ok) return;
    expect(EXTRACT_ATTACHMENT_COMMAND.plan({ name: "einladung.ics" }, zweiterAufruf({ content: mitLink.content })))
      .toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("schreibt sehr wohl eine zweite Datei, wenn am Zielnamen ANDERE Bytes liegen", () => {
    // Der Fall, den ein Basename-Vergleich falsch abgewiesen haette: zwei gleichnamige, aber
    // verschiedene Anhaenge derselben Mail — der erste liegt schon im Vault.
    const c = ctx({
      mail: mailWithDuplicateAttachments(),
      frontmatter: { mail_id: "a@x", attachments: ["invoice.pdf", "invoice.pdf"] },
      attachmentPathFor: () => "Anhaenge/invoice 1.pdf",
      existingAttachment: () => ({ path: "Anhaenge/invoice.pdf", data: new Uint8Array([1, 1]) }),
    });
    const r = EXTRACT_ATTACHMENT_COMMAND.plan({ name: "invoice.pdf (2)" }, c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.attachment).toEqual({ path: "Anhaenge/invoice 1.pdf", data: new Uint8Array([2, 2]) });
  });
});
