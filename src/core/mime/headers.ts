import { sha256HexUtf8 } from "../../vendor/code-kit/sha256";
import type { MailAddress } from "./types";

export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /<([^<>\s]*)>/.exec(raw);
  if (m) { const v = m[1]!.trim(); return v.length > 0 ? v : null; }
  // Kein Match (z. B. Whitespace innerhalb der Klammern): Fallback ist raw.trim(), aber der
  // darf selbst keinen Whitespace oder Klammern enthalten — sonst waere er als Header-Wert
  // (z. B. Message-ID/In-Reply-To) eine Injection-Flaeche.
  const v = raw.trim();
  return v.length > 0 && !/[\s<>]/.test(v) ? v : null;
}

export function splitReferences(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const m of raw.matchAll(/<([^<>\s]*)>/g)) {
    const id = m[1]!.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function formatAddress(a: MailAddress): string {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// RFC 2047 begrenzt ein einzelnes encoded-word auf 75 Zeichen. Budget fuer die base64-Nutzlast:
// 75 - laenge("=?UTF-8?B??=") = 63 base64-Zeichen -> 47 Rohbytes -> auf ein Vielfaches von 3
// abgerundet = 45 Bytes pro Chunk (glatt ohne Padding, damit Chunk-Groessen vorhersehbar bleiben).
const ENCODED_WORD_CHUNK_BYTES = 45;

export function encodeHeaderWord(value: string): string {
  let ascii = true;
  for (const ch of value) if (ch.charCodeAt(0) > 0x7e || ch.charCodeAt(0) < 0x20) { ascii = false; break; }
  if (ascii) return value;
  // Auf Codepunkt-Grenzen splitten (kein Zerreissen eines UTF-8-Mehrbyte-Zeichens mitten in
  // seinen Bytes): Chunks sammeln Codepunkte, bis die waere-base64-Laenge das Budget ueberschreitet.
  const codePoints = Array.from(value);
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const cp of codePoints) {
    const byteLen = new TextEncoder().encode(cp).length;
    if (current && currentBytes + byteLen > ENCODED_WORD_CHUNK_BYTES) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += cp;
    currentBytes += byteLen;
  }
  if (current) chunks.push(current);
  // Fortsetzung ueber "?= =?UTF-8?B?": benachbarte encoded-words werden durch ein Leerzeichen
  // getrennt (RFC 2047: Whitespace zwischen encoded-words wird beim Decodieren nicht angezeigt).
  return chunks.map((c) => `=?UTF-8?B?${utf8ToBase64(c)}?=`).join(" ");
}

export function foldHeader(name: string, value: string): string {
  const words = value.split(" ");
  const lines: string[] = [];
  let cur = `${name}:`;
  for (const w of words) {
    // Anders als sonst wird hier NICHT verlangt, dass cur bereits ueber die Initialform
    // hinausgewachsen ist: ein einzelnes ueberlanges erstes Wort (z. B. ein 72-Zeichen
    // encoded-word) muss auch dann auf eine eigene Zeile fallen, wenn es das erste Wort ist —
    // sonst waere "Name: " + 72 Zeichen laenger als die 78-Zeichen-Zeilenobergrenze.
    if ((cur + " " + w).length > 76) { lines.push(cur); cur = ` ${w}`; }
    else cur += ` ${w}`;
  }
  lines.push(cur);
  return lines.join("\r\n");
}

export function fallbackId(date: string, from: string, subject: string): string {
  return `noid-${sha256HexUtf8(`${date}|${from}|${subject}`).slice(0, 32)}`;
}

/** Umkehrung zu formatAddress: die reine Adresse aus "Name <adresse>" oder aus einer
 *  nackten Adresse. null, wenn nichts Adressartiges drinsteht — der Aufrufer entscheidet,
 *  ob das ein Fehler ist. */
export function addressOf(formatted: string): string | null {
  const m = /<([^<>]+)>\s*$/.exec(formatted.trim());
  const candidate = (m?.[1] ?? formatted).trim();
  return candidate.includes("@") && !candidate.includes(" ") ? candidate : null;
}
