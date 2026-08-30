import type { NotePlan } from "./plan";

export interface PlanExecutionResult {
  created: number;
  updated: number;
  skipped: NotePlan[];
  stateChanged: number;
  /** Ein gescheiterter Plan beendet den Lauf nicht — die uebrigen werden ausgefuehrt und der
   *  Fehlschlag wird als Wert gemeldet (Spec § 5: Fehler sind Werte, kein Stacktrace-Spam). */
  errors: { plan: NotePlan; message: string }[];
}

export interface PlanExecutor {
  execute(plans: NotePlan[]): Promise<PlanExecutionResult>;
}

export interface ZoneHashStore {
  get(mailId: string): string | null;
  set(mailId: string, hash: string): void;
}
