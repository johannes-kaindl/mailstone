import { mergeSettings } from "../vendor/code-kit/settings";
import { secretIdFor as kitSecretIdFor } from "../vendor/kit/secrets";
import { defaultMailProfile, type FmVal, type MailProfile } from "./mirror/profile";
import type { TlsMode } from "./net/types";
import type { TrustedSender } from "./api/types";

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
// taskPreset traegt bewusst kein `boolean` (Fix-Runde 1, Task 7): toFm() (merge.ts) macht aus
// JEDEM JS-Boolean per String(v) einen String, und needsQuoting() (vendor/kit/frontmatter.ts)
// quotet jeden String, der wie "true"/"false" aussieht, ausdruecklich — das Ergebnis ist immer
// die Zeichenkette "false", nie ein echtes YAML-Bool, auf jedem Weg (Settings-UI wie
// Hand-Edit in data.json). Das zu reparieren waere ein Eingriff in toFm/needsQuoting, der ALLE
// Frontmatter-Felder betraefe — kein M5-Vorgang. Ein `number` ist davon nicht betroffen: er
// laeuft an toFm vorbei und wird unquoted ausgegeben.
export interface MailstoneSettings { schemaVersion: 1; language: "auto" | "en" | "de"; accounts: Account[]; profile: MailProfile; taskPreset: Record<string, string | number>; onCreateAllowedValues: string[]; debugLog: boolean; openViewOnStartup: boolean; trustedSenders: TrustedSender[] }

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function secretIdFor(accountId: string): string { return kitSecretIdFor("mailstone", accountId); }

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
export const DEFAULT_SETTINGS: MailstoneSettings = { schemaVersion: 1, language: "auto", accounts: [], profile: defaultMailProfile(), taskPreset: {}, onCreateAllowedValues: ["mail"], debugLog: false, openViewOnStartup: false, trustedSenders: [] };

/** Reine Pruefung ohne Reparatur: welche STRING-Werte in `onCreate` stehen nicht in `allowed`?
 *  Nicht-String-Werte (number/boolean/string[], s. `FmVal`) sind kein Enum-Fall und bleiben
 *  unberuehrt — die Liste beschreibt Kategorien wie "mail"/"task", keine beliebigen
 *  Frontmatter-Werte. Wiederverwendet in `loadSettings` (Reparatur) UND in main.ts
 *  (Notice-Entscheidung) — dieselbe Berechnung an beiden Stellen statt zweier Fassungen, die
 *  auseinanderlaufen koennten. */
export function onCreateInvalidValues(onCreate: Record<string, unknown> | undefined, allowed: readonly string[]): string[] {
  if (!onCreate) return [];
  return Object.values(onCreate).filter((v): v is string => typeof v === "string" && !allowed.includes(v));
}

/** Extrahiert `raw.profile.onCreate` als Objekt, ohne es zu reparieren — main.ts (obsidian-Schicht)
 *  braucht dieselbe Extraktion fuer die Notice-Entscheidung, ohne core-interne `isObj`-Logik zu
 *  duplizieren. */
export function rawOnCreate(raw: unknown): Record<string, unknown> | undefined {
  if (!isObj(raw) || !isObj(raw.profile) || !isObj(raw.profile.onCreate)) return undefined;
  return raw.profile.onCreate;
}

/** Eine Enum-Liste ohne Duplikate/Leerstrings; ein leeres oder fremdes `raw` faellt auf die
 *  heutigen onCreate-Werte zurueck (Default `["mail"]`) statt eine leere Liste zuzulassen — eine
 *  leere Allowlist wuerde JEDEN onCreate-Wert als ungueltig behandeln. */
function repairOnCreateAllowedValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SETTINGS.onCreateAllowedValues];
  const werte = raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
  const eindeutig = [...new Set(werte)];
  return eindeutig.length > 0 ? eindeutig : [...DEFAULT_SETTINGS.onCreateAllowedValues];
}

/** Wirft nie: ein alteres `data.json` (oder ein Hand-Edit) kann `taskPreset`-Werte tragen, die
 *  der aktuelle Typ nicht mehr kennt — ein `boolean` (Fix-Runde 1, s. Kommentar an
 *  `MailstoneSettings`) oder Fremdes (Array, Objekt, `null`). Ein solcher Eintrag wird beim
 *  Laden stillschweigend fallengelassen statt den Ladevorgang zu brechen: er war ohnehin nie
 *  funktional (der Boolean-Fall) bzw. nie gueltig. */
function repairTaskPreset(raw: unknown): Record<string, string | number> {
  if (!isObj(raw)) return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" || typeof v === "number") out[k] = v;
  }
  return out;
}

/** Wirft nie (gleiche Begruendung wie repairTaskPreset): ein Hand-Edit an `data.json` darf den
 *  Ladevorgang nicht brechen. Unbrauchbare Eintraege fallen still weg — sie waren nie funktional.
 *  Doppelte `pluginId` werden auf den ersten Eintrag reduziert, damit ein Widerruf in der UI
 *  wirklich alles entfernt und nicht einen zweiten Eintrag stehen laesst. */
function repairTrustedSenders(raw: unknown): TrustedSender[] {
  if (!Array.isArray(raw)) return [];
  const out: TrustedSender[] = [];
  const gesehen = new Set<string>();
  for (const e of raw) {
    if (!isObj(e)) continue;
    const { pluginId, transportId } = e;
    if (typeof pluginId !== "string" || !pluginId) continue;
    if (typeof transportId !== "string" || !transportId) continue;
    if (gesehen.has(pluginId)) continue;
    gesehen.add(pluginId);
    out.push({ pluginId, transportId });
  }
  return out;
}

export function loadSettings(raw: unknown): MailstoneSettings {
  const s = mergeSettings(DEFAULT_SETTINGS, raw && typeof raw === "object" ? raw : {});
  s.accounts = (Array.isArray(s.accounts) ? s.accounts : []).map((a) => repairAccount(a));
  s.taskPreset = repairTaskPreset(isObj(raw) ? raw.taskPreset : undefined);
  s.onCreateAllowedValues = repairOnCreateAllowedValues(isObj(raw) ? raw.onCreateAllowedValues : undefined);
  s.trustedSenders = repairTrustedSenders(isObj(raw) ? raw.trustedSenders : undefined);
  const rawProfile = isObj(raw) && isObj(raw.profile) ? raw.profile : {};
  const onCreateRoh = rawOnCreate(raw);
  const onCreateUngueltig = onCreateInvalidValues(onCreateRoh, s.onCreateAllowedValues);
  s.profile = {
    ...defaultMailProfile(),
    ...s.profile,
    fields: { ...defaultMailProfile().fields, ...(isObj(rawProfile.fields) ? rawProfile.fields : {}) },
    onCreate: onCreateRoh && onCreateUngueltig.length === 0 ? { ...(onCreateRoh as Record<string, FmVal>) } : { ...defaultMailProfile().onCreate },
  };
  return s;
}
