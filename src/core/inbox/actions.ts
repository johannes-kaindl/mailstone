import type { ImapConnectWritableResult } from "../imap/client";
import type { BusyGuard } from "../sync/busy";

/**
 * Die beiden Posteingangs-Aktionen. Sie stehen bewusst NEBEN dem Deskriptor-Rahmen aus
 * core/commands: der ist notiz-zentriert (MailTarget ist immer eine Notiz, MailCommandPlan
 * traegt Vault-Schreibvorgaenge) und existiert fuer Formular, Diff-Vorschau und Merge-Risiko.
 * Eine Server-Aktion hat davon nichts — keine Eingabe, kein Diff, kein Vault-Schreiben; die
 * Notiz entsteht anschliessend durch den Sync. Spec 2026-09-02 § 4.
 */
export type InboxActionCode =
  | "busy" // Sync oder eine andere Aktion haelt den Guard
  | "no-target-folder" // Zielordner nicht konfiguriert — es gibt nichts anzusteuern
  | "unsupported" // Server kann kein sicheres Verschieben (kein MOVE)
  | "gone" // Quell-UID trifft nichts mehr — erneut synchronisieren
  // Die restlichen sind genau die ImapErrorCode-Werte (types.ts:7 + net/types.ts:22) —
  // `closed` gehoert dazu, sonst ist `code: verbunden.code` ein Typfehler.
  | "folder-missing" | "connect" | "tls" | "tls-required" | "auth" | "no-secret" | "protocol" | "timeout" | "closed";

export type InboxActionResult = { ok: true } | { ok: false; code: InboxActionCode; detail: string };

export interface InboxActionRequest {
  uid: number;
  sourceFolder: string;
  targetFolder: string;
}

export interface InboxActionDeps {
  /** Baut eine EIGENE kurze Verbindung (connect -> Aktion -> logout), nicht die des Syncs. */
  connect(): Promise<ImapConnectWritableResult>;
  busy: BusyGuard;
}

async function moveMessage(deps: InboxActionDeps, req: InboxActionRequest): Promise<InboxActionResult> {
  // Vor dem Guard pruefen: ein fehlendes Ziel ist eine Konfigurationsfrage, kein Netzvorgang.
  if (req.targetFolder.length === 0) {
    return { ok: false, code: "no-target-folder", detail: "kein Zielordner konfiguriert" };
  }
  if (!deps.busy.tryAcquire()) return { ok: false, code: "busy", detail: "ein anderer Vorgang laeuft" };
  try {
    const verbunden = await deps.connect();
    if (!verbunden.ok) return { ok: false, code: verbunden.code, detail: verbunden.detail };
    const session = verbunden.session;
    try {
      const gewaehlt = await session.select(req.sourceFolder);
      if (!gewaehlt.ok) return { ok: false, code: gewaehlt.code, detail: gewaehlt.detail };
      const verschoben = await session.uidMove(req.uid, req.targetFolder);
      return verschoben.ok ? { ok: true } : { ok: false, code: verschoben.code, detail: verschoben.detail };
    } finally {
      // Der Logout gehoert in den finally-Zweig: eine offene Verbindung nach einem
      // Fehlschlag haelt die Sitzung am Server, bis er sie von sich aus abraeumt.
      await session.logout().catch(() => undefined);
    }
  } finally {
    deps.busy.release();
  }
}

/** Posteingang -> Allowlist-Ordner. Die Notiz entsteht danach durch den Sync, nicht hier. */
export function adoptMessage(deps: InboxActionDeps, req: InboxActionRequest): Promise<InboxActionResult> {
  return moveMessage(deps, req);
}

/** Posteingang -> Archivordner. */
export function archiveMessage(deps: InboxActionDeps, req: InboxActionRequest): Promise<InboxActionResult> {
  return moveMessage(deps, req);
}
