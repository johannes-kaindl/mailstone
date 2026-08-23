import { describe, it, expect, afterEach } from "vitest";
import * as net from "node:net";
import { loadNodeNet, nodeSocketTransport } from "../../src/obsidian/tls-transport";
import { Platform } from "../vendor/kit/obsidian-mock";

describe("loadNodeNet", () => {
  it("liefert unter Platform.isDesktop=true ein Objekt mit tls.connect", async () => {
    const mods = await loadNodeNet();
    expect(mods).not.toBeNull();
    expect(typeof mods?.tls.connect).toBe("function");
  });

  it("liefert unter Platform.isDesktop=false null", async () => {
    const prev = Platform.isDesktop;
    Platform.isDesktop = false;
    try {
      const mods = await loadNodeNet();
      expect(mods).toBeNull();
    } finally {
      Platform.isDesktop = prev;
    }
  });
});

describe("nodeSocketTransport", () => {
  let server: net.Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
  });

  function listen(handler: (socket: net.Socket) => void): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = net.createServer(handler);
      server = s;
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const addr = s.address();
        if (addr === null || typeof addr === "string") {
          reject(new Error("unexpected server address"));
          return;
        }
        resolve(addr.port);
      });
    });
  }

  it("verbindet, liest eine Zeile, schreibt, und schliesst sauber", async () => {
    const received: string[] = [];
    const port = await listen((socket) => {
      socket.write("220 hi\r\n");
      socket.on("data", (d: Buffer) => received.push(d.toString("utf8")));
    });

    const transport = nodeSocketTransport();
    await transport.connect({ host: "127.0.0.1", port, tls: "none", timeoutMs: 1000 });
    expect(transport.secure).toBe(false);
    expect(transport.closed).toBe(false);

    const line = await transport.readLine();
    expect(line).toBe("220 hi");

    await transport.write("X\r\n");
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (received.join("").includes("X\r\n")) resolve();
        else setImmediate(check);
      };
      check();
    });
    expect(received.join("")).toContain("X\r\n");

    await transport.close();
    expect(transport.closed).toBe(true);
  });

  it("wirft NetError(connect) bei Verbindung zu geschlossenem Port", async () => {
    // Port 0 als "listen" liefert einen freien Port; wir schliessen sofort wieder, sodass er frei bleibt aber niemand lauscht.
    const port = await listen(() => {});
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;

    const transport = nodeSocketTransport();
    await expect(transport.connect({ host: "127.0.0.1", port, tls: "none", timeoutMs: 1000 })).rejects.toMatchObject({
      code: "connect",
    });
  });

  it("wirft NetError(timeout) wenn readLine innerhalb von timeoutMs nichts erhaelt", async () => {
    const port = await listen(() => {
      // Server nimmt an, sendet aber nichts.
    });

    const transport = nodeSocketTransport();
    await transport.connect({ host: "127.0.0.1", port, tls: "none", timeoutMs: 200 });
    await expect(transport.readLine()).rejects.toMatchObject({ code: "timeout" });
    await transport.close();
  });
});
