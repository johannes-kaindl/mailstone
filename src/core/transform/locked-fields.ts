// Die Sperrliste eines Transformers (A5, Schritt 1, E18): Felder der Mail, an denen ein Transformer nichts aendern darf,
// weil mailstone sie als Identitaet oder Schluessel nutzt (UID-Cache, Index, Verweise, Anhang-Extrakt).
//
// Vorstufe fuer A5 (Anonymizer), verdrahtet mit dem Pseudonymizer-Aufruf.
import type { ParsedMail } from "../mime/types";

/** Der Teil einer Mail, den die Sperrliste ansieht; eine volle `ParsedMail` passt strukturell. */
export interface LockedFieldsView extends Pick<ParsedMail, "id" | "messageIdRaw" | "inReplyTo" | "references"> {
  attachments: readonly { key: string }[];
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** Die Namen der gesperrten Felder, die `transformed` gegenueber `original` veraendert hat; `[]` heisst unveraendert.
 *  Feste Reihenfolge: `id`, `messageIdRaw`, `inReplyTo`, `references`, dann `attachments[].key` (ein Schluessel kam hinzu,
 *  fiel weg oder wurde ersetzt) oder, bei gleichen Schluesseln, `attachments.order` (die Reihenfolge der Anhaenge). */
export function lockedFieldsChanged(original: LockedFieldsView, transformed: LockedFieldsView): string[] {
  const out: string[] = [];
  if (original.id !== transformed.id) out.push("id");
  if (original.messageIdRaw !== transformed.messageIdRaw) out.push("messageIdRaw");
  if (original.inReplyTo !== transformed.inReplyTo) out.push("inReplyTo");
  if (!sameList(original.references, transformed.references)) out.push("references");
  const a = original.attachments.map((x) => x.key);
  const b = transformed.attachments.map((x) => x.key);
  if (!sameList(a, b)) {
    const sameSet = a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
    out.push(sameSet ? "attachments.order" : "attachments[].key");
  }
  return out;
}
