import { adoptMessage, type InboxActionCode, type InboxActionDeps, type InboxActionRequest } from "./actions";

/**
 * Der Posteingangs-Weg zu einer TaskNotes-Aufgabe: eine Mail ohne Notiz hat keinen
 * `MailTarget`-Pfad, deshalb lebt diese Kette NEBEN dem Deskriptor-Rahmen aus core/commands —
 * genau wie `adoptMessage`/`archiveMessage`. Design 2026-09-05 § 4:
 *
 *   adoptMessage(...)            // UID MOVE in den Allowlist-Ordner
 *     -> syncAccount(accountId)  // gezielt, nicht aufs Intervall warten
 *     -> pollUntil(Notiz zur Message-ID im Index, Frist)
 *
 * Der Beleg dafuer, dass die Notiz da ist, ist der INDEX-TREFFER, nicht die Rueckmeldung des
 * Sync-Laufs — ein Lauf kann fehlerfrei enden, ohne dass genau diese Notiz entstanden ist.
 * Dieselbe Linie wie M4s `UID MOVE`, das seinen Erfolg an `COPYUID` misst statt an der
 * `OK`-Zeile des Servers.
 */

/** 30s: das reguraere Sync-Intervall kann Minuten entfernt sein, und ein Modal, das
 *  minutenlang wartet, ist kaputt — der gezielte Sync macht diese Kette erst tragbar. */
export const CREATE_TASK_SYNC_TIMEOUT_MS = 30_000;

export type CreateTaskFlowResult =
  | { ok: true; notePath: string }
  // `adopted` steht bei JEDEM Fehlschlag, nicht nur beim Timeout: die Uebernahme ist auf dem
  // Server passiert, sobald `adoptMessage` `ok:true` meldet, und ab dann in keinem Fehlerfall
  // mehr rueckgaengig zu machen. Wer das Ergebnis nur als Fehlschlag meldet, verleitet zu
  // einem zweiten Uebernehmen, das ins Leere greift, weil die Mail den Posteingang laengst
  // verlassen hat.
  | { ok: false; code: InboxActionCode | "sync-timeout"; detail: string; adopted: boolean };

export interface CreateTaskFlowRequest extends InboxActionRequest {
  accountId: string;
  /** Message-ID der Mail — der Schluessel, unter dem der Index die entstehende Notiz fuehrt. */
  mailId: string;
}

export interface CreateTaskFlowDeps extends InboxActionDeps {
  syncAccount(accountId: string): Promise<unknown>;
  /** Notizpfad zur Message-ID, oder null. Synchron aus dem Index. */
  notePathFor(mailId: string): string | null;
  /** Wartet, bis `pruefen` true liefert oder die Frist reisst. Injiziert statt im Kern gebaut
   *  (`src/core/**` ist obsidian-/DOM-/node-frei, `window.setTimeout` waere ein Verstoss) — und
   *  damit ohne echte Zeit testbar. */
  pollUntil(pruefen: () => boolean, fristMs: number): Promise<boolean>;
}

export async function createTaskFromInbox(
  deps: CreateTaskFlowDeps,
  req: CreateTaskFlowRequest,
): Promise<CreateTaskFlowResult> {
  const uebernommen = await adoptMessage(deps, req);
  if (!uebernommen.ok) {
    // Am Server ist noch nichts passiert — kein zweiter Versuch noetig, also `adopted: false`.
    return { ok: false, code: uebernommen.code, detail: uebernommen.detail, adopted: false };
  }

  // Gezielt fuer GENAU dieses Konto, nicht `syncAll` — andere Konten zu synchronisieren
  // verlaengert nur die Wartezeit des Modals, ohne die gesuchte Notiz naeher zu bringen.
  await deps.syncAccount(req.accountId);

  const daHinein = await deps.pollUntil(() => deps.notePathFor(req.mailId) !== null, CREATE_TASK_SYNC_TIMEOUT_MS);
  if (!daHinein) {
    return {
      ok: false,
      code: "sync-timeout",
      detail: "die Notiz ist binnen der Frist nicht im Index erschienen",
      adopted: true,
    };
  }

  // pollUntil hat den Index-Treffer bereits bestaetigt — der erneute Aufruf holt nur noch den
  // Pfad, den `pruefen()` schon gesehen hat. `?? ""` ist reine Typ-Absicherung, kein erwarteter
  // Ausgang: zwischen der letzten `pruefen()`-Auswertung und hier liegt kein `await`.
  return { ok: true, notePath: deps.notePathFor(req.mailId) ?? "" };
}
