// Transport-Vertrag fuer IMAP/SMTP-Verbindungen. Keine Implementierung hier — die Obsidian-/Node-
// gebundenen Adapter (echter Socket, Fake fuer Tests) implementieren dieses Interface ausserhalb von
// core/, damit core/ selbst frei von obsidian-/node-Imports bleibt (siehe scripts/check-pure.mjs).

export type TlsMode = "implicit" | "starttls" | "none";

export interface ConnectOptions {
  host: string;
  port: number;
  tls: TlsMode;
  timeoutMs: number;
  servername?: string;
  /** Zusätzliche Vertrauensanker NUR für Tests/lokale Fake-Server; die Zertifikatsprüfung selbst
   *  bleibt immer aktiv — es gibt bewusst keine Option, sie abzuschalten. */
  extraCa?: string;
}

/** Die Codes als LISTE, der Typ daraus abgeleitet — nicht umgekehrt. Grund: `parseRunState`
 *  muss einen Code aus `data.json` zur Laufzeit gegen die gueltigen Werte pruefen, und eine
 *  von Hand gepflegte zweite Aufzaehlung liefe beim naechsten neuen Code auseinander. So
 *  ergaenzt, wer den Typ erweitert, zwangslaeufig auch die Pruefung. */
export const NET_ERROR_CODES = ["connect", "tls", "timeout", "closed", "protocol"] as const;

export type NetErrorCode = (typeof NET_ERROR_CODES)[number];

export class NetError extends Error {
  constructor(
    public readonly code: NetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NetError";
  }
}

export interface SocketTransport {
  connect(opts: ConnectOptions): Promise<void>;
  upgradeTls(): Promise<void>;
  write(data: Uint8Array | string): Promise<void>;
  /** Liefert die naechste Zeile ohne CRLF. Wirft NetError("closed") bei EOF, NetError("timeout") nach timeoutMs. */
  readLine(): Promise<string>;
  readBytes(n: number): Promise<Uint8Array>;
  close(): Promise<void>;
  readonly closed: boolean;
  /** true nach implizitem TLS (connect mit tls:"implicit") oder nach erfolgreichem upgradeTls(). */
  readonly secure: boolean;
}
