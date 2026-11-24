import { normalizePath, TFile, type App } from "obsidian";
import { sameBytes, type AttachmentResolver, type AttachmentTarget } from "../core/mirror/attachments";

/** Bei Kollision haengt Obsidian " 1", " 2" an den Stamm; dasselbe Muster fuer Pfade, die erst dieser Lauf belegt. */
function numbered(path: string, n: number): string {
  const cut = path.lastIndexOf("/") + 1;
  const dot = path.lastIndexOf(".");
  return dot > cut ? `${path.slice(0, dot)} ${String(n)}${path.slice(dot)}` : `${path} ${String(n)}`;
}

/**
 * Loest die Ziele der Anhaenge einer Mail im Vault auf (A6): der Pfad kommt von `fileManager.getAvailablePathForAttachment`
 * (Anhangordner der Obsidian-Einstellungen), liegt am blanken Namen schon eine BYTE-GLEICHE Datei, wird sie verlinkt statt kopiert
 * (dieselbe Regel wie `mail.extractAttachment`). Der Resolver gehoert zu EINEM Lauf und merkt sich, was der Lauf schon vergeben hat:
 * die Dateien sind beim Aufloesen noch nicht geschrieben, zwei Mails mit `rechnung.pdf` bekaemen sonst denselben Pfad.
 */
export function createAttachmentResolver(app: App): AttachmentResolver {
  const reserved = new Map<string, Uint8Array>();
  return async (mail, notePath) => {
    const out = new Map<string, AttachmentTarget>();
    for (const meta of mail.attachments) {
      if (meta.inline) continue;
      const data = mail.attachmentData.get(meta.key);
      if (!data) continue;
      const free = await app.fileManager.getAvailablePathForAttachment(meta.name, notePath);
      const blank = `${free.slice(0, free.lastIndexOf("/") + 1)}${meta.name}`;
      // Wiederverwenden: der blanke Name gehoert schon dieser Datei (im Vault oder von diesem Lauf).
      const pending = reserved.get(blank);
      if (pending && sameBytes(pending, data)) { out.set(meta.key, { path: blank, write: false }); continue; }
      if (!pending && blank !== free) {
        const there = app.vault.getAbstractFileByPath(normalizePath(blank));
        if (there instanceof TFile && sameBytes(new Uint8Array(await app.vault.readBinary(there)), data)) {
          out.set(meta.key, { path: blank, write: false });
          continue;
        }
      }
      let path = free;
      for (let n = 1; reserved.has(path) || (path !== free && app.vault.getAbstractFileByPath(normalizePath(path)) !== null); n++) path = numbered(free, n);
      reserved.set(path, data);
      out.set(meta.key, { path, write: true });
    }
    return out;
  };
}
