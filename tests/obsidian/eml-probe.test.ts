import { describe, it, expect, vi } from "vitest";
import { probeEml } from "../../src/obsidian/eml-probe";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { makeApp } from "../helpers/memory-vault";

const profile = defaultMailProfile();
const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
const NOTE = "Mail/2026/x.md";
const EML_PATH = "Mail/2026/_eml/x.eml";

describe("probeEml", () => {
  it("liefert undefined, wenn am Konventionspfad keine Datei liegt", async () => {
    const app = makeApp();
    expect(await probeEml(app, profile, NOTE, "a@x")).toBeUndefined();
  });

  it("match: der Message-ID-Kopf passt zur mail_id", async () => {
    const app = makeApp();
    await app.vault.createBinary(EML_PATH, enc("From: a@b\r\nMessage-ID: <a@x>\r\nSubject: S\r\n\r\nText\r\n"));
    expect(await probeEml(app, profile, NOTE, "a@x")).toEqual({ path: EML_PATH, status: "match" });
  });

  it("match auch bei gefaltetem Kopf, LF-Zeilenenden und Gross-/Kleinschreibung des Feldnamens", async () => {
    const app = makeApp();
    await app.vault.createBinary(EML_PATH, enc("From: a@b\nMESSAGE-id:\n <a@x>\n\nText\n"));
    expect(await probeEml(app, profile, NOTE, "a@x")).toEqual({ path: EML_PATH, status: "match" });
  });

  it("mismatch: eine andere Message-ID", async () => {
    const app = makeApp();
    await app.vault.createBinary(EML_PATH, enc("Message-ID: <fremd@x>\r\n\r\nText\r\n"));
    expect(await probeEml(app, profile, NOTE, "a@x")).toEqual({ path: EML_PATH, status: "mismatch" });
  });

  it("unreadable: kein Message-ID-Kopf, leere Datei, oder die ID steht nur im Text", async () => {
    const app = makeApp();
    await app.vault.createBinary(EML_PATH, enc("From: a@b\r\n\r\nMessage-ID: <a@x>\r\n"));
    expect(await probeEml(app, profile, NOTE, "a@x")).toEqual({ path: EML_PATH, status: "unreadable" });
    const leer = makeApp();
    await leer.vault.createBinary(EML_PATH, new ArrayBuffer(0));
    expect(await probeEml(leer, profile, NOTE, "a@x")).toEqual({ path: EML_PATH, status: "unreadable" });
  });

  it("vergleicht normalisiert: eine mail_id mit spitzen Klammern passt trotzdem", async () => {
    const app = makeApp();
    await app.vault.createBinary(EML_PATH, enc("Message-ID: <a@x>\r\n\r\n"));
    expect(await probeEml(app, profile, NOTE, "<a@x>")).toEqual({ path: EML_PATH, status: "match" });
  });

  it("liest keine ganze grosse Datei in den Text: nur ein Kopfstueck wird ausgewertet", async () => {
    const app = makeApp();
    await app.vault.createBinary(EML_PATH, enc(`Message-ID: <a@x>\r\n\r\n${"x".repeat(300_000)}`));
    expect(await probeEml(app, profile, NOTE, "a@x")).toMatchObject({ status: "match" });
  });

  it("folgt dem emlSubfolder des Profils", async () => {
    const app = makeApp();
    await app.vault.createBinary("Mail/2026/roh/x.eml", enc("Message-ID: <a@x>\r\n\r\n"));
    expect(await probeEml(app, { ...profile, emlSubfolder: "roh" }, NOTE, "a@x")).toEqual({ path: "Mail/2026/roh/x.eml", status: "match" });
    void vi;
  });
});
