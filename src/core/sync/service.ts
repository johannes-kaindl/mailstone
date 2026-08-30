// Ein Sync-Lauf pro Konto: eine Verbindung, EXAMINE auf den Allowlist-Ordner, UID-Abgleich
// gegen den Vault-Index, Plaene ueber den PlanExecutor. Der Service kennt weder Vault noch
// Obsidian (siehe scripts/check-pure.mjs) — Index, Pfade und Executor kommen als Deps.
import type { Account } from "../settings";
import type { MailProfile } from "../mirror/profile";
import type { SocketTransport } from "../net/types";
import type { PlanExecutor } from "../mirror/execute";
import type { NotePlan } from "../mirror/plan";
import { planSync, type MailIndex } from "../mirror/apply";
import { parseEml } from "../mime/parse";
import type { ParsedMail } from "../mime/types";
import { imapConnect, type ImapSession } from "../imap/client";
import { isLoopback } from "../send/service";
import type { UidCacheStore } from "./uid-cache";
import type { BusyGuard } from "./busy";
import type { SyncCounts, SyncEmitter } from "./events";
import type { SyncErrorCode } from "./errors";
import type { TimeoutTimers } from "../../vendor/code-kit/timeout";

export type SyncRunResult =
  | { ok: true; accountId: string; counts: SyncCounts }
  | { ok: false; accountId: string; code: SyncErrorCode; detail?: string };

export interface SyncDeps {
  accounts: () => Account[];
  profile: () => MailProfile;
  secret: (secretId: string) => string | null;
  transport: () => SocketTransport;
  index: () => MailIndex;
  takenPaths: () => Set<string>;
  executor: () => PlanExecutor;
  uidCache: UidCacheStore;
  busy: BusyGuard;
  events: SyncEmitter;
  /** Timer-Port, den der Service an imapConnect durchreicht (withTimeout). */
  timers: TimeoutTimers;
  now: () => Date;
  log?: (line: string) => void;
}

export interface SyncService {
  syncAccount(accountId: string): Promise<SyncRunResult>;
  /** Alle Konten mit sync.enabled, nacheinander — nie parallel gegen denselben Vault. */
  syncAll(): Promise<SyncRunResult[]>;
}

