import { Notice, Plugin, SuggestModal, TFile, getLanguage, type App } from "obsidian";
import { loadSettings, type Account, type MailstoneSettings } from "./core/settings";
import { initI18n } from "./i18n/strings";
import { t } from "./vendor/code-kit/i18n";
import { MailstoneSettingTab } from "./obsidian/settings-tab";
import { importEmlFolder } from "./obsidian/import-eml";
import { noticeNotifier, type Notifier } from "./obsidian/notifier";
import { FolderPromptModal } from "./obsidian/modals/folder-prompt";
import { obsidianSecretStore } from "./obsidian/secrets";
import { nodeSocketTransport } from "./obsidian/tls-transport";
import { createSendService, resolveSender, isLoopback, type SendService } from "./core/send/service";
import { transportAccounts, splitTransportId } from "./core/send/imip";
import type { SecretStore } from "./core/send/secrets";
import { imapConnect, imapConnectWritable } from "./core/imap/client";
import { fetchInbox as fetchInboxCore } from "./core/inbox/fetch";
import { adoptMessage, archiveMessage, type InboxActionCode } from "./core/inbox/actions";
import { createTaskFromInbox } from "./core/inbox/create-task-flow";
import { pollUntil } from "./obsidian/poll";
import { buildMailTransport, createCalendarNotesBridge, type CalendarNotesBridge } from "./obsidian/calendar-notes-bridge";
import { createSyncService, type SyncService, type SyncRunResult } from "./core/sync/service";
import { dueAccounts, TICK_MS } from "./core/sync/schedule";
import { createBusyGuard } from "./core/sync/busy";
import { createEmitter, type Emitter, type SyncEmitter } from "./core/sync/events";
import { createUidCache, type UidCacheStore, type UidCacheData } from "./core/sync/uid-cache";
import { recordRun, parseRunState, type RunState } from "./core/sync/run-state";
import { findNotePathForMailId, mailIndex, vaultPlanExecutor, writeAttachment, type ZoneHashStore } from "./obsidian/vault-notes";
import { withTaskPreset } from "./core/mirror/profile";
import { commandRegistry, ensureDefaultCommands } from "./core/commands/registry";
import { CREATE_TASK_COMMAND } from "./core/commands/create-task";
import type { CommandDescriptor } from "./core/commands/types";
import type { CommandExecuteDeps, CommandExecuteResult } from "./core/commands/execute";
import type { NotePlan } from "./core/mirror/plan";
import { runCommand, probeFor, type RunResult } from "./obsidian/command-flow";
import { readTaskNotesApi, createTaskViaBridge } from "./obsidian/tasknotes-bridge";
import { trTitle } from "./obsidian/command-i18n";
import { createCockpitHost } from "./obsidian/views/cockpit-host";
import type { CockpitHost } from "./obsidian/views/cockpit-panel";
import { createInboxHost, type CreateTaskOutcome } from "./obsidian/views/inbox-host";
import type { InboxHost } from "./obsidian/views/inbox-panel";
import { confirmAction } from "./vendor/kit-obsidian/confirm";
import { MailstoneView, VIEW_TYPE_MAILSTONE, activateMailstoneView } from "./obsidian/views/mailstone-view";

// runState ist Laufzeitzustand wie zoneHashes und uidCache, keine Einstellung — s.
// Task-Brief M5: bewusst NICHT in MailstoneSettings.
interface PersistedState { settings: MailstoneSettings; zoneHashes: Record<string, string>; uidCache: UidCacheData; runState: RunState }

interface TransportRow { id: string; address: string; label: string }

/** Waehlt Konto+Identitaet fuer "Test-Mail an mich": Suchfeld ueber alle
 *  `transportAccounts()`-Zeilen (Konto x Identitaet), abgebrochen (Escape/Klick daneben)
 *  liefert `null` statt eine Ausnahme zu werfen. */
class TransportPickerModal extends SuggestModal<TransportRow> {
  private settled = false;
  private resolveFn: (row: TransportRow | null) => void = () => undefined;

  constructor(
    app: App,
    private readonly rows: TransportRow[],
  ) {
    super(app);
  }

  getSuggestions(query: string): TransportRow[] {
    const q = query.toLowerCase();
    return this.rows.filter((r) => r.label.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));
  }

  renderSuggestion(row: TransportRow, el: HTMLElement): void {
    el.setText(row.label);
  }

  onChooseSuggestion(row: TransportRow): void {
    this.settle(row);
  }

  onClose(): void {
    this.settle(null);
  }

  private settle(row: TransportRow | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveFn(row);
  }

  pick(): Promise<TransportRow | null> {
    return new Promise((resolve) => {
      this.resolveFn = resolve;
      this.open();
    });
  }
}

/** Text fuer die Statusleiste, wenn ein Sync-Lauf zuende ist, aber KEIN Konto erfolgreich war.
 *  Das `"synced"`-Event (das den Status im Normalfall auf `status.sync.idle` zurueckstellt)
 *  feuert nur auf dem Erfolgspfad eines Kontos (s. core/sync/service.ts) — ohne diesen Zweig
 *  bliebe die Anzeige bei "synchronisiert…" haengen, obwohl der Lauf laengst vorbei ist (Fund
 *  Fix-Runde 1: besonders sichtbar bei "no-secret", das der Passwort-Hinweis in der Kontenzeile
 *  jetzt haeufiger provoziert). `null`, wenn mindestens ein Konto erfolgreich war (das Event hat
 *  den Status dann schon aktuell gesetzt) oder `results` leer ist (keine aktivierten Konten).
 *  Reine Funktion (kein Obsidian-Zugriff) — direkt ohne Mock testbar. */
