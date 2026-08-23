import { describe, it, expect, afterEach } from "vitest";
import * as net from "node:net";
import * as tls from "node:tls";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("upgradeTls", () => {
  /**
   * Erzeugt ein Wegwerf-selbstsigniertes Zertifikat fuer CN=localhost via openssl (vorhanden auf
   * macOS/Ubuntu-Runnern). Kein Skip-Pfad bei fehlendem openssl (Workspace-Lesson: ein
   * ueberspringbarer Check braucht einen begruendeten Skip-Pfad — hier gibt es keinen Grund dafuer,
   * also harter Fehlschlag mit klarer Fehlermeldung statt stillem Skip).
   */
  function makeSelfSignedCert(): { dir: string; key: string; cert: string } {
    const dir = mkdtempSync(join(tmpdir(), "mailstone-tls-"));
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    try {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          keyPath,
          "-out",
          certPath,
          "-days",
          "2",
          "-subj",
          "/CN=localhost",
        ],
        { stdio: "pipe" },
      );
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(
          "openssl nicht gefunden — der STARTTLS-Handshake-Test braucht openssl, um zur Testzeit ein " +
            "Wegwerf-Zertifikat zu erzeugen (auf macOS/Ubuntu-Runnern vorhanden). Bitte openssl installieren.",
        );
      }
      throw err;
    }
    return { dir, key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
  }

  /**
   * Plaintext-Server, der nach "STARTTLS\r\n" den rohen Socket in ein server-seitiges TLSSocket
   * einwickelt (isServer:true) und danach "220 secure\r\n" ueber TLS sendet. `sockets` sammelt
   * alle roh/TLS-Sockets fuer den Aufraeum-Schritt, damit `server.close()` nicht auf offene
   * Verbindungen wartet (siehe Lesson aus dem vorherigen Fix-Round: server.close() haengt, wenn
   * eine akzeptierte Verbindung nie geschlossen wird).
   */
  function startStarttlsServer(
    key: string,
    cert: string,
    sockets: Set<net.Socket | tls.TLSSocket>,
    opts?: { injectedLine?: string },
  ): Promise<{ server: net.Server; port: number }> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.write("220 plain\r\n");
        let plain = "";
        const onData = (chunk: Buffer): void => {
          plain += chunk.toString("utf8");
          if (!plain.includes("STARTTLS\r\n")) return;
          socket.removeListener("data", onData);
          // MITM-Simulation (opts.injectedLine): das go-ahead und eine zusaetzliche Klartext-Zeile
          // kommen in EINEM Write, damit der Client sie zusammen im Lesepuffer vorfindet, bevor er
          // ueberhaupt readLine() fuer "220 go" aufruft.
          socket.write(`220 go\r\n${opts?.injectedLine ?? ""}`);
          const secureSocket = new tls.TLSSocket(socket, { isServer: true, key, cert });
          sockets.add(secureSocket);
          secureSocket.on("close", () => sockets.delete(secureSocket));
          // Im Negativfall verweigert der Client das Zertifikat und bricht den Handshake ab —
          // das server-seitige TLSSocket meldet das als "error"; erwartet, nicht weiter behandeln.
          secureSocket.on("error", () => {});
          secureSocket.on("secure", () => {
            secureSocket.write("220 secure\r\n");
          });
        };
        socket.on("data", onData);
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr === null || typeof addr === "string") {
          reject(new Error("unexpected server address"));
          return;
        }
        resolve({ server, port: addr.port });
      });
    });
  }

  it(
    "STARTTLS-Handshake gegen lokalen TLS-Server — mit extraCa vertraut, ohne nicht (Zertifikatsprüfung bleibt aktiv)",
    async () => {
      const { dir, key, cert } = makeSelfSignedCert();
      const sockets = new Set<net.Socket | tls.TLSSocket>();
      let server: net.Server | null = null;
      try {
        const started = await startStarttlsServer(key, cert, sockets);
        server = started.server;
        const port = started.port;

        // Positiv: extraCa gesetzt → Zertifikat wird als vertrauenswuerdig akzeptiert.
        const trusting = nodeSocketTransport();
        await trusting.connect({
          host: "127.0.0.1",
          port,
          tls: "starttls",
          timeoutMs: 2000,
          servername: "localhost",
          extraCa: cert,
        });
        expect(await trusting.readLine()).toBe("220 plain");
        await trusting.write("STARTTLS\r\n");
        expect(await trusting.readLine()).toBe("220 go");
        await trusting.upgradeTls();
        expect(trusting.secure).toBe(true);
        expect(await trusting.readLine()).toBe("220 secure");
        await trusting.close();

        // Negativ: kein extraCa → selbstsigniertes Zertifikat ist nicht vertrauenswuerdig,
        // upgradeTls() muss ablehnen. Beweist, dass die Zertifikatsprüfung aktiv bleibt.
        const distrusting = nodeSocketTransport();
        await distrusting.connect({
          host: "127.0.0.1",
          port,
          tls: "starttls",
          timeoutMs: 2000,
          servername: "localhost",
        });
        expect(await distrusting.readLine()).toBe("220 plain");
        await distrusting.write("STARTTLS\r\n");
        expect(await distrusting.readLine()).toBe("220 go");
        await expect(distrusting.upgradeTls()).rejects.toMatchObject({ code: "tls" });
        await distrusting.close().catch(() => {});
      } finally {
        for (const s of sockets) s.destroy();
        if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
        rmSync(dir, { recursive: true, force: true });
      }
    },
    10000,
  );

  it(
    "upgradeTls() lehnt ab, wenn vor dem Handshake bereits Daten im Lesepuffer liegen (STARTTLS-Injection, CVE-2011-0411-Klasse)",
    async () => {
      const { dir, key, cert } = makeSelfSignedCert();
      const sockets = new Set<net.Socket | tls.TLSSocket>();
      let server: net.Server | null = null;
      try {
        const started = await startStarttlsServer(key, cert, sockets, { injectedLine: "250 injected\r\n" });
        server = started.server;
        const port = started.port;

        const transport = nodeSocketTransport();
        await transport.connect({
          host: "127.0.0.1",
          port,
          tls: "starttls",
          timeoutMs: 2000,
          servername: "localhost",
          extraCa: cert,
        });
        expect(await transport.readLine()).toBe("220 plain");
        await transport.write("STARTTLS\r\n");
        // Der Server hat "220 go\r\n250 injected\r\n" in einem Write geschickt — readLine() liest
        // nur die erste Zeile, "250 injected\r\n" bleibt im Lesepuffer.
        expect(await transport.readLine()).toBe("220 go");
        await expect(transport.upgradeTls()).rejects.toMatchObject({ code: "tls" });
        await transport.close().catch(() => {});
      } finally {
        for (const s of sockets) s.destroy();
        if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
        rmSync(dir, { recursive: true, force: true });
      }
    },
    10000,
  );
});