export function createSyncService(deps: SyncDeps): SyncService {
  async function run(account: Account): Promise<SyncRunResult> {
    const profile = deps.profile();
    const folder = account.folders.allowlist;
    const source = `${account.id}/${folder}`;
    const password = deps.secret(account.secretId);
    if (password === null) return { ok: false, accountId: account.id, code: "no-secret" };

    const connected = await imapConnect(deps.transport(), {
      host: account.imap.host, port: account.imap.port, tls: account.imap.tls,
      username: account.username, password, timers: deps.timers,
      // Der IMAP-Client verweigert Klartext-Auth ohne TLS (code: "tls-required"). Der Settings-Typ
      // kennt fuer IMAP nur "implicit"/"starttls" (die UI bietet unverschluesselt nie an), ein
      // Vergleich auf tls === "none" waere hier also ein Typfehler. Die Loopback-Pruefung ist
      // gleichwertig: der Riegel im Client greift ohnehin nur, wenn transport.secure false ist —
      // das Ventil oeffnet sich nur fuer einen lokalen Fake-IMAP-Server (Integrationstest).
      ...(isLoopback(account.imap.host) ? { allowInsecureAuth: true } : {}),
      ...(deps.log ? { log: deps.log } : {}),
    });
    if (!connected.ok) return { ok: false, accountId: account.id, code: connected.code, detail: connected.detail };
    const session: ImapSession = connected.session;

    try {
      const examined = await session.examine(folder);
      if (!examined.ok) return { ok: false, accountId: account.id, code: examined.code, detail: examined.detail };

      const uids = await session.uidSearchAll();
      const known = deps.uidCache.known(account.id, folder, examined.uidValidity);
      const unknownUids = uids.filter((u) => !known.has(u));
      if (unknownUids.length > 0) {
        for (const [uid, mailId] of await session.uidFetchMessageIds(unknownUids)) {
          if (mailId === null) continue; // ohne Message-ID-Header: ID entsteht erst beim Parsen
          known.set(uid, mailId);
          deps.uidCache.remember(account.id, folder, examined.uidValidity, uid, mailId);
        }
      }

      const index = deps.index();
      const onServer = new Set<string>();
      const fetched: { mail: ParsedMail; eml: Uint8Array }[] = [];
      let errors = 0;
      // Zaehlt UIDs, deren Mail-ID dieser Lauf NICHT bestimmen konnte (Body zwischenzeitlich
      // verschwunden oder unparsbar) — onServer bleibt fuer diese UID leer, siehe unten.
      let undetermined = 0;

      for (const uid of uids) {
        const cachedId = known.get(uid);
        if (cachedId !== undefined) {
          onServer.add(cachedId);
          if (index.has(cachedId)) continue; // Notiz existiert — kein Body noetig
        }
        const eml = await session.uidFetchBody(uid);
        if (!eml) { errors += 1; undetermined += 1; continue; } // UID zwischenzeitlich verschwunden — ID unbekannt
        try {
          const mail = await parseEml(eml);
          onServer.add(mail.id);
          deps.uidCache.remember(account.id, folder, examined.uidValidity, uid, mail.id);
          if (!index.has(mail.id)) fetched.push({ mail, eml });
        } catch {
          errors += 1; undetermined += 1; // unparsbare Mail ueberspringt der Lauf, ID bleibt unbekannt
        }
      }
      deps.uidCache.retain(account.id, folder, examined.uidValidity, uids);

      const rawPlans = planSync({
        profile, source, syncedAt: deps.now(), index,
        takenPaths: deps.takenPaths(), fetched, onServer,
        linkFor: (id) => index.get(id)?.path.replace(/\.md$/, "") ?? null,
      });

      // Konnte dieser Lauf mindestens eine Server-ID nicht bestimmen, ist `onServer`
      // unvollstaendig — ein Detach waere dann evtl. falsch (die Mail liegt vielleicht noch
      // im Ordner, wir wissen es nur nicht). Ein liegengebliebenes Detach holt der naechste
      // saubere Lauf nach; ein faelschliches Detach schreibt sofort in den Vault — deshalb
      // bei Unsicherheit lieber keins. reattach/create beruhen auf tatsaechlich gefundenen
      // IDs, nicht auf Abwesenheit, und bleiben unberuehrt.
      const plans = undetermined > 0
        ? rawPlans.filter((p) => !(p.kind === "setState" && p.state === "detached"))
        : rawPlans;

      const result = await deps.executor().execute(plans);
      const executedPlans = executed(plans, result.errors);
      const counts: SyncCounts = {
        created: result.created,
        reattached: executedPlans.filter((p) => p.kind === "setState" && p.state === "live").length,
        detached: executedPlans.filter((p) => p.kind === "setState" && p.state === "detached").length,
        skipped: result.skipped.length,
        errors: errors + result.errors.length,
      };
      for (const p of executedPlans) {
        deps.events.emit("changed", { path: p.path, kind: p.kind, mailId: p.mailId });
      }
      deps.events.emit("synced", { accountId: account.id, counts });
      return { ok: true, accountId: account.id, counts };
    } finally {
      await session.logout();
    }
  }

  /** Eindeutiger Schluessel eines Plans fuer den Abgleich gegen `PlanExecutionResult.errors`
   *  (s. u.) — jede Mail-ID liefert `planSync` hoechstens einen Plan, `path` grenzt zusaetzlich ab. */
  function planKey(p: NotePlan): string {
    return `${p.path}|${p.mailId}`;
  }

  /** Plaene, die tatsaechlich gewirkt haben: keine skips, keine gescheiterten. Der Abgleich
   *  laeuft ueber `path`+`mailId` statt Objektidentitaet — `PlanExecutionResult.errors` (siehe
   *  core/mirror/execute.ts) sagt nicht zu, dass `errors[].plan` dieselbe Referenz ist wie der
   *  uebergebene Plan; ein Executor darf den Plan klonen oder rekonstruieren. */
  function executed(plans: NotePlan[], failed: { plan: NotePlan; message: string }[]): NotePlan[] {
    const failedKeys = new Set(failed.map((f) => planKey(f.plan)));
    return plans.filter((p) => p.kind !== "skip" && !failedKeys.has(planKey(p)));
  }

  return {
    async syncAccount(accountId) {
      const account = deps.accounts().find((a) => a.id === accountId);
      if (!account) return { ok: false, accountId, code: "no-account" };
      if (!deps.busy.tryAcquire()) return { ok: false, accountId, code: "busy" };
      try {
        return await run(account);
      } catch (e) {
        return { ok: false, accountId, code: "protocol", detail: e instanceof Error ? e.message : String(e) };
      } finally {
        deps.busy.release();
      }
    },

    async syncAll() {
      const out: SyncRunResult[] = [];
      // Nacheinander, nie parallel: der Busy-Guard laesst ohnehin nur einen Lauf zu, und zwei
      // gleichzeitige Laeufe wuerden dieselben freien Pfade doppelt vergeben.
      for (const a of deps.accounts().filter((x) => x.sync.enabled)) out.push(await this.syncAccount(a.id));
      return out;
    },
  };
}
