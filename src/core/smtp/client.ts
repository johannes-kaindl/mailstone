// SMTP-Client als Zustandsautomat ueber SocketTransport (RFC 5321): Greeting -> EHLO -> optional
// STARTTLS -> AUTH PLAIN -> MAIL FROM -> RCPT TO (je Empfaenger) -> DATA -> QUIT. Kein Node-/
// Obsidian-Import hier (siehe scripts/check-pure.mjs) — der Transport ist die einzige Aussenwelt.
import type { NetErrorCode, SocketTransport } from "../net/types";
import { NetError } from "../net/types";
import { dotStuff } from "./dotstuff";

export type SmtpErrorCode = "tls-required" | "auth" | "sender-rejected" | "recipient-rejected" | "data-rejected" | "protocol" | NetErrorCode;

export interface SmtpSendOptions {
  host: string;
  port: number;
  tls: "implicit" | "starttls";
  username: string;
  password: string;
  /** Envelope-Absender (MAIL FROM). */
  from: string;
  recipients: string[];
  message: Uint8Array;
  timeoutMs?: number;
  /** Bekommt jede Protokollzeile (Client als "C: ", Server als "S: "). AUTH PLAIN wird maskiert. */
  log?: (line: string) => void;
}

export type SmtpSendResult = { ok: true; response: string; rejected?: string[] } | { ok: false; code: SmtpErrorCode; detail: string; rejected?: string[] };

const DEFAULT_TIMEOUT_MS = 30000;

interface SmtpResponse {
  code: number;
  lines: string[];
}

async function readResponse(t: SocketTransport, log?: (line: string) => void): Promise<SmtpResponse | { protocolError: string }> {
  const lines: string[] = [];
  for (;;) {
    const line = await t.readLine();
    log?.(`S: ${line}`);
    const match = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!match) return { protocolError: `unerwartete Antwortzeile: ${line}` };
    const code = Number(match[1]);
    const sep = match[2];
    lines.push(line);
    if (sep === " ") return { code, lines };
  }
}

async function send(t: SocketTransport, line: string, log?: (line: string) => void, maskedLog?: string): Promise<void> {
  log?.(`C: ${maskedLog ?? line}`);
  await t.write(`${line}\r\n`);
}

function fail(code: SmtpErrorCode, detail: string, rejected?: string[]): SmtpSendResult {
  return rejected ? { ok: false, code, detail, rejected } : { ok: false, code, detail };
}

export async function smtpSend(transport: SocketTransport, opts: SmtpSendOptions): Promise<SmtpSendResult> {
  try {
    return await runDialog(transport, opts);
  } catch (e) {
    if (e instanceof NetError) return fail(e.code, e.message);
    throw e;
  } finally {
    if (!transport.closed) await transport.close().catch(() => undefined);
  }
}

async function runDialog(transport: SocketTransport, opts: SmtpSendOptions): Promise<SmtpSendResult> {
  const log = opts.log;
  await transport.connect({
    host: opts.host,
    port: opts.port,
    tls: opts.tls,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const greeting = await readResponse(transport, log);
  if ("protocolError" in greeting) return fail("protocol", greeting.protocolError);
  if (greeting.code !== 220) return fail("protocol", `Greeting nicht 220: ${greeting.lines.join(" | ")}`);

  let capabilities = await ehlo(transport, log);
  if ("result" in capabilities) return capabilities.result;

  if (opts.tls === "starttls") {
    if (!capabilities.lines.some((l) => /^250[ -]STARTTLS/i.test(l))) {
      return fail("tls-required", "Server bietet STARTTLS nicht an");
    }
    await send(transport, "STARTTLS", log);
    const starttlsResponse = await readResponse(transport, log);
    if ("protocolError" in starttlsResponse) return fail("protocol", starttlsResponse.protocolError);
    if (starttlsResponse.code !== 220) return fail("tls-required", `STARTTLS abgelehnt: ${starttlsResponse.lines.join(" | ")}`);
    await transport.upgradeTls();
    capabilities = await ehlo(transport, log);
    if ("result" in capabilities) return capabilities.result;
  }

  if (!transport.secure) {
    return fail("tls-required", "keine Klartext-Authentifizierung ohne TLS");
  }

  const authToken = btoa(`\0${opts.username}\0${opts.password}`);
  await send(transport, `AUTH PLAIN ${authToken}`, log, "AUTH PLAIN ****");
  const authResponse = await readResponse(transport, log);
  if ("protocolError" in authResponse) return fail("protocol", authResponse.protocolError);
  if (authResponse.code !== 235) return fail("auth", authResponse.lines.join(" | "));

  await send(transport, `MAIL FROM:<${opts.from}>`, log);
  const mailResponse = await readResponse(transport, log);
  if ("protocolError" in mailResponse) return fail("protocol", mailResponse.protocolError);
  if (mailResponse.code !== 250) return fail("sender-rejected", mailResponse.lines.join(" | "));

  const rejected: string[] = [];
  let accepted = 0;
  for (const recipient of opts.recipients) {
    await send(transport, `RCPT TO:<${recipient}>`, log);
    const rcptResponse = await readResponse(transport, log);
    if ("protocolError" in rcptResponse) return fail("protocol", rcptResponse.protocolError);
    if (rcptResponse.code === 250 || rcptResponse.code === 251) {
      accepted += 1;
    } else {
      rejected.push(recipient);
    }
  }
  if (accepted === 0) {
    return fail("recipient-rejected", `alle Empfaenger abgelehnt: ${rejected.join(", ")}`, rejected);
  }

  await send(transport, "DATA", log);
  const dataResponse = await readResponse(transport, log);
  if ("protocolError" in dataResponse) return fail("protocol", dataResponse.protocolError);
  if (dataResponse.code !== 354) return fail("data-rejected", dataResponse.lines.join(" | "));

  const body = dotStuff(opts.message);
  log?.("C: (Nachricht)");
  await transport.write(body);
  await send(transport, ".", log);
  const finalResponse = await readResponse(transport, log);
  if ("protocolError" in finalResponse) return fail("protocol", finalResponse.protocolError);
  if (finalResponse.code !== 250) return fail("data-rejected", finalResponse.lines.join(" | "));

  await send(transport, "QUIT", log);
  await readResponse(transport, log).catch(() => undefined);

  const response = finalResponse.lines[finalResponse.lines.length - 1] ?? "";
  return rejected.length > 0 ? { ok: true, response, rejected } : { ok: true, response };
}

async function ehlo(t: SocketTransport, log?: (line: string) => void): Promise<SmtpResponse | { result: SmtpSendResult }> {
  await send(t, "EHLO mailstone.local", log);
  const response = await readResponse(t, log);
  if ("protocolError" in response) return { result: fail("protocol", response.protocolError) };
  if (response.code !== 250) return { result: fail("protocol", `EHLO abgelehnt: ${response.lines.join(" | ")}`) };
  return response;
}
