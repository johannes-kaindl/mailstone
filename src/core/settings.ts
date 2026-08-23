import { mergeSettings } from "../vendor/code-kit/settings";
import { defaultMailProfile, type FmVal, type MailProfile } from "./mirror/profile";
import type { TlsMode } from "./net/types";

export interface Identity { id: string; address: string; name: string }
export interface Account {
  id: string; label: string;
  // smtp.tls erlaubt zusaetzlich "none": die Settings-UI bietet es nie an, aber data.json kann es
  // fuer einen lokalen Fake-SMTP-Server (127.0.0.1) tragen — siehe core/send/service.ts isLoopback.
  imap: { host: string; port: number; tls: "implicit" | "starttls" }; smtp: { host: string; port: number; tls: TlsMode };
  username: string; secretId: string; identities: Identity[]; defaultIdentityId: string;
  folders: { inbox: string; allowlist: string; archive: string; sent?: string }; sync: { enabled: boolean; intervalMin: number };
}
export interface MailstoneSettings { schemaVersion: 1; language: "auto" | "en" | "de"; accounts: Account[]; profile: MailProfile; taskPreset: Record<string, string | number | boolean>; debugLog: boolean }

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function secretIdFor(accountId: string): string { return `mailstone-${accountId}`; }
export function newAccount(id: string): Account {
  return { id, label: id, imap: { host: "", port: 993, tls: "implicit" }, smtp: { host: "", port: 465, tls: "implicit" }, username: "", secretId: secretIdFor(id),
    identities: [], defaultIdentityId: "", folders: { inbox: "INBOX", allowlist: "Vault", archive: "Archive" }, sync: { enabled: true, intervalMin: 5 } };
}

function repairAccount(raw: unknown): Account {
  const r = isObj(raw) ? raw : {};
  const id = typeof r.id === "string" ? r.id : "account";
  const base = newAccount(id);
  return {
    ...base,
    label: typeof r.label === "string" ? r.label : base.label,
    imap: { ...base.imap, ...(isObj(r.imap) ? r.imap : {}) },
    smtp: { ...base.smtp, ...(isObj(r.smtp) ? r.smtp : {}) },
    username: typeof r.username === "string" ? r.username : base.username,
    secretId: typeof r.secretId === "string" ? r.secretId : base.secretId,
    identities: Array.isArray(r.identities) ? r.identities.filter((i): i is Identity => isObj(i) && typeof i.id === "string" && typeof i.address === "string" && typeof i.name === "string") : base.identities,
    defaultIdentityId: typeof r.defaultIdentityId === "string" ? r.defaultIdentityId : base.defaultIdentityId,
    folders: { ...base.folders, ...(isObj(r.folders) ? r.folders : {}) },
    sync: { ...base.sync, ...(isObj(r.sync) ? r.sync : {}) },
  };
}

export const DEFAULT_SETTINGS: MailstoneSettings = { schemaVersion: 1, language: "auto", accounts: [], profile: defaultMailProfile(), taskPreset: {}, debugLog: false };

export function loadSettings(raw: unknown): MailstoneSettings {
  const s = mergeSettings(DEFAULT_SETTINGS, raw && typeof raw === "object" ? raw : {});
  s.accounts = (Array.isArray(s.accounts) ? s.accounts : []).map((a) => repairAccount(a));
  const rawProfile = isObj(raw) && isObj(raw.profile) ? raw.profile : {};
  s.profile = {
    ...defaultMailProfile(),
    ...s.profile,
    fields: { ...defaultMailProfile().fields, ...(isObj(rawProfile.fields) ? rawProfile.fields : {}) },
    onCreate: { ...(isObj(rawProfile.onCreate) ? (rawProfile.onCreate as Record<string, FmVal>) : defaultMailProfile().onCreate) },
  };
  return s;
}
