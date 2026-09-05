import { describe, it, expect } from "vitest";
import { FakeSocketTransport } from "../../helpers/fake-socket";
import { readRawLine, tokenize, parseResponse, firstLiteral, findAtomValue } from "../../../src/core/imap/parser";
import type { ConnectOptions } from "../../../src/core/net/types";

const opts: ConnectOptions = { host: "imap.example.net", port: 993, tls: "implicit", timeoutMs: 1000 };

describe("readRawLine", () => {
  it("setzt eine Zeile mit Literal zu einer logischen Zeile zusammen", async () => {
    const body = new TextEncoder().encode("Message-ID: <x@y>\r\n");
    const fake = new FakeSocketTransport([`* 1 FETCH (UID 7 BODY[HEADER] {${String(body.byteLength)}}`, body, ")"], []);
    await fake.connect(opts);
    const raw = await readRawLine(fake);
    expect(raw.text).toBe("* 1 FETCH (UID 7 BODY[HEADER] {19})");
    expect(raw.literals).toHaveLength(1);
    expect(new TextDecoder().decode(raw.literals[0])).toBe("Message-ID: <x@y>\r\n");
  });

  it("liest eine Zeile ohne Literal unveraendert", async () => {
    const fake = new FakeSocketTransport(["a001 OK EXAMINE completed"], []);
    await fake.connect(opts);
    expect((await readRawLine(fake)).text).toBe("a001 OK EXAMINE completed");
  });

  it("weist ein unplausibel grosses Literal ab, statt es zu lesen", async () => {
    const fake = new FakeSocketTransport(["* 1 FETCH (BODY[] {99999999999}"], []);
    await fake.connect(opts);
    await expect(readRawLine(fake)).rejects.toMatchObject({ name: "NetError", code: "protocol" });
  });
});

describe("tokenize", () => {
  it("zerlegt Atome, Strings, NIL und geschachtelte Listen", () => {
    const items = tokenize('* 1 FETCH (UID 7 FLAGS (\\Seen \\Answered) X NIL SUBJ "Hallo Welt")', []);
    expect(items[0]).toEqual({ kind: "atom", value: "*" });
    const list = items[3];
    expect(list?.kind).toBe("list");
    if (list?.kind !== "list") throw new Error("unreachable");
    expect(findAtomValue(list.items, "UID")).toBe("7");
    expect(list.items).toContainEqual({ kind: "nil" });
    expect(list.items).toContainEqual({ kind: "string", value: "Hallo Welt" });
  });

  it("nimmt eckige Klammern samt Inhalt als Teil des Atoms", () => {
    const items = tokenize("* OK [UIDVALIDITY 3857529045] UIDs valid", []);
    expect(items[2]).toEqual({ kind: "atom", value: "[UIDVALIDITY 3857529045]" });
    const fetch = tokenize("(BODY[HEADER.FIELDS (MESSAGE-ID)] {4})", [new Uint8Array([1, 2, 3, 4])]);
    const list = fetch[0];
    if (list?.kind !== "list") throw new Error("unreachable");
    expect(list.items[0]).toEqual({ kind: "atom", value: "BODY[HEADER.FIELDS (MESSAGE-ID)]" });
    expect(list.items[1]?.kind).toBe("literal");
  });

  it("entschluesselt Escapes im quoted string", () => {
    expect(tokenize('"a\\"b\\\\c"', [])).toEqual([{ kind: "string", value: 'a"b\\c' }]);
  });

  it("setzt Literale in der Reihenfolge ihres Auftretens ein", () => {
    const a = new TextEncoder().encode("AA");
    const b = new TextEncoder().encode("BB");
    const items = tokenize("({2} {2})", [a, b]);
    const list = items[0];
    if (list?.kind !== "list") throw new Error("unreachable");
    expect(list.items).toEqual([{ kind: "literal", bytes: a }, { kind: "literal", bytes: b }]);
  });

  it("weist einen unterminierten quoted string ab, statt ihn abzuschneiden", () => {
    expect(() => tokenize('* 1 FETCH (SUBJECT "kaputt', [])).toThrow(/NetError|protocol|unterminiert/i);
  });
});

