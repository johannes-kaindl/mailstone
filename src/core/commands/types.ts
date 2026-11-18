import type { ParsedMail } from "../mime/types";
import type { NotePlan } from "../mirror/plan";
import type { MailProfile } from "../mirror/profile";
import type { ObjectSchema } from "./schema";
import { EMPTY_SCHEMA } from "./schema";

export type CommandErrorCode =
  | "busy"                     // Sync oder ein anderes Kommando haelt den Guard
  | "invalid-input"            // Schema-Validierung fehlgeschlagen
  | "not-applicable"           // appliesTo() sagt nein (Doppelpruefung vor dem Ausfuehren)
  | "eml-missing"              // keine .eml am Konventionspfad
  | "eml-unparseable"          // parseEml hat geworfen
  | "eml-mismatch"             // die .eml gehoert zu einer ANDEREN Mail als die Notiz
  | "original-not-found"       // weder .eml neben der Notiz noch Original auf dem Server (A6)
  | "original-unsearchable"    // Message-ID fehlt (noid-) oder ist per IMAP nicht durchsuchbar
  | "original-desktop-only"    // keine .eml, und der Abruf vom Server gibt es nur am Desktop
  | "fences-missing"           // Zone fehlt (Merge-Regel 3)
  | "zone-edited"              // Zone von Hand geaendert (Merge-Regel 4)
  | "frontmatter-unparseable"  // verwalteter Key liegt als Block-Skalar vor (Merge-Regel 2)
  | "attachment-missing"       // gewaehlter Anhang liegt nicht in der .eml
  | "no-recipient"             // keine Absenderadresse zum Antworten
  | "tasknotes-unavailable"    // TaskNotes fehlt oder die Formpruefung ist durchgefallen
  | "task-create-failed"       // tasks.create hat abgelehnt oder geworfen
  | "no-choices"               // ein Auswahlfeld hat KEINE Option — das Formular waere unbedienbar
  | "nothing-to-do"            // Plan waere leer — nichts zu schreiben
  | "write-failed"             // Schreibvorgang gescheitert
  | "unexpected";              // runCommand() hat geworfen, BEVOR etwas geschrieben wurde (M3b-Nachlese, Fund 3)

/** Ein Netzfehler beim Abruf des Originals behaelt Code UND Text des Sync-Fehlers: der Code ist
 *  schon der volle i18n-Schluessel (`error.sync.auth`), dieselbe Konvention wie `notifyError` im
 *  Posteingang (ein Punkt im Code heisst „bereits qualifiziert“). */
export type QualifiedErrorKey = `error.sync.${string}`;

/** Was ein Fehler beim Aufbau des Kontexts tragen kann: ein Kommando-Code oder ein Sync-Schluessel. */
export type ContextErrorCode = CommandErrorCode | QualifiedErrorKey | `error.command.${string}`;

/** Die Notiz, auf die ein Kommando wirkt. */
export interface MailTarget {
  mailId: string;
  path: string;
  /** Wert von `profile.sourceField` — wird von Kommandos NIE geaendert, nur weitergereicht. */
  source: string;
  /** Wert von `profile.stateField` (`live` | `detached` | null bei Altbestand). */
  state: string | null;
}

/** Eine Mail-Notiz samt Inhalt — nur Kommandos mit `needs.allNotes` bekommen die Liste.
 *  `frontmatter` kommt aus dem Metadata-Cache (nicht aus dem yaml_lite-Parser: der Cache ist
 *  Obsidians eigene Lesart und kennt Formen, die yaml_lite nicht kennt); `zoneHash` ist der
 *  GESPEICHERTE Hash aus dem Plugin-Zustand, null wenn keiner vorliegt. */
export interface MailNoteRef {
  mailId: string;
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  zoneHash: string | null;
  /** Nur gefuellt bei `needs.emlProbe`, und nur wenn am Konventionspfad (`emlPathFor`) eine
   *  Datei liegt. `status` kommt aus dem Message-ID-Kopf der Datei, nicht aus einem vollen
   *  Parse: `match` = gehoert zu dieser Notiz, `mismatch` = andere Message-ID, `unreadable` =
   *  kein Message-ID-Kopf lesbar. */
  eml?: { path: string; status: "match" | "mismatch" | "unreadable" };
  /** Nur gefuellt bei `needs.threads`: Verweise und Vorgangswert der Notiz, von der Obsidian-Schicht zu
   *  Mail-IDs aufgeloest (Wikilinks ueber die Linkaufloesung, E6). `valueId` ist die Mail-ID, auf die der
   *  Vorgangswert zeigt, `null` ohne Wert oder bei einem Link ins Leere. */
  thread?: { inReplyTo: string[]; references: string[]; valueId: string | null };
}

/**
 * Was `appliesTo()` braucht — und nur das. Synchron aus dem Metadata-Cache zu haben.
 * `checkCallback` laeuft bei JEDEM Oeffnen der Kommandopalette fuer JEDES registrierte
 * Kommando und muss synchron antworten; dort die Notiz zu lesen, eine .eml zu parsen und
 * Anhangpfade aufzuloesen waere unverhaeltnismaessig. Der volle Kontext entsteht erst,
 * wenn das Kommando wirklich laeuft (s. src/obsidian/command-flow.ts).
 */
export interface CommandProbe {
  profile: MailProfile;
  target: MailTarget;
  /** Frontmatter der Zielnotiz aus dem Metadata-Cache. */
  frontmatter: Record<string, unknown>;
}

