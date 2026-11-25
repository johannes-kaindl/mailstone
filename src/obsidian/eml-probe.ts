import { FileSystemAdapter, normalizePath, Platform, TFile, type App } from "obsidian";
import { emlPathFor } from "../core/commands/eml";
import type { MailNoteRef } from "../core/commands/types";
import { messageIdFromHeader } from "../core/imap/client";
import { normalizeMessageId } from "../core/mime/headers";
import type { MailProfile } from "../core/mirror/profile";

/** Soviel vom Anfang der Datei reicht fuer den Kopf; der Rest (Text, Anhaenge) wird nie
 *  dekodiert. */
const HEAD_BYTES = 64 * 1024;

/** Das Teilstueck von `node:fs/promises`, das das Kopfstueck braucht (lokal getypt: `src/` hat unter `types: []` kein `@types/node`). */
export interface HeadFs {
  open(path: string, flags: string): Promise<{
    read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
    close(): Promise<void>;
  }>;
}
export interface HeadIo { fs: HeadFs; join(...parts: string[]): string; base: string }

/** Das echte Node-Dateisystem am Desktop (lazy `require`, wie in docs-mirror), sonst `null`: mobil und mit fremdem Adapter bleibt `readBinary`. */
function desktopIo(app: App): HeadIo | null {
  const adapter = app.vault.adapter;
  if (!Platform.isDesktopApp || !(adapter instanceof FileSystemAdapter)) return null;
  try {
    const req = (window as unknown as { require: (id: string) => unknown }).require;
    return { fs: (req("fs") as { promises: HeadFs }).promises, join: (req("path") as { join: (...p: string[]) => string }).join, base: adapter.getBasePath() };
  } catch {
    return null;
  }
}

/** Die ersten `HEAD_BYTES` einer Datei. Am Desktop liest ein Teil-Lesen nur diese Bytes von der Platte; `readBinary` holte die ganze
 *  .eml samt Anhaengen in den Speicher, bei Tausenden Notizen der Preis des Aufraeumbefehls. Ein Fehler des Teil-Lesens (Datei zwischenzeitlich
 *  verschoben, kein Zugriff) faellt auf `readBinary` zurueck, damit Verhalten und Fehlerbild gleich bleiben. */
async function readHead(app: App, file: TFile, io: HeadIo | null): Promise<Uint8Array> {
  if (io !== null) {
    try {
      const handle = await io.fs.open(io.join(io.base, file.path), "r");
      try {
        const buf = new Uint8Array(HEAD_BYTES);
        const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
        return buf.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } catch { /* weiter mit readBinary */ }
  }
  return new Uint8Array(await app.vault.readBinary(file)).subarray(0, HEAD_BYTES);
}

/**
 * Die Probe fuer `mail.removeEml`: gehoert die .eml am Konventionspfad zu dieser Notiz? Gelesen
 * wird nur der Message-ID-Kopf (dasselbe Muster wie der Abgleich im Sync, `messageIdFromHeader`),
 * kein `parseEml` — bei Hunderten von Notizen mit Anhaengen waere der volle Parse der Preis fuer
 * eine einzige Frage. `undefined`, wenn keine Datei dort liegt.
 */
export async function probeEml(app: App, profile: MailProfile, notePath: string, mailId: string, io: HeadIo | null = desktopIo(app)): Promise<MailNoteRef["eml"]> {
  const path = emlPathFor(profile, notePath);
  const file = app.vault.getFileByPath(normalizePath(path));
  if (!file) return undefined;
  let head: Uint8Array;
  try {
    head = await readHead(app, file, io);
  } catch {
    return { path, status: "unreadable" };
  }
  // Nur der Kopfblock: eine Message-ID, die erst im Text steht, ist keine.
  const text = new TextDecoder().decode(head);
  const end = /\r?\n\r?\n/.exec(text);
  const block = end ? text.slice(0, end.index) : text;
  const found = messageIdFromHeader(new TextEncoder().encode(block));
  if (found === null) return { path, status: "unreadable" };
  return { path, status: found === (normalizeMessageId(mailId) ?? mailId) ? "match" : "mismatch" };
}
