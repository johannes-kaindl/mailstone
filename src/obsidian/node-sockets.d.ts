// Minimal-Ambient-Deklaration fuer `node:tls`/`node:net`, nur fuer die dynamischen Imports in
// tls-transport.ts. `tsconfig.json` faehrt `types: []` (kein @types/node fuer src/), daher findet
// `import("node:tls")` sonst keine Typdeklaration (TS2307). Diese Datei ist bewusst KEIN Modul
// (kein Top-Level-import/export) — nur so deklariert `declare module "node:tls"` ein neues
// Ambient-Modul statt eine (fehlschlagende) Augmentation eines bereits aufgeloesten Moduls zu
// versuchen (TS2664). Ausschliesslich das hier tatsaechlich verwendete `connect(...)` ist getypt.
interface AmbientNodeSocketLike {
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end" | "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  once(event: "error", listener: (err: Error) => void): void;
  removeAllListeners(event: "data"): void;
  write(data: Uint8Array | string, cb: (err?: Error) => void): void;
  end(cb: () => void): void;
}

declare module "node:tls" {
  function connect(
    opts:
      | { host: string; port: number; servername: string }
      | { socket: AmbientNodeSocketLike; servername: string },
    cb: () => void,
  ): AmbientNodeSocketLike;
}

declare module "node:net" {
  function connect(opts: { host: string; port: number }, cb: () => void): AmbientNodeSocketLike;
}
