import { describe, it, expect } from "vitest";
import { importEmlFolder } from "../../src/obsidian/import-eml";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { makeApp } from "../helpers/memory-vault";
import { loadFixture } from "../helpers/fixtures";
import { parseEml } from "../../src/core/mime/parse";
import { mailFilename, mailFolder } from "../../src/core/render/filename";
import type { PortOutcome, TransformPort } from "../../src/core/transform/transform-mail";
import { createBusyGuard } from "../../src/vendor/code-kit/busy-guard";
import type { TransformRequest } from "../../src/vendor/kit/pseudonymizer-source";

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s.replace(/\n/g, "\r\n")).buffer as ArrayBuffer;
const eml = (id: string, extra: string): string =>
  `From: a@example.org\nTo: b@example.org\nSubject: Betreff ${id}\nDate: Tue, 19 Aug 2026 16:00:00 +0200\nMessage-ID: <${id}>\n${extra}MIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\n\nText\n`;

describe("importEmlFolder", () => {
  it("importiert alle .eml eines Vault-Ordners, zweiter Lauf ist idempotent", async () => {
    const app = makeApp();
    for (const f of ["utf8-plain", "thread-reply"]) await app.vault.createBinary(`Import/${f}.eml`, loadFixture(f).buffer);
    const hashes = new Map<string, string>();
    // Die beiden Laeufe stehen bewusst auf VERSCHIEDENEN Uhrzeiten: mit eingefrorener Zeit
    // waere die Idempotenz ein Testartefakt (mail_synced wuerde im Betrieb jeden Lauf
    // veraendern und damit jedes Mal einen Schreibvorgang ausloesen).
    let jetzt = new Date("2026-08-23T13:00:00Z");
    const deps = { app, profile: defaultMailProfile(), hashes: { get: (k: string) => hashes.get(k) ?? null, set: (k: string, v: string) => { hashes.set(k, v); } }, now: () => jetzt };
    const r1 = await importEmlFolder(deps, "Import");
    expect(r1.created).toBe(2); expect(r1.errors).toEqual([]);
    expect(await app.vault.adapter.exists("Mail/2026/2026-08-19-1432-hallo-welt.md")).toBe(true);
    expect(await app.vault.adapter.exists("Mail/2026/_eml/2026-08-19-1432-hallo-welt.eml")).toBe(true);
    const nachLauf1 = await app.vault.adapter.read("Mail/2026/2026-08-19-1432-hallo-welt.md");
    jetzt = new Date("2026-08-23T17:45:00Z");
    const r2 = await importEmlFolder(deps, "Import");
    expect(r2.created).toBe(0); expect(r2.skipped.every((p) => p.kind === "skip" && p.reason === "unchanged")).toBe(true);
    expect(await app.vault.adapter.read("Mail/2026/2026-08-19-1432-hallo-welt.md")).toBe(nachLauf1);
  });
  it("kaputte Datei landet in errors, Rest wird importiert", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/ok.eml", loadFixture("utf8-plain").buffer);
    await app.vault.createBinary("Import/leer.eml", new ArrayBuffer(0));
    const r = await importEmlFolder({ app, profile: defaultMailProfile(), hashes: { get: () => null, set: () => {} }, now: () => new Date(0) }, "Import");
    // leere Datei: parseEml liefert eine Mail ohne alles → wird als noid-Notiz angelegt ODER als Fehler gefuehrt; beides ok, aber kein Throw:
    expect(r.created).toBeGreaterThanOrEqual(1);
    expect(r.created + r.errors.length).toBe(2);
  });
  it("Ordnerangabe mit Schraegstrich am Ende, eine einzelne Datei als Angabe und ein Ordner mit gleichem Namensanfang (Kit folder-scope, self)", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", loadFixture("utf8-plain").buffer);
    await app.vault.createBinary("Import-Archiv/b.eml", loadFixture("thread-reply").buffer);
    const mk = () => ({ app, profile: defaultMailProfile(), hashes: { get: () => null, set: () => {} }, now: () => new Date(0) });
    const mitSlash = await importEmlFolder(mk(), "Import/");
    expect(mitSlash.created).toBe(1);
    const einzeln = await importEmlFolder(mk(), "Import-Archiv/b.eml");
    expect(einzeln.created).toBe(1);
  });
  it("ein leerer Ordnername importiert nichts, statt den ganzen Vault", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", loadFixture("utf8-plain").buffer);
    const r = await importEmlFolder({ app, profile: defaultMailProfile(), hashes: { get: () => null, set: () => {} }, now: () => new Date(0) }, "");
    expect(r.created + r.errors.length).toBe(0);
  });
  // B1 (Welle 36): Antwort und Bezugsmail im selben Import. Die Antwort liegt zuerst im Ordner;
  // die Bezugsmail weicht auf -2 aus, der Link der Antwort muss auf -2 zeigen.
  it("verlinkt die Bezugsmail desselben Imports, auch wenn die Antwort vor ihr kommt und die Bezugsmail ausweicht", async () => {
    const app = makeApp();
    const profile = defaultMailProfile();
    const aBytes = eml("a@example.org", "");
    await app.vault.createBinary("Import/1-antwort.eml", enc(eml("b@example.org", "In-Reply-To: <a@example.org>\nReferences: <a@example.org>\n")));
    await app.vault.createBinary("Import/2-bezug.eml", enc(aBytes));
    const a = await parseEml(new Uint8Array(enc(aBytes)));
    const base = `${mailFolder(profile, a)}/${mailFilename(profile, a)}`;
    await app.vault.create(`${base}.md`, "belegt");
    const r = await importEmlFolder({ app, profile, hashes: { get: () => null, set: () => {} }, now: () => new Date(0) }, "Import");
    expect(r.errors).toEqual([]);
    expect(r.created).toBe(2);
    expect(await app.vault.adapter.exists(`${base}-2.md`)).toBe(true);
    const antwort = (await app.vault.adapter.read(`${mailFolder(profile, a)}/${mailFilename(profile, { ...a, subject: "Betreff b@example.org" })}.md`)) as string;
    expect(antwort).toContain(`[[${base}-2]]`);
    const zeile = antwort.split("\n").find((l) => l.startsWith("in_reply_to:"));
    expect(zeile).toContain(`[[${base}-2]]`);
    expect(zeile).not.toContain(`[[${base}]]`);
  });
  it("eine Mail, die ihre eigene ID in References traegt, verlinkt im Import nicht auf sich selbst", async () => {
    const app = makeApp();
    const profile = defaultMailProfile();
    await app.vault.createBinary("Import/selbst.eml", enc(eml("s@example.org", "In-Reply-To: <s@example.org>\nReferences: <s@example.org>\n")));
    const r = await importEmlFolder({ app, profile, hashes: { get: () => null, set: () => {} }, now: () => new Date(0) }, "Import");
    expect(r.created).toBe(1);
    const pfad = (await app.vault.getMarkdownFiles())[0]!.path;
    const inhalt = (await app.vault.adapter.read(pfad)) as string;
    expect(inhalt).not.toContain("[[");
    expect(inhalt.split("\n").find((l) => l.startsWith("in_reply_to:"))).toContain("s@example.org");
  });
  it("saveEml: false: der Import legt Notizen, aber keine .eml neben ihnen an (A6)", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", loadFixture("utf8-plain").buffer);
    const profile = { ...defaultMailProfile(), saveEml: false };
    const r = await importEmlFolder({ app, profile, hashes: { get: () => null, set: () => {} }, now: () => new Date(0) }, "Import");
    expect(r.created).toBe(1);
    expect(await app.vault.adapter.exists("Mail/2026/2026-08-19-1432-hallo-welt.md")).toBe(true);
    expect(await app.vault.adapter.exists("Mail/2026/_eml")).toBe(false);
    // Die Quelldatei im Importordner bleibt, wo sie war.
    expect(await app.vault.adapter.exists("Import/a.eml")).toBe(true);
  });
  // A3 (Welle 36): der Vorgangswert beim Import, auch fuer eine Vorgaengerin desselben Imports.
  it("traegt bei gesetztem threadField den Vorgang ein: Antwort vor Bezugsmail im selben Import, beide zeigen auf die Wurzel", async () => {
    const app = makeApp();
    const profile = { ...defaultMailProfile(), threadField: "vorgang" };
    await app.vault.createBinary("Import/1-antwort.eml", enc(eml("b@example.org", "In-Reply-To: <a@example.org>\n").replace("16:00:00", "17:00:00")));
    await app.vault.createBinary("Import/2-bezug.eml", enc(eml("a@example.org", "")));
    const r = await importEmlFolder({ app, profile, hashes: { get: () => null, set: () => {} }, now: () => new Date(0) }, "Import");
    expect(r.errors).toEqual([]);
    const notes = [...app.__files.keys()].filter((p: string) => p.endsWith(".md"));
    expect(notes).toHaveLength(2);
    const werte = (await Promise.all(notes.map((p: string) => app.vault.adapter.read(p)))).map((c: string) => c.split("\n").find((l) => l.startsWith("vorgang:")));
    expect(werte[0]).toBeDefined();
    expect(werte[0]).toBe(werte[1]);
  });
  it("legt ohne threadField kein Vorgangsfeld an", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", enc(eml("a@example.org", "")));
    await importEmlFolder({ app, profile: defaultMailProfile(), hashes: { get: () => null, set: () => {} }, now: () => new Date(0) }, "Import");
    const note = [...app.__files.keys()].find((p: string) => p.endsWith(".md"))!;
    expect(await app.vault.adapter.read(note)).not.toContain("vorgang");
  });

  // A2 (Welle 36): geerbte Felder beim Import.
  describe("geerbte Felder (A2)", () => {
    const hashes = { get: () => null, set: () => {} };
    it("erbt von einer Notiz im Vault: eine Liste von Wikilinks bleibt eine Liste", async () => {
      const app = makeApp([{ path: "Mail/2026/alt.md", frontmatter: { mail_id: "alt@example.org", projekt: ["[[A]]", "[[B]]"] } }]);
      await app.vault.createBinary("Import/neu.eml", enc(eml("neu@example.org", "In-Reply-To: <alt@example.org>\n")));
      const profile = { ...defaultMailProfile(), inheritFields: ["projekt"] };
      const r = await importEmlFolder({ app, profile, hashes, now: () => new Date(0) }, "Import");
      expect(r.errors).toEqual([]);
      expect(r.created).toBe(1);
      const neu = [...app.__files.keys()].find((p: string) => p.endsWith(".md") && p !== "Mail/2026/alt.md")!;
      expect((await app.vault.adapter.read(neu)).split("\n").find((l: string) => l.startsWith("projekt:"))).toBe('projekt: ["[[A]]", "[[B]]"]');
    });

    it("erbt in einer Kette im selben Import, die Antwort liegt vor der Bezugsmail", async () => {
      const app = makeApp([{ path: "Mail/2026/alt.md", frontmatter: { mail_id: "alt@example.org", projekt: "Alpha" } }]);
      await app.vault.createBinary("Import/1-c.eml", enc(eml("c@example.org", "In-Reply-To: <b@example.org>\n")));
      await app.vault.createBinary("Import/2-b.eml", enc(eml("b@example.org", "In-Reply-To: <alt@example.org>\n")));
      const profile = { ...defaultMailProfile(), inheritFields: ["projekt"] };
      await importEmlFolder({ app, profile, hashes, now: () => new Date(0) }, "Import");
      const neue = [...app.__files.keys()].filter((p: string) => p.endsWith(".md") && p !== "Mail/2026/alt.md");
      expect(neue).toHaveLength(2);
      for (const p of neue) expect((await app.vault.adapter.read(p)).split("\n")).toContain("projekt: Alpha");
    });

    it("erbt nichts ohne eingestellte Schluessel", async () => {
      const app = makeApp([{ path: "Mail/2026/alt.md", frontmatter: { mail_id: "alt@example.org", projekt: "Alpha" } }]);
      await app.vault.createBinary("Import/neu.eml", enc(eml("neu@example.org", "In-Reply-To: <alt@example.org>\n")));
      await importEmlFolder({ app, profile: defaultMailProfile(), hashes, now: () => new Date(0) }, "Import");
      const neu = [...app.__files.keys()].find((p: string) => p.endsWith(".md") && p !== "Mail/2026/alt.md")!;
      expect(await app.vault.adapter.read(neu)).not.toContain("projekt");
    });
  });
  // A5, Schritt 1: vorberechnete Werte aus dem Original gehen der Ableitung aus der (spaeter transformierten) Mail vor.
  it("facts je Mail-ID: richtung kommt aus dem Original, ohne facts wie bisher", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", enc(eml("a@example.org", "")));
    const mk = (facts?: Map<string, { direction: "eingehend" | "ausgehend"; threadToken: string | null }>) =>
      ({ app, profile: defaultMailProfile(), hashes: { get: () => null, set: () => {} }, now: () => new Date(0), ...(facts ? { facts } : {}) });
    const r = await importEmlFolder(mk(new Map([["a@example.org", { direction: "ausgehend", threadToken: null }]])), "Import");
    expect(r.errors).toEqual([]);
    const pfad = (await app.vault.getMarkdownFiles())[0]!.path;
    expect(await app.vault.adapter.read(pfad)).toContain("richtung: ausgehend");
    const app2 = makeApp();
    await app2.vault.createBinary("Import/a.eml", enc(eml("a@example.org", "")));
    await importEmlFolder({ app: app2, profile: defaultMailProfile(), hashes: { get: () => null, set: () => {} }, now: () => new Date(0) }, "Import");
    expect(await app2.vault.adapter.read((await app2.vault.getMarkdownFiles())[0]!.path)).toContain("richtung: eingehend");
  });
});

