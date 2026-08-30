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
  /** Stabiler, eindeutiger Schluessel dieses Anhangs innerhalb der Mail — contentId, wenn
   *  vorhanden, sonst "<Index>:<Name>". Zwei Anhaenge KOENNEN denselben Dateinamen tragen
   *  (z. B. zwei "invoice.pdf"); der Name allein ist daher kein Schluessel. Bytes IMMER ueber
   *  diesen Key aus attachmentData holen, nie ueber `name` (M3b-Nachlese, Fund 1). */
  key: string;
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
  attachmentData: Map<string, Uint8Array>; // key = MailAttachmentMeta.key (contentId oder Index:Name)
  rawSize: number;
}
