import { describe, it, expect } from "vitest";
import { FakeSocketTransport, type DialogStep } from "../../helpers/fake-socket";
import { testTimers } from "../../helpers/timers";
import { imapConnect } from "../../../src/core/imap/client";
import { MAX_UNTAGGED_PER_COMMAND } from "../../../src/core/imap/types";

const base = { host: "imap.example.net", port: 993, tls: "implicit" as const, username: "u@example.net", password: "geheim", timers: testTimers };

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
    // Die Aussage ist der Verzicht auf AUTHENTICATE — dass LOGIN gesendet wurde, erzwingt schon
    // der Dialog-Step oben, eine Assertion darauf koennte gar nicht fehlschlagen.
    expect(fake.written.some((l) => l.includes("AUTHENTICATE"))).toBe(false);
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
    // Die Aussage ist der Verzicht auf AUTHENTICATE — dass LOGIN gesendet wurde, erzwingt schon
    // der Dialog-Step oben, eine Assertion darauf koennte gar nicht fehlschlagen.
    expect(fake.written.some((l) => l.includes("AUTHENTICATE"))).toBe(false);
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

describe("ImapSession.append", () => {
  async function sessionFor(steps: DialogStep[]) {
    const fake = new FakeSocketTransport(["* OK ready"], [...greetingAndAuth, ...steps]);
    const r = await imapConnect(fake, base);
    if (!r.ok) throw new Error(`connect fehlgeschlagen: ${r.detail}`);
    return { fake, s: r.session };
  }
  const eml = new TextEncoder().encode("From: a@b\r\nSubject: x\r\n\r\nHallo\r\n");

  it("kuendigt die Groesse an, wartet auf die Continuation und schickt dann die Bytes", async () => {
    const { fake, s } = await sessionFor([
      { expect: new RegExp(`^a003 APPEND "Sent" \\(\\\\Seen\\) \\{${String(eml.byteLength)}\\}$`), send: ["+ Ready for literal data"] },
      { expect: /^$/, send: ["a003 OK [APPENDUID 1 7] Append completed"] },
    ]);
    expect(await s.append("Sent", eml, ["\\Seen"])).toEqual({ ok: true });
    // Die Bytes gehen NACH der Continuation raus, nicht davor.
    const idx = fake.written.findIndex((l) => l.startsWith("a003 APPEND"));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(fake.written.slice(idx + 1).join("\n")).toContain("Subject: x");
  });

  it("kodiert den Ordnernamen und meldet folder-missing bei NO", async () => {
    const { fake, s } = await sessionFor([
      { expect: /^a003 APPEND "Gel&APY-scht" /, send: ["a003 NO [TRYCREATE] Mailbox doesn't exist"] },
    ]);
    expect(await s.append("Gelöscht", eml)).toMatchObject({ ok: false, code: "folder-missing" });
    expect(fake.written.some((l) => l.includes("Gel&APY-scht"))).toBe(true);
  });

  it("schickt die Bytes NICHT, wenn der Server statt der Continuation ablehnt", async () => {
    const { fake, s } = await sessionFor([
      { expect: /^a003 APPEND /, send: ["a003 NO Over quota"] },
    ]);
    const r = await s.append("Sent", eml);
    expect(r.ok).toBe(false);
    expect(fake.written.join("\n")).not.toContain("Subject: x");
  });
});

// M3-Nachlese, Abdeckungsluecken: der STARTTLS-Zweig wird in der Konten-UI angeboten und war
// vollstaendig ungetestet — der Fake-Transport kann `upgrade: true` seit M3, benutzt hatte es
// niemand. Fuer einen Nutzer mit einem Server ohne implizites TLS lief also ungeprueter Code.
describe("imapConnect — STARTTLS", () => {
  const starttls = { ...base, port: 143, tls: "starttls" as const };

  it("schickt STARTTLS, hebt die Verbindung an und authentifiziert erst danach", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 STARTTLS$/, send: ["a001 OK begin TLS"], upgrade: true },
      { expect: /^a002 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", "a002 OK done"] },
      { expect: /^a003 AUTHENTICATE PLAIN /, send: ["a003 OK authenticated"] },
    ]);
    const r = await imapConnect(fake, starttls);
    expect(r.ok).toBe(true);
    expect(fake.secure).toBe(true);
    // Die Reihenfolge ist die Zusage: kein Passwort auf der Leitung vor dem Upgrade.
    const idxTls = fake.written.findIndex((l) => l.includes("STARTTLS"));
    const idxAuth = fake.written.findIndex((l) => l.includes("AUTHENTICATE"));
    expect(idxTls).toBeGreaterThanOrEqual(0);
    expect(idxAuth).toBeGreaterThan(idxTls);
  });

  it("bricht mit 'tls-required' ab, wenn der Server STARTTLS ablehnt — ohne Zugangsdaten zu senden", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 STARTTLS$/, send: ["a001 NO not available"] },
    ]);
    const r = await imapConnect(fake, starttls);
    expect(r).toMatchObject({ ok: false, code: "tls-required" });
    expect(fake.secure).toBe(false);
    expect(fake.written.some((l) => l.includes("AUTHENTICATE") || l.includes("LOGIN"))).toBe(false);
    expect(fake.written.some((l) => l.includes("geheim"))).toBe(false);
  });
});

