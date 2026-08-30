// Ein Sync-Lauf pro Konto: eine Verbindung, EXAMINE auf den Allowlist-Ordner, UID-Abgleich
// gegen den Vault-Index, Plaene ueber den PlanExecutor. Der Service kennt weder Vault noch
// Obsidian (siehe scripts/check-pure.mjs) — Index, Pfade und Executor kommen als Deps.
import type { Account } from "../settings";
import type { MailProfile } from "../mirror/profile";
import type { SocketTransport } from "../net/types";
import { NetError } from "../net/types";
import type { PlanExecutionResult, PlanExecutor } from "../mirror/execute";
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

/** Obergrenze neu geholter Mails je Lauf. Der Sync ist fuer einen kuratierten Allowlist-Ordner
 *  entworfen (ein paar Dutzend Mails) — zieht jemand beim Einrichten seinen ganzen Bestand
 *  hinein, baute ein einziger Lauf sonst `fetched` UND alle create-Plaene mit denselben
 *  .eml-Bytes gleichzeitig im Renderer-Prozess auf, unbeaufsichtigt, weil der Intervall ihn von
 *  selbst startet. 200 liegt weit ueber dem Entwurfsfall, bleibt bei ueblichen Mailgroessen im
 *  zweistelligen MB-Bereich und teilt einen Erstbestand in wenige Laeufe. Was die Grenze
 *  abschneidet, holt der naechste Lauf; `onServer` wird bis zur letzten UID weiter aus dem
 *  UID-Cache befuellt, der Abbruch loest also keine falschen Detaches aus. */
export const MAX_FETCH_PER_RUN = 200;

/** Obergrenze fuer den Header-Abgleich je Lauf. Derselbe Gedanke wie bei MAX_FETCH_PER_RUN, nur
 *  eine Groessenordnung hoeher: ein Message-ID-Header wiegt ein paar Dutzend Bytes, ein Body
 *  schnell ein Megabyte. Die FETCH-Kommandos selbst waren nie unbegrenzt — client.ts schickt den
 *  Abgleich in Baendern von HEADER_BATCH (200). Unbegrenzt war die MENGE je Lauf: alle Baender
 *  landen in einer Map, ein einziger Lauf zog also den ganzen Ordner durch. 2000 haelt einen
 *  Erstbestand von 10.000 Mails bei fuenf Laeufen — statt fuenfzig, wenn man den Body-Deckel
 *  wiederverwendete. Was die Grenze abschneidet, bleibt UNBESTIMMT — genau wie beim
 *  Body-Deckel setzt der Lauf dann Detaches aus, statt sie faelschlich auszuloesen. */
