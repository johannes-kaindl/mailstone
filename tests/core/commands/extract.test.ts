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
      { name: "einladung.ics", type: "text/calendar", size: 2800, inline: false },
      { name: "logo.png", type: "image/png", size: 100, contentId: "logo@cid", inline: true },
    ],
    attachmentData: new Map([["einladung.ics", new Uint8Array([66, 69])], ["logo@cid", new Uint8Array([1])]]),
    rawSize: 3000,
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
    expect(r.plan.notes[0]).toMatchObject({ kind: "update", path: "Mail/2026/x.md", zoneHash: "gespeichert" });
  });

  it("weist einen Namen ab, der nicht in der Mail steckt", () => {
    expect(EXTRACT_ATTACHMENT_COMMAND.plan({ name: "erfunden.pdf" }, ctx())).toEqual({ ok: false, code: "invalid-input" });
  });

  it("meldet attachment-missing, wenn zum Namen keine Bytes vorliegen", () => {
    const m = mail();
    m.attachmentData.delete("einladung.ics");
    expect(EXTRACT_ATTACHMENT_COMMAND.plan({ name: "einladung.ics" }, ctx({ mail: m }))).toEqual({ ok: false, code: "attachment-missing" });
  });

  it("meldet eml-missing ohne geladene .eml", () => {
    const c = ctx();
    delete c.mail;
    expect(EXTRACT_ATTACHMENT_COMMAND.plan({ name: "einladung.ics" }, c)).toEqual({ ok: false, code: "eml-missing" });
  });
});
