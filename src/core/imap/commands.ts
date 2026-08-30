// Bausteine fuer IMAP-Kommandozeilen: Ordnernamen-Kodierung (modified UTF-7, RFC 3501 § 5.1.3),
// Quoting und der CR/LF-Riegel. Alles, was aus den Settings kommt, laeuft hier durch — eine
// Kommandozeile darf nie durch einen Ordnernamen zu zwei Zeilen werden (vgl. STARTTLS-
// Injektionsschutz aus dem M2-Final-Review).
import { NetError } from "../net/types";

export function assertNoCrlf(value: string, what: string): void {
  if (/[\r\n]/.test(value)) throw new NetError("protocol", `${what} enthaelt Zeilenumbrueche`);
}

/** Base64 der UTF-16BE-Bytes, wie modified UTF-7 es verlangt — mit "," statt "/" und ohne "=". */
function b64Utf16(s: string): string {
  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      bytes.push(hi >> 8, hi & 0xff, lo >> 8, lo & 0xff);
    } else {
      bytes.push(cp >> 8, cp & 0xff);
    }
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\//g, ",");
}

export function encodeMailbox(name: string): string {
  assertNoCrlf(name, "Ordnername");
  let out = "";
  let buf = "";
  const flush = (): void => {
    if (buf) { out += `&${b64Utf16(buf)}-`; buf = ""; }
  };
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === "&") { flush(); out += "&-"; continue; }
    if (cp >= 0x20 && cp <= 0x7e) { flush(); out += ch; continue; }
    buf += ch;
  }
  flush();
  return out;
}

export function quoteArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildUidSet(uids: readonly number[]): string {
  // Set vor dem Sortieren: doppelte UIDs ergaben sonst "1,1:3" statt "1:3" — semantisch dasselbe,
  // aber laenger und im Log irritierend. Sie entstehen, sobald eine Aufrufstelle zwei Quellen
  // zusammenwirft.
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i];
    if (start === undefined) break;
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) { i++; end += 1; }
    parts.push(start === end ? String(start) : `${String(start)}:${String(end)}`);
    i++;
  }
  return parts.join(",");
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