describe("parseResponse / Helfer", () => {
  it("trennt Tag und Rest", () => {
    const r = parseResponse({ text: "a003 NO [TRYCREATE] Mailbox does not exist", literals: [] });
    expect(r.tag).toBe("a003");
    expect(r.text).toBe("NO [TRYCREATE] Mailbox does not exist");
  });

  it("firstLiteral findet ein Literal auch geschachtelt", () => {
    const bytes = new TextEncoder().encode("hi");
    expect(firstLiteral(tokenize("* 1 FETCH (UID 7 BODY[] {2})", [bytes]))).toBe(bytes);
    expect(firstLiteral(tokenize("a001 OK done", []))).toBeNull();
  });
});

describe("tokenize — unausgeglichene eckige Klammern", () => {
  // Ein schliessendes ] ohne oeffnendes machte die Klammertiefe negativ. Danach war
  // `depth === 0` nie wieder wahr, also griff KEIN Trennzeichen mehr: der ganze Rest der
  // Zeile verschmolz zu einem einzigen Atom. Ein Server, der so etwas schickt (oder eine
  // Zeile, die durch einen fremden Fehler verstuemmelt ankommt), legte damit die Auswertung
  // aller folgenden Felder still, statt nur das eine kaputte Feld zu verlieren.
  it("trennt nach einem verirrten ] weiter an Leerzeichen", () => {
    expect(tokenize("A] B C", [])).toEqual([
      { kind: "atom", value: "A]" },
      { kind: "atom", value: "B" },
      { kind: "atom", value: "C" },
    ]);
  });

  it("findAtomValue findet einen Schluessel hinter einem verirrten ]", () => {
    expect(findAtomValue(tokenize("* 1 FETCH] UID 7", []), "UID")).toBe("7");
  });

  it("laesst ausgeglichene Klammern unveraendert zum Atom gehoeren", () => {
    expect(tokenize("BODY[HEADER.FIELDS (MESSAGE-ID)] NIL", [])).toEqual([
      { kind: "atom", value: "BODY[HEADER.FIELDS (MESSAGE-ID)]" },
      { kind: "nil" },
    ]);
  });

  // Die Gegenrichtung, und sie ist die gefaehrlichere: ein OEFFNENDES [ ohne schliessendes
  // liess die Tiefe bis zum Zeilenende stehen. Damit griff kein Trennzeichen mehr, das Atom
  // schluckte auch das ) der umschliessenden Liste, `readList` schloss nie — und ALLE
  // folgenden Felder derselben FETCH-Antwort gingen verloren.
  //
  // Dass ein Server so etwas schicken DARF, steht in RFC 3501 § 9: `[` ist kein
  // `atom-special` (`]` sehr wohl, ueber `resp-specials`). Ein Atom - etwa ein
  // Schluesselwort-Flag - darf eine oeffnende eckige Klammer also voellig regelkonform
  // enthalten, ohne sie je zu schliessen.
  it("verliert nach einem verirrten [ nicht den Rest der Antwort", () => {
    expect(tokenize("(FLAGS (\\Seen $Label[1) UID 7)", [])).toEqual([
      {
        kind: "list",
        items: [
          { kind: "atom", value: "FLAGS" },
          { kind: "list", items: [{ kind: "atom", value: "\\Seen" }, { kind: "atom", value: "$Label[1" }] },
          { kind: "atom", value: "UID" },
          { kind: "atom", value: "7" },
        ],
      },
    ]);
  });

  it("findAtomValue findet einen Schluessel hinter einem verirrten [", () => {
    expect(findAtomValue(tokenize("* 1 FETCH$x[1 UID 7", []), "UID")).toBe("7");
  });

  it("trennt auch bei mehreren verirrten [ weiter", () => {
    expect(tokenize("A[ B[ C", [])).toEqual([
      { kind: "atom", value: "A[" },
      { kind: "atom", value: "B[" },
      { kind: "atom", value: "C" },
    ]);
  });
});
