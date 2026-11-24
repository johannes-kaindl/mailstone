import { describe, it, expect } from "vitest";
import { createAttachmentResolver } from "../../src/obsidian/attachment-targets";
import { parseEml } from "../../src/core/mime/parse";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { makeApp } from "../helpers/memory-vault";
import { loadFixture } from "../helpers/fixtures";

const NOTE = "Mail/2026/x.md";
const mixed = async () => parseEml(loadFixture("multipart-mixed-attachments"));
const pathsOf = (m: ReadonlyMap<string, { path: string; write: boolean }>): Record<string, string> =>
  Object.fromEntries([...m.values()].map((t) => [t.path, t.write ? "write" : "reuse"]));

describe("createAttachmentResolver (Obsidian-Schicht)", () => {
  it("loest die Pfade im Anhangordner auf, je echtem Anhang ein Ziel", async () => {
    const app = makeApp();
    const mail = await mixed();
    const t = await createAttachmentResolver(app)(mail, NOTE);
    expect(pathsOf(t)).toEqual({ "Anhaenge/bericht.pdf": "write", "Anhaenge/notiz.txt": "write" });
  });
  it("liegt am blanken Namen schon eine BYTE-GLEICHE Datei, wird sie wiederverwendet", async () => {
    const app = makeApp();
    const mail = await mixed();
    const bericht = mail.attachments.find((a) => a.name === "bericht.pdf")!;
    await app.vault.createBinary("Anhaenge/bericht.pdf", new Uint8Array(mail.attachmentData.get(bericht.key)!).buffer);
    const t = await createAttachmentResolver(app)(mail, NOTE);
    expect(pathsOf(t)["Anhaenge/bericht.pdf"]).toBe("reuse");
  });
  it("liegt dort eine gleichnamige ANDERE Datei, bekommt der Anhang einen neuen Namen", async () => {
    const app = makeApp();
    const mail = await mixed();
    await app.vault.createBinary("Anhaenge/bericht.pdf", new TextEncoder().encode("ganz anders").buffer as ArrayBuffer);
    const t = await createAttachmentResolver(app)(mail, NOTE);
    expect(pathsOf(t)["Anhaenge/bericht 1.pdf"]).toBe("write");
    expect(pathsOf(t)["Anhaenge/bericht.pdf"]).toBeUndefined();
  });
  it("innerhalb EINES Laufs: dieselbe Datei aus zwei Mails wird nur einmal geschrieben, eine gleichnamige andere weicht aus", async () => {
    const app = makeApp();
    const mail = await mixed();
    const resolve = createAttachmentResolver(app);
    const erste = await resolve(mail, NOTE);
    const zweite = await resolve(mail, "Mail/2026/y.md");
    expect(pathsOf(erste)).toEqual({ "Anhaenge/bericht.pdf": "write", "Anhaenge/notiz.txt": "write" });
    expect(pathsOf(zweite)).toEqual({ "Anhaenge/bericht.pdf": "reuse", "Anhaenge/notiz.txt": "reuse" });
    // gleicher Name, andere Bytes
    const anders = await mixed();
    for (const [k, v] of anders.attachmentData) anders.attachmentData.set(k, new Uint8Array([...v, 1]));
    const dritte = await resolve(anders, "Mail/2026/z.md");
    expect(pathsOf(dritte)).toEqual({ "Anhaenge/bericht 1.pdf": "write", "Anhaenge/notiz 1.txt": "write" });
  });
  it("Inline-Bilder bekommen kein Ziel (sie bleiben ohne .eml unerreichbar, akzeptiert)", async () => {
    const app = makeApp();
    const mail = await parseEml(loadFixture("multipart-related-inline"));
    expect(mail.attachments.some((a) => a.inline)).toBe(true);
    const t = await createAttachmentResolver(app)(mail, NOTE);
    for (const a of mail.attachments.filter((x) => x.inline)) expect(t.has(a.key)).toBe(false);
  });
  void defaultMailProfile;
});