export function syncFailureStatus(results: readonly SyncRunResult[], silent = false): string | null {
  if (results.length === 0 || results.some((r) => r.ok)) return null;
  const failures = results.filter((r): r is Extract<SyncRunResult, { ok: false }> => !r.ok);
  // `busy` heisst: ein anderer Lauf arbeitet gerade — kein Fehler dieses Kontos. Im
  // unbeaufsichtigten Takt darf das die Statusleiste nicht uebernehmen, sonst zeigt sie
  // "Es laeuft bereits eine Synchronisation", WAEHREND der manuelle Lauf, der die Sperre haelt,
  // noch arbeitet und seinen eigenen Status dorthin schreiben will.
  const relevant = silent ? failures.filter((r) => r.code !== "busy") : failures;
  const failed = relevant[0];
  return failed ? `Mailstone: ${t(`error.sync.${failed.code}`)}` : null;
}

export interface SyncNotice { key: string; args: (string | number)[] }

/** Welche Konten ein Lauf anfasst.
 *
 *  Der Punkt ist der `only`-Zweig: ein ausdruecklich angefordertes Konto wird NICHT nach
 *  `sync.enabled` gefiltert. „Jetzt synchronisieren" war sonst bei abgeschaltetem
 *  Auto-Abgleich wirkungslos — und zwar zustandsabhaengig, weil ein zweites, aktives Konto
 *  den Riegel passieren liess und derselbe Knopf sich je nach Nachbarkonto anders verhielt.
 *  Manuell heisst manuell; `sync.enabled` regelt den WECKER, nicht die Bedienbarkeit.
 *  `dueAccounts` filtert fuer den Takt ohnehin selbst, der stille Lauf verliert also nichts.
 *
 *  Reine Funktion, damit die Auswahl ohne Plugin-Instanz pruefbar ist — dieselbe Begruendung
 *  wie bei `syncNotices` und `syncFailureStatus`. */
export function syncTargets(accounts: readonly Account[], only?: readonly string[]): string[] {
  if (only) return [...only];
  return accounts.filter((a) => a.sync.enabled).map((a) => a.id);
}

/** Schreibt den Plugin-Zustand nur, wenn er sich seit dem letzten Schreibvorgang geaendert hat.
 *  Der Intervall-Lauf ruft `saveSettings()` in jedem Tick — ohne diesen Riegel entstuende alle
 *  fuenf Minuten eine Schreiboperation auf `data.json`, eine Datei, die Obsidian Sync und Git
 *  beobachten (M3-Nachlese).
 *
 *  Der Vergleich laeuft ueber die Serialisierung, nicht ueber ein Dirty-Flag an fuenf
 *  Mutationsstellen: `JSON.stringify` kostet hier nichts gegen die Datei-IO, und ein Flag, das
 *  irgendwo zu setzen vergessen wird, verliert Daten still. Der Stand gilt erst NACH erfolgreichem
 *  Schreiben als geschrieben — sonst wuerde eine Aenderung, deren Schreibvorgang scheiterte, beim
 *  naechsten Aufruf uebersprungen. Rueckgabe sagt, ob geschrieben wurde (fuer Tests). */
export function createPersister<T>(save: (state: T) => Promise<void>): (state: T) => Promise<boolean> {
  let last: string | null = null;
  return async (state: T): Promise<boolean> => {
    const serialised = JSON.stringify(state);
    if (serialised === last) return false;
    await save(state);
    last = serialised;
    return true;
  };
}

/**
 * Faengt einen werfenden `runCommand()` ab. Der Aufrufer in `onload` startet ihn ueber
 * `void this.runMailCommand(...)` (Obsidians `checkCallback` ist synchron) — eine Rejection
 * dort ist unbeobachtet: kein Notice, kein Status, nichts. Reachable throws liegen VOR dem
 * try/catch in `executeCommandPlan` (das nur Fehler waehrend des Schreibens abfaengt): ein
 * verschwundenes/umbenanntes File beim `vault.read`/`readBinary`, `getAvailablePathForAttachment`,
 * ein werfendes `Modal.open()` (M3b-Nachlese, Fund 3). Eigene Exportfunktion statt inline im
 * `try`, damit sie ohne Obsidian-App testbar ist. */
export async function safeRunCommand(run: () => Promise<RunResult>): Promise<RunResult> {
  try {
    return await run();
  } catch {
    return { kind: "error", code: "unexpected" };
  }
}

/** Ob das Standard-Notice "Done: {0} note(s) written, {1} skipped." unterdrueckt wird.
 *  mail.replyExternal plant per Bauart keine Notizen — nur eine externe URL —, deshalb waere
 *  "Done: 0 note(s) written, 0 skipped." dort keine Information, sondern eine Verwirrung
 *  (M3b-Nachlese, Sammel-Review). mail.createTask ist derselbe Fall mit einer TaskNotes-
 *  Aufgabe statt einer URL (Fix-Runde 1, Task 5): ohne diese Erweiterung liefe die eigene
 *  "Aufgabe angelegt: …"-Notice neben einem irrefuehrenden "nichts geschrieben". Reine
 *  Funktion, damit die Bedingung ohne Obsidian-App pruefbar ist. */
export function suppressDoneNotice(r: Extract<CommandExecuteResult, { ok: true }>): boolean {
  const wroteNothing = r.created + r.updated === 0 && r.skipped.length === 0 && !r.attachmentPath;
  return wroteNothing && (r.openedUrl === true || r.taskPath !== undefined);
}

/** Wie viele uebersprungene Plaene an einem zwischenzeitlichen Schreibvorgang scheiterten
 *  (Fund 2, M3b-Nachlese: der Lost-Update-Schutz in vaultPlanExecutor). Der reine Zaehler in
 *  "Done: … skipped" sagt nicht, WARUM — ohne diese Zahl waere das nur im Log nachvollziehbar. */
export function staleSkipCount(skipped: readonly NotePlan[]): number {
  return skipped.filter((p) => p.kind === "skip" && p.reason === "content-changed").length;
}

