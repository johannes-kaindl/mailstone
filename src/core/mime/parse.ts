import PostalMime, { type Address, type Attachment } from "postal-mime";
import { fallbackId, normalizeMessageId, splitReferences } from "./headers";
import type { MailAddress, MailAttachmentMeta, ParsedMail } from "./types";

function flat(list: Address[] | undefined): MailAddress[] {
  const out: MailAddress[] = [];
  for (const a of list ?? []) {
    if (a.group) for (const g of a.group) out.push({ name: g.name ?? "", address: g.address });
    else if (a.address) out.push({ name: a.name ?? "", address: a.address });
  }
  return out;
}

function bytesOf(a: Attachment): Uint8Array {
  const c = a.content;
  if (c instanceof Uint8Array) return c;
  if (c instanceof ArrayBuffer) return new Uint8Array(c);
  return new TextEncoder().encode(String(c));
}

export async function parseEml(bytes: Uint8Array): Promise<ParsedMail> {
  const e = await PostalMime.parse(bytes, { attachmentEncoding: "arraybuffer" });
  const from = flat(e.from ? [e.from] : [])[0] ?? null;
  const messageIdRaw = e.messageId ?? null;
  const dateIso = e.date ?? "";
  const date = dateIso ? new Date(dateIso) : null;
  const id = normalizeMessageId(messageIdRaw) ?? fallbackId(dateIso, from?.address ?? "", e.subject ?? "");
  const attachments: MailAttachmentMeta[] = [];
  const attachmentData = new Map<string, Uint8Array>();
  for (const a of e.attachments) {
    const data = bytesOf(a);
    const contentId = a.contentId ? (normalizeMessageId(a.contentId) ?? undefined) : undefined;
    const inline = a.disposition === "inline" || a.related === true || !!contentId;
    const name = a.filename ?? (contentId ? `inline-${contentId}` : `attachment-${attachments.length + 1}`);
    // TNEF (Exchange): Typ vereinheitlichen, damit Renderer/UI ihn erkennen; nie auspacken (Spec § 2.2)
    const type = a.mimeType === "application/ms-tnef" || name.toLowerCase() === "winmail.dat" ? "application/ms-tnef" : a.mimeType;
    const meta: MailAttachmentMeta = { name, type, size: data.byteLength, inline };
    if (contentId) meta.contentId = contentId;
    attachments.push(meta);
    attachmentData.set(contentId ?? name, data);
  }
  return {
    id,
    messageIdRaw,
    inReplyTo: normalizeMessageId(e.inReplyTo),
    references: splitReferences(e.references),
    from,
    to: flat(e.to),
    cc: flat(e.cc),
    subject: e.subject ?? "",
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    text: e.text ?? null,
    html: e.html ?? null,
    attachments,
    attachmentData,
    rawSize: bytes.byteLength,
  };
}
