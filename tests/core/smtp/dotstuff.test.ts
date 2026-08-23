import { describe, it, expect } from "vitest";
import { dotStuff } from "../../../src/core/smtp/dotstuff";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("dotStuff", () => {
  it("verdoppelt fuehrende Punkte zeilenweise und stellt abschliessendes CRLF sicher", () => {
    expect(dec(dotStuff(enc("a\r\n.b\r\n..c")))).toBe("a\r\n..b\r\n...c\r\n");
  });

  it("leere Eingabe wird zu CRLF", () => {
    expect(dec(dotStuff(enc("")))).toBe("\r\n");
  });

  it("laesst Zeilen ohne fuehrenden Punkt unveraendert", () => {
    expect(dec(dotStuff(enc("Subject: hi\r\nBody line\r\n")))).toBe("Subject: hi\r\nBody line\r\n");
  });

  it("stuffed auch die erste Zeile, wenn sie mit einem Punkt beginnt", () => {
    expect(dec(dotStuff(enc(".start\r\nrest\r\n")))).toBe("..start\r\nrest\r\n");
  });
});
