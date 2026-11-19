import { describe, it, expect, vi } from "vitest";
import { mailTargetFor, buildContext, runCommand } from "../../src/obsidian/command-flow";

// Die Modale sind in dieser Datei nur daran interessant, OB sie aufgehen — der Fall unten ist
// gerade der, in dem keines aufgehen darf.
const { formularGeoeffnet, vorschauGeoeffnet } = vi.hoisted(() => ({ formularGeoeffnet: vi.fn(), vorschauGeoeffnet: vi.fn() }));
vi.mock("../../src/obsidian/modals/schema-form-modal", () => ({
  SchemaFormModal: class {
    constructor() { formularGeoeffnet(); }
    async pick(): Promise<null> { return null; }
  },
}));
vi.mock("../../src/obsidian/modals/plan-preview-modal", () => ({
  PlanPreviewModal: class {
    constructor() { vorschauGeoeffnet(); }
    async confirm(): Promise<boolean> { return false; }
  },
}));
import { makeApp } from "../helpers/memory-vault";
import { loadFixture } from "../helpers/fixtures";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { RERENDER_COMMAND } from "../../src/core/commands/rerender";
import { RELINK_COMMAND } from "../../src/core/commands/relink";
import { REMOVE_EML_COMMAND } from "../../src/core/commands/remove-eml";
import { EXTRACT_ATTACHMENT_COMMAND } from "../../src/core/commands/extract";
import type { PortOutcome, TransformPort } from "../../src/core/transform/transform-mail";
import { noMailText } from "../../src/obsidian/transform-text";
import { initI18n } from "../../src/i18n/strings";

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

  it("meldet original-desktop-only, wenn nichts am Konventionspfad liegt und es keinen Abruf gibt (Mobile)", async () => {
    const app = makeApp();
    await app.vault.create("Mail/2026/x.md", `---\nmail_id: a@x\n---\n${ZONE}`);
    const r = await buildContext(deps(app), RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r).toEqual({ ok: false, code: "original-desktop-only" });
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

  it("wirft bei einem Anhangnamen, den die .eml gar nicht kennt", async () => {
    // Frueher fiel `attachmentPathFor` hier auf den nackten Dateinamen zurueck — die Anlage waere
    // in die VAULT-WURZEL geschrieben worden, statt in den Anhangordner. Heute unerreichbar (der
    // Name kommt immer aus `nonInlineAttachments`), aber es ist derselbe stille Fehlwert, den der
    // Guard eine Zeile darueber schon ausschliesst.
    const app = await vaultMitAnhang();
    const r = await buildContext(deps(app), EXTRACT_ATTACHMENT_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => r.ctx.attachmentPathFor("gibtsnicht.pdf")).toThrow(/gibtsnicht\.pdf/);
    expect(() => r.ctx.existingAttachment("gibtsnicht.pdf")).not.toThrow(); // "nichts vorhanden" ist hier die WAHRE Antwort
  });

  it("liefert null, wenn am Zielnamen noch nichts liegt", async () => {
    const app = await vaultMitAnhang();
    const r = await buildContext(deps(app), EXTRACT_ATTACHMENT_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ctx.existingAttachment("a.txt")).toBeNull();
  });
});