// M3-Nachlese: Greeting-nicht-OK, existsFrom-Rueckfall und logout() waren ungeprueft.
describe("imapConnect — Randfaelle des Verbindungsaufbaus", () => {
  it("lehnt ein Greeting ab, das weder OK noch PREAUTH ist", async () => {
    const fake = new FakeSocketTransport(["* BYE server too busy"], []);
    const r = await imapConnect(fake, base);
    expect(r).toMatchObject({ ok: false, code: "protocol" });
    if (r.ok) throw new Error("unreachable");
    expect(r.detail).toContain("Greeting nicht OK");
    // Kein Kommando nach einem abgelehnten Greeting — auch kein CAPABILITY.
    expect(fake.written).toEqual([]);
  });

  it("akzeptiert PREAUTH als Greeting", async () => {
    const fake = new FakeSocketTransport(["* PREAUTH IMAP4rev1 logged in"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", "a001 OK done"] },
      { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
    ]);
    expect((await imapConnect(fake, base)).ok).toBe(true);
  });

  it("meldet exists 0, wenn EXAMINE keine EXISTS-Zeile schickt", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      ...greetingAndAuth,
      { expect: /^a003 EXAMINE /, send: ["* OK [UIDVALIDITY 42] ok", "a003 OK done"] },
    ]);
    const r = await imapConnect(fake, base);
    if (!r.ok) throw new Error("unreachable");
    const ex = await r.session.examine("Vault");
    expect(ex).toEqual({ ok: true, uidValidity: 42, exists: 0 });
  });

  it("schliesst die Verbindung auch dann, wenn LOGOUT scheitert", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], greetingAndAuth);
    const r = await imapConnect(fake, base);
    if (!r.ok) throw new Error("unreachable");
    // Kein Dialog-Step fuer LOGOUT: das Kommando laeuft ins Leere und wirft.
    await r.session.logout();
    expect(fake.closed).toBe(true);
  });
});

// M3-Nachlese: jeder einzelne Read steht unter Timeout, die Sammelschleife um ihn herum nicht.
// Ein Server, der ohne Pause untagged Antworten schickt, haelt damit jeden Read innerhalb der
// Frist und laesst das Array trotzdem unbegrenzt wachsen. In einem Modul, das MAX_LITERAL_BYTES
// ausdruecklich gegen "einen defekten oder feindlichen Server" begruendet, war das inkonsistent.
describe("imapConnect — Obergrenze fuer untagged Antworten", () => {
  it("bricht ab, wenn ein Kommando mehr untagged Antworten bekommt als vorgesehen", async () => {
    const flut = Array.from({ length: MAX_UNTAGGED_PER_COMMAND + 1 }, (_, i) => `* ${String(i + 1)} EXISTS`);
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: [...flut, "a001 OK done"] },
    ]);
    const r = await imapConnect(fake, base);
    expect(r).toMatchObject({ ok: false, code: "protocol" });
    if (r.ok) throw new Error("unreachable");
    expect(r.detail).toMatch(/untagged/i);
  });

  it("laesst eine grosse, aber legitime Antwort durch", async () => {
    const viele = Array.from({ length: 500 }, (_, i) => `* ${String(i + 1)} EXISTS`);
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: [...viele, "* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", "a001 OK done"] },
      { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
    ]);
    expect((await imapConnect(fake, base)).ok).toBe(true);
  });
});

// M3-Nachlese, zwei Uneinheitlichkeiten im selben Modul:
describe("imapConnect — einheitliche Konventionen", () => {
  // `line` kommt OHNE Tag (command setzt es davor), `masked` musste es bisher MITBRINGEN. Wer das
  // verwechselte, bekam eine Log-Zeile ohne Tag — harmlos, aber genau die Sorte Falle, die man
  // erst beim Debuggen bemerkt. Jetzt tragen beide Parameter dieselbe Form.
  it("loggt die maskierte Zeile MIT Tag, ohne dass der Aufrufer es mitgibt", async () => {
    const lines: string[] = [];
    const fake = new FakeSocketTransport(["* OK ready"], greetingAndAuth);
    await imapConnect(fake, { ...base, log: (l) => lines.push(l) });
    expect(lines).toContain("C: a002 AUTHENTICATE PLAIN ****");
    expect(lines.some((l) => l.includes("geheim"))).toBe(false);
  });

  // uidFetchMessageIds verglich numerisch, uidFetchBody als Zeichenkette. Beide Wege treffen im
  // Normalfall dasselbe, aber nur der numerische ist gegen eine fuehrende Null robust.
  it("ordnet eine FETCH-Antwort auch dann zu, wenn der Server die UID mit fuehrender Null schreibt", async () => {
    const body = new TextEncoder().encode("Message-ID: <x@y>\r\n\r\nHallo\r\n");
    const fake = new FakeSocketTransport(["* OK ready"], [
      ...greetingAndAuth,
      {
        expect: /^a003 UID FETCH 7 \(BODY\.PEEK\[\]\)$/,
        send: [`* 1 FETCH (UID 007 BODY[] {${String(body.byteLength)}}`, body, ")", "a003 OK done"],
      },
    ]);
    const r = await imapConnect(fake, base);
    if (!r.ok) throw new Error("unreachable");
    expect(await r.session.uidFetchBody(7)).not.toBeNull();
  });
});
