import type { Account } from "../../core/settings";
import type { Unsubscribe } from "../../core/sync/events";
import { buildInboxViewModel, type InboxRow, type InboxViewModel } from "../../core/view/inbox-vm";
import type { InboxActionResult } from "../../core/inbox/actions";
import type { InboxFetchResult } from "../../core/inbox/fetch";
import type { InboxHost } from "./inbox-panel";

/** Ausgang der dritten Zeilen-Aktion (Task 6: Posteingangs-Weg zu einer Aufgabe). `adopted`
 *  fehlt bei `cancelled`/`done` bewusst nicht als eigenes Feld — beide heissen "die Uebernahme
 *  ist passiert" (bei `cancelled` hat der Nutzer nur die anschliessende Aufgabe abgebrochen).
 *  Nur `error` kann VOR der Uebernahme scheitern (busy, kein Geheimnis, kein Zielordner) und
 *  traegt deshalb, ob die Mail den Posteingang trotzdem schon verlassen hat. */
export type CreateTaskOutcome = { kind: "done" } | { kind: "cancelled" } | { kind: "error"; code: string; adopted: boolean };

export interface InboxHostDeps {
  accounts: () => readonly Account[];
  isBusy: () => boolean;
  fetchInbox: (accountId: string) => Promise<InboxFetchResult>;
  adopt: (accountId: string, uid: number) => Promise<InboxActionResult>;
  archive: (accountId: string, uid: number) => Promise<InboxActionResult>;
  /** Bestaetigung vor einem Server-Verschieben — am Server nicht rueckgaengig zu machen. */
  confirmMove: (kind: "adopt" | "archive" | "createTask", zielordner: string) => Promise<boolean>;
  targetFolder: (accountId: string, kind: "adopt" | "archive") => string;
  /** Ob die dritte Aktion ("Aufgabe erstellen") ueberhaupt angeboten wird — Pruefstelle-1-Logik
   *  wie beim Kommando (`readTaskNotesApi(app) !== null`), aus der Obsidian-Schicht gereicht:
   *  `src/core/**` darf die fremde API nicht kennen. */
  taskNotesAvailable: () => boolean;
  /** Fuehrt die volle Kette: uebernehmen -> gezielt synchronisieren -> auf die Notiz warten ->
   *  denselben Kommando-Weg wie im Notiz-Fall (Formular + Vorschau) auf ihr ausfuehren. */
  createTask: (accountId: string, uid: number, mailId: string) => Promise<CreateTaskOutcome>;
  /** Nach erfolgreichem Uebernehmen: die Notiz entsteht im Sync, nicht in der Aktion. Die
   *  Zusage ist absichtlich Teil des Vertrags (I1): sie loest sich erst, wenn `runSync` seinen
   *  eigenen Busy-Guard wieder freigegeben hat — der Host wartet genau darauf, bevor er selbst
   *  neu laedt, sonst kollidiert das Nachladen mit dem noch laufenden Sync. */
  syncNow: (accountId: string) => Promise<void>;
  notifyError: (code: string) => void;
  openSettings: () => void;
  /** Haengt an den Emittern `synced`/`changed` — die Liste ist eine Momentaufnahme und
   *  soll sich erneuern, wenn der Sync etwas veraendert hat (Spec § 8). */
  onChange: (cb: () => void) => Unsubscribe;
}

/**
 * Haelt den Zustand, den das Panel nur liest: gewaehltes Konto, zuletzt geholte Zeilen,
 * Lade- und Fehlerlage. Das Panel bleibt damit zustandslos und ist eine reine Funktion
 * dieses Zustands — dieselbe Aufteilung wie beim Cockpit.
 */