/** Text der Statusleiste nach einem beendeten Lauf. `created + reattached` ist ein LAUF-Zaehler;
 *  in der Form "{0} Notizen" las er sich wie eine Bestandszahl, und nach einem Lauf ohne
 *  Aenderungen stand dort "0 Notizen" — als waere der Vault leer (M3-Nachlese). Der Nullfall
 *  bekommt deshalb einen eigenen Satz statt einer Null. */
export function syncIdleStatus(counts: { created: number; reattached: number }, time: string): string {
  const n = counts.created + counts.reattached;
  return n > 0 ? t("status.sync.idle", String(n), time) : t("status.sync.idleNoChange", time);
}

/** Welche Meldungen ein beendeter Sync-Lauf ausgibt. Reine Funktion (kein Obsidian-Zugriff),
 *  damit die Auswahl ohne Plugin-Mock pruefbar ist — dieselbe Begruendung wie bei
 *  `syncFailureStatus`.
 *
 *  Der Zuschnitt ist der eigentliche Punkt: die Zusammenfassung ("x neu, y verbunden…") gehoert
 *  dem beaufsichtigten Lauf, sonst poppte alle fuenf Minuten eine Meldung auf. **Ausgelassene
 *  Abloesungen gehoeren beiden.** Sie sind kein Zaehler des Normalfalls, sondern der Hinweis,
 *  dass der Detach-Zweig dieses Laufs stillgelegt war — und der Fall tritt gerade im
 *  unbeaufsichtigten Intervall-Lauf auf, wo ihn vorher niemand zu sehen bekam (M3-Nachlese). */
export function syncNotices(
  results: readonly SyncRunResult[],
  silent: boolean,
  prevDetachSkipped: number | null = null,
): { notices: SyncNotice[]; detachSkipped: number } {
  const ok = results.filter((r): r is Extract<SyncRunResult, { ok: true }> => r.ok);
  if (ok.length === 0) return { notices: [], detachSkipped: prevDetachSkipped ?? 0 };
  const sum = ok.reduce((acc, r) => ({
    created: acc.created + r.counts.created,
    reattached: acc.reattached + r.counts.reattached,
    detached: acc.detached + r.counts.detached,
    detachSkipped: acc.detachSkipped + r.counts.detachSkipped,
    errors: acc.errors + r.counts.errors,
  }), { created: 0, reattached: 0, detached: 0, detachSkipped: 0, errors: 0 });
  const out: SyncNotice[] = [];
  if (!silent) out.push({ key: "notice.sync.done", args: [sum.created, sum.reattached, sum.detached, sum.errors] });
  // Im stillen Lauf nur bei VERAENDERTEM Stand: `undetermined > 0` haelt sich von Natur aus ueber
  // viele Laeufe (ein Erstbestand braucht Dutzende, eine Mail ohne bestimmbare ID bleibt es
  // dauerhaft). Bei einem Takt von einer Minute waere die Meldung sonst ein Popup pro Minute —
  // schlimmer als der Befund, der sie ueberhaupt in den stillen Lauf gebracht hat.
  const meldenswert = sum.detachSkipped > 0 && (!silent || sum.detachSkipped !== prevDetachSkipped);
  if (meldenswert) out.push({ key: "notice.sync.detachSkipped", args: [sum.detachSkipped] });
  return { notices: out, detachSkipped: sum.detachSkipped };
}

export default class MailstonePlugin extends Plugin {
  settings: MailstoneSettings = loadSettings(undefined);
  zoneHashes: Record<string, string> = {};
  runState: RunState = {};
  private lastRun: Record<string, number> = {};
  sendService!: SendService;
  bridge!: CalendarNotesBridge;
  syncService!: SyncService;
  uidCache!: UidCacheStore;
  status!: HTMLElement;
  readonly busy = createBusyGuard();
  /** Zuletzt gemeldeter Stand ausgelassener Abloesungen — Wiederholungssperre im stillen Lauf. */
  private lastDetachSkipped: number | null = null;
  readonly syncEvents: SyncEmitter = createEmitter();
  /** Eigener Emitter statt eine Wiederverwendung von syncEvents: das ist die Flaeche, an der
   *  Fremdplugins per api.on(...) haengen — die Cockpit-View soll dort nicht mitlauschen. */
  private readonly cockpitChanged: Emitter<{ changed: undefined }> = createEmitter();
  /** Wie viele Sync-Laeufe gerade offen sind. Eigener Zustand NEBEN dem BusyGuard, nicht statt
   *  ihm: der Guard wird tief in `syncAccount` belegt und dort im `finally` sofort wieder
   *  freigegeben — zwischen zwei Konten und beim Render ist er frei. Fuer die Frage „laeuft das
   *  Cockpit gerade?" ist er damit unbrauchbar, obwohl er fuer seine eigene Frage
   *  („darf ich jetzt schreiben?") richtig ist. */
  private cockpitRuns = 0;

