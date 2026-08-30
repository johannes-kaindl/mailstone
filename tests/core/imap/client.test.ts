import { describe, it, expect } from "vitest";
import { FakeSocketTransport, type DialogStep, type SendPart } from "../../helpers/fake-socket";
import { testTimers } from "../../helpers/timers";
import { imapConnect } from "../../../src/core/imap/client";

const base = { host: "imap.example.net", port: 993, tls: "implicit" as const, username: "u@example.net", password: "geheim", timers: testTimers };

function literal(text: string): SendPart[] {
  const bytes = new TextEncoder().encode(text);
  return [`* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(bytes.byteLength)}}`, bytes, ")"];
}

const greetingAndAuth: DialogStep[] = [
  { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR UIDPLUS MOVE", "a001 OK done"] },
  { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
];

describe("imapConnect", () => {
  it("verbindet, liest Capabilities und authentifiziert mit AUTH=PLAIN", async () => {
    const fake = new FakeSocketTransport(["* OK [CAPABILITY IMAP4rev1] server ready"], greetingAndAuth);
    const r = await imapConnect(fake, base);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.session.capabilities).toContain("UIDPLUS");
    expect(fake.written.some((l) => l.includes("geheim"))).toBe(false);
  });

  it("maskiert die Auth-Zeile im Log", async () => {
    const lines: string[] = [];
    const fake = new FakeSocketTransport(["* OK ready"], greetingAndAuth);
    await imapConnect(fake, { ...base, log: (l) => lines.push(l) });
    expect(lines.some((l) => l.includes("geheim"))).toBe(false);
    expect(lines.some((l) => /AUTHENTICATE PLAIN \*{4}/.test(l))).toBe(true);
  });

  it("liefert code 'auth' bei abgelehnter Anmeldung", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", "a001 OK done"] },
      { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 NO [AUTHENTICATIONFAILED] Invalid credentials"] },
    ]);
    const r = await imapConnect(fake, base);
    expect(r).toMatchObject({ ok: false, code: "auth" });
  });

  it("faellt auf LOGIN zurueck, wenn der Server AUTH=PLAIN nicht anbietet", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1", "a001 OK done"] },
      { expect: /^a002 LOGIN /, send: ["a002 OK logged in"] },
    ]);
    const r = await imapConnect(fake, base);
    expect(r.ok).toBe(true);
    expect(fake.written.some((l) => l.startsWith("a002 LOGIN"))).toBe(true);
  });

  // Die Initial-Response-Form von AUTHENTICATE ist RFC 4959 und braucht SASL-IR. Ein Server, der
  // nur AUTH=PLAIN ankuendigt, antwortet darauf BAD — der Client meldete "auth" und der Nutzer
  // haette sein Passwort ewig neu eingegeben, ohne je hineinzukommen.
  it("nimmt LOGIN, wenn der Server AUTH=PLAIN ohne SASL-IR ankuendigt", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN UIDPLUS", "a001 OK done"] },
      { expect: /^a002 LOGIN /, send: ["a002 OK logged in"] },
    ]);
    const r = await imapConnect(fake, base);
    expect(r.ok).toBe(true);
    expect(fake.written.some((l) => l.startsWith("a002 LOGIN"))).toBe(true);
    expect(fake.written.some((l) => l.includes("AUTHENTICATE"))).toBe(false);
  });

  it("weist LOGINDISABLED auch mit AUTH=PLAIN ab, solange SASL-IR fehlt (kein nutzbares Verfahren)", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 LOGINDISABLED AUTH=PLAIN", "a001 OK done"] },
    ]);
    expect(await imapConnect(fake, base)).toMatchObject({ ok: false, code: "tls-required" });
    expect(fake.written.some((l) => /^a\d+ (AUTHENTICATE|LOGIN)/.test(l))).toBe(false);
  });

  it("weist LOGINDISABLED ohne Verbindungsaufbau zum Postfach ab", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 LOGINDISABLED", "a001 OK done"] },
    ]);
    expect(await imapConnect(fake, base)).toMatchObject({ ok: false, code: "tls-required" });
  });

  it("verweigert Authentifizierung ohne TLS, wenn allowInsecureAuth nicht gesetzt ist", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN", "a001 OK done"] },
    ]);
    const r = await imapConnect(fake, { ...base, tls: "none" });
    expect(r).toMatchObject({ ok: false, code: "tls-required" });
    expect(fake.written.some((l) => /^a\d+ (AUTHENTICATE|LOGIN)/.test(l))).toBe(false);
  });

  it("erlaubt Klartext-Authentifizierung mit allowInsecureAuth (lokaler Fake-Server)", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], greetingAndAuth);
    const r = await imapConnect(fake, { ...base, tls: "none", allowInsecureAuth: true });
    expect(r.ok).toBe(true);
  });
});

