import { describe, it, expect, vi } from "vitest";
import { mailTargetFor, buildContext, runCommand } from "../../src/obsidian/command-flow";

// Die Modale sind in dieser Datei nur daran interessant, OB sie aufgehen — der Fall unten ist
// gerade der, in dem keines aufgehen darf.
const { formularGeoeffnet } = vi.hoisted(() => ({ formularGeoeffnet: vi.fn() }));
vi.mock("../../src/obsidian/modals/schema-form-modal", () => ({
  SchemaFormModal: class {
    constructor() { formularGeoeffnet(); }
    async pick(): Promise<null> { return null; }
  },
}));
import { makeApp } from "../helpers/memory-vault";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { RERENDER_COMMAND } from "../../src/core/commands/rerender";
import { RELINK_COMMAND } from "../../src/core/commands/relink";
import { EXTRACT_ATTACHMENT_COMMAND } from "../../src/core/commands/extract";

const profile = defaultMailProfile();
const ZONE = "%% mailstone:begin %%\n## Nachricht\nHallo\n%% mailstone:end %%\n";
const EML_ANHANG_TEIL = "\r\nContent-Type: text/plain; name=\"a.txt\"\r\nContent-Disposition: attachment; filename=\"a.txt\"\r\n\r\nInhalt\r\n";
const EML = "Message-ID: <a@x>\r\nFrom: Erika <erika@example.org>\r\nSubject: Termin\r\nDate: Sat, 29 Aug 2026 10:00:00 +0200\r\n\r\nHallo\r\n";

/** Dieselbe Notiz, aber die .eml traegt einen echten Anhang. */
function vaultMitAnhang() {
  return vaultWithNote(EML.replace("\r\n\r\nHallo\r\n", EML_ANHANG_TEIL));
}

async function vaultWithNote(emlBody = EML) {
  const app = makeApp();
  await app.vault.create("Mail/2026/x.md", `---\nmail_id: a@x\nmail_source: acc/Vault\nmail_state: live\n---\n## Notizen\n\n${ZONE}`);
  await app.vault.createBinary("Mail/2026/_eml/x.eml", new TextEncoder().encode(emlBody).buffer);
  return app;
}

function deps(app: unknown) {
  return {
    app: app as never,
    profile: () => profile,
    hashes: { get: () => null, set: () => {} },
    now: () => new Date("2026-08-30T22:00:00Z"),
  };
}

describe("mailTargetFor", () => {
  it("erkennt eine Mail-Notiz am idField", () => {
    expect(mailTargetFor(profile, "Mail/2026/x.md", { mail_id: "a@x", mail_source: "acc/Vault", mail_state: "live" }))
      .toEqual({ mailId: "a@x", path: "Mail/2026/x.md", source: "acc/Vault", state: "live" });
  });
  it("liefert null ohne mail_id", () => {
    expect(mailTargetFor(profile, "Notiz.md", { titel: "x" })).toBeNull();
  });
  it("vertraegt eine Notiz ohne Herkunft und ohne Zustand (Altbestand)", () => {
    expect(mailTargetFor(profile, "x.md", { mail_id: "a@x" })).toEqual({ mailId: "a@x", path: "x.md", source: "", state: null });
  });
});

