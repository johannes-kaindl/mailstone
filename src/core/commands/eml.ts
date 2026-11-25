import type { ParsedMail } from "../mime/types";
import type { MailProfile } from "../mirror/profile";
import type { CommandErrorCode } from "./types";
import { vaultDirname } from "../../vendor/kit/vault-path";
import { baseName } from "../../vendor/code-kit/rel-path";

/**
 * Konventionspfad der .eml zu einer Mail-Notiz: der `_eml`-Unterordner NEBEN der Notiz
 * (Spec § 2.2). Bewusst relativ zum tatsaechlichen Ort der Notiz statt ueber
 * `profile.folder` — so stimmt er auch bei `yearSubfolder: false` und bei einer
 * Ordnerumbenennung, solange Notiz und .eml zusammen umgezogen sind.
 */
export function emlPathFor(profile: MailProfile, notePath: string): string {
  const dir = vaultDirname(notePath);
  const base = baseName(notePath).replace(/\.md$/, "");
  const folder = dir ? `${dir}/${profile.emlSubfolder}` : profile.emlSubfolder;
  return `${folder}/${base}.eml`;
}

/**
 * Die gefundene Datei muss zur Notiz gehoeren. Ohne diese Probe wuerde eine falsch
 * benannte .eml die Notiz mit dem Inhalt einer fremden Mail ueberschreiben — der einzige
 * Schreibvorgang im Plugin, der eine bestehende Notiz ueberhaupt ersetzen darf.
 */
export function verifyEml(mail: ParsedMail, expectedId: string): { ok: true } | { ok: false; code: CommandErrorCode } {
  return mail.id === expectedId ? { ok: true } : { ok: false, code: "eml-mismatch" };
}