export interface CommandContext extends CommandProbe {
  now: Date;
  /** Roher Inhalt der Zielnotiz. */
  content: string;
  /** Gespeicherter Zone-Hash der Zielnotiz (null = unbekannt, z. B. Altbestand). */
  zoneHash: string | null;
  /** mail_id -> Notizpfad OHNE Endung; null, wenn es die Notiz nicht gibt. */
  linkFor(id: string): string | null;
  /** Zielpfad fuer eine Anlage im Anhangordner des Vaults (Port: getAvailablePathForAttachment).
   *  Weicht auf "<name> 1" aus, wenn am unnummerierten Namen schon etwas liegt. */
  attachmentPathFor(name: string): string;
  /** Die Datei, die am UNNUMMERIERTEN Zielnamen bereits liegt — Pfad und Bytes —, sonst null.
   *  Vorab aufgeloest, weil `plan()` synchron ist. Pflichtfeld statt optional: ein fehlender
   *  Zugriff wuerde sich als "nichts vorhanden" tarnen und die Doppelerkennung lautlos
   *  abschalten. */
  existingAttachment(name: string): { path: string; data: Uint8Array } | null;
  /** Nur gefuellt bei `needs.eml` — geparste und gegen `target.mailId` geprueft (s. eml.ts). */
  mail?: ParsedMail;
  /** Nur gefuellt bei `needs.allNotes`. */
  notes?: readonly MailNoteRef[];
}

export interface MailCommandPlan {
  commandId: string;
  mailId: string;
  /** ENGLISCHER Fallback-Text, aus denselben Argumenten komponiert wie `summaryArgs`. */
  summary: string;
  summaryKey: string;
  summaryArgs: (string | number)[];
  diff: { field: string; before?: string; after?: string }[];
  /** Notiz-Schreibvorgaenge — ausgefuehrt vom vorhandenen PlanExecutor aus M1/M3. */
  notes: NotePlan[];
  /** Dateien, die in den Papierkorb gehen (mail.removeEml). Die Art `trash` gibt es nur im
   *  Kommandoplan, nie in einem NotePlan: ausgefuehrt wird ueber die Dep `trash`, die der
   *  Papierkorb-Einstellung des Vaults folgt. Der Kern entscheidet nur WAS, nie WIE. */
  trash?: { kind: "trash"; path: string; mailId: string }[];
  /** Genau eine Binaerdatei (mail.extractAttachment). */
  attachment?: { path: string; data: Uint8Array };
  /** Extern zu oeffnende URL (mail.replyExternal). */
  openUrl?: string;
  /** Absicht: eine TaskNotes-Aufgabe anlegen (mail.createTask). Analog zu `openUrl` — der
   *  Kern formuliert nur, ausgefuehrt wird in der Obsidian-Schicht, weil src/core/** die
   *  fremde API nicht anfassen darf. Feldnamen nach der Messung aus Task 0. */
  createTask?: { title: string; due: string | null; noteLink: string };
}

export type PlanResult =
  | { ok: true; plan: MailCommandPlan }
  /** `hintKey`: ein genauerer Text (`error.command.*`) fuer denselben Code, etwa „Vorgang ist aus“ zu `nothing-to-do`. */
  | { ok: false; code: CommandErrorCode; hintKey?: `error.command.${string}` };

export interface CommandDescriptor {
  id: string;
  /** ENGLISCHER Fallback + i18n-Key; aufgeloest erst in src/obsidian/command-i18n.ts. */
  title: string;
  titleKey: string;
  description: string;
  descriptionKey: string;
  schema: ObjectSchema;
  /** Kontextabhaengiges Schema — Abweichung von calendar-notes, gebraucht fuer die
   *  Anhangliste als enum. Default ist `schema`; s. schemaOf(). */
  schemaFor?(ctx: CommandContext): ObjectSchema;
  /** Was `plan()` braucht. Die Obsidian-Schicht laedt NUR das — eine .eml zu parsen oder
   *  jede Mail-Notiz zu lesen kostet, und `appliesTo()` laeuft bei JEDEM Oeffnen der
   *  Kommandopalette (checkCallback). `attachments` setzt `eml` voraus und kostet je
   *  nicht-inline Anhang einen Vault-Zugriff; wer es nicht deklariert, bekommt
   *  `attachmentPathFor`/`existingAttachment` als WERFENDE Attrappen statt stiller
   *  Fehlwerte. */
  needs?: { eml?: true; allNotes?: true; attachments?: true; /** Setzt `allNotes` voraus: liest je Notiz nur den Message-ID-Kopf der .eml am Konventionspfad. */ emlProbe?: true; /** Setzt `allNotes` voraus: loest je Notiz Verweise und Vorgangswert zu Mail-IDs auf (`MailNoteRef.thread`). */ threads?: true };
  /** Bekommt bewusst nur den `CommandProbe`, nicht den vollen Kontext — s. dort. */
  appliesTo(probe: CommandProbe): boolean;
  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult;
}

/** Das wirksame Schema eines Deskriptors in DIESEM Kontext. */
export function schemaOf(descriptor: CommandDescriptor, ctx: CommandContext): ObjectSchema {
  return descriptor.schemaFor ? descriptor.schemaFor(ctx) : descriptor.schema;
}

export { EMPTY_SCHEMA };