describe("buildContext", () => {
  it("laedt und prueft die .eml fuer ein Kommando mit needs.eml", async () => {
    const app = await vaultWithNote();
    const r = await buildContext(deps(app), RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok).toBe(true);
    expect(r.ok && r.ctx.mail?.id).toBe("a@x");
  });

  it("meldet eml-missing, wenn am Konventionspfad nichts liegt", async () => {
    const app = makeApp();
    await app.vault.create("Mail/2026/x.md", `---\nmail_id: a@x\n---\n${ZONE}`);
    const r = await buildContext(deps(app), RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r).toEqual({ ok: false, code: "eml-missing" });
  });

  it("meldet eml-mismatch, wenn die .eml zu einer anderen Mail gehoert", async () => {
    const app = await vaultWithNote(EML.replace("<a@x>", "<fremd@x>"));
    const r = await buildContext(deps(app), RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r).toEqual({ ok: false, code: "eml-mismatch" });
  });

  it("laedt fuer needs.allNotes alle Mail-Notizen samt Frontmatter und Inhalt", async () => {
    const app = await vaultWithNote();
    await app.vault.create("Mail/2026/y.md", `---\nmail_id: b@x\n---\n${ZONE}`);
    const r = await buildContext(deps(app), RELINK_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok && r.ctx.notes?.map((n) => n.mailId).sort()).toEqual(["a@x", "b@x"]);
    expect(r.ok && r.ctx.notes?.[0]?.frontmatter["mail_id"]).toBeDefined();
  });

  it("laedt KEINE .eml fuer ein Kommando ohne needs.eml", async () => {
    const app = await vaultWithNote();
    const spy = vi.spyOn(app.vault, "readBinary");
    await buildContext(deps(app), RELINK_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("loest die Anhangpfade vorab auf, damit attachmentPathFor synchron bleibt", async () => {
    const app = await vaultMitAnhang();
    const r = await buildContext(deps(app), EXTRACT_ATTACHMENT_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok && r.ctx.attachmentPathFor("a.txt")).toBe("Anhaenge/a.txt");
  });

  it("loest sie NICHT fuer ein Kommando ohne needs.attachments — mail.rerender ruft attachmentPathFor nie", async () => {
    const app = await vaultMitAnhang();
    const spy = vi.spyOn(app.fileManager, "getAvailablePathForAttachment");
    await buildContext(deps(app), RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("reicht Pfad und Bytes einer am Zielnamen bereits liegenden Datei durch", async () => {
    const app = await vaultMitAnhang();
    await app.vault.createBinary("Anhaenge/a.txt", new TextEncoder().encode("alt").buffer);
    const r = await buildContext(deps(app), EXTRACT_ATTACHMENT_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Obsidian weicht auf " 1" aus — genau daran ist zu erkennen, dass am blanken Namen etwas liegt.
    expect(r.ctx.attachmentPathFor("a.txt")).toBe("Anhaenge/a 1.txt");
    expect(r.ctx.existingAttachment("a.txt")).toEqual({ path: "Anhaenge/a.txt", data: new TextEncoder().encode("alt") });
  });

  it("wirft, wenn ein Kommando ohne needs.attachments die Anhangzugriffe doch benutzt", async () => {
    // Sonst laege hier ein stiller Fehlwert: ein neues Kommando, das `needs.attachments` zu
    // deklarieren vergisst, bekaeme einen falschen Pfad und ein "nichts vorhanden" zurueck,
    // ohne dass irgendetwas auffiele.
    const app = await vaultMitAnhang();
    const r = await buildContext(deps(app), RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => r.ctx.attachmentPathFor("a.txt")).toThrow(/needs\.attachments/);
    expect(() => r.ctx.existingAttachment("a.txt")).toThrow(/needs\.attachments/);
  });

  it("liefert null, wenn am Zielnamen noch nichts liegt", async () => {
    const app = await vaultMitAnhang();
    const r = await buildContext(deps(app), EXTRACT_ATTACHMENT_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ctx.existingAttachment("a.txt")).toBeNull();
  });
});

describe("runCommand: ein Formular ohne waehlbare Option geht gar nicht erst auf", () => {
  // Der Frontmatter fuehrt einen Anhang, die .eml enthaelt keinen (hand-editierte Notiz,
  // ersetzte .eml). `appliesTo` sagt deshalb ja, das Enum ist aber leer — frueher erschien ein
  // Dropdown ohne Option, und jeder Absendeversuch scheiterte an `must be one of []`.
  async function vaultMitLuecke() {
    const app = makeApp();
    await app.vault.create("Mail/2026/x.md", `---\nmail_id: a@x\nmail_source: acc/Vault\nmail_state: live\nattachments:\n  - "weg.pdf (application/pdf, 1 KB)"\n---\n## Notizen\n\n${ZONE}`);
    await app.vault.createBinary("Mail/2026/_eml/x.eml", new TextEncoder().encode(EML).buffer);
    return app;
  }

  it("meldet no-choices, statt ein unbedienbares Formular zu zeigen", async () => {
    formularGeoeffnet.mockClear();
    const app = await vaultMitLuecke();
    const r = await runCommand(deps(app), {} as never, EXTRACT_ATTACHMENT_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r).toEqual({ kind: "error", code: "no-choices" });
    expect(formularGeoeffnet).not.toHaveBeenCalled();
  });
});
