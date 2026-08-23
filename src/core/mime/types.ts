export interface MailAddress {
  name: string;
  address: string;
}

export interface MailAttachmentMeta {
  name: string;
  type: string;
  size: number;
  contentId?: string;
  inline: boolean;
}

export interface ParsedMail {
  id: string; // normalisierte Message-ID oder "noid-<sha256[:32]>"
  messageIdRaw: string | null;
  inReplyTo: string | null; // normalisiert
  references: string[]; // normalisiert
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  date: Date | null; // aus dem Date-Header; null wenn unparsbar
  text: string | null;
  html: string | null;
  attachments: MailAttachmentMeta[];
  attachmentData: Map<string, Uint8Array>; // key = contentId oder name, fuer Extraktion/Inline
  rawSize: number;
}
