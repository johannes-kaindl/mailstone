// uebernommen aus calendar-notes/src/core/commands/registry.ts, 2026-08-30
// Kommandos registrieren sich als Arrays (keine Seiteneffekte beim Import); der Aufrufer
// (src/main.ts oder ein Test) baut das Register per ensureDefaultCommands() auf.
import { MAIL_COMMANDS } from "./mail-commands";
import type { CommandDescriptor, CommandProbe } from "./types";

let registered: CommandDescriptor[] = [];

export function registerCommands(cmds: CommandDescriptor[]): void {
  const seen = new Set(registered.map((c) => c.id));
  for (const c of cmds) {
    if (seen.has(c.id)) throw new Error(`Doppelte Kommando-ID: ${c.id}`);
    seen.add(c.id);
  }
  registered = [...registered, ...cmds];
}

/** Befuellt die Registry mit dem eingebauten Satz — IDEMPOTENT. Ein blindes
 *  registerCommands([...]) wuerfe beim zweiten Aufruf (Plugin-Reload im selben Prozess);
 *  und wer den Aufruf ganz vergisst, bekommt eine leere Registry und Kommandos, die es
 *  nirgends gibt (der Fall, den calendar-notes 2026-08-23 erst im GUI-Smoke bemerkte). */
export function ensureDefaultCommands(): void {
  const ids = new Set(registered.map((c) => c.id));
  const missing = MAIL_COMMANDS.filter((c) => !ids.has(c.id));
  if (missing.length > 0) registerCommands(missing);
}

export function resetCommands(): void {
  registered = [];
}

export function commandRegistry(): CommandDescriptor[] {
  return [...registered];
}

export function findCommand(id: string): CommandDescriptor | undefined {
  return registered.find((c) => c.id === id);
}

export function commandsFor(probe: CommandProbe): CommandDescriptor[] {
  return registered.filter((c) => c.appliesTo(probe));
}
