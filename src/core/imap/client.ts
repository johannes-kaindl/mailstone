// IMAP-Client als Zustandsautomat ueber SocketTransport (RFC 3501, Subset): CAPABILITY ->
// AUTHENTICATE PLAIN (Fallback LOGIN) -> EXAMINE -> UID SEARCH -> UID FETCH -> LOGOUT.
// Nur lesend: EXAMINE statt SELECT, BODY.PEEK statt BODY — ein Sync-Lauf darf \Seen nie setzen.
// Kein Node-/Obsidian-Import (siehe scripts/check-pure.mjs).
import type { SocketTransport, TlsMode } from "../net/types";
import { NetError } from "../net/types";
import { withTimeout, type TimeoutTimers } from "../../vendor/code-kit/timeout";
import { normalizeMessageId } from "../mime/headers";
import { assertNoCrlf, buildUidSet, chunk, encodeMailbox, quoteArg } from "./commands";
import { findAtomValue, firstLiteral, parseResponse, readRawLine } from "./parser";
import type { ImapErrorCode, ImapResponse } from "./types";

export interface ImapConnectOptions {
  host: string;
  port: number;
  /** TlsMode, nicht nur implicit/starttls: "none" ist ausschliesslich fuer einen lokalen
   *  Fake-Server auf 127.0.0.1 gedacht (wie smtp.tls === "none" in M2) und wird von der
   *  Settings-UI nie angeboten. */
  tls: TlsMode;
  username: string;
  password: string;
  /** Timer-Port fuer withTimeout — main.ts uebergibt `window`, Tests testTimers. */
  timers: TimeoutTimers;
  timeoutMs?: number;
  log?: (line: string) => void;
  /** Erlaubt AUTHENTICATE PLAIN/LOGIN ueber eine unverschluesselte Verbindung
   *  (transport.secure === false). NUR vom Aufrufer gesetzt, und dort ausschliesslich fuer
   *  tls==="none" auf einem Loopback-Host (lokaler Fake-IMAP-Server ohne TLS, z. B. im
   *  Integrationstest). Nie aus der Settings-UI erreichbar, nie fuer echte Server. */
  allowInsecureAuth?: boolean;
}

export interface ImapSession {
  readonly capabilities: string[];
  examine(mailbox: string): Promise<{ ok: true; uidValidity: number; exists: number } | { ok: false; code: ImapErrorCode; detail: string }>;
  uidSearchAll(): Promise<number[]>;
  /** uid → normalisierte Message-ID; null, wenn die Mail keinen Message-ID-Header hat. */
  uidFetchMessageIds(uids: readonly number[]): Promise<Map<number, string | null>>;
  /** Rohe RFC-5322-Bytes via BODY.PEEK[] — null, wenn die UID nicht mehr existiert. */
  uidFetchBody(uid: number): Promise<Uint8Array | null>;
  logout(): Promise<void>;
}

export type ImapConnectResult = { ok: true; session: ImapSession } | { ok: false; code: ImapErrorCode; detail: string };

const DEFAULT_TIMEOUT_MS = 30000;
/** UIDs je FETCH-Kommando. 200 haelt die Kommandozeile deutlich unter jeder ueblichen
 *  Laengengrenze und begrenzt zugleich, was ein einzelner Fehlschlag kostet. */
const HEADER_BATCH = 200;

interface Tagged { status: "OK" | "NO" | "BAD"; text: string; untagged: ImapResponse[] }

function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

class Connection {
  private counter = 0;
  constructor(
    readonly transport: SocketTransport,
    private readonly timeoutMs: number,
    private readonly timers: TimeoutTimers,
    private readonly log?: (line: string) => void,
  ) {}

  nextTag(): string {
    this.counter += 1;
    return `a${String(this.counter).padStart(3, "0")}`;
  }

  /** withTimeout liefert eine diskriminierte Union, keinen Wert — hier wird ein abgelaufener
   *  Schritt in den NetError uebersetzt, den der ganze Client ohnehin schon behandelt. Die
   *  Arbeit selbst bricht nicht ab (der Kit-Kommentar sagt das ausdruecklich); der Transport
   *  wird deshalb im Fehlerfall geschlossen, damit nichts im Hintergrund weiterlaeuft. */
  async guard<T>(work: Promise<T>, what: string): Promise<T> {
    const r = await withTimeout(work, this.timeoutMs, this.timers);
    if (r.timedOut) {
      await this.transport.close().catch(() => undefined);
      throw new NetError("timeout", `${what} hat nicht innerhalb von ${String(this.timeoutMs)} ms geantwortet`);
    }
    return r.value;
  }

