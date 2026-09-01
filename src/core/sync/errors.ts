import { IMAP_ERROR_CODES } from "../imap/types";

/** Alles, was ein Sync-Lauf als Wert melden kann. Uebersetzt wird erst in src/obsidian
 *  (Schluessel `error.sync.<code>` in src/i18n/strings.ts).
 *
 *  Liste zuerst, Typ daraus abgeleitet (s. NET_ERROR_CODES): `parseRunState` prueft einen aus
 *  `data.json` gelesenen Code gegen genau diese Liste. Waere sie eine zweite, von Hand
 *  gepflegte Aufzaehlung neben dem Typ, liefe sie beim naechsten neuen Code auseinander — und
 *  ein unbekannter Code endete als roher i18n-Schluessel in der Anzeige. */
export const SYNC_ERROR_CODES = ["no-secret", "busy", "no-account", ...IMAP_ERROR_CODES] as const;

export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];
