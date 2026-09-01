import { NET_ERROR_CODES } from "../net/types";

/** Liste zuerst, Typ daraus — s. NET_ERROR_CODES. Der Spread haelt die Schichtung: ein neuer
 *  Netz-Code ist automatisch auch ein IMAP-Code, ohne zweite Nennung. */
export const IMAP_ERROR_CODES = ["auth", "folder-missing", "tls-required", ...NET_ERROR_CODES] as const;

export type ImapErrorCode = (typeof IMAP_ERROR_CODES)[number];

/** Obergrenze fuer ein einzelnes Literal (64 MiB). Ein groesserer Wert ist kein
 *  Postfach-Inhalt mehr, sondern ein defekter oder feindlicher Server. */
export const MAX_LITERAL_BYTES = 64 * 1024 * 1024;

/** Obergrenze fuer untagged Antworten EINES Kommandos. Jeder einzelne Read steht unter Timeout,
 *  die Sammelschleife um ihn herum nicht: ein Server, der ohne Pause weiterschickt, haelt damit
 *  jede Frist ein und laesst das Array trotzdem unbegrenzt wachsen. Derselbe Gedanke wie bei
 *  MAX_LITERAL_BYTES, nur fuer die Anzahl statt die Groesse.
 *  10.000 liegt weit ueber jedem legitimen Fall — das groesste Kommando dieses Clients ist ein
 *  Header-Band ueber HEADER_BATCH (200) UIDs, dazu etwas Server-Geschwaetz. */
export const MAX_UNTAGGED_PER_COMMAND = 10_000;

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