  /** Schickt ein Kommando und liest bis zur gleichnamig getaggten Antwort. `masked` ersetzt die
   *  Zeile im Log (Passwoerter). Jeder Schritt laeuft unter guard() — ein haengendes FETCH
   *  darf den Intervall-Lauf nicht blockieren. */
  async command(tag: string, line: string, masked?: string): Promise<Tagged> {
    const full = `${tag} ${line}`;
    this.log?.(`C: ${masked ?? full}`);
    await this.guard(this.transport.write(`${full}\r\n`), "imap-write");
    const untagged: ImapResponse[] = [];
    for (;;) {
      const raw = await this.guard(readRawLine(this.transport), "imap-read");
      const r = parseResponse(raw);
      this.log?.(`S: ${raw.text}`);
      if (r.tag === tag) {
        const m = /^(OK|NO|BAD)\b\s*(.*)$/s.exec(r.text);
        if (!m) throw new NetError("protocol", `unverstaendliche Abschlusszeile: ${raw.text}`);
        return { status: m[1] as "OK" | "NO" | "BAD", text: m[2] ?? "", untagged };
      }
      if (r.tag !== "*" && r.tag !== "+") throw new NetError("protocol", `fremder Tag in der Antwort: ${raw.text}`);
      untagged.push(r);
    }
  }
}

function capabilitiesFrom(responses: ImapResponse[]): string[] {
  const out: string[] = [];
  for (const r of responses) {
    if (!/^\*\s+CAPABILITY\b/i.test(`* ${r.text}`)) continue;
    for (const it of r.items) if (it.kind === "atom" && it.value !== "*" && it.value.toUpperCase() !== "CAPABILITY") out.push(it.value.toUpperCase());
  }
  return out;
}

/** `* OK [UIDVALIDITY 42] …` — der Wert steckt im eckigen Klammer-Atom (siehe Tokenizer). */
function bracketNumber(responses: ImapResponse[], key: string): number | null {
  for (const r of responses) {
    for (const it of r.items) {
      if (it.kind !== "atom") continue;
      const m = new RegExp(`^\\[${key}\\s+(\\d+)\\]$`, "i").exec(it.value);
      if (m?.[1]) return Number(m[1]);
    }
  }
  return null;
}

function existsFrom(responses: ImapResponse[]): number {
  for (const r of responses) {
    const m = /^(\d+)\s+EXISTS$/i.exec(r.text);
    if (m?.[1]) return Number(m[1]);
  }
  return 0;
}

function messageIdFromHeader(bytes: Uint8Array): string | null {
  const text = new TextDecoder().decode(bytes);
  const m = /^message-id:\s*(.+)$/im.exec(text);
  return m?.[1] ? normalizeMessageId(m[1].trim()) : null;
}

/** Oeffentlicher Einstieg: faehrt den Dialog (runConnect) und schliesst den Transport auf jedem
 *  Fehlerpfad — der Aufrufer bekommt bei `ok:false` kein Session-Handle und kann selbst nicht
 *  schliessen. Im Erfolgsfall bleibt die Verbindung bewusst offen, die Session braucht sie noch.
 *  `result` bleibt undefined, wenn runConnect einen NICHT-NetError wirft (Programmierfehler) —
 *  auch dann wird aufgeraeumt, statt den Socket offenzulassen. */
export async function imapConnect(transport: SocketTransport, opts: ImapConnectOptions): Promise<ImapConnectResult> {
  let result: ImapConnectResult | undefined;
  try {
    result = await runConnect(transport, opts);
    return result;
  } finally {
    if ((!result || !result.ok) && !transport.closed) await transport.close().catch(() => undefined);
  }
}

