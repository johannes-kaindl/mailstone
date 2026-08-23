import { mergeSettings } from "../vendor/code-kit/settings";
import { defaultMailProfile, type MailProfile } from "./mirror/profile";

export interface Identity { id: string; address: string; name: string }
export interface Account {
  id: string; label: string;
  imap: { host: string; port: number; tls: "implicit" | "starttls" }; smtp: { host: string; port: number; tls: "implicit" | "starttls" };
  username: string; secretId: string; identities: Identity[]; defaultIdentityId: string;
  folders: { inbox: string; allowlist: string; archive: string; sent?: string }; sync: { enabled: boolean; intervalMin: number };
}
export interface MailstoneSettings { schemaVersion: 1; language: "auto" | "en" | "de"; accounts: Account[]; profile: MailProfile; taskPreset: Record<string, string | number | boolean>; debugLog: boolean }

export function secretIdFor(accountId: string): string { return `mailstone-${accountId}`; }
export function newAccount(id: string): Account {
  return { id, label: id, imap: { host: "", port: 993, tls: "implicit" }, smtp: { host: "", port: 465, tls: "implicit" }, username: "", secretId: secretIdFor(id),
    identities: [], defaultIdentityId: "", folders: { inbox: "INBOX", allowlist: "Vault", archive: "Archive" }, sync: { enabled: true, intervalMin: 5 } };
}
export const DEFAULT_SETTINGS: MailstoneSettings = { schemaVersion: 1, language: "auto", accounts: [], profile: defaultMailProfile(), taskPreset: {}, debugLog: false };

export function loadSettings(raw: unknown): MailstoneSettings {
  const s = mergeSettings(DEFAULT_SETTINGS, raw && typeof raw === "object" ? raw : {});
  s.accounts = (Array.isArray(s.accounts) ? s.accounts : []).map((a) => {
    const id = ((a as unknown) as Record<string, unknown>).id;
    const base = newAccount(typeof id === "string" ? id : "account");
    return mergeSettings(base, a);
  });
  s.profile = mergeSettings(defaultMailProfile(), s.profile);
  return s;
}