  async onload(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PersistedState> | null;
    this.settings = loadSettings(raw?.settings ?? raw);
    this.zoneHashes = raw?.zoneHashes ?? {};
    this.runState = parseRunState(raw?.runState);
    initI18n(this.settings.language === "auto" ? getLanguage() : this.settings.language);
    const secrets = obsidianSecretStore(this.app);
    // Objektreferenz statt Kopie: this.settings wird nach dieser Stelle im onload() nicht mehr
    // neu zugewiesen (nur Felder darin mutiert), der Tab sieht also stets den aktuellen Stand.
    this.addSettingTab(
      new MailstoneSettingTab(this.app, this, {
        settings: this.settings,
        saveSettings: () => this.saveSettings(),
        secrets,
        transport: () => nodeSocketTransport(),
      }),
    );
    const notify = noticeNotifier();

    this.sendService = createSendService({
      accounts: () => this.settings.accounts,
      secret: (id) => secrets.get(id),
      transport: () => nodeSocketTransport(),
      // Zweite Fabrik fuer die Ablage im Sent-Ordner: der SMTP-Transport ist nach dem Versand
      // verbraucht, die Kopie braucht eine eigene Verbindung.
      imapTransport: () => nodeSocketTransport(),
      timers: window,
      now: () => new Date(),
      randomId: () => crypto.randomUUID(),
      ...(this.settings.debugLog ? { log: (l: string) => console.debug("[mailstone smtp]", l) } : {}),
    });

    this.uidCache = createUidCache(raw?.uidCache);
    const hashes = { get: (k: string) => this.zoneHashes[k] ?? null, set: (k: string, v: string) => { this.zoneHashes[k] = v; } };
    this.syncService = createSyncService({
      accounts: () => this.settings.accounts,
      // taskPreset (Settings) fliesst nur ueber onCreate ein — planMailNote wendet onCreate
      // ausschliesslich im create-Zweig an (M5 § 5).
      profile: () => withTaskPreset(this.settings.profile, this.settings.taskPreset),
      secret: (id) => secrets.get(id),
      transport: () => nodeSocketTransport(),
      index: () => mailIndex(this.app, this.settings.profile),
      takenPaths: () => new Set(this.app.vault.getFiles().map((f) => f.path)),
      executor: () => vaultPlanExecutor(this.app, hashes),
      uidCache: this.uidCache,
      busy: this.busy,
      events: this.syncEvents,
      // window statt nacktem setTimeout: `obsidianmd/prefer-window-timers` verlangt es, und
      // core/ darf `window` nicht selbst kennen (check:pure) — deshalb hier injiziert.
      timers: window,
      now: () => new Date(),
      ...(this.settings.debugLog ? { log: (l: string) => { console.debug("[mailstone imap]", l); } } : {}),
    });

    this.status = this.addStatusBarItem();
    this.syncEvents.on("synced", ({ counts }) => {
      this.status.setText(syncIdleStatus(counts, new Date().toLocaleTimeString()));
    });

    this.addCommand({ id: "sync-mailbox", name: t("cmd.sync.name"), callback: () => void this.runSync(notify) });

    // Genau ein registerView-Type (UI-STANDARD §1): das Ribbon-Symbol OEFFNET die Ansicht,
    // es startet keinen Lauf mehr — "sync-mailbox" in der Befehlspalette bleibt der Weg fuer
    // einen direkten Sync ohne die Seitenleiste zu oeffnen.
    this.registerView(VIEW_TYPE_MAILSTONE, (leaf) => new MailstoneView(leaf, this.cockpitHost(notify), this.inboxHost(notify, secrets)));
    this.addRibbonIcon("mail", t("cockpit.title"), () => { void activateMailstoneView(this.app); });
    // Eigener Schluessel statt cockpit.title: Obsidian stellt jedem Kommandonamen den
    // Plugin-Namen voran — mit dem View-Titel stuende in der Palette „Mailstone: Mailstone".
    this.addCommand({ id: "open-cockpit", name: t("cmd.openCockpit.name"), callback: () => { void activateMailstoneView(this.app); } });
    // Auto-Oeffnen ist Opt-in, Default aus (REGISTRY: Opt-in-Gate fuer Startup-Seiteneffekt).
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openViewOnStartup) void activateMailstoneView(this.app);
    });

    // Ohne diesen Aufruf bliebe die Registry leer und jedes Kommando waere unauffindbar —
    // genau der Fehler, den calendar-notes erst im GUI-Smoke bemerkte.
    ensureDefaultCommands();
    for (const descriptor of commandRegistry()) {
      this.addCommand({
        // Obsidian-Kommando-IDs tragen keine Punkte; die Deskriptor-ID bleibt unberuehrt.
        id: descriptor.id.replace(/\./g, "-"),
        name: trTitle(descriptor),
        // checkCallback statt callback: ein Kommando, das zur geoeffneten Notiz nicht passt,
        // steht gar nicht erst in der Palette — statt dort zu stehen und eine Fehlermeldung
        // zu zeigen.
        checkCallback: (checking: boolean): boolean => {
          // Pruefstelle 1 (Spec § 3): mail.createTask nur anbieten, wenn TaskNotes da ist und
          // seine Form stimmt — src/core/** darf die fremde API nicht kennen, appliesTo() weiss
          // davon also nichts. Faellt die Pruefung durch, FEHLT das Kommando in der Palette,
          // statt ausgegraut zu erscheinen.
          if (descriptor.id === CREATE_TASK_COMMAND.id && readTaskNotesApi(this.app) === null) return false;
          const probe = probeFor(this.app, this.settings.profile);
          if (!probe || !descriptor.appliesTo(probe)) return false;
          if (!checking) void this.runMailCommand(descriptor, notify);
          return true;
        },
      });
    }

    // registerInterval statt setInterval: Obsidian raeumt den Timer beim Entladen selbst ab.
    // Fester Takt statt einer beim Laden berechneten Kadenz — welche Konten faellig sind,
    // entscheidet `dueAccounts` bei jedem Schlag neu (s. core/sync/schedule.ts).
    // Beim Laden gilt jedes vorhandene Konto als gerade gelaufen, sonst synchronisierte der erste
    // Takt unmittelbar nach dem Start. Ein spaeter angelegtes Konto hat keinen Eintrag und ist
    // damit sofort faellig — genau das erwartet man nach dem Einrichten.
    const startedAt = Date.now();
    for (const a of this.settings.accounts) this.lastRun[a.id] = startedAt;
    this.registerInterval(window.setInterval(() => { void this.runDueSyncs(notify, this.lastRun); }, TICK_MS));

    this.bridge = createCalendarNotesBridge(
      this.app,
      buildMailTransport({ accounts: () => this.settings.accounts, sendService: this.sendService, label: "Mailstone" }),
    );
    // calendar-notes kann vor oder nach mailstone geladen werden (und zur Laufzeit entladen
    // werden) — deshalb hier, in onLayoutReady UND bei jedem "layout-change" versuchen, solange
    // noch nicht registriert (tryRegister() ist idempotent).
    this.bridge.tryRegister();
    this.app.workspace.onLayoutReady(() => {
      this.bridge.tryRegister();
    });
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        if (!this.bridge.registered) this.bridge.tryRegister();
      }),
    );

    this.addCommand({
      id: "import-eml-folder",
      name: t("cmd.importEml.name"),
      callback: async () => {
        const folder = await new FolderPromptModal(this.app, t("import.prompt.folder")).prompt();
        if (!folder) return;
        // finally: die Zone-Hashes der bereits geschriebenen Notizen muessen auch dann
        // persistiert werden, wenn der Lauf unterwegs wirft — sonst gilt beim naechsten Lauf
        // jede davon als fremd editiert (zone-edited) und wird nie wieder aktualisiert.
        try {
          const r = await importEmlFolder(
            {
              app: this.app,
              profile: withTaskPreset(this.settings.profile, this.settings.taskPreset),
              hashes: { get: (k) => this.zoneHashes[k] ?? null, set: (k, v) => { this.zoneHashes[k] = v; } },
              now: () => new Date(),
            },
            folder,
          );
          notify.info("import.done", r.created, r.updated, r.skipped.length, r.errors.length);
          if (r.errors.length > 0) notify.error("import.errors", r.errors.length);
        } finally {
          await this.saveSettings();
        }
      },
    });

    this.addCommand({
      id: "send-test-mail",
      name: t("cmd.sendTest.name"),
      callback: () => void this.sendTestMail(notify),
    });
  }

  onunload(): void {
    this.bridge?.unregister();
  }

  /** Schreibt nur bei tatsaechlicher Aenderung — s. createPersister. */
  private readonly persist = createPersister<PersistedState>((state) => this.saveData(state));

  async saveSettings(): Promise<void> {
    // uidCache.data() liefert die interne Referenz, keine Kopie — hier nur lesen, nie
    // hineinschreiben, sonst umgeht man die Verwerfungslogik des Caches bei UIDVALIDITY-Wechsel.
    await this.persist({ settings: this.settings, zoneHashes: this.zoneHashes, uidCache: this.uidCache.data(), runState: this.runState } satisfies PersistedState);
    // Hier und nicht nur am Ende von runSync: der Settings-Tab ruft ausschliesslich
    // saveSettings(). Ohne diesen Emit blieb eine offene Ansicht nach dem Anlegen des ersten
    // Kontos im Empty-State stehen — und weil dort auch „Alle synchronisieren" gesperrt ist,
    // gab es keinen Knopf mehr, der ein Re-Render haette ausloesen koennen. Dasselbe galt fuer
    // Umbenennen, Loeschen und den Sync-Schalter.
    // Unbedingt, nicht nur bei tatsaechlichem Schreiben: der Persister vergleicht die
    // Serialisierung von `data.json`, das Cockpit zeigt aber auch `lastRun` — Zustand, der
    // dort gar nicht vorkommt. Ein Re-Render zu viel ist unsichtbar, ein fehlendes nicht.
    this.cockpitChanged.emit("changed", undefined);
  }

  private cockpitHost(notify: Notifier): CockpitHost {
    return createCockpitHost({
      accounts: () => this.settings.accounts,
      runState: () => this.runState,
      lastRun: () => this.lastRun,
      // Beides: der Guard sperrt auch waehrend eines Kommandos (dann darf das Cockpit nicht
      // dazwischenfunken), der Zaehler ueberbrueckt die Luecken zwischen zwei Konten eines Laufs.
      isBusy: () => this.busy.isBusy() || this.cockpitRuns > 0,
      syncNow: (accountId) => { void this.runSync(notify, false, accountId ? [accountId] : undefined); },
      // `setting` ist undokumentierte Obsidian-Flaeche, deshalb optional zugegriffen statt fest
      // gecastet — fehlt sie einmal, oeffnet sich nichts, statt dass die Zeile wirft.
      // `openTabById` ist der zweite Teil: `open()` allein landet auf dem ZULETZT benutzten Tab,
      // und wer gerade „noch kein Konto" gelesen hat, stuende dann womoeglich bei „Darstellung".
      // Vorbild kuro-gamification/src/main.ts:461.
      openSettings: () => {
        const setting = (this.app as unknown as {
          setting?: { open(): void; openTabById(id: string): void };
        }).setting;
        setting?.open();
        setting?.openTabById(this.manifest.id);
      },
      onChange: (cb) => this.cockpitChanged.on("changed", cb),
    });
  }

  private inboxHost(notify: Notifier, secrets: SecretStore): InboxHost {
    const konto = (id: string): Account | undefined => this.settings.accounts.find((a) => a.id === id);

    // Kein-Geheimnis ist ein Konfigurationsfehler, keiner, den connect() melden kann: dessen
    // Rueckgabetyp ImapConnectResult/ImapConnectWritableResult kennt nur ImapErrorCode, und
    // "no-secret" gehoert nicht dazu (s. InboxActionCode) — deshalb hier abgefangen, BEVOR
    // eine Verbindung ueberhaupt versucht wird. Derselbe Riegel wie SyncService.syncAccount.
    function password(acc: Account): { ok: true; wert: string } | { ok: false; code: InboxActionCode } {
      const w = secrets.get(acc.secretId);
      return w === null ? { ok: false, code: "no-secret" } : { ok: true, wert: w };
    }

    const connectOpts = (acc: Account, pw: string) => ({
      host: acc.imap.host, port: acc.imap.port, tls: acc.imap.tls,
      username: acc.username, password: pw, timers: window,
      ...(isLoopback(acc.imap.host) ? { allowInsecureAuth: true } : {}),
    });

    return createInboxHost({
      accounts: () => this.settings.accounts,
      // Derselbe geteilte Guard wie beim Cockpit — ein zweiter Zaehler wuerde eine zweite,
      // moeglicherweise widerspruechliche Wahrheit ueber "laeuft gerade etwas" fuehren.
      isBusy: () => this.busy.isBusy() || this.cockpitRuns > 0,
      fetchInbox: async (accountId) => {
        const acc = konto(accountId);
        if (!acc) return { ok: false, code: "gone", detail: "Konto nicht mehr vorhanden" };
        const pw = password(acc);
        if (!pw.ok) return { ok: false, code: pw.code, detail: "kein Geheimnis hinterlegt" };
        return fetchInboxCore(
          {
            connect: () => imapConnect(nodeSocketTransport(), connectOpts(acc, pw.wert)),
            busy: this.busy,
            bekannteIds: () => new Set(mailIndex(this.app, this.settings.profile).keys()),
          },
          { folder: acc.folders.inbox },
        );
      },
      adopt: async (accountId, uid) => {
        const acc = konto(accountId);
        if (!acc) return { ok: false, code: "gone", detail: "Konto nicht mehr vorhanden" };
        const pw = password(acc);
        if (!pw.ok) return { ok: false, code: pw.code, detail: "kein Geheimnis hinterlegt" };
        return adoptMessage(
          // imapConnectWritable, nicht imapConnect: der Sync bleibt lesend, diese Aktion ist
          // der EINZIGE hier erlaubte Weg zu einer schreibfaehigen Sitzung (client.ts:264).
          { connect: () => imapConnectWritable(nodeSocketTransport(), connectOpts(acc, pw.wert)), busy: this.busy },
          { uid, sourceFolder: acc.folders.inbox, targetFolder: acc.folders.allowlist },
        );
      },
      archive: async (accountId, uid) => {
        const acc = konto(accountId);
        if (!acc) return { ok: false, code: "gone", detail: "Konto nicht mehr vorhanden" };
        const pw = password(acc);
        if (!pw.ok) return { ok: false, code: pw.code, detail: "kein Geheimnis hinterlegt" };
        return archiveMessage(
          { connect: () => imapConnectWritable(nodeSocketTransport(), connectOpts(acc, pw.wert)), busy: this.busy },
          { uid, sourceFolder: acc.folders.inbox, targetFolder: acc.folders.archive },
        );
      },
      confirmMove: (kind, zielordner) => confirmAction(this.app, { message: t(`inbox.confirm.${kind}`, zielordner) }),
      targetFolder: (accountId, kind) => {
        const acc = konto(accountId);
        if (!acc) return "";
        return kind === "adopt" ? acc.folders.allowlist : acc.folders.archive;
      },
      // Pruefstelle 1 (Spec § 4, dieselbe Logik wie beim Kommando in checkCallback oben):
      // die dritte Zeilen-Aktion fehlt ganz, statt ausgegraut dazustehen, wenn TaskNotes nicht
      // erreichbar ist.
      taskNotesAvailable: () => readTaskNotesApi(this.app) !== null,
      createTask: async (accountId, uid, mailId) => {
        const acc = konto(accountId);
        if (!acc) return { kind: "error", code: "gone", adopted: false };
        const pw = password(acc);
        if (!pw.ok) return { kind: "error", code: pw.code, adopted: false };
        const kette = await createTaskFromInbox(
          {
            // imapConnectWritable, nicht imapConnect: dieselbe Begruendung wie bei adopt oben —
            // schreibfaehige Sitzungen entstehen NUR ueber diesen Weg.
            connect: () => imapConnectWritable(nodeSocketTransport(), connectOpts(acc, pw.wert)),
            busy: this.busy,
            // Fix-Runde 1, Important 3: NICHT direkt `syncService.syncAccount` — nur `runSync`
            // persistiert Zone-Hashes/UID-Cache im `finally` (main.ts runSync-Kommentar). Ohne
            // diesen Weg blieben auf dem sync-timeout-Pfad geschriebene Notizen unpersistiert
            // und gaelten beim naechsten Lauf als fremd editiert. Nebengewinn: das Cockpit
            // zeigt die bis zu 30s laufende Kette als "laeuft" an (cockpitRuns).
            syncAccount: (id) => this.runSync(notify, false, [id]),
            // Fix-Runde 1, Minor 4+5: gezielte Suche mit Abbruch beim Treffer statt eines
            // vollen Index-Aufbaus pro Poll-Tick, und auf beiden Seiten normalisiert — sonst
            // triff eine von Hand mit spitzen Klammern geschriebene `mail_id` nie.
            notePathFor: (id) => findNotePathForMailId(this.app, this.settings.profile, id),
            pollUntil: pollUntil(window),
          },
          { uid, sourceFolder: acc.folders.inbox, targetFolder: acc.folders.allowlist, accountId, mailId },
        );
        if (!kette.ok) return { kind: "error", code: kette.code, adopted: kette.adopted };
        // Ab hier ist die Notiz da — derselbe Kommando-Weg wie im Notiz-Fall (Formular +
        // Vorschau), kein zweiter Formular- und Fehlerpfad (Task-Brief).
        return this.runCreateTaskForNote(kette.notePath, notify);
      },
      // Die Notiz entsteht im Sync, nicht in der Aktion (Spec § 4) — nach einem erfolgreichen
      // Uebernehmen also einen (nicht-stillen) Lauf fuer GENAU dieses Konto anstossen. Die
      // Zusage wird durchgereicht (nicht `void`): der Host wartet auf sie, bevor er selbst neu
      // laedt (I1) — `runSync` gibt sie ohnehin bereits zurueck.
      syncNow: (accountId) => this.runSync(notify, false, [accountId]).then(() => undefined),
      // Fix-Runde 1, Important 2: die dritte Zeilen-Aktion (Task 6) kann Codes aus dem
      // Kommando-Weg durchreichen (`error.command.*`), nicht nur InboxActionCode-Werte
      // (`inbox.error.*`) — ein Punkt im Code heisst "bereits vollstaendig qualifiziert".
      notifyError: (code) => notify.error(code.includes(".") ? code : `inbox.error.${code}`),
      openSettings: () => {
        const setting = (this.app as unknown as {
          setting?: { open(): void; openTabById(id: string): void };
        }).setting;
        setting?.open();
        setting?.openTabById(this.manifest.id);
      },
      // "synced" UND "changed": ein Sync ohne inhaltliche Aenderung (synced) kann trotzdem
      // den imVault-Status einer Zeile veraendert haben (Notiz woanders geloescht+neu erkannt),
      // "changed" feuert dagegen nur bei tatsaechlich ausgefuehrten NotePlans (Spec § 8).
      onChange: (cb) => {
        const ab1 = this.syncEvents.on("synced", () => cb());
        const ab2 = this.syncEvents.on("changed", () => cb());
        return () => { ab1(); ab2(); };
      },
    });
  }

  private hashStore(): ZoneHashStore {
    return { get: (k) => this.zoneHashes[k] ?? null, set: (k, v) => { this.zoneHashes[k] = v; } };
  }

  private commandExecuteDeps(): CommandExecuteDeps {
    return {
      // Derselbe Guard wie der SyncService: ein laufender Sync und ein Kommando schliessen
      // einander aus.
      busy: this.busy,
      notes: vaultPlanExecutor(this.app, this.hashStore()),
      writeAttachment: writeAttachment(this.app),
      openExternal: (url: string) => { window.open(url); },
      createTask: (req) => createTaskViaBridge(this.app, req),
    };
  }

  /** Faehrt ein Kommando und meldet das Ergebnis. Ein Abbruch durch den Nutzer meldet
   *  nichts — er weiss, dass er abgebrochen hat. Die Zone-Hashes werden auch nach einem
   *  Fehlschlag persistiert (dieselbe Begruendung wie beim Import- und beim Sync-Kommando:
   *  sonst gilt eine geschriebene Notiz beim naechsten Lauf als fremd editiert). */
  private async runMailCommand(descriptor: CommandDescriptor, notify: Notifier): Promise<void> {
    let outcome: RunResult;
    try {
      outcome = await safeRunCommand(() => runCommand(
        { app: this.app, profile: () => this.settings.profile, hashes: this.hashStore(), now: () => new Date() },
        this.commandExecuteDeps(),
        descriptor,
      ));
    } finally {
      await this.saveSettings();
    }
    if (outcome.kind === "cancelled") return;
    if (outcome.kind === "error") { notify.error(`error.command.${outcome.code}`); return; }
    const r = outcome.result;
    if (!r.ok) { notify.error(`error.command.${r.code}`); return; }
    if (!suppressDoneNotice(r)) notify.info("notice.command.done", r.created + r.updated, r.skipped.length);
    const staleSkips = staleSkipCount(r.skipped);
    if (staleSkips > 0) notify.info("notice.command.staleSkip", staleSkips);
    if (r.attachmentPath) notify.info("notice.command.attachment", r.attachmentPath);
    if (r.taskPath) notify.info("notice.command.taskCreated", r.taskPath);
  }

  /** Task 6, letzter Schritt der Posteingangs-Kette: die Notiz ist jetzt da — ab hier ist der
   *  Weg identisch zum Notiz-Fall (`mail.createTask` aus der Befehlspalette), deshalb wird er
   *  nicht zweimal gebaut.
   *
   *  Fix-Runde 1, Important 1: die Notiz wird NICHT mehr geoeffnet — der Nutzer hat "Aufgabe
   *  erstellen" geklickt, nicht "Notiz oeffnen", und ein ungefragt umgeschalteter Hauptbereich
   *  ist eine Nebenwirkung, die niemand bestellt hat. Statt dessen bekommt `runCommand()` die
   *  Ziel-Notiz explizit als vierten Parameter: ohne den Parameter waere die aktive View beim
   *  Klick die `MailstoneView` selbst (keine FileView), und `getActiveFile()` griffe auf
   *  Obsidians "zuletzt aktive Datei"-Fallback zurueck — trifft der die falsche Notiz, entstuende
   *  eine Aufgabe mit `noteLink` auf die falsche Mail, ohne Fehlermeldung (appliesTo() ist fuer
   *  jede Mail-Notiz true). */
  private async runCreateTaskForNote(notePath: string, notify: Notifier): Promise<CreateTaskOutcome> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return { kind: "error", code: "error.command.not-applicable", adopted: true };
    let outcome: RunResult;
    try {
      outcome = await safeRunCommand(() => runCommand(
        { app: this.app, profile: () => this.settings.profile, hashes: this.hashStore(), now: () => new Date() },
        this.commandExecuteDeps(),
        CREATE_TASK_COMMAND,
        file,
      ));
    } finally {
      await this.saveSettings();
    }
    if (outcome.kind === "cancelled") return { kind: "cancelled" };
    // Fix-Runde 1, Important 2: diese Codes sind CommandErrorCode/CommandExecuteResult-Werte,
    // keine InboxActionCode-Werte — `strings.ts` fuehrt sie unter `error.command.*`, nicht
    // unter `inbox.error.*`. Der volle, bereits qualifizierte Schluessel geht durch bis zum
    // Host, dessen `notifyError` einen Punkt im Code als "schon qualifiziert" erkennt.
    if (outcome.kind === "error") return { kind: "error", code: `error.command.${outcome.code}`, adopted: true };
    const r = outcome.result;
    if (!r.ok) return { kind: "error", code: `error.command.${r.code}`, adopted: true };
    if (r.taskPath) notify.info("notice.command.taskCreated", r.taskPath);
    return { kind: "done" };
  }

  /** Ein Takt des Weckers: nur die faelligen Konten, und die Faelligkeit wird bei jedem Schlag
   *  frisch aus den Einstellungen bestimmt. Der Zeitstempel wird VOR dem Lauf gesetzt und auch
   *  dann, wenn das Konto scheitert — sonst versuchte ein dauerhaft unerreichbares Konto es bei
   *  jedem Takt erneut, statt in seinem eigenen Intervall zu bleiben. */
  private async runDueSyncs(notify: Notifier, lastRun: Record<string, number>): Promise<void> {
    const due = dueAccounts(this.settings.accounts, lastRun, Date.now());
    if (due.length === 0) return;
    const vorher = new Map(due.map((id) => [id, lastRun[id]]));
    const now = Date.now();
    for (const id of due) lastRun[id] = now;
    const results = await this.runSync(notify, true, due);
    // `busy` heisst, dass ein anderer Lauf die Sperre hielt — dieses Konto wurde also gar nicht
    // synchronisiert. Es als "gerade gelaufen" zu buchen kostete es ein volles Intervall, obwohl
    // nichts geschehen ist; der Stempel wird deshalb zurueckgenommen.
    for (const r of results) {
      if (r.ok || r.code !== "busy") continue;
      const alt = vorher.get(r.accountId);
      if (alt === undefined) delete lastRun[r.accountId];
      else lastRun[r.accountId] = alt;
    }
  }

  /** `silent` = Intervall-Lauf: kein Notice bei Erfolg, nur bei Fehlern — sonst poppt alle
   *  fuenf Minuten eine Meldung auf. Der Nutzer sieht das Ergebnis in der Statusleiste.
   *  `only` schraenkt auf bestimmte Konten ein (der Wecker uebergibt die faelligen, das Cockpit
   *  das angeklickte) und laeuft dann OHNE `sync.enabled`-Filter; ohne Angabe laufen alle
   *  aktivierten. Die Auswahl selbst trifft `syncTargets`, dort steht auch die Begruendung. */
  private async runSync(notify: Notifier, silent = false, only?: readonly string[]): Promise<SyncRunResult[]> {
    const ziele = syncTargets(this.settings.accounts, only);
    if (ziele.length === 0) { if (!silent) notify.info("notice.sync.noAccounts"); return []; }
    this.status.setText(t("status.sync.running"));
    // Der Lauf beginnt SICHTBAR: der BusyGuard wird erst in syncAccount belegt und im finally
    // dort wieder freigegeben — beim Render ist er darum immer frei, und der is-checking-
    // Indikator waere unerreichbar. Ein eigener Zaehler statt eines Bools, weil ein Takt des
    // Weckers und ein Handlauf sich ueberlappen koennen: das `finally` des inneren Laufs
    // loeschte sonst die Anzeige des aeusseren.
    this.cockpitRuns += 1;
    this.cockpitChanged.emit("changed", undefined);
    try {
      // Nacheinander, nie parallel gegen denselben Vault — dieselbe Zusage, die `syncAll` im
      // SyncService gibt. Eine Schleife fuer BEIDE Faelle statt syncAll() im einen Zweig: die
      // Auswahl der Konten trifft damit an EINER Stelle `syncTargets` und ist dort pruefbar,
      // statt sich auf zwei Filter in zwei Modulen zu verteilen — genau die Aufteilung, aus der
      // Befund 2 entstand.
      const results: SyncRunResult[] = [];
      for (const id of ziele) results.push(await this.syncService.syncAccount(id));
      for (const r of results) if (!r.ok && !(silent && r.code === "busy")) notify.error(`error.sync.${r.code}`);
      // Scheitern ALLE aktivierten Konten, feuert kein "synced"-Event — die Statusleiste
      // bliebe sonst dauerhaft bei "synchronisiert…" stehen (Fund Fix-Runde 1).
      const failureStatus = syncFailureStatus(results, silent);
      if (failureStatus) this.status.setText(failureStatus);
      const { notices, detachSkipped } = syncNotices(results, silent, this.lastDetachSkipped);
      for (const n of notices) notify.info(n.key, ...n.args);
      this.lastDetachSkipped = detachSkipped;
      this.runState = recordRun(this.runState, results, Date.now());
      return results;
    } finally {
      this.cockpitRuns -= 1;
      // Zone-Hashes und UID-Cache muessen auch nach einem Abbruch persistiert sein — sonst
      // gilt jede geschriebene Notiz beim naechsten Lauf als fremd editiert (dieselbe
      // Begruendung wie beim Import-Kommando aus M1). Der Emit fuers Cockpit steckt darin —
      // ein eigener waere ein zweites Re-Render fuer dieselbe Aenderung.
      await this.saveSettings();
    }
  }

  private async sendTestMail(notify: { info(key: string, ...a: (string | number)[]): void; error(key: string, ...a: (string | number)[]): void }): Promise<void> {
    const withIdentities = this.settings.accounts.filter((a) => a.identities.length > 0);
    if (withIdentities.length === 0) {
      new Notice(t("error.send.no-accounts"));
      return;
    }

    let accountId: string;
    let identityId: string;
    if (withIdentities.length === 1) {
      const acc = withIdentities[0];
      if (!acc) return; // unreachable (Laenge oben geprueft), macht noUncheckedIndexedAccess still.
      const identity = acc.identities.find((i) => i.id === acc.defaultIdentityId) ?? acc.identities[0];
      if (!identity) return; // unreachable: withIdentities filtert identities.length > 0.
      accountId = acc.id;
      identityId = identity.id;
    } else {
      const rows = transportAccounts(withIdentities);
      const picked = await new TransportPickerModal(this.app, rows).pick();
      if (!picked) return;
      const split = splitTransportId(picked.id);
      if (!split) return;
      accountId = split.accountId;
      identityId = split.identityId;
    }

    const resolved = resolveSender(this.settings.accounts, accountId, identityId);
    if (!resolved.ok) {
      notify.error(`error.send.${resolved.code}`);
      return;
    }

    const result = await this.sendService.send(accountId, {
      from: identityId,
      to: [resolved.identity.address],
      subject: "Mailstone test",
      text: `Mailstone test ${new Date().toISOString()}`,
    });
    if (result.ok) notify.info("notice.sendTest.ok", result.messageId);
    else notify.error(`error.send.${result.code}`);
  }
}
