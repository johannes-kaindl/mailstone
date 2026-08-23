import { encodeHeaderWord, foldHeader } from "./headers";
import { isAddress, type OutgoingMessage, type Sender } from "../send/outgoing";
import { sha256HexUtf8 } from "../../vendor/code-kit/sha256";

export interface BuildOptions { sender: Sender; messageId: string; date: Date; boundarySeed?: string }
const CRLF = "\r\n";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number): string => String(n).padStart(2, "0");

export function rfc5322Date(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${DAYS[d.getDay()]}, ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${sign}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
}

/** Haertung gegen Header-Injection: ersetzt CR/LF (einzeln oder als CRLF) durch je ein
 *  Leerzeichen und kollabiert danach Whitespace-Laeufe auf ein einzelnes Leerzeichen. Jeder
 *  Wert, der als Header-Zeile oder als Teil davon (foldHeader, Anhangsnamen) im
 *  MIME-Dokument landet, muss vorher durch diese Funktion — sonst kann ein boesartiger Wert
 *  (z. B. ein Betreff mit eingebettetem "\r\nBcc: ...") eine zusaetzliche Header-Zeile
 *  einschleusen. */
export function sanitizeHeaderValue(v: string): string {
  return v.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
}

/** Fuer Message-IDs (In-Reply-To/References): Whitespace wird komplett entfernt statt durch
 *  ein Leerzeichen ersetzt, weil innerhalb von "<...>" ohnehin kein Whitespace erlaubt ist
 *  (siehe headers.ts normalizeMessageId/splitReferences). */
function sanitizeId(v: string): string {
  return v.replace(/\s+/g, "");
}

/** Anhangs-MIME-Typ gegen Header-Injection und Part-Splitting haerten. Zuerst wird alles ab
 *  dem ersten Whitespace/CR/LF/Semikolon abgeschnitten (ein eingebettetes
 *  "\r\nContent-Disposition: inline" waere sonst ein syntaktisch gueltiges "type/subtype",
 *  weil es genau einen "/" enthaelt — der Schnitt muss also VOR der Zeichen-Filterung
 *  passieren, nicht danach). Danach werden nur RFC-2045-Token-Zeichen zugelassen; passt das
 *  Ergebnis nicht auf "type/subtype", faellt es auf einen sicheren Default zurueck. */
