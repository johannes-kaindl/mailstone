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
  // sent traegt den Default "Sent": eine gesendete Mail, die im Webmail nirgends auftaucht,
  // ist ein Verlust, den man erst bemerkt, wenn man sie sucht. Ein leerer Wert schaltet die
  // Kopie ab — das ist die Opt-out-Form, absichtlich statt Opt-in (Spec § 3.3, praezisiert 2026-08-30).
  folders: { inbox: string; allowlist: string; archive: string; sent?: string }; sync: { enabled: boolean; intervalMin: number };
}
export interface MailstoneSettings { schemaVersion: 1; language: "auto" | "en" | "de"; accounts: Account[]; profile: MailProfile; taskPreset: Record<string, string | number | boolean>; debugLog: boolean; openViewOnStartup: boolean }

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function secretIdFor(accountId: string): string { return `mailstone-${accountId}`; }

const SLUG_TRANSLIT: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "ae", Ö: "oe", Ü: "ue" };

/** Slug aus einem Konto-Label fuer die Konto-`id` (und damit `secretId`) — a-z0-9 mit Bindestrichen,
 *  Umlaute transliteriert statt weggeworfen. Leer/nur-Sonderzeichen faellt auf "account" zurueck. */
export function slugifyAccountId(label: string): string {
  const s = label
    .trim()
    .replace(/[äöüßÄÖÜ]/g, (c) => SLUG_TRANSLIT[c] ?? c)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "account";
}

/** Haengt bei Kollision `-2`, `-3`, … an (kein Zaehler-Suffix bei der ersten Vergabe). */
export function uniqueAccountId(label: string, existingIds: readonly string[]): string {
  const base = slugifyAccountId(label);
  if (!existingIds.includes(base)) return base;
  let n = 2;
  while (existingIds.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function newAccount(id: string): Account {
  return { id, label: id, imap: { host: "", port: 993, tls: "implicit" }, smtp: { host: "", port: 465, tls: "implicit" }, username: "", secretId: secretIdFor(id),
    identities: [], defaultIdentityId: "", folders: { inbox: "INBOX", allowlist: "Vault", archive: "Archive", sent: "Sent" }, sync: { enabled: true, intervalMin: 5 } };
}

const IMAP_TLS_VALUES = ["implicit", "starttls"] as const;
const SMTP_TLS_VALUES = ["implicit", "starttls", "none"] as const;

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v > 0;
}

/** Narrowt ein rohes verschachteltes host/port/tls-Objekt gegen Defaults — jedes Feld einzeln:
 *  ein unbrauchbarer Wert (falscher Typ, Tippfehler wie "starttls " mit Leerzeichen, "465" als
 *  String statt Number) faellt auf den jeweiligen Default zurueck statt die ganze Reparatur mit
 *  einem generischen Spread durchzuwinken. */
function repairHostPortTls<T extends string>(
  base: { host: string; port: number; tls: T },
  raw: Record<string, unknown>,
  tlsValues: readonly T[],
): { host: string; port: number; tls: T } {
  return {
    host: typeof raw.host === "string" ? raw.host : base.host,
    port: isPositiveInt(raw.port) ? raw.port : base.port,
    tls: typeof raw.tls === "string" && (tlsValues as readonly string[]).includes(raw.tls) ? (raw.tls as T) : base.tls,
  };
}

function repairAccount(raw: unknown): Account {
  const r = isObj(raw) ? raw : {};
  const id = typeof r.id === "string" ? r.id : "account";
  const base = newAccount(id);
  return {
    ...base,
    label: typeof r.label === "string" ? r.label : base.label,
    imap: repairHostPortTls(base.imap, isObj(r.imap) ? r.imap : {}, IMAP_TLS_VALUES),
    smtp: repairHostPortTls(base.smtp, isObj(r.smtp) ? r.smtp : {}, SMTP_TLS_VALUES),
    username: typeof r.username === "string" ? r.username : base.username,
    secretId: typeof r.secretId === "string" ? r.secretId : base.secretId,
    identities: Array.isArray(r.identities) ? r.identities.filter((i): i is Identity => isObj(i) && typeof i.id === "string" && typeof i.address === "string" && typeof i.name === "string") : base.identities,
    defaultIdentityId: typeof r.defaultIdentityId === "string" ? r.defaultIdentityId : base.defaultIdentityId,
    folders: { ...base.folders, ...(isObj(r.folders) ? r.folders : {}) },
    sync: { ...base.sync, ...(isObj(r.sync) ? r.sync : {}) },
  };
}

// openViewOnStartup: Default AUS — ein Plugin, das sich beim Start ungefragt in die
// Seitenleiste draengt, ist ein Aergernis (REGISTRY: Opt-in-Gate fuer Startup-Seiteneffekt,
// n=2 in vim-dojo und kuro-gamification).
export const DEFAULT_SETTINGS: MailstoneSettings = { schemaVersion: 1, language: "auto", accounts: [], profile: defaultMailProfile(), taskPreset: {}, debugLog: false, openViewOnStartup: false };

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
