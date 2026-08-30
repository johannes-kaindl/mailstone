import type { ConnectOptions, SocketTransport } from "../../src/core/net/types";
import { NetError } from "../../src/core/net/types";

/** Server-Antwort eines Dialog-Schritts: String = Zeile (CRLF wird angehaengt),
 *  Uint8Array = rohe Bytes ohne Zusatz (IMAP-Literal-Inhalt). */
export type SendPart = string | Uint8Array;

/**
 * Ein Skript-Schritt im simulierten SMTP/IMAP-Dialog. `expect` matcht die naechste vollstaendige
 * Client-Zeile (String = exakter Vergleich, RegExp = test()); trifft sie zu, werden `send`-Teile
 * in den Lesepuffer gelegt und der Fake ruecht zum naechsten Schritt vor. `upgrade: true` markiert
 * einen STARTTLS-Handshake-Schritt: erst nach dessen Match ist `upgradeTls()` erlaubt.
 */
export interface DialogStep {
  expect?: RegExp | string;
  send?: SendPart[];
  upgrade?: boolean;
}

const CRLF = new TextEncoder().encode("\r\n");

function toBytes(part: SendPart): Uint8Array {
  if (part instanceof Uint8Array) return part;
  const line = new TextEncoder().encode(part);
  const out = new Uint8Array(line.byteLength + CRLF.byteLength);
  out.set(line, 0);
  out.set(CRLF, line.byteLength);
  return out;
}

/**
 * Node-/obsidian-freier Test-Doppelgaenger fuer SocketTransport. Faehrt ein fest verdrahtetes
 * Skript aus Server-Bytes ab, die auf passende Client-Zeilen folgen — kein echtes Netzwerk.
 *
 * Puffer ist byte-genau statt zeilenweise: `readLine` schneidet bis zum naechsten CRLF, `readBytes`
 * schneidet n Bytes ab — beide aus demselben Puffer, damit ein IMAP-Literal mitten in einer Zeile
 * enden darf (`{2048}` am Zeilenende, gefolgt von rohen Bytes, gefolgt vom Rest der Zeile).
 */
export class FakeSocketTransport implements SocketTransport {
  readonly written: string[] = [];
  readonly connectCalls: ConnectOptions[] = [];
  closed = true;
  secure = false;

  /** Ungelesene Server-Bytes. readLine schneidet bis CRLF, readBytes schneidet n Bytes ab. */
  private buffer: Uint8Array = new Uint8Array(0);
  private stepIndex = 0;
  private awaitingUpgrade = false;
  /** Angefangene Client-Zeile: write() darf mit beliebigen Bruchstuecken aufgerufen werden. */
  private partial = "";

  constructor(
    private readonly greeting: SendPart[],
    private readonly steps: DialogStep[],
  ) {}

  private push(parts: SendPart[]): void {
    for (const p of parts) {
      const b = toBytes(p);
      const next = new Uint8Array(this.buffer.byteLength + b.byteLength);
      next.set(this.buffer, 0);
      next.set(b, this.buffer.byteLength);
      this.buffer = next;
    }
  }

  private take(n: number): Uint8Array {
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.slice(n);
    return out;
  }

  async connect(opts: ConnectOptions): Promise<void> {
    this.connectCalls.push(opts);
    this.closed = false;
    this.secure = opts.tls === "implicit";
    this.push(this.greeting);
    return Promise.resolve();
  }

  async upgradeTls(): Promise<void> {
    if (!this.awaitingUpgrade) {
      throw new NetError("protocol", "upgradeTls() unerwartet: der aktuelle Dialog-Step erlaubt kein STARTTLS");
    }
    this.awaitingUpgrade = false;
    this.secure = true;
  }

  async write(data: Uint8Array | string): Promise<void> {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    this.partial += text;
    for (;;) {
      const nl = this.partial.indexOf("\r\n");
      if (nl === -1) break;
      const line = this.partial.slice(0, nl);
      this.partial = this.partial.slice(nl + 2);
      this.written.push(line);
      this.matchStep(line);
    }
    return Promise.resolve();
  }

  private matchStep(line: string): void {
    // Jede vollstaendige Zeile wird protokolliert — auch DATA-Body-Zeilen, die keinen Step matchen,
    // bis der Ende-Marker-Step (expect: /^\.$/) sie mit einsammelt.
    const step = this.steps[this.stepIndex];
    if (!step) return;
    const hit =
      step.expect === undefined ? false : typeof step.expect === "string" ? step.expect === line : step.expect.test(line);
    if (!hit) return;
    this.stepIndex += 1;
    this.awaitingUpgrade = step.upgrade === true;
    if (step.send) this.push(step.send);
  }

  async readLine(): Promise<string> {
    for (let i = 0; i + 1 < this.buffer.byteLength; i++) {
      if (this.buffer[i] === 13 && this.buffer[i + 1] === 10) {
        const line = new TextDecoder().decode(this.take(i));
        this.take(2);
        return Promise.resolve(line);
      }
    }
    throw new NetError("closed", "Fake-Skript zu Ende (keine vollstaendige Zeile mehr im Puffer)");
  }

  async readBytes(n: number): Promise<Uint8Array> {
    if (this.buffer.byteLength < n) {
      throw new NetError("closed", `Fake-Skript hat nur ${String(this.buffer.byteLength)} von ${String(n)} Bytes`);
    }
    return Promise.resolve(this.take(n));
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