export function createInboxHost(deps: InboxHostDeps): InboxHost {
  let kontoId = deps.accounts()[0]?.id ?? "";
  let zustand: "laedt" | "fehler" | "bereit" = "bereit";
  let rows: readonly InboxRow[] = [];
  let fehlerCode: string | null = null;
  let kannVerschieben = false;
  // I2: der Tab soll sich beim ERSTEN Sichtbarwerden von selbst fuellen, aber nicht bei jedem
  // Tab-Wechsel neu laden — buildHubInto ruft onShow() bei jeder Aktivierung, nicht nur einmal.
  let ersteLadungAusgeloest = false;
  const horcher = new Set<() => void>();

  function melde(): void {
    for (const cb of horcher) cb();
  }

  async function laden(): Promise<void> {
    // I5: das erste Konto kann NACH der Host-Erzeugung angelegt worden sein, oder das
    // gewaehlte wurde geloescht — `kontoId` wird sonst nur einmal beim Erzeugen ausgewertet
    // und der Aktualisieren-Knopf bliebe bis zum Schliessen/Neuoeffnen der Seitenleiste tot.
    if (!deps.accounts().some((a) => a.id === kontoId)) {
      kontoId = deps.accounts()[0]?.id ?? "";
    }
    if (kontoId.length === 0) { zustand = "bereit"; rows = []; melde(); return; }
    const vorher = zustand;
    zustand = "laedt";
    melde();
    const r = await deps.fetchInbox(kontoId);
    if (r.ok) {
      rows = r.rows;
      kannVerschieben = r.kannVerschieben;
      zustand = "bereit";
      fehlerCode = null;
    } else if (r.code === "busy") {
      // I1: ein Guard-Zusammenstoss (Uebernehmen -> syncNow -> Nachladen, oder der
      // Intervall-Wecker waehrend eines laufenden Ladevorgangs) ist keine Fehlermeldung wert
      // — die vorhandene Liste bleibt stehen statt durch "Ein anderer Vorgang laeuft gerade."
      // ersetzt zu werden.
      zustand = vorher;
    } else {
      zustand = "fehler";
      fehlerCode = r.code;
    }
    melde();
  }

  async function verschieben(kind: "adopt" | "archive", uid: number): Promise<void> {
    const ziel = deps.targetFolder(kontoId, kind);
    if (ziel.length === 0) {
      // Kleinbefund: die Pruefung gehoert VOR die Bestaetigung — der Dialog fragte sonst nach
      // einem Ordner, den es noch gar nicht gibt, und meldete den Fehler erst danach.
      deps.notifyError("no-target-folder");
      return;
    }
    if (!(await deps.confirmMove(kind, ziel))) return;
    const r = kind === "adopt" ? await deps.adopt(kontoId, uid) : await deps.archive(kontoId, uid);
    if (!r.ok) {
      deps.notifyError(r.code);
      // Bei `gone` ist die Liste nachweislich veraltet — dann neu laden statt sie stehen
      // zu lassen, sonst klickt der Nutzer denselben Fehler ein zweites Mal.
      if (r.code === "gone") void laden();
      return;
    }
    if (kind === "adopt") {
      // I1: erst NACH dem Sync-Abschluss neu laden. `runSync` belegt den Busy-Guard SYNCHRON,
      // vor seinem ersten `await` — ein `laden()` direkt daneben traf ihn noch besetzt und
      // zeigte "busy" anstelle der (laengst erfolgreichen) Liste.
      await deps.syncNow(kontoId);
    }
    void laden();
  }

  /** Task 6: die dritte Zeilen-Aktion. `deps.createTask` erledigt die ganze Kette (uebernehmen,
   *  gezielt synchronisieren, auf die Notiz warten, den bestehenden Kommando-Weg auf ihr
   *  ausfuehren) — dieser Host entscheidet nur ueber Bestaetigung, Fehlermeldung und Neuladen. */
  async function erstelleAufgabe(uid: number): Promise<void> {
    const zeile = rows.find((r) => r.uid === uid);
    if (!zeile) return;
    const ziel = deps.targetFolder(kontoId, "adopt");
    if (ziel.length === 0) {
      deps.notifyError("no-target-folder");
      return;
    }
    if (!(await deps.confirmMove("createTask", ziel))) return;
    const r = await deps.createTask(kontoId, uid, zeile.mailId);
    if (r.kind === "error") {
      deps.notifyError(r.code);
      // Ein Fehler VOR der Uebernahme (busy, kein Geheimnis, ...) hat die Liste nicht
      // veraendert — nur bei `adopted: true` hat die Mail den Posteingang bereits verlassen.
      if (r.adopted) void laden();
      return;
    }
    // "done" und "cancelled" heissen beide: die Uebernahme ist passiert, die Mail ist weg.
    void laden();
  }

  // I2 (Teil B): ein Sync macht die Liste veraltet — neu LADEN statt nur neu zu zeichnen, sonst
  // aktualisiert sich weder die Zeilenmenge noch der "liegt im Vault"-Badge (Spec § 8). `laden()`
  // haelt bei `busy` selbst den vorherigen Zustand (I1), ein Zusammenstoss mit einem parallel
  // laufenden Nachladen ist also unschaedlich. Einmalig fuer die Lebensdauer des Hosts verdrahtet.
  // Nur NACH dem ersten `ensureLoaded()`: sonst loest ein Sync im Hintergrund eine IMAP-Verbindung
  // fuer einen Tab aus, den niemand je geoeffnet hat — das erste Laden bleibt bewusst lazy
  // (Spec § 8 "beim Oeffnen des Tabs"), das Nachladen danach folgt derselben Regel.
  //
  // Regression aus dem I2-Re-Review: der Unsub wurde bis hierher NIRGENDS gehalten. `main.ts`
  // ruft die Host-Fabrik bei jeder Leaf-Erzeugung neu auf, und `InboxHost` hatte kein `destroy()`
  // — jedes Schliessen/Wiederoeffnen des Posteingangs haengte einen weiteren, nie abgemeldeten
  // Listener an `syncEvents` (plugin-lebenslang). Ein toter Host konnte so bei kuenftigen Syncs
  // erneut `laden()` ausloesen und eine IMAP-Verbindung fuer eine laengst geschlossene Ansicht
  // aufbauen. Der Unsub wird jetzt gehalten und in `destroy()` aufgerufen.
  const syncUnsub = deps.onChange(() => { if (ersteLadungAusgeloest) void laden(); });

  return {
    accounts: () => deps.accounts(),
    selectedAccountId: () => kontoId,
    selectAccount: (id) => { kontoId = id; void laden(); },
    viewModel: (): InboxViewModel => buildInboxViewModel({ zustand, rows, fehlerCode, kannVerschieben, busy: deps.isBusy() }),
    refresh: () => { void laden(); },
    ensureLoaded: () => {
      if (ersteLadungAusgeloest) return;
      ersteLadungAusgeloest = true;
      void laden();
    },
    adopt: (uid) => { void verschieben("adopt", uid); },
    archive: (uid) => { void verschieben("archive", uid); },
    canCreateTask: () => deps.taskNotesAvailable(),
    createTask: (uid) => { void erstelleAufgabe(uid); },
    openSettings: () => deps.openSettings(),
    onChange: (cb) => {
      horcher.add(cb);
      return () => { horcher.delete(cb); };
    },
    // Muss vom View-Lebenszyklus aufgerufen werden (`MailstoneView.onClose()`) — ohne diesen
    // Aufruf bleibt `syncUnsub` fuer immer aktiv (s. Kommentar oben an `syncUnsub`).
    destroy: () => {
      syncUnsub();
      horcher.clear();
    },
  };
}
