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
