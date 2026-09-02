// IMAP-Client als Zustandsautomat ueber SocketTransport (RFC 3501, Subset): CAPABILITY ->
// AUTHENTICATE PLAIN (nur mit SASL-IR, sonst LOGIN) -> EXAMINE -> UID SEARCH -> UID FETCH -> LOGOUT.
// Nur lesend: EXAMINE statt SELECT, BODY.PEEK statt BODY — ein Sync-Lauf darf \Seen nie setzen.
// Kein Node-/Obsidian-Import (siehe scripts/check-pure.mjs).
import type { SocketTransport, TlsMode } from "../net/types";
import { NetError } from "../net/types";
import { withTimeout, type TimeoutTimers } from "../../vendor/code-kit/timeout";
import { normalizeMessageId } from "../mime/headers";
import { assertNoCrlf, buildUidSet, chunk, encodeMailbox, quoteArg } from "./commands";
import { findAtomValue, firstLiteral, parseResponse, readRawLine } from "./parser";
import type { ImapErrorCode, ImapResponse } from "./types";
import { MAX_UNTAGGED_PER_COMMAND } from "./types";

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
  /** Legt eine Nachricht in einem Ordner ab (RFC 3501 § 6.3.11). Der einzige schreibende
   *  Vorgang dieses Clients — er faellt bewusst NICHT unter den Nur-lesend-Vertrag des Syncs,
   *  weil er eine selbst versandte Mail ablegt, statt fremde zu veraendern. */
  append(mailbox: string, bytes: Uint8Array, flags?: readonly string[]): Promise<{ ok: true } | { ok: false; code: ImapErrorCode; detail: string }>;
  logout(): Promise<void>;
}

export type ImapConnectResult = { ok: true; session: ImapSession } | { ok: false; code: ImapErrorCode; detail: string };

const DEFAULT_TIMEOUT_MS = 30000;
/** UIDs je FETCH-Kommando. 200 haelt die Kommandozeile deutlich unter jeder ueblichen
 *  Laengengrenze und begrenzt zugleich, was ein einzelner Fehlschlag kostet. */
const HEADER_BATCH = 200;

interface Tagged { status: "OK" | "NO" | "BAD"; text: string; untagged: ImapResponse[] }

/** Sammelt eine untagged Antwort und haelt dabei die Obergrenze ein. Jeder einzelne Read steht
 *  unter Timeout, die Sammelschleife um ihn herum nicht — ein Server, der ohne Pause
 *  weiterschickt, haelt also jede Frist ein und liesse das Array trotzdem unbegrenzt wachsen.
 *  Derselbe Gedanke wie MAX_LITERAL_BYTES, nur fuer die Anzahl statt die Groesse. */