function sanitizeAttachmentType(v: string): string {
  const rawType = v.split(/[\s\r\n;]/)[0] ?? "";
  const type = rawType.replace(/[^A-Za-z0-9!#$&^_.+\-/]/g, "");
  return /^[^/]+\/[^/]+$/.test(type) ? type : "application/octet-stream";
}

export function encodeQuotedPrintable(text: string): string {
  const bytes = new TextEncoder().encode(text.replace(/\r?\n/g, CRLF));
  let out = "";
  let line = "";
  const flush = (soft: boolean): void => { out += line + (soft ? "=" : "") + CRLF; line = ""; };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    if (b === 13 && bytes[i + 1] === 10) {
      // CRLF: Leerzeichen am Zeilenende schuetzen
      if (line.endsWith(" ")) line = line.slice(0, -1) + "=20";
      flush(false);
      i++;
      continue;
    }
    const enc = (b === 61 || b < 32 || b > 126) && b !== 9 ? `=${b.toString(16).toUpperCase().padStart(2, "0")}` : String.fromCharCode(b);
    if (line.length + enc.length > 75) flush(true);
    line += enc;
  }
  if (line) out += line;
  return out;
}

function base64Lines(data: Uint8Array): string {
  let bin = "";
  for (const b of data) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join(CRLF);
}

function boundary(seed: string, n: number): string {
  return `=_mailstone_${sha256HexUtf8(`${seed}:${n}`).slice(0, 24)}`;
}

export function buildMime(msg: OutgoingMessage, opts: BuildOptions): { bytes: Uint8Array; envelopeRecipients: string[] } {
  const seed = opts.boundarySeed ?? `${opts.messageId}:${opts.date.getTime()}`;
  const h: string[] = [];
  const senderAddr = sanitizeId(opts.sender.address);
  if (!isAddress(senderAddr)) throw new Error("invalid sender address");
  const senderName = sanitizeHeaderValue(opts.sender.name);
  const fromHdr = senderName ? `${encodeHeaderWord(senderName)} <${senderAddr}>` : senderAddr;
  h.push(foldHeader("From", fromHdr), foldHeader("To", msg.to.map(sanitizeHeaderValue).join(", ")));
  if (msg.cc?.length) h.push(foldHeader("Cc", msg.cc.map(sanitizeHeaderValue).join(", ")));
  const mid = sanitizeId(opts.messageId);
  if (!mid) throw new Error("invalid message-id");
  h.push(foldHeader("Subject", encodeHeaderWord(sanitizeHeaderValue(msg.subject))), `Date: ${rfc5322Date(opts.date)}`, `Message-ID: <${mid}>`);
  if (msg.inReplyTo) h.push(`In-Reply-To: <${sanitizeId(msg.inReplyTo)}>`);
  if (msg.references?.length) h.push(foldHeader("References", msg.references.map((r) => `<${sanitizeId(r)}>`).join(" ")));
  h.push("MIME-Version: 1.0", "X-Mailer: mailstone (Obsidian)");

  const textPart = `Content-Type: text/plain; charset=utf-8${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}${encodeQuotedPrintable(msg.text)}`;
  const parts: string[] = [];
  let altBody: string;
  if (msg.calendar) {
    const b1 = boundary(seed, 1);
    const cal = `Content-Type: text/calendar; method=${msg.calendar.method}; charset=utf-8${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}${encodeQuotedPrintable(msg.calendar.ics)}`;
    const htmlPart = msg.html ? `Content-Type: text/html; charset=utf-8${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}${encodeQuotedPrintable(msg.html)}` : null;
    altBody = `Content-Type: multipart/alternative; boundary="${b1}"${CRLF}${CRLF}--${b1}${CRLF}${textPart}${CRLF}${htmlPart ? `--${b1}${CRLF}${htmlPart}${CRLF}` : ""}--${b1}${CRLF}${cal}${CRLF}--${b1}--`;
    parts.push(altBody);
    parts.push(`Content-Type: application/ics; name="invite.ics"${CRLF}Content-Disposition: attachment; filename="invite.ics"${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${base64Lines(new TextEncoder().encode(msg.calendar.ics))}`);
  } else if (msg.html) {
    const b1 = boundary(seed, 1);
    const htmlPart = `Content-Type: text/html; charset=utf-8${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}${encodeQuotedPrintable(msg.html)}`;
    parts.push(`Content-Type: multipart/alternative; boundary="${b1}"${CRLF}${CRLF}--${b1}${CRLF}${textPart}${CRLF}--${b1}${CRLF}${htmlPart}${CRLF}--${b1}--`);
  } else {
    parts.push(textPart);
  }
  for (const a of msg.attachments ?? []) {
    const name = sanitizeHeaderValue(a.name).replace(/"/g, "");
    const type = sanitizeAttachmentType(a.type);
    parts.push(`Content-Type: ${type}; name="${name}"${CRLF}Content-Disposition: attachment; filename="${name}"${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${base64Lines(a.data)}`);
  }

  let body: string;
  if (parts.length === 1) body = parts[0] as string;
  else {
    const b0 = boundary(seed, 0);
    body = `Content-Type: multipart/mixed; boundary="${b0}"${CRLF}${CRLF}` + parts.map((p) => `--${b0}${CRLF}${p}${CRLF}`).join("") + `--${b0}--`;
  }

  const raw = `${h.join(CRLF)}${CRLF}${body}${CRLF}`;
  return { bytes: new TextEncoder().encode(raw), envelopeRecipients: [...msg.to, ...(msg.cc ?? []), ...(msg.bcc ?? [])] };
}
