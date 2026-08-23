// Node-Socket-Transport hinter Platform.isDesktop-Guard (Spec § 1.1/§ 5). Implementiert
// SocketTransport aus src/core/net/types.ts mit einem echten TCP/TLS-Socket — ausserhalb von
// src/core/, damit core frei von obsidian-/node-Imports bleibt (siehe scripts/check-pure.mjs).
//
// tsconfig.json faehrt `types: []` (kein @types/node fuer src/) — deshalb kein `Buffer`, kein
// statischer `node:*`-Typimport. Empfangene Bytes werden als wachsendes Uint8Array gehalten,
// CRLF wird manuell gesucht, Dekodierung laeuft ueber TextDecoder. Die Node-Module selbst laden
// nur ueber dynamischen `import("node:...")` (die einzige store-saubere Form fuer Node-Builtins;
// das esbuild-Plugin `node-builtin-require` schreibt ihn im Bundle auf `require()` um) und werden
// mit lokalen Minimal-Interfaces getypt, da `import("node:tls")` unter `types: []` keine
// Typdeklarationen findet.
import { Platform } from "obsidian";
import { NetError, type ConnectOptions, type SocketTransport } from "../core/net/types";

/** Minimaler Ausschnitt der node:net/node:tls-Socket-API, den dieser Adapter braucht. */
interface NodeSocketLike {
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end" | "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  once(event: "error", listener: (err: Error) => void): void;
  removeAllListeners(event: "data"): void;
  write(data: Uint8Array | string, cb: (err?: Error) => void): void;
  end(cb: () => void): void;
}

interface NetModule {
  connect(opts: { host: string; port: number }, cb: () => void): NodeSocketLike;
}

interface TlsModule {
  connect(
    opts: { host: string; port: number; servername: string } | { socket: NodeSocketLike; servername: string },
    cb: () => void,
  ): NodeSocketLike;
}

// `import("node:tls")`/`import("node:net")` finden unter `types: []` (kein @types/node fuer src/)
// keine Typdeklaration (TS2307). Statt eines Casts (verboten waere @ts-ignore/@ts-expect-error)
// deklariert `node-sockets.d.ts` daneben genau die Minimal-Form, die diese Datei braucht — `tsc`
// loest den dynamischen Import damit ganz reell gegen dieses Ambient-Modul auf, kein Any im Spiel.
export async function loadNodeNet(): Promise<{ tls: TlsModule; net: NetModule } | null> {
  if (!Platform.isDesktop) return null;
  // Registry § Node-Builtin desktop-only: dynamischer Import ist die einzige store-saubere Form;
  // esbuild-Plugin node-builtin-require schreibt ihn im Bundle auf require() um.
  const [tls, net] = await Promise.all([import("node:tls"), import("node:net")]);
  return { tls, net };
}

const CR = 0x0d;
const LF = 0x0a;

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Sucht das erste CRLF ab `from`; -1, wenn keins vorhanden ist. */
function indexOfCrlf(buf: Uint8Array, from: number): number {
  for (let i = from; i < buf.length - 1; i += 1) {
    if (buf[i] === CR && buf[i + 1] === LF) return i;
  }
  return -1;
}

const decoder = new TextDecoder("utf-8");

export function nodeSocketTransport(): SocketTransport {
  let sock: NodeSocketLike | null = null;
  let buf: Uint8Array = new Uint8Array(0);
  let eof = false;
  let sockErr: Error | null = null;
  let waiter: (() => void) | null = null;
  let timeoutMs = 30000;
  let secure = false;
  let hostName = "";

  const wake = (): void => {
    const w = waiter;
    waiter = null;
    w?.();
  };

  const attach = (s: NodeSocketLike): void => {
    sock = s;
    s.on("data", (d: Uint8Array) => {
      buf = concat(buf, d);
      wake();
    });
    s.on("end", () => {
      eof = true;
      wake();
    });
    s.on("close", () => {
      eof = true;
      wake();
    });
    s.on("error", (e: Error) => {
      sockErr = e;
      eof = true;
      wake();
    });
  };

  const waitData = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const t = window.setTimeout(() => {
        waiter = null;
        reject(new NetError("timeout", `no data within ${timeoutMs} ms`));
      }, timeoutMs);
      waiter = () => {
        window.clearTimeout(t);
        resolve();
      };
    });

  return {
    get closed() {
      return sock === null || eof;
    },
    get secure() {
      return secure;
    },

    async connect(opts: ConnectOptions) {
      const mods = await loadNodeNet();
      if (!mods) throw new NetError("connect", "desktop only");
      timeoutMs = opts.timeoutMs;
      hostName = opts.servername ?? opts.host;
      await new Promise<void>((resolve, reject) => {
        const onErr = (e: Error): void => reject(new NetError(opts.tls === "implicit" ? "tls" : "connect", e.message));
        if (opts.tls === "implicit") {
          const s = mods.tls.connect({ host: opts.host, port: opts.port, servername: hostName }, () => {
            secure = true;
            resolve();
          });
          s.once("error", onErr);
          attach(s);
        } else {
          const s = mods.net.connect({ host: opts.host, port: opts.port }, () => resolve());
          s.once("error", onErr);
          attach(s);
        }
      });
    },

    async upgradeTls() {
      const mods = await loadNodeNet();
      if (!mods || !sock) throw new NetError("tls", "no socket");
      const plain = sock;
      await new Promise<void>((resolve, reject) => {
        const s = mods.tls.connect({ socket: plain, servername: hostName }, () => {
          secure = true;
          resolve();
        });
        s.once("error", (e: Error) => reject(new NetError("tls", e.message)));
        plain.removeAllListeners("data");
        attach(s);
      });
    },

    async write(data) {
      if (!sock || eof) throw new NetError("closed", "socket closed");
      const s = sock;
      await new Promise<void>((resolve, reject) => {
        s.write(data, (e) => (e ? reject(new NetError("closed", e.message)) : resolve()));
      });
    },

    async readLine() {
      for (;;) {
        const i = indexOfCrlf(buf, 0);
        if (i >= 0) {
          const line = decoder.decode(buf.subarray(0, i));
          buf = buf.subarray(i + 2);
          return line;
        }
        if (sockErr) throw new NetError("closed", sockErr.message);
        if (eof) throw new NetError("closed", "EOF");
        await waitData();
      }
    },

    async readBytes(n) {
      while (buf.length < n) {
        if (sockErr) throw new NetError("closed", sockErr.message);
        if (eof) throw new NetError("closed", "EOF");
        await waitData();
      }
      const out = buf.subarray(0, n);
      buf = buf.subarray(n);
      return out;
    },

    async close() {
      if (sock && !eof) {
        const s = sock;
        await new Promise<void>((resolve) => s.end(() => resolve()));
      }
      eof = true;
    },
  };
}
