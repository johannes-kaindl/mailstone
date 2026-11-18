// Prueft die Einstellungen der Feldnamen des Vorgangs (A3, E7): `threadField` (Link auf die Wurzel) und `followField`
// (Markierung „diesem Vorgang nicht mehr folgen“, A1). Ein Name darf in `data.json` stehen, wie er ist (die
// Einstellung zeigt den Hinweis); wirksam ist er nur, wenn er taugt — sonst ist die Regel aus. Ein verwalteter
// Schluessel als Feld liesse einen Befehl `mail_id` ueberschreiben, deshalb gilt er nie.
import { managedKeys, type MailProfile } from "../mirror/profile";

export type ThreadFieldProblem = "managed" | "unreadable" | "collision";
export type FollowFieldProblem = ThreadFieldProblem;

// Die Schluesselform, die der zeilenweise Frontmatter-Schreiber (vendor/kit/frontmatter-patch) erkennt:
// ein Name mit Nicht-ASCII-Zeichen wuerde bei jedem Lauf eine weitere Zeile anhaengen.
const READABLE_KEY = /^[A-Za-z0-9_](?:[\w .-]*[\w.-])?$/;

/** Warum `name` als Feldname nicht taugt, oder `null` (auch fuer „leer = aus“). `other` ist das jeweils andere
 *  Feld des Vorgangs: derselbe Name waere eine Kollision, beide Regeln sind dann aus, bis einer geaendert ist. */
function problemOf(profile: MailProfile, name: string, other: string): ThreadFieldProblem | null {
  const key = name.trim();
  if (key === "") return null;
  if (managedKeys(profile).includes(key)) return "managed";
  if (!READABLE_KEY.test(key)) return "unreadable";
  return other.trim() === key ? "collision" : null;
}

/** Warum der eingestellte Name des Vorgangsfeldes nicht taugt, oder `null`. */
export function threadFieldProblem(profile: MailProfile, name: string = profile.threadField): ThreadFieldProblem | null {
  return problemOf(profile, name, profile.followField);
}

/** Der Feldname, der WIRKLICH gilt: `""` (aus), wenn er leer ist oder nicht taugt. */
export function effectiveThreadField(profile: MailProfile): string {
  return threadFieldProblem(profile) === null ? profile.threadField.trim() : "";
}

/** Warum der eingestellte Name der Folgen-Markierung nicht taugt, oder `null`. */
export function followFieldProblem(profile: MailProfile, name: string = profile.followField): FollowFieldProblem | null {
  return problemOf(profile, name, profile.threadField);
}

/** Der Name der Folgen-Markierung, der WIRKLICH gilt: `""` (aus), wenn er leer ist oder nicht taugt. */
export function effectiveFollowField(profile: MailProfile): string {
  return followFieldProblem(profile) === null ? profile.followField.trim() : "";
}

/** Steht an dieser Notiz die Markierung „nicht mehr folgen“? `false` als Wahrheitswert und der Text `false` (in jeder
 *  Schreibweise) heissen beendet (E2): der Cache liest ein YAML-`false` als Wahrheitswert, ein von Hand gequotetes als Text. */
export function followStopped(profile: MailProfile, frontmatter: Readonly<Record<string, unknown>>): boolean {
  const key = effectiveFollowField(profile);
  if (key === "") return false;
  const v = frontmatter[key];
  return v === false || (typeof v === "string" && v.trim().toLowerCase() === "false");
}
