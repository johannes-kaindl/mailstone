import { describe, it, expect } from "vitest";
import { FakeSocketTransport } from "./fake-socket";
import type { ConnectOptions } from "../../src/core/net/types";

const opts: ConnectOptions = { host: "mail.example.net", port: 25, tls: "none", timeoutMs: 1000 };

describe("FakeSocketTransport", () => {
  it("spielt ein Skript aus Greeting + EHLO/QUIT-Steps ab und wirft nach Skript-Ende", async () => {
    const fake = new FakeSocketTransport(
      ["220 fake ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-fake", "250 AUTH PLAIN"] },
        { expect: /^QUIT$/, send: ["221 bye"] },
      ],
    );
    await fake.connect(opts);
    expect(fake.connectCalls).toEqual([opts]);
    expect(await fake.readLine()).toBe("220 fake ESMTP");

    await fake.write("EHLO x\r\n");
    expect(await fake.readLine()).toBe("250-fake");
    expect(await fake.readLine()).toBe("250 AUTH PLAIN");

    await fake.write("QUIT\r\n");
    expect(await fake.readLine()).toBe("221 bye");

    await expect(fake.readLine()).rejects.toMatchObject({ name: "NetError", code: "closed" });
    expect(fake.written).toEqual(["EHLO x", "QUIT"]);
  });

  it("upgradeTls() ohne upgrade:true im aktuellen Step wirft", async () => {
    const fake = new FakeSocketTransport(["220 fake ESMTP"], [{ expect: /^EHLO /, send: ["250 ok"] }]);
    await fake.connect(opts);
    await expect(fake.upgradeTls()).rejects.toMatchObject({ name: "NetError" });
  });

  it("upgradeTls() ist erlaubt, wenn der aktuelle Step upgrade:true traegt, und setzt secure", async () => {
    const fake = new FakeSocketTransport(
      ["220 fake ESMTP"],
      [
        { expect: /^EHLO /, send: ["250-fake", "250 STARTTLS"] },
        { expect: /^STARTTLS$/, send: ["220 go ahead"], upgrade: true },
        { expect: /^EHLO /, send: ["250 fake secure"] },
      ],
    );
    await fake.connect(opts);
    await fake.readLine();
    await fake.write("EHLO x\r\n");
    await fake.readLine();
    await fake.readLine();
    await fake.write("STARTTLS\r\n");
    await fake.readLine();
    expect(fake.secure).toBe(false);
    await fake.upgradeTls();
    expect(fake.secure).toBe(true);
  });

  it("connect setzt secure=true bei tls:'implicit'", async () => {
    const fake = new FakeSocketTransport(["220 fake ESMTP"], []);
    await fake.connect({ ...opts, tls: "implicit" });
    expect(fake.secure).toBe(true);
  });

  it("sammelt DATA-Body-Zeilen in written bis zum '.'-Ende-Marker-Step", async () => {
    const fake = new FakeSocketTransport(
      ["220 fake ESMTP"],
      [
        { expect: /^DATA$/, send: ["354 go ahead"] },
        { expect: /^\.$/, send: ["250 ok queued"] },
      ],
    );
    await fake.connect(opts);
    await fake.readLine();
    await fake.write("DATA\r\n");
    await fake.readLine();
    await fake.write("Subject: hi\r\nBody line 1\r\nBody line 2\r\n.\r\n");
    expect(await fake.readLine()).toBe("250 ok queued");
    expect(fake.written).toEqual(["DATA", "Subject: hi", "Body line 1", "Body line 2", "."]);
  });

  it("readBytes wirft NetError('protocol') — vom Fake nicht unterstuetzt", async () => {
    const fake = new FakeSocketTransport(["220 fake ESMTP"], []);
    await fake.connect(opts);
    await expect(fake.readBytes(4)).rejects.toMatchObject({ name: "NetError", code: "protocol" });
  });

  it("close() setzt closed=true", async () => {
    const fake = new FakeSocketTransport(["220 fake ESMTP"], []);
    await fake.connect(opts);
    expect(fake.closed).toBe(false);
    await fake.close();
    expect(fake.closed).toBe(true);
  });
});
