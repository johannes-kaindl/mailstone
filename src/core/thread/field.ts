// Prueft die Einstellung des Vorgangs (A3, E7): den Feldnamen. Er darf in `data.json` stehen, wie er ist
// (die Einstellung zeigt den Hinweis); wirksam ist er nur, wenn er taugt — sonst ist die Regel aus. Ein verwalteter Schluessel als Vorgangsfeld liesse `mail.recomputeThreads`
// `mail_id` ueberschreiben, deshalb gilt er nie.
import { managedKeys, type MailProfile } from "../mirror/profile";

export type ThreadFieldProblem = "managed" | "unreadable";

// Die Schluesselform, die der zeilenweise Frontmatter-Schreiber (vendor/kit/frontmatter-patch) erkennt:
// ein Name mit Nicht-ASCII-Zeichen wuerde bei jedem Lauf eine weitere Zeile anhaengen.
const READABLE_KEY = /^[A-Za-z0-9_](?:[\w .-]*[\w.-])?$/;

/** Warum der eingestellte Feldname nicht taugt, oder `null` (auch fuer „leer = aus“). */
export function threadFieldProblem(profile: MailProfile, name: string = profile.threadField): ThreadFieldProblem | null {
  const key = name.trim();
  if (key === "") return null;
  if (managedKeys(profile).includes(key)) return "managed";
  return READABLE_KEY.test(key) ? null : "unreadable";
}

/** Der Feldname, der WIRKLICH gilt: `""` (aus), wenn er leer ist oder nicht taugt. */
export function effectiveThreadField(profile: MailProfile): string {
  return threadFieldProblem(profile) === null ? profile.threadField.trim() : "";
}