async function runConnect(transport: SocketTransport, opts: ImapConnectOptions): Promise<ImapConnectResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const conn = new Connection(transport, timeoutMs, opts.timers, opts.log);
  try {
    assertNoCrlf(opts.username, "Benutzername");
    assertNoCrlf(opts.password, "Passwort");
    await conn.guard(transport.connect({ host: opts.host, port: opts.port, tls: opts.tls, timeoutMs }), "imap-connect");

    const greeting = await conn.guard(readRawLine(transport), "imap-greeting");
    opts.log?.(`S: ${greeting.text}`);
    if (!/^\*\s+(OK|PREAUTH)\b/i.test(greeting.text)) return { ok: false, code: "protocol", detail: `Greeting nicht OK: ${greeting.text}` };

    if (opts.tls === "starttls") {
      const tag = conn.nextTag();
      const r = await conn.command(tag, "STARTTLS");
      if (r.status !== "OK") return { ok: false, code: "tls-required", detail: r.text };
      await conn.guard(transport.upgradeTls(), "imap-starttls");
    }

    const capTag = conn.nextTag();
    const cap = await conn.command(capTag, "CAPABILITY");
    if (cap.status !== "OK") return { ok: false, code: "protocol", detail: `CAPABILITY abgelehnt: ${cap.text}` };
    const capabilities = capabilitiesFrom(cap.untagged);

    if (capabilities.includes("LOGINDISABLED") && !capabilities.includes("AUTH=PLAIN")) {
      return { ok: false, code: "tls-required", detail: "Server erlaubt keine Anmeldung auf dieser Verbindung (LOGINDISABLED)" };
    }

    // Klartext-Zugangsdaten nie ohne TLS auf die Leitung — weder bei tls:"none" noch wenn ein
    // STARTTLS-Upgrade nicht tatsaechlich griff (transport.secure spiegelt genau das, nicht die
    // angeforderte opts.tls). Nur der Aufrufer darf das fuer einen lokalen Fake-Server aufheben.
    if (!transport.secure && !opts.allowInsecureAuth) {
      return { ok: false, code: "tls-required", detail: "keine Klartext-Authentifizierung ohne TLS" };
    }

    const authTag = conn.nextTag();
    const auth = capabilities.includes("AUTH=PLAIN")
      ? await conn.command(authTag, `AUTHENTICATE PLAIN ${base64Utf8(`\0${opts.username}\0${opts.password}`)}`, `${authTag} AUTHENTICATE PLAIN ****`)
      : await conn.command(authTag, `LOGIN ${quoteArg(opts.username)} ${quoteArg(opts.password)}`, `${authTag} LOGIN **** ****`);
    if (auth.status !== "OK") return { ok: false, code: "auth", detail: auth.text };

    return { ok: true, session: makeSession(conn, capabilities) };
  } catch (e) {
    if (e instanceof NetError) return { ok: false, code: e.code, detail: e.message };
    throw e;
  }
}

function makeSession(conn: Connection, capabilities: string[]): ImapSession {
  return {
    capabilities,

    async examine(mailbox) {
      const tag = conn.nextTag();
      const r = await conn.command(tag, `EXAMINE ${quoteArg(encodeMailbox(mailbox))}`);
      if (r.status === "NO") return { ok: false, code: "folder-missing", detail: r.text };
      if (r.status !== "OK") return { ok: false, code: "protocol", detail: r.text };
      const uidValidity = bracketNumber(r.untagged, "UIDVALIDITY");
      if (uidValidity === null) return { ok: false, code: "protocol", detail: "keine UIDVALIDITY in der EXAMINE-Antwort" };
      return { ok: true, uidValidity, exists: existsFrom(r.untagged) };
    },

    async uidSearchAll() {
      const tag = conn.nextTag();
      const r = await conn.command(tag, "UID SEARCH ALL");
      if (r.status !== "OK") throw new NetError("protocol", `UID SEARCH abgelehnt: ${r.text}`);
      const uids: number[] = [];
      for (const resp of r.untagged) {
        if (!/^SEARCH\b/i.test(resp.text)) continue;
        for (const part of resp.text.split(/\s+/).slice(1)) {
          const n = Number(part);
          if (Number.isSafeInteger(n) && n > 0) uids.push(n);
        }
      }
      return uids;
    },

    async uidFetchMessageIds(uids) {
      const out = new Map<number, string | null>();
      for (const batch of chunk(uids, HEADER_BATCH)) {
        if (batch.length === 0) continue;
        const tag = conn.nextTag();
        const r = await conn.command(tag, `UID FETCH ${buildUidSet(batch)} (BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])`);
        if (r.status !== "OK") throw new NetError("protocol", `UID FETCH (Header) abgelehnt: ${r.text}`);
        for (const resp of r.untagged) {
          const list = resp.items.find((i) => i.kind === "list");
          if (list?.kind !== "list") continue;
          const uidText = findAtomValue(list.items, "UID");
          const bytes = firstLiteral(list.items);
          if (!uidText || !bytes) continue;
          out.set(Number(uidText), messageIdFromHeader(bytes));
        }
      }
      return out;
    },

    async uidFetchBody(uid) {
      const tag = conn.nextTag();
      const r = await conn.command(tag, `UID FETCH ${String(uid)} (BODY.PEEK[])`);
      if (r.status !== "OK") throw new NetError("protocol", `UID FETCH (Body) abgelehnt: ${r.text}`);
      for (const resp of r.untagged) {
        const list = resp.items.find((i) => i.kind === "list");
        if (list?.kind !== "list") continue;
        if (findAtomValue(list.items, "UID") !== String(uid)) continue;
        const bytes = firstLiteral(list.items);
        if (bytes) return bytes;
      }
      return null;
    },

    async logout() {
      try {
        await conn.command(conn.nextTag(), "LOGOUT");
      } catch {
        /* Ein gescheiterter LOGOUT ist folgenlos — die Verbindung wird ohnehin geschlossen. */
      } finally {
        if (!conn.transport.closed) await conn.transport.close().catch(() => undefined);
      }
    },
  };
}
