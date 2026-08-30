import type { NetErrorCode } from "../net/types";

export type ImapErrorCode = "auth" | "folder-missing" | "tls-required" | NetErrorCode;

/** Obergrenze fuer ein einzelnes Literal (64 MiB). Ein groesserer Wert ist kein
 *  Postfach-Inhalt mehr, sondern ein defekter oder feindlicher Server. */
export const MAX_LITERAL_BYTES = 64 * 1024 * 1024;

export type ImapItem =
  | { kind: "atom"; value: string }
  | { kind: "string"; value: string }
  | { kind: "literal"; bytes: Uint8Array }
  | { kind: "nil" }
  | { kind: "list"; items: ImapItem[] };

export interface ImapResponse {
  tag: string;
  items: ImapItem[];
  text: string;
}
