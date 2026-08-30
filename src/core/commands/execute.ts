import type { BusyGuard } from "../sync/busy";
import type { PlanExecutor } from "../mirror/execute";
import type { NotePlan } from "../mirror/plan";
import type { CommandErrorCode, MailCommandPlan } from "./types";

export interface CommandExecuteDeps {
  /** Derselbe Guard wie im SyncService — ein laufender Sync und ein Kommando schliessen
   *  einander aus, egal wer zuerst kam. */
  busy: BusyGuard;
  notes: PlanExecutor;
  writeAttachment(path: string, data: Uint8Array): Promise<void>;
  openExternal(url: string): void;
}

export type CommandExecuteResult =
  | { ok: true; created: number; updated: number; stateChanged: number; skipped: NotePlan[]; attachmentPath?: string; openedUrl?: boolean }
  | { ok: false; code: CommandErrorCode };

/**
 * Der EINZIGE Ort, an dem ein Kommando etwas schreibt. Reihenfolge: Anhang, Notizen, URL —
 * s. Task-Kommentar im Plan (ein toter Wikilink ist schlimmer als ein nicht extrahierter
 * Anhang). Der Guard wird im finally freigegeben, auch wenn ein Port wirft.
 */
export async function executeCommandPlan(plan: MailCommandPlan, deps: CommandExecuteDeps): Promise<CommandExecuteResult> {
  if (!deps.busy.tryAcquire()) return { ok: false, code: "busy" };
  try {
    if (plan.attachment) {
      await deps.writeAttachment(plan.attachment.path, plan.attachment.data);
    }
    const r = await deps.notes.execute(plan.notes);
    if (r.errors.length > 0) return { ok: false, code: "write-failed" };
    if (plan.openUrl) deps.openExternal(plan.openUrl);
    return {
      ok: true,
      created: r.created,
      updated: r.updated,
      stateChanged: r.stateChanged,
      skipped: r.skipped,
      ...(plan.attachment ? { attachmentPath: plan.attachment.path } : {}),
      ...(plan.openUrl ? { openedUrl: true } : {}),
    };
  } catch {
    // Fehler sind Werte (Spec § 5): ein werfender Port wird zum Code, nicht zum Stacktrace.
    return { ok: false, code: "write-failed" };
  } finally {
    deps.busy.release();
  }
}
