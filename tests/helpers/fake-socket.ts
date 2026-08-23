import type { ConnectOptions, SocketTransport } from "../../src/core/net/types";
import { NetError } from "../../src/core/net/types";

/**
 * Ein Skript-Schritt im simulierten SMTP/IMAP-Dialog. `expect` matcht die naechste vollstaendige
 * Client-Zeile (String = exakter Vergleich, RegExp = test()); trifft sie zu, werden `send`-Zeilen
 * in den Lesepuffer gelegt und der Fake ruecht zum naechsten Schritt vor. `upgrade: true` markiert
 * einen STARTTLS-Handshake-Schritt: erst nach dessen Match ist `upgradeTls()` erlaubt.
 */
export interface DialogStep {
  expect?: RegExp | string;
  send?: string[];
  upgrade?: boolean;
}

/**
 * Node-/obsidian-freier Test-Doppelgaenger fuer SocketTransport. Faehrt ein fest verdrahtetes
 * Skript aus Server-Zeilen ab, die auf passende Client-Zeilen folgen — kein echtes Netzwerk.
 */
export class FakeSocketTransport implements SocketTransport {
  readonly written: string[] = [];
  closed = false;
  secure = false;
  readonly connectCalls: ConnectOptions[] = [];

  private readonly pending: string[] = [];
  private lineBuf = "";
  private stepIndex = 0;
  private awaitingUpgrade = false;

  constructor(
    private readonly greeting: string[],
    private readonly steps: DialogStep[],
  ) {}

  async connect(opts: ConnectOptions): Promise<void> {
    this.connectCalls.push(opts);
    this.secure = opts.tls === "implicit";
    this.pending.push(...this.greeting);
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
    this.lineBuf += text;
    let idx = this.lineBuf.indexOf("\r\n");
    while (idx !== -1) {
      const line = this.lineBuf.slice(0, idx);
      this.lineBuf = this.lineBuf.slice(idx + 2);
      this.consumeLine(line);
      idx = this.lineBuf.indexOf("\r\n");
    }
  }

  private consumeLine(line: string): void {
    // Jede vollstaendige Zeile wird protokolliert — auch DATA-Body-Zeilen, die keinen Step matchen,
    // bis der Ende-Marker-Step (expect: /^\.$/) sie mit einsammelt.
    this.written.push(line);
    const step = this.steps[this.stepIndex];
    if (!step) return;
    const matches =
      step.expect === undefined ? false : typeof step.expect === "string" ? line === step.expect : step.expect.test(line);
    if (!matches) return;
    this.stepIndex += 1;
    this.awaitingUpgrade = step.upgrade === true;
    if (step.send) this.pending.push(...step.send);
  }

  async readLine(): Promise<string> {
    const line = this.pending.shift();
    if (line === undefined) {
      throw new NetError("closed", "FakeSocketTransport: Skript erschoepft, keine weiteren Zeilen im Lesepuffer");
    }
    return line;
  }

  // SMTP liest nie binaer/laengenbasiert (nur zeilenbasiert per readLine), deshalb muss der Fake
  // readBytes nicht simulieren — ein Aufruf hier ist ein Fehler im getesteten Client.
  async readBytes(_n: number): Promise<Uint8Array> {
    throw new NetError("protocol", "FakeSocketTransport.readBytes wird nicht unterstuetzt");
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
