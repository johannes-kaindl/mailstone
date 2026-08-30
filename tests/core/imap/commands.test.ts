import { describe, it, expect } from "vitest";
import { encodeMailbox, quoteArg, assertNoCrlf, buildUidSet, chunk } from "../../../src/core/imap/commands";

describe("encodeMailbox (modified UTF-7)", () => {
  it("laesst reines ASCII unveraendert", () => {
    expect(encodeMailbox("Vault")).toBe("Vault");
    expect(encodeMailbox("INBOX/Sub")).toBe("INBOX/Sub");
  });
  it("kodiert Umlaute nach RFC 3501 § 5.1.3", () => {
    expect(encodeMailbox("Entwürfe")).toBe("Entw&APw-rfe");
    expect(encodeMailbox("Gelöschte Objekte")).toBe("Gel&APY-schte Objekte");
  });
  it("kodiert das Und-Zeichen als &-", () => {
    expect(encodeMailbox("R&D")).toBe("R&-D");
  });
});

describe("quoteArg / assertNoCrlf", () => {
  it("umschliesst mit Anfuehrungszeichen und escaped Sonderzeichen", () => {
    expect(quoteArg('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
  it("assertNoCrlf wirft bei CR oder LF", () => {
    expect(() => assertNoCrlf("Vault\r\nX LOGOUT", "Ordner")).toThrow(/Ordner/);
    expect(() => assertNoCrlf("Vault", "Ordner")).not.toThrow();
  });
});

describe("buildUidSet / chunk", () => {
  it("fasst zusammenhaengende UIDs zu Bereichen", () => {
    expect(buildUidSet([1, 2, 3, 7, 9, 10])).toBe("1:3,7,9:10");
    expect(buildUidSet([5])).toBe("5");
    expect(buildUidSet([])).toBe("");
  });
  it("chunk teilt in Bloecke", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