// A6 (Welle 36): ohne brauchbare .eml neben der Notiz holt buildContext das Original vom Server.
describe("buildContext: Rueckfall auf das Original vom Server", () => {
  const bytes = new TextEncoder().encode(EML);
  const ok = { ok: true as const, bytes };
  const fileOf = (app: Awaited<ReturnType<typeof vaultWithNote>>) => app.vault.getAbstractFileByPath("Mail/2026/x.md");
  async function ohneEml() {
    const app = makeApp();
    await app.vault.create("Mail/2026/x.md", `---\nmail_id: a@x\nmail_source: acc/Vault\nmail_state: live\n---\n## Notizen\n\n${ZONE}`);
    return app;
  }

  it("ruft den Abruf mit Message-ID und mail_source, wenn die .eml fehlt, und baut den Kontext aus den Bytes", async () => {
    const app = await ohneEml();
    const fetchOriginal = vi.fn(async () => ok);
    const r = await buildContext({ ...deps(app), fetchOriginal }, RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(fetchOriginal).toHaveBeenCalledWith({ mailId: "a@x", source: "acc/Vault" });
    expect(r.ok && r.ctx.mail?.id).toBe("a@x");
  });

  it("ruft den Abruf NICHT, wenn eine passende .eml daneben liegt", async () => {
    const app = await vaultWithNote();
    const fetchOriginal = vi.fn(async () => ok);
    await buildContext({ ...deps(app), fetchOriginal }, RERENDER_COMMAND, fileOf(app));
    expect(fetchOriginal).not.toHaveBeenCalled();
  });

  it("ruft ihn auch bei einer nicht passenden und bei einer unlesbaren .eml", async () => {
    const fremd = await vaultWithNote(EML.replace("<a@x>", "<fremd@x>"));
    const f1 = vi.fn(async () => ok);
    const r1 = await buildContext({ ...deps(fremd), fetchOriginal: f1 }, RERENDER_COMMAND, fileOf(fremd));
    expect(f1).toHaveBeenCalledTimes(1);
    expect(r1.ok).toBe(true);
    const kaputt = await vaultWithNote("");
    const f2 = vi.fn(async () => ok);
    const r2 = await buildContext({ ...deps(kaputt), fetchOriginal: f2 }, RERENDER_COMMAND, fileOf(kaputt));
    expect(f2).toHaveBeenCalledTimes(1);
    expect(r2.ok).toBe(true);
  });

  it("holt fuer den Anhang-Befehl genauso, und die Anhangpfade kommen aus dem geholten Original", async () => {
    const app = await ohneEml();
    const mitAnhang = new TextEncoder().encode(EML.replace("\r\n\r\nHallo\r\n", EML_ANHANG_TEIL));
    const r = await buildContext({ ...deps(app), fetchOriginal: async () => ({ ok: true, bytes: mitAnhang }) }, EXTRACT_ATTACHMENT_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok && r.ctx.attachmentPathFor("a.txt")).toBe("Anhaenge/a.txt");
  });

  it("schreibt das geholte Original nicht in den Vault", async () => {
    const app = await ohneEml();
    const spy = vi.spyOn(app.vault, "createBinary");
    await buildContext({ ...deps(app), fetchOriginal: async () => ok }, RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("reicht not-found mit der Ordnerliste und unsearchable als eigenen Code weiter", async () => {
    const app = await ohneEml();
    const f = app.vault.getAbstractFileByPath("Mail/2026/x.md");
    expect(await buildContext({ ...deps(app), fetchOriginal: async () => ({ ok: false, code: "original-not-found", detail: "Konto: Vault" }) }, RERENDER_COMMAND, f))
      .toEqual({ ok: false, code: "original-not-found", detail: "Konto: Vault" });
    expect(await buildContext({ ...deps(app), fetchOriginal: async () => ({ ok: false, code: "original-unsearchable", detail: "a@x" }) }, RERENDER_COMMAND, f))
      .toEqual({ ok: false, code: "original-unsearchable" });
  });

  it("reicht busy durch und laesst Netzfehler ihren Code und Text (error.sync.*) behalten", async () => {
    const app = await ohneEml();
    const f = app.vault.getAbstractFileByPath("Mail/2026/x.md");
    expect(await buildContext({ ...deps(app), fetchOriginal: async () => ({ ok: false, code: "busy", detail: "" }) }, RERENDER_COMMAND, f)).toEqual({ ok: false, code: "busy" });
    for (const code of ["auth", "connect", "timeout", "no-secret"] as const) {
      expect(await buildContext({ ...deps(app), fetchOriginal: async () => ({ ok: false, code, detail: "x" }) }, RERENDER_COMMAND, f), code)
        .toEqual({ ok: false, code: `error.sync.${code}` });
    }
  });

  it("behaelt bei einer schlechten lokalen .eml deren Code, wenn der Server auch nichts liefert oder nicht gefragt werden kann", async () => {
    const fremd = await vaultWithNote(EML.replace("<a@x>", "<fremd@x>"));
    const nichts = { ok: false as const, code: "original-not-found" as const, detail: "Konto: Vault" };
    expect(await buildContext({ ...deps(fremd), fetchOriginal: async () => nichts }, RERENDER_COMMAND, fileOf(fremd))).toEqual({ ok: false, code: "eml-mismatch" });
    expect(await buildContext(deps(fremd), RERENDER_COMMAND, fileOf(fremd))).toEqual({ ok: false, code: "eml-mismatch" });
    const kaputt = await vaultWithNote("");
    expect(await buildContext(deps(kaputt), RERENDER_COMMAND, fileOf(kaputt))).toMatchObject({ ok: false, code: expect.stringMatching(/^eml-(unparseable|mismatch)$/) });
    // Ein Netzfehler beim Rueckfall wird gemeldet, nicht von der lokalen Meldung ueberdeckt.
    const netz = await buildContext({ ...deps(fremd), fetchOriginal: async () => ({ ok: false, code: "auth", detail: "x" }) }, RERENDER_COMMAND, fileOf(fremd));
    expect(netz).toEqual({ ok: false, code: "error.sync.auth" });
  });

  it("ein geholtes Original mit anderer Message-ID wird als eml-mismatch abgelehnt", async () => {
    const app = await ohneEml();
    const falsch = new TextEncoder().encode(EML.replace("<a@x>", "<anders@x>"));
    expect(await buildContext({ ...deps(app), fetchOriginal: async () => ({ ok: true, bytes: falsch }) }, RERENDER_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md")))
      .toEqual({ ok: false, code: "eml-mismatch" });
  });
});

describe("buildContext: needs.emlProbe (mail.removeEml)", () => {
  const off = { ...defaultMailProfile(), saveEml: false };
  it("haengt je Notiz die Probe der .eml am Konventionspfad an und parst keine .eml", async () => {
    const app = await vaultWithNote();
    await app.vault.create("Mail/2026/y.md", `---\nmail_id: b@x\n---\n${ZONE}`);
    await app.vault.createBinary("Mail/2026/_eml/y.eml", new TextEncoder().encode(EML.replace("<a@x>", "<fremd@x>")).buffer);
    await app.vault.create("Mail/2026/z.md", `---\nmail_id: c@x\n---\n${ZONE}`);
    const fetchOriginal = vi.fn();
    const r = await buildContext({ ...deps(app), profile: () => off, fetchOriginal }, REMOVE_EML_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = Object.fromEntries((r.ctx.notes ?? []).map((n) => [n.mailId, n.eml]));
    expect(byId).toEqual({
      "a@x": { path: "Mail/2026/_eml/x.eml", status: "match" },
      "b@x": { path: "Mail/2026/_eml/y.eml", status: "mismatch" },
      "c@x": undefined,
    });
    // Das Kommando holt nie ein Original und braucht keine geparste .eml.
    expect(fetchOriginal).not.toHaveBeenCalled();
    expect(r.ctx.mail).toBeUndefined();
  });
  it("laedt die Probe NICHT fuer ein Kommando ohne needs.emlProbe (mail.relink)", async () => {
    const app = await vaultWithNote();
    const spy = vi.spyOn(app.vault, "readBinary");
    const r = await buildContext(deps(app), RELINK_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(spy).not.toHaveBeenCalled();
    expect(r.ok && r.ctx.notes?.[0]?.eml).toBeUndefined();
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

describe("runCommand: bei genau einer Option gibt es nichts zu fragen", () => {
  /** Notiz mit EINEM Anhang im Frontmatter, .eml mit genau diesem einen Anhang. */
  async function vaultMitEinemAnhang() {
    const app = makeApp();
    await app.vault.create("Mail/2026/x.md", `---\nmail_id: a@x\nmail_source: acc/Vault\nmail_state: live\nattachments:\n  - "a.txt (text/plain, 6 B)"\n---\n## Notizen\n\n${ZONE}`);
    await app.vault.createBinary("Mail/2026/_eml/x.eml", new TextEncoder().encode(EML.replace("\r\n\r\nHallo\r\n", EML_ANHANG_TEIL)).buffer);
    return app;
  }

  it("ueberspringt das Formular und geht direkt zur Vorschau", async () => {
    formularGeoeffnet.mockClear();
    vorschauGeoeffnet.mockClear();
    const app = await vaultMitEinemAnhang();
    const r = await runCommand(deps(app), {} as never, EXTRACT_ATTACHMENT_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));

    // Beide Aussagen zusammen tragen erst die Behauptung: „nicht geoeffnet" allein waere auch
    // wahr, wenn der Ablauf vorher abgebrochen haette — die Vorschau belegt, dass er WEITERGING.
    expect(formularGeoeffnet).not.toHaveBeenCalled();
    expect(vorschauGeoeffnet).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ kind: "cancelled" }); // die Vorschau-Attrappe lehnt ab
  });

  it("oeffnet es weiterhin, sobald es etwas zu waehlen gibt — zwei Anhaenge", async () => {
    // Der Waechter gegen die Ueberdehnung: die Bedingung fuer das Formular ist jetzt
    // `predeterminedInput`, nicht mehr „hat ueberhaupt Felder". Ohne diesen Punkt bliebe
    // unbelegt, dass der NORMALFALL noch fragt.
    formularGeoeffnet.mockClear();
    vorschauGeoeffnet.mockClear();
    // Echtes Multipart-Fixture statt zweier aneinandergehaengter Koepfe — die ergaeben kein
    // multipart/mixed, und der Parser saehe nur EINEN Anhang. Genau daran ist der erste Entwurf
    // dieses Pruefpunkts gescheitert: er war rot, und schuld war die Fixtur, nicht der Code.
    const app = makeApp();
    await app.vault.create("Mail/2026/x.md", `---\nmail_id: mixed-001@mail.example.org\nmail_source: acc/Vault\nmail_state: live\nattachments:\n  - "bericht.pdf (application/pdf, 5 B)"\n  - "notiz.txt (text/plain, 5 B)"\n---\n## Notizen\n\n${ZONE}`);
    await app.vault.createBinary("Mail/2026/_eml/x.eml", loadFixture("multipart-mixed-attachments").buffer as ArrayBuffer);

    const r = await runCommand(deps(app), {} as never, EXTRACT_ATTACHMENT_COMMAND, app.vault.getAbstractFileByPath("Mail/2026/x.md"));
    expect(formularGeoeffnet).toHaveBeenCalledTimes(1);
    expect(vorschauGeoeffnet).not.toHaveBeenCalled(); // die Formular-Attrappe bricht ab
    expect(r).toEqual({ kind: "cancelled" });
  });
});

// A5, Schritt 3: dieselbe Transformation nach jedem parseEml, auch im Kontext der Befehle (lokale .eml und Original vom Server).
describe("buildContext: Pseudonymisieren (A5)", () => {
  initI18n("de");
  const ersetze = (seen: boolean[] = []): TransformPort => (req) => {
    seen.push(req.interactive);
    return Promise.resolve<PortOutcome>({ kind: "pseudonymized", result: { parts: req.parts.map((p) => ({ id: p.id, value: p.id === "subject" ? "Person_x" : p.id.startsWith("from.name") ? "Person_k3" : p.id.startsWith("from.address") ? "Person_k3_Mail" : p.value })), entities: [], applied: 2 } });
  };
  const pseudo = (mode: "if-available" | "required" | "off") => ({ ...defaultMailProfile(), pseudonymize: mode, ownAddresses: ["erika@example.org"] });
  const fileOf = (app: Awaited<ReturnType<typeof vaultWithNote>>) => app.vault.getAbstractFileByPath("Mail/2026/x.md");

  it("Aus: der Port wird nie gerufen, kein facts im Kontext", async () => {
    const app = await vaultWithNote();
    let calls = 0;
    const r = await buildContext({ ...deps(app), profile: () => pseudo("off"), pseudonymize: () => { calls += 1; return ersetze()({} as never); } }, RERENDER_COMMAND, fileOf(app));
    expect(calls).toBe(0);
    expect(r.ok && r.ctx.facts).toBeUndefined();
    expect(r.ok && r.ctx.mail?.subject).toBe("Termin");
  });

  it("lokale .eml: der Kontext traegt die transformierte Mail und die Fakten des Originals; interactive ist true", async () => {
    const app = await vaultWithNote();
    const seen: boolean[] = [];
    const r = await buildContext({ ...deps(app), profile: () => pseudo("required"), pseudonymize: ersetze(seen) }, RERENDER_COMMAND, fileOf(app));
    expect(seen).toEqual([true]);
    expect(r.ok && r.ctx.mail?.subject).toBe("Person_x");
    expect(r.ok && r.ctx.mail?.id).toBe("a@x");
    expect(r.ok && r.ctx.facts).toEqual({ direction: "ausgehend", threadToken: null });
  });

  it("Original vom Server: dieselbe Transformation", async () => {
    const app = makeApp();
    await app.vault.create("Mail/2026/x.md", `---\nmail_id: a@x\nmail_source: acc/Vault\nmail_state: live\n---\n## Notizen\n\n${ZONE}`);
    const r = await buildContext({ ...deps(app), profile: () => pseudo("required"), pseudonymize: ersetze(), fetchOriginal: async () => ({ ok: true, bytes: new TextEncoder().encode(EML) }) }, RERENDER_COMMAND, fileOf(app));
    expect(r.ok && r.ctx.mail?.subject).toBe("Person_x");
    expect(r.ok && r.ctx.facts?.direction).toBe("ausgehend");
  });

  it("wait: kein Kontext, ein Code mit Grund; die Notiz bleibt unberuehrt", async () => {
    const app = await vaultWithNote();
    const r = await buildContext({ ...deps(app), profile: () => pseudo("required"), pseudonymize: () => Promise.resolve({ kind: "wait", reason: "locked", message: "gesperrt" }) }, RERENDER_COMMAND, fileOf(app));
    expect(r).toEqual({ ok: false, code: "error.command.pseudonymize-wait", detail: noMailText({ kind: "wait", reason: "locked", message: "gesperrt" }) });
    expect(noMailText({ kind: "wait", reason: "locked", message: "gesperrt" })).not.toBe("gesperrt"); // bekannter Grund: der uebersetzte Text
    expect(noMailText({ kind: "wait", reason: "unbekannt-xyz", message: "Meldung des Plugins" })).toBe("Meldung des Plugins"); // unbekannter Grund: die Meldung selbst
  });

  it("error: kein Kontext, ein Code mit Grund", async () => {
    const app = await vaultWithNote();
    const r = await buildContext({ ...deps(app), profile: () => pseudo("if-available"), pseudonymize: () => Promise.resolve({ kind: "error", reason: "threw", message: "boom" }) }, RERENDER_COMMAND, fileOf(app));
    expect(r).toEqual({ ok: false, code: "error.command.pseudonymize-error", detail: noMailText({ kind: "error", reason: "threw", message: "boom" }) });
  });

  it("ein Schalter ungleich Aus ohne gebundenen Port liefert nie die Klartext-Mail", async () => {
    const app = await vaultWithNote();
    const r = await buildContext({ ...deps(app), profile: () => pseudo("if-available") }, RERENDER_COMMAND, fileOf(app));
    expect(r.ok).toBe(false);
  });

  it("ein Kommando ohne needs.eml ruft den Port nicht", async () => {
    const app = await vaultWithNote();
    let calls = 0;
    await buildContext({ ...deps(app), profile: () => pseudo("required"), pseudonymize: () => { calls += 1; return ersetze()({} as never); } }, RELINK_COMMAND, fileOf(app));
    expect(calls).toBe(0);
  });
});