function pushUntagged(untagged: ImapResponse[], r: ImapResponse): void {
  if (untagged.length >= MAX_UNTAGGED_PER_COMMAND) {
    throw new NetError("protocol", `mehr als ${String(MAX_UNTAGGED_PER_COMMAND)} untagged Antworten auf ein Kommando`);
  }
  untagged.push(r);
}

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
   *  Zeile im Log (Passwoerter) und wird — wie `line` — OHNE Tag uebergeben; das Tag setzt diese
   *  Methode davor. Bis 2026-08-30 trugen die beiden Parameter unterschiedliche Konventionen, was
   *  eine Log-Zeile ohne Tag ergab, sobald jemand sie verwechselte. Jeder Schritt laeuft unter
   *  guard() — ein haengendes FETCH darf den Intervall-Lauf nicht blockieren. */
  async command(tag: string, line: string, masked?: string): Promise<Tagged> {
    const full = `${tag} ${line}`;
    this.log?.(`C: ${masked === undefined ? full : `${tag} ${masked}`}`);
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
      pushUntagged(untagged, r);
    }
  }

  /** Kommando mit anschliessendem Literal (RFC 3501 § 4.3): erst die Groessenankuendigung,
   *  dann wartet der Server-Dialog auf ein `+`, und ERST DANN gehen die Bytes raus. Lehnt der
   *  Server stattdessen direkt ab (`NO`/`BAD` — etwa fehlender Ordner oder volles Postfach),
   *  duerfen die Bytes nicht mehr geschrieben werden; sie waeren sonst herrenlose Daten auf
   *  einer Leitung, die schon auf das naechste Kommando wartet. */
  async commandWithLiteral(tag: string, line: string, bytes: Uint8Array): Promise<Tagged> {
    this.log?.(`C: ${line} (${String(bytes.byteLength)} Bytes folgen)`);
    await this.guard(this.transport.write(`${tag} ${line}\r\n`), "imap-write");

    const untagged: ImapResponse[] = [];
    for (;;) {
      const raw = await this.guard(readRawLine(this.transport), "imap-read");
      const r = parseResponse(raw);
      this.log?.(`S: ${raw.text}`);
      if (r.tag === tag) {
        // Abschluss VOR der Continuation = Ablehnung. Bytes bleiben ungeschrieben.
        const m = /^(OK|NO|BAD)\b\s*(.*)$/s.exec(r.text);
        if (!m) throw new NetError("protocol", `unverstaendliche Abschlusszeile: ${raw.text}`);
        return { status: m[1] as "OK" | "NO" | "BAD", text: m[2] ?? "", untagged };
      }
      if (r.tag === "+") break;
      if (r.tag !== "*") throw new NetError("protocol", `fremder Tag in der Antwort: ${raw.text}`);
      pushUntagged(untagged, r);
    }

    await this.guard(this.transport.write(bytes), "imap-write-literal");
    await this.guard(this.transport.write("\r\n"), "imap-write");
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
      pushUntagged(untagged, r);
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

/** Capabilities aus einem Response-Code `[CAPABILITY a b c]` einer Tagged-Antwort. Viele Server
 *  kuendigen MOVE/UIDPLUS erst NACH der Anmeldung an — wer nur die Prae-Auth-Liste liest, haelt
 *  einen faehigen Server fuer unfaehig. */
function capabilitiesFromCode(text: string): string[] {
  const m = /\[CAPABILITY\s+([^\]]+)\]/i.exec(text);
  if (!m || m[1] === undefined) return [];
  return m[1].split(/\s+/).filter((v) => v.length > 0).map((v) => v.toUpperCase());
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

    // Die Initial-Response-Form `AUTHENTICATE PLAIN <base64>` ist RFC 4959 und setzt die
    // Capability SASL-IR voraus — AUTH=PLAIN allein sagt nur, dass der Mechanismus existiert.
    // Ein Server, der PLAIN ohne SASL-IR ankuendigt, antwortet auf diese Form BAD; der Client
    // meldete dann "auth", der Nutzer gaebe sein Passwort immer wieder neu ein und kaeme nie
    // hinein. Fehlt SASL-IR, nimmt der Client deshalb LOGIN — die mehrstufige
    // Continuation-Form von AUTHENTICATE spricht dieses Subset bewusst nicht.
    const canSaslIr = capabilities.includes("AUTH=PLAIN") && capabilities.includes("SASL-IR");

    // LOGINDISABLED wird an genau dieselbe Bedingung gehaengt: ohne SASL-IR bliebe nur LOGIN,
    // und das hat der Server hier gerade verboten — es gibt dann kein nutzbares Verfahren.
    if (capabilities.includes("LOGINDISABLED") && !canSaslIr) {
      return { ok: false, code: "tls-required", detail: "Server erlaubt keine Anmeldung auf dieser Verbindung (LOGINDISABLED)" };
    }

    // Klartext-Zugangsdaten nie ohne TLS auf die Leitung — weder bei tls:"none" noch wenn ein
    // STARTTLS-Upgrade nicht tatsaechlich griff (transport.secure spiegelt genau das, nicht die
    // angeforderte opts.tls). Nur der Aufrufer darf das fuer einen lokalen Fake-Server aufheben.
    if (!transport.secure && !opts.allowInsecureAuth) {
      return { ok: false, code: "tls-required", detail: "keine Klartext-Authentifizierung ohne TLS" };
    }

    const authTag = conn.nextTag();
    const auth = canSaslIr
      ? await conn.command(authTag, `AUTHENTICATE PLAIN ${base64Utf8(`\0${opts.username}\0${opts.password}`)}`, `AUTHENTICATE PLAIN ****`)
      : await conn.command(authTag, `LOGIN ${quoteArg(opts.username)} ${quoteArg(opts.password)}`, `LOGIN **** ****`);
    if (auth.status !== "OK") return { ok: false, code: "auth", detail: auth.text };

    // Vereinigung aus drei Quellen: Prae-Auth-CAPABILITY, untagged `* CAPABILITY` der
    // Auth-Antwort und deren Response-Code. Set statt Array-Suche, damit die Reihenfolge
    // der Quellen keine Duplikate erzeugt.
    const alle = new Set([...capabilities, ...capabilitiesFrom(auth.untagged), ...capabilitiesFromCode(auth.text)]);
    return { ok: true, session: makeSession(conn, [...alle]) };
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
        // Numerisch vergleichen wie in uidFetchMessageIds: ein Zeichenketten-Vergleich haette
        // "007" nicht als 7 erkannt und die Antwort stillschweigend verworfen.
        if (Number(findAtomValue(list.items, "UID")) !== uid) continue;
        const bytes = firstLiteral(list.items);
        if (bytes) return bytes;
      }
      return null;
    },

    async append(mailbox, bytes, flags) {
      const tag = conn.nextTag();
      const flagTeil = flags && flags.length > 0 ? ` (${flags.join(" ")})` : "";
      const r = await conn.commandWithLiteral(
        tag,
        `APPEND ${quoteArg(encodeMailbox(mailbox))}${flagTeil} {${String(bytes.byteLength)}}`,
        bytes,
      );
      if (r.status === "OK") return { ok: true };
      // TRYCREATE ist die Antwort auf einen fehlenden Ordner; jedes andere NO/BAD hat einen
      // anderen Grund (Quota, Rechte) und wird nicht als "Ordner fehlt" ausgegeben.
      const fehlt = r.status === "NO" && /TRYCREATE|does\s*n.?t exist|unknown mailbox/i.test(r.text);
      return { ok: false, code: fehlt ? "folder-missing" : "protocol", detail: r.text };
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
