import type { ImapErrorCode } from "../imap/types";

/** Alles, was ein Sync-Lauf als Wert melden kann. Uebersetzt wird erst in src/obsidian
 *  (Schluessel `error.sync.<code>` in src/i18n/strings.ts). */
export type SyncErrorCode = "no-secret" | "busy" | "no-account" | ImapErrorCode;