export const MAX_HEADER_FETCH_PER_RUN = 2000;

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
      // Einziger verfuegbarer Quercheck gegen das teuerste Fehlerbild dieses Moduls: meldet
      // EXAMINE Nachrichten im Ordner, waehrend UID SEARCH ALL nichts liefert, stimmt etwas
      // nicht — und der Lauf wuerde JEDE Notiz dieses Kontos auf detached setzen. Nur der
      // Null-Fall ist sicher pruefbar; eine strikte Gleichheit (uids.length === exists) waere
      // falsch, weil zwischen EXAMINE und SEARCH eine Mail eintreffen kann.
      if (examined.exists > 0 && uids.length === 0) {
        return {
          ok: false, accountId: account.id, code: "protocol",
          detail: `EXAMINE meldet ${String(examined.exists)} Nachrichten, UID SEARCH ALL liefert keine`,
        };
      }

      const known = deps.uidCache.known(account.id, folder, examined.uidValidity);
      // slice NACH dem Filter: was hier abgeschnitten wird, bleibt ohne bekannte Mail-ID und
      // zaehlt unten als `undetermined` — der Lauf setzt Detaches dann aus (s. MAX_HEADER_FETCH_PER_RUN).
      const unknownUids = uids.filter((u) => !known.has(u)).slice(0, MAX_HEADER_FETCH_PER_RUN);
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
      // Mail-IDs, fuer die dieser Lauf schon einen Fetch-Eintrag hat. Zwei UIDs koennen dieselbe
      // normalisierte Message-ID tragen (zurueckkopierte Mail, Sieve-Kopie, an sich selbst
      // weitergeleitete Nachricht) oder ueber fallbackId auf denselben Wert fallen; ohne diesen
      // Riegel bekaeme jede von beiden einen eigenen create-Plan und damit einen eigenen Pfad —
      // zwei Notizen mit identischem mail_id, von denen der mailIndex nur eine wiederfindet.
      const fetchedIds = new Set<string>();
      let errors = 0;
      // Zaehlt UIDs, deren Mail-ID dieser Lauf NICHT bestimmen konnte (Body zwischenzeitlich
      // verschwunden, unparsbar oder wegen MAX_FETCH_PER_RUN gar nicht geholt) — onServer bleibt
      // fuer genau diese UIDs leer, siehe unten. Bewusst NICHT hochgezaehlt, wenn die ID schon
      // aus dem Cache bekannt war: eine MIME-kaputte Mail, deren Header laengst im Cache steht,
      // macht onServer nicht unvollstaendig und darf den Detach-Zweig nicht stilllegen — sonst
      // legte eine einzige dauerhaft unparsbare Mail ihn fuer immer stumm.
      let undetermined = 0;

      for (const uid of uids) {
        const cachedId = known.get(uid);
        if (cachedId !== undefined) {
          onServer.add(cachedId);
          if (index.has(cachedId) || fetchedIds.has(cachedId)) continue; // Notiz existiert/ist geplant — kein Body noetig
        }
        if (fetched.length >= MAX_FETCH_PER_RUN) {
          // Obergrenze erreicht (s. MAX_FETCH_PER_RUN): keine Bodies mehr, die Schleife laeuft
          // aber weiter, damit onServer aus dem Cache vollstaendig bleibt. Nur fuer eine UID
          // ohne bekannte ID bleibt sie unbestimmt — dann setzt der Lauf Detaches aus.
          if (cachedId === undefined) undetermined += 1;
          continue;
        }
        const eml = await session.uidFetchBody(uid);
        // UID zwischenzeitlich verschwunden: ID nur dann unbekannt, wenn der Cache sie nicht kennt.
        if (!eml) { errors += 1; if (cachedId === undefined) undetermined += 1; continue; }
        try {
          const mail = await parseEml(eml);
          onServer.add(mail.id);
          deps.uidCache.remember(account.id, folder, examined.uidValidity, uid, mail.id);
          if (!index.has(mail.id) && !fetchedIds.has(mail.id)) {
            fetchedIds.add(mail.id);
            fetched.push({ mail, eml });
          }
        } catch {
          // Unparsbare Mail ueberspringt der Lauf; ihre ID ist nur unbestimmt, wenn sie auch
          // nicht im Cache stand (bei MIME-Schaden parst der Header in aller Regel noch).
          errors += 1;
          if (cachedId === undefined) undetermined += 1;
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
      const isDetach = (p: NotePlan): boolean => p.kind === "setState" && p.state === "detached";
      const suppressDetach = undetermined > 0;
      const plans = suppressDetach ? rawPlans.filter((p) => !isDetach(p)) : rawPlans;
      // Ein unterdrueckter Detach-Durchgang darf von "es gab nichts zu tun" unterscheidbar sein:
      // sonst sieht der Nutzer nur, dass entfernte Mails nicht mehr abgeloest werden, waehrend
      // der Lauf ok: true meldet.
      const detachSkipped = suppressDetach ? rawPlans.filter(isDetach).length : 0;

      const result = await deps.executor().execute(plans);
      const executedPlans = executed(plans, result);
      const counts: SyncCounts = {
        created: result.created,
        reattached: executedPlans.filter((p) => p.kind === "setState" && p.state === "live").length,
        detached: executedPlans.filter(isDetach).length,
        skipped: result.skipped.length,
        detachSkipped,
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

  /** Plaene, die tatsaechlich gewirkt haben: keine skips, keine gescheiterten — und keine, die
   *  der Executor selbst uebersprungen hat. Beide Ausgaenge sind symmetrisch zu behandeln: ein
   *  `setState`-Plan, dessen Zieldatei zwischen Planung und Ausfuehrung verschwunden ist, landet
   *  nicht in `errors`, sondern als "missing-target"-Skip in `skipped` (src/obsidian/vault-notes.ts)
   *  — er wuerde sonst als detached/reattached gezaehlt und feuerte ein changed-Event fuer eine
   *  Notiz, die nie angefasst wurde. Der Abgleich laeuft ueber `path`+`mailId` statt
   *  Objektidentitaet: `PlanExecutionResult` (siehe core/mirror/execute.ts) sagt nicht zu, dass
   *  die zurueckgegebenen Plaene dieselben Referenzen sind wie die uebergebenen; ein Executor
   *  darf sie klonen oder rekonstruieren. */
  function executed(plans: NotePlan[], result: PlanExecutionResult): NotePlan[] {
    const blocked = new Set([...result.errors.map((f) => planKey(f.plan)), ...result.skipped.map(planKey)]);
    return plans.filter((p) => p.kind !== "skip" && !blocked.has(planKey(p)));
  }

  // Benannte Funktion statt Methode am Rueckgabeobjekt: syncAll ruft sie direkt, nicht ueber
  // `this` — sonst braeche `const { syncAll } = createSyncService(...)` mit einem TypeError.
  async function syncAccount(accountId: string): Promise<SyncRunResult> {
    const account = deps.accounts().find((a) => a.id === accountId);
    if (!account) return { ok: false, accountId, code: "no-account" };
    if (!deps.busy.tryAcquire()) return { ok: false, accountId, code: "busy" };
    try {
      return await run(account);
    } catch (e) {
      // Nach dem Connect uebersetzt niemand mehr: examine/uidSearchAll/uidFetchBody werfen ihren
      // NetError bis hierher durch. Dessen Code ist die Diagnose, die der Nutzer lesen soll
      // ("nicht rechtzeitig geantwortet", "Verbindung geschlossen") — pauschal "protocol" waere
      // eine Falschaussage und liesse vier i18n-Schluessel auf diesem Pfad unerreichbar.
      const code: SyncErrorCode = e instanceof NetError ? e.code : "protocol";
      return { ok: false, accountId, code, detail: e instanceof Error ? e.message : String(e) };
    } finally {
      deps.busy.release();
    }
  }

  async function syncAll(): Promise<SyncRunResult[]> {
    const out: SyncRunResult[] = [];
    // Nacheinander, nie parallel: der Busy-Guard laesst ohnehin nur einen Lauf zu, und zwei
    // gleichzeitige Laeufe wuerden dieselben freien Pfade doppelt vergeben.
    for (const a of deps.accounts().filter((x) => x.sync.enabled)) out.push(await syncAccount(a.id));
    return out;
  }

  return { syncAccount, syncAll };
}
