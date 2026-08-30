import { describe, it, expect } from "vitest";
import { RERENDER_COMMAND } from "../../../src/core/commands/rerender";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import { buildDerivedFrontmatter } from "../../../src/core/render/frontmatter";
import { renderMessageBlock } from "../../../src/core/render/body";
import { newNote } from "../../../src/core/merge/merge";
import type { CommandContext } from "../../../src/core/commands/types";
import type { ParsedMail } from "../../../src/core/mime/types";

const profile = defaultMailProfile();
const NOW = new Date("2026-08-30T22:00:00Z");

function mail(over: Partial<ParsedMail> = {}): ParsedMail {
  return {
    id: "a@x", messageIdRaw: "<a@x>", inReplyTo: null, references: [],
    from: { name: "Erika", address: "erika@example.org" }, to: [], cc: [],
    subject: "Quartalsreview", date: new Date("2026-08-29T08:00:00Z"),
    text: "Hallo", html: null, attachments: [], attachmentData: new Map(), rawSize: 10,
    ...over,
  };
}

/** Baut eine Notiz so, wie der Sync sie angelegt haette — mit denselben Kern-Funktionen. */
function noteFor(m: ParsedMail, state: "live" | "detached" = "live", source = "acc/Vault") {
  const derived = buildDerivedFrontmatter(profile, { mail: m, source, state, syncedAt: NOW, linkFor: () => null });
  return newNote(derived, profile.onCreate, renderMessageBlock(m));
}

function ctxFor(m: ParsedMail, note: { content: string; zoneHash: string | null }, over: Partial<CommandContext> = {}): CommandContext {
  return {
    now: NOW, profile,
    target: { mailId: "a@x", path: "Mail/2026/x.md", source: "acc/Vault", state: "live" },
    content: note.content,
    frontmatter: { mail_id: "a@x", mail_source: "acc/Vault", mail_state: "live", subject: "Quartalsreview" },
    zoneHash: note.zoneHash,
    linkFor: () => null,
    attachmentPathFor: (n) => `Anhaenge/${n}`,
    mail: m,
    ...over,
  };
}

describe("mail.rerender", () => {
  it("ist anwendbar, sobald eine Mail-Notiz das Ziel ist", () => {
    const m = mail();
    expect(RERENDER_COMMAND.appliesTo(ctxFor(m, noteFor(m)))).toBe(true);
  });

  it("verlangt die .eml (needs.eml) und meldet eml-missing ohne sie", () => {
    const m = mail();
    expect(RERENDER_COMMAND.needs?.eml).toBe(true);
    const ctx = ctxFor(m, noteFor(m));
    delete ctx.mail;
    expect(RERENDER_COMMAND.plan({}, ctx)).toEqual({ ok: false, code: "eml-missing" });
  });

  it("plant ein update, wenn die .eml einen neuen Betreff traegt", () => {
    const alt = mail();
    const note = noteFor(alt);
    const neu = mail({ subject: "Quartalsreview (verschoben)" });
    const r = RERENDER_COMMAND.plan({}, ctxFor(neu, note));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.notes).toHaveLength(1);
    expect(r.plan.notes[0]).toMatchObject({ kind: "update", path: "Mail/2026/x.md", mailId: "a@x" });
    expect(r.plan.diff).toContainEqual({ field: "subject", before: "Quartalsreview", after: "Quartalsreview (verschoben)" });
  });

  it("laesst mail_state unveraendert — eine abgeloeste Notiz wird nicht wieder live", () => {
    const m = mail();
    const note = noteFor(m, "detached");
    const ctx = ctxFor(mail({ subject: "neu" }), note, {
      target: { mailId: "a@x", path: "Mail/2026/x.md", source: "acc/Vault", state: "detached" },
      frontmatter: { mail_id: "a@x", mail_source: "acc/Vault", mail_state: "detached" },
    });
    const r = RERENDER_COMMAND.plan({}, ctx);
    expect(r.ok && r.plan.notes[0]?.kind).toBe("update");
    expect(r.ok && (r.plan.notes[0] as { content: string }).content).toContain("mail_state: detached");
  });

  it("uebernimmt mail_source aus der Notiz, statt sie neu zu bestimmen", () => {
    const m = mail();
    const note = noteFor(m, "live", "zweitkonto/Vault");
    const ctx = ctxFor(mail({ subject: "neu" }), note, {
      target: { mailId: "a@x", path: "Mail/2026/x.md", source: "zweitkonto/Vault", state: "live" },
      frontmatter: { mail_id: "a@x", mail_source: "zweitkonto/Vault", mail_state: "live" },
    });
    const r = RERENDER_COMMAND.plan({}, ctx);
    expect(r.ok && (r.plan.notes[0] as { content: string }).content).toContain("mail_source: zweitkonto/Vault");
  });

  it("meldet zone-edited, wenn die Zone von Hand geaendert wurde", () => {
    const m = mail();
    const note = noteFor(m);
    const ctx = ctxFor(mail({ subject: "neu" }), note, { zoneHash: "fremder-hash" });
    expect(RERENDER_COMMAND.plan({}, ctx)).toEqual({ ok: false, code: "zone-edited" });
  });

  it("meldet fences-missing, wenn die verwaltete Zone fehlt", () => {
    const m = mail();
    const ctx = ctxFor(m, { content: "---\nmail_id: a@x\n---\nnur Text", zoneHash: null });
    expect(RERENDER_COMMAND.plan({}, ctx)).toEqual({ ok: false, code: "fences-missing" });
  });

  it("meldet nothing-to-do, wenn sich nichts geaendert hat", () => {
    const m = mail();
    expect(RERENDER_COMMAND.plan({}, ctxFor(m, noteFor(m)))).toEqual({ ok: false, code: "nothing-to-do" });
  });

  it("weist eine Eingabe zurueck, die das leere Schema nicht kennt", () => {
    const m = mail();
    expect(RERENDER_COMMAND.plan({ egal: 1 }, ctxFor(m, noteFor(m)))).toEqual({ ok: false, code: "invalid-input" });
  });
});