describe("ImapSession", () => {
  async function session(steps: DialogStep[]) {
    const fake = new FakeSocketTransport(["* OK ready"], [...greetingAndAuth, ...steps]);
    const r = await imapConnect(fake, base);
    if (!r.ok) throw new Error(`connect fehlgeschlagen: ${r.detail}`);
    return { fake, s: r.session };
  }

  it("examine liefert UIDVALIDITY und EXISTS und benutzt EXAMINE, nie SELECT", async () => {
    const { fake, s } = await session([
      { expect: /^a003 EXAMINE /, send: ["* 12 EXISTS", "* OK [UIDVALIDITY 3857529045] UIDs valid", "a003 OK [READ-ONLY] EXAMINE completed"] },
    ]);
    expect(await s.examine("Vault")).toEqual({ ok: true, uidValidity: 3857529045, exists: 12 });
    expect(fake.written.some((l) => /\bSELECT\b/.test(l))).toBe(false);
  });

  it("examine meldet folder-missing bei NO", async () => {
    const { s } = await session([{ expect: /^a003 EXAMINE /, send: ["a003 NO Mailbox doesn't exist: Vault"] }]);
    expect(await s.examine("Vault")).toMatchObject({ ok: false, code: "folder-missing" });
  });

  it("examine kodiert Umlaute im Ordnernamen", async () => {
    const { fake, s } = await session([{ expect: /^a003 EXAMINE /, send: ["* 0 EXISTS", "* OK [UIDVALIDITY 1] ok", "a003 OK done"] }]);
    await s.examine("Entwürfe");
    expect(fake.written).toContain('a003 EXAMINE "Entw&APw-rfe"');
  });

  it("uidSearchAll liest die UID-Liste", async () => {
    const { s } = await session([
      { expect: /^a003 EXAMINE /, send: ["* 3 EXISTS", "* OK [UIDVALIDITY 1] ok", "a003 OK done"] },
      { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 4 8 15", "a004 OK done"] },
    ]);
    await s.examine("Vault");
    expect(await s.uidSearchAll()).toEqual([4, 8, 15]);
  });

  it("uidSearchAll liefert [] bei leerer SEARCH-Antwort", async () => {
    const { s } = await session([
      { expect: /^a003 EXAMINE /, send: ["* 0 EXISTS", "* OK [UIDVALIDITY 1] ok", "a003 OK done"] },
      { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH", "a004 OK done"] },
    ]);
    await s.examine("Vault");
    expect(await s.uidSearchAll()).toEqual([]);
  });

  it("uidFetchMessageIds normalisiert die Message-ID und meldet null ohne Header", async () => {
    const withId = new TextEncoder().encode("Message-ID: <abc@example.net>\r\n\r\n");
    const { s } = await session([
      { expect: /^a003 EXAMINE /, send: ["* 1 EXISTS", "* OK [UIDVALIDITY 1] ok", "a003 OK done"] },
      {
        expect: /^a004 UID FETCH 7,9 \(BODY\.PEEK\[HEADER\.FIELDS \(MESSAGE-ID\)\]\)$/,
        send: [
          `* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(withId.byteLength)}}`, withId, ")",
          "* 2 FETCH (UID 9 BODY[HEADER.FIELDS (MESSAGE-ID)] {2}", new TextEncoder().encode("\r\n"), ")",
          "a004 OK done",
        ],
      },
    ]);
    await s.examine("Vault");
    const map = await s.uidFetchMessageIds([7, 9]);
    expect(map.get(7)).toBe("abc@example.net");
    expect(map.get(9)).toBeNull();
  });

  it("uidFetchBody liefert die rohen Bytes und benutzt BODY.PEEK", async () => {
    const eml = new TextEncoder().encode("From: a@b\r\nSubject: x\r\n\r\nHallo\r\n");
    const { fake, s } = await session([
      { expect: /^a003 EXAMINE /, send: ["* 1 EXISTS", "* OK [UIDVALIDITY 1] ok", "a003 OK done"] },
      { expect: /^a004 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: [`* 1 FETCH (UID 7 BODY[] {${String(eml.byteLength)}}`, eml, ")", "a004 OK done"] },
    ]);
    await s.examine("Vault");
    expect(new TextDecoder().decode((await s.uidFetchBody(7)) ?? new Uint8Array())).toContain("Subject: x");
    expect(fake.written.some((l) => /BODY\[\]\)$/.test(l) && !l.includes("PEEK"))).toBe(false);
  });

  it("uidFetchBody liefert null, wenn die UID verschwunden ist", async () => {
    const { s } = await session([
      { expect: /^a003 EXAMINE /, send: ["* 0 EXISTS", "* OK [UIDVALIDITY 1] ok", "a003 OK done"] },
      { expect: /^a004 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: ["a004 OK done"] },
    ]);
    await s.examine("Vault");
    expect(await s.uidFetchBody(7)).toBeNull();
  });

  it("meldet code 'protocol' bei einer BAD-Antwort mitten im Dialog", async () => {
    const { s } = await session([{ expect: /^a003 EXAMINE /, send: ["a003 BAD Error in IMAP command"] }]);
    expect(await s.examine("Vault")).toMatchObject({ ok: false, code: "protocol" });
  });
});
