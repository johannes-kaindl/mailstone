// uebernommen aus calendar-notes/src/obsidian/command-i18n.ts, 2026-08-30
import { t } from "../vendor/code-kit/i18n";
import type { FieldSchema } from "../core/commands/schema";
import type { CommandDescriptor, MailCommandPlan } from "../core/commands/types";

/** `t()` faellt bei einem unbekannten Key auf den Key selbst zurueck. Passiert das, zeigen
 *  wir den englischen Fallback aus dem Deskriptor statt `cmd.mail.relink.title`. */
function trOrFallback(key: string, fallback: string, ...args: (string | number)[]): string {
  const translated = t(key, ...args);
  return translated === key ? fallback : translated;
}

export function trTitle(d: CommandDescriptor): string {
  return trOrFallback(d.titleKey, d.title);
}

export function trDescription(d: CommandDescriptor): string {
  return trOrFallback(d.descriptionKey, d.description);
}

export function tr(d: CommandDescriptor): { title: string; description: string } {
  return { title: trTitle(d), description: trDescription(d) };
}

export function trFieldDescription(field: FieldSchema): string | undefined {
  if (!field.descriptionKey) return field.description;
  return trOrFallback(field.descriptionKey, field.description ?? "");
}

export function trPlan(plan: MailCommandPlan): string {
  return trOrFallback(plan.summaryKey, plan.summary, ...plan.summaryArgs);
}

/** Feldname fuer die Diff-Tabelle. Frontmatter-Keys (`subject`, `to`) bleiben, wie sie in
 *  der Notiz stehen — sie sind der Sache nach schon der richtige Name. Nur die wenigen
 *  eigenen Bezeichner (`attachment`) haben einen Eintrag und werden uebersetzt. */
export function fieldLabel(name: string): string {
  return trOrFallback(`plan.field.${name}`, name);
}
