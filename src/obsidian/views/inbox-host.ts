import type { Account } from "../../core/settings";
import type { Unsubscribe } from "../../core/sync/events";
import { buildInboxViewModel, type InboxRow, type InboxViewModel } from "../../core/view/inbox-vm";
import type { InboxActionResult } from "../../core/inbox/actions";
import type { InboxFetchResult } from "../../core/inbox/fetch";
import type { InboxHost } from "./inbox-panel";

export interface InboxHostDeps {
  accounts: () => readonly Account[];
  isBusy: () => boolean;
  fetchInbox: (accountId: string) => Promise<InboxFetchResult>;
  adopt: (accountId: string, uid: number) => Promise<InboxActionResult>;
  archive: (accountId: string, uid: number) => Promise<InboxActionResult>;
  /** Bestaetigung vor einem Server-Verschieben — am Server nicht rueckgaengig zu machen. */
  confirmMove: (kind: "adopt" | "archive", zielordner: string) => Promise<boolean>;
  targetFolder: (accountId: string, kind: "adopt" | "archive") => string;
  /** Nach erfolgreichem Uebernehmen: die Notiz entsteht im Sync, nicht in der Aktion. */
  syncNow: (accountId: string) => void;
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
  const horcher = new Set<() => void>();

  function melde(): void {
    for (const cb of horcher) cb();
  }

  async function laden(): Promise<void> {
    if (kontoId.length === 0) { zustand = "bereit"; rows = []; melde(); return; }
    zustand = "laedt";
    melde();
    const r = await deps.fetchInbox(kontoId);
    if (r.ok) {
      rows = r.rows;
      kannVerschieben = r.kannVerschieben;
      zustand = "bereit";
      fehlerCode = null;
    } else {
      zustand = "fehler";
      fehlerCode = r.code;
    }
    melde();
  }

  async function verschieben(kind: "adopt" | "archive", uid: number): Promise<void> {
    const ziel = deps.targetFolder(kontoId, kind);
    if (!(await deps.confirmMove(kind, ziel))) return;
    const r = kind === "adopt" ? await deps.adopt(kontoId, uid) : await deps.archive(kontoId, uid);
    if (!r.ok) {
      deps.notifyError(r.code);
      // Bei `gone` ist die Liste nachweislich veraltet — dann neu laden statt sie stehen
      // zu lassen, sonst klickt der Nutzer denselben Fehler ein zweites Mal.
      if (r.code === "gone") void laden();
      return;
    }
    if (kind === "adopt") deps.syncNow(kontoId);
    void laden();
  }

  return {
    accounts: () => deps.accounts(),
    selectedAccountId: () => kontoId,
    selectAccount: (id) => { kontoId = id; void laden(); },
    viewModel: (): InboxViewModel => buildInboxViewModel({ zustand, rows, fehlerCode, kannVerschieben, busy: deps.isBusy() }),
    refresh: () => { void laden(); },
    adopt: (uid) => { void verschieben("adopt", uid); },
    archive: (uid) => { void verschieben("archive", uid); },
    openSettings: () => deps.openSettings(),
    onChange: (cb) => {
      horcher.add(cb);
      const ab = deps.onChange(cb);
      return () => { horcher.delete(cb); ab(); };
    },
  };
}
