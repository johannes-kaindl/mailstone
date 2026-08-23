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

export function encodeHeaderWord(value: string): string {
  let ascii = true;
  for (const ch of value) if (ch.charCodeAt(0) > 0x7e || ch.charCodeAt(0) < 0x20) { ascii = false; break; }
  return ascii ? value : `=?UTF-8?B?${utf8ToBase64(value)}?=`;
}

export function foldHeader(name: string, value: string): string {
  const words = value.split(" ");
  const lines: string[] = [];
  let cur = `${name}:`;
  for (const w of words) {
    if ((cur + " " + w).length > 76 && cur !== `${name}:`) { lines.push(cur); cur = ` ${w}`; }
    else cur += ` ${w}`;
  }
  lines.push(cur);
  return lines.join("\r\n");
}

export function fallbackId(date: string, from: string, subject: string): string {
  return `noid-${sha256HexUtf8(`${date}|${from}|${subject}`).slice(0, 32)}`;
}