// A5, Schritt 3: derselbe Transformer wie im Sync, aber als Befehl eines Menschen (interactive: true).
describe("importEmlFolder — Pseudonymisieren (A5)", () => {
  const nowFn = () => new Date(0);
  const ersetze = (seen: boolean[] = []): TransformPort => (req: TransformRequest): Promise<PortOutcome> => {
    seen.push(req.interactive);
    return Promise.resolve({ kind: "pseudonymized", result: { parts: req.parts.map((p) => ({ id: p.id, value: p.id === "body" ? "Person_k3 schreibt" : p.id === "subject" ? "Betreff Person_k3" : p.value })), entities: [], applied: 2 } });
  };
  it("Aus: der Port wird nie gerufen, die .eml wird wie bisher angelegt", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", loadFixture("utf8-plain").buffer);
    let calls = 0;
    const r = await importEmlFolder({ app, profile: { ...defaultMailProfile(), pseudonymize: "off" }, hashes: { get: () => null, set: () => {} }, now: nowFn, pseudonymize: () => { calls += 1; return Promise.resolve({ kind: "plain", reason: "off" }); } }, "Import");
    expect(calls).toBe(0);
    expect(r.created).toBe(1);
    expect(r.held).toEqual([]);
    expect(await app.vault.adapter.exists("Mail/2026/_eml/2026-08-19-1432-hallo-welt.eml")).toBe(true);
  });
  it("pseudonymisiert: die Notiz traegt die Platzhalter, keine .eml neben ihr, der Port bekommt interactive: true", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", loadFixture("utf8-plain").buffer);
    const seen: boolean[] = [];
    const r = await importEmlFolder({ app, profile: { ...defaultMailProfile(), pseudonymize: "required" }, hashes: { get: () => null, set: () => {} }, now: nowFn, pseudonymize: ersetze(seen) }, "Import");
    expect(r.errors).toEqual([]);
    expect(r.created).toBe(1);
    expect(seen).toEqual([true]);
    const pfad = [...app.__files.keys()].find((x: string) => x.endsWith(".md"))!;
    const inhalt = (await app.vault.adapter.read(pfad)) as string;
    expect(inhalt).toContain("Person_k3 schreibt");
    expect(inhalt).toContain("Betreff Person_k3");
    expect([...app.__files.keys()].some((x: string) => x.endsWith(".eml") && !x.startsWith("Import/"))).toBe(false);
  });
  it("wait: nichts wird geschrieben, die Mail steht mit Grund in `held`, die Quelldatei bleibt", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", loadFixture("utf8-plain").buffer);
    const r = await importEmlFolder({ app, profile: { ...defaultMailProfile(), pseudonymize: "required" }, hashes: { get: () => null, set: () => {} }, now: nowFn, pseudonymize: () => Promise.resolve({ kind: "wait", reason: "absent", message: "fehlt" }) }, "Import");
    expect(r.created).toBe(0);
    expect(r.errors).toEqual([]);
    expect(r.held).toEqual([{ path: "Import/a.eml", kind: "wait", reason: "absent", message: "fehlt" }]);
    expect([...app.__files.keys()].filter((x: string) => !x.startsWith("Import/"))).toEqual([]);
    expect(await app.vault.adapter.exists("Import/a.eml")).toBe(true);
  });
  it("error: nichts wird geschrieben, die Datei steht in errors mit dem Grund", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", loadFixture("utf8-plain").buffer);
    const r = await importEmlFolder({ app, profile: { ...defaultMailProfile(), pseudonymize: "if-available" }, hashes: { get: () => null, set: () => {} }, now: nowFn, pseudonymize: () => Promise.resolve({ kind: "error", reason: "invalid-input", message: "kaputt" }) }, "Import");
    expect(r.created).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ path: "Import/a.eml" });
    expect(r.errors[0]!.message).toContain("invalid-input");
    expect([...app.__files.keys()].filter((x: string) => !x.startsWith("Import/"))).toEqual([]);
  });
  it("ein Schalter ungleich Aus ohne gebundenen Port schreibt nie Klartext", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", loadFixture("utf8-plain").buffer);
    const r = await importEmlFolder({ app, profile: { ...defaultMailProfile(), pseudonymize: "if-available" }, hashes: { get: () => null, set: () => {} }, now: nowFn }, "Import");
    expect(r.created).toBe(0);
    expect(r.held).toHaveLength(1);
  });
  it("richtung und Vorgangs-Token stammen aus dem Original, nicht aus der transformierten Mail", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", enc(eml("t@example.org", "").replace("Subject: Betreff t@example.org", "Subject: [Ticket#9] Frage")));
    const profile = { ...defaultMailProfile(), pseudonymize: "required" as const, ownAddresses: ["a@example.org"], threadField: "vorgang" };
    const port: TransformPort = (req) => Promise.resolve({ kind: "pseudonymized", result: { parts: req.parts.map((p) => ({ id: p.id, value: p.id === "subject" ? "Person_x" : p.id.startsWith("from.") ? "Person_k3" : p.value })), entities: [], applied: 1 } });
    const r = await importEmlFolder({ app, profile, hashes: { get: () => null, set: () => {} }, now: nowFn, pseudonymize: port }, "Import");
    expect(r.created).toBe(1);
    const pfad = [...app.__files.keys()].find((x: string) => x.endsWith(".md"))!;
    expect(await app.vault.adapter.read(pfad)).toContain("richtung: ausgehend");
  });
  // W37 (Task „Prüffenster im Sync hält den Busy-Guard“): der Sync hält den Guard über run samt Prüffenster, der Index ist vor dem
  // Fenster gelesen. Ein Import derselben Mail währenddessen legte eine zweite Notiz mit gleicher mail_id an.
  it("läuft nicht, solange ein anderer Lauf den Busy-Guard hält, und legt dann nichts an", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", loadFixture("utf8-plain").buffer);
    const busy = createBusyGuard();
    expect(busy.tryAcquire()).toBe(true); // der Sync-Lauf mit offenem Prüffenster
    const deps = { app, profile: defaultMailProfile(), hashes: { get: () => null, set: () => {} }, now: () => new Date(0), busy };
    const r = await importEmlFolder(deps, "Import");
    expect(r.busy).toBe(true);
    expect(r.created).toBe(0);
    expect(app.vault.getMarkdownFiles()).toHaveLength(0);
    busy.release();
    const r2 = await importEmlFolder(deps, "Import");
    expect(r2.busy).toBe(false);
    expect(r2.created).toBe(1);
    expect(busy.isBusy()).toBe(false); // der Import gibt den Guard wieder frei
  });
  it("gibt den Busy-Guard auch frei, wenn der Import wirft", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/a.eml", loadFixture("utf8-plain").buffer);
    const busy = createBusyGuard();
    const profile = { ...defaultMailProfile(), pseudonymize: "required" as const };
    const pseudonymize: TransformPort = () => { throw new Error("boom"); };
    await importEmlFolder({ app, profile, hashes: { get: () => null, set: () => {} }, now: () => new Date(0), busy, pseudonymize }, "Import").catch(() => undefined);
    expect(busy.isBusy()).toBe(false);
  });
});
