// Die Betreff-Kennung eines Vorgangs (A3/A1, Welle 36): ein vom Nutzer eingestellter regulaerer Ausdruck, dessen
// erster Treffer im Betreff eine Mail einem Vorgang zuordnet, auch wenn die Header (In-Reply-To, References)
// nichts verbinden — etwa `[Ticket#4711]` eines Helpdesks.
//
// Duenner Adapter auf code-kit `user-regex`: Bauen, Risiko-Veto (ReDoS) und Treffersuche liegen dort
// (`compileUserRegex`, `firstMatch`). Hier steht nur, was mailstone entscheidet: woher der Ausdruck kommt, was die
// Kennung ist (Gruppe 1, sonst der ganze Treffer) und wie lang ein Betreff sein darf, bevor gesucht wird.
import { compileUserRegex, firstMatch } from "../../vendor/code-kit/user-regex";
import { fmKeyFor, type MailProfile } from "../mirror/profile";

/** Warum der eingestellte Ausdruck nicht wirkt: `syntax` (kein gueltiger Ausdruck) oder `risky` (das Risiko-Veto des
 *  Kits lehnt ihn ab, er koennte den Betreff exponentiell lange absuchen). Leer ist kein Problem, sondern aus. */
export type TokenPatternProblem = "syntax" | "risky";

/** Alles mit einem Betreff: ein Eintrag, eine Kandidatin, eine Notiz. */
export interface Subjected { subject: string }

/** Laenger sucht die Kennung nicht: ein Betreff hat nach RFC 5322 hoechstens 998 Zeichen, und das Risiko-Veto ist eine
 *  Heuristik (das Kit nennt Muster, die es durchlaesst), also bleibt die Laufzeit auch dann beschraenkt. */
const MAX_SUBJECT = 998;

type Compiled = { re: RegExp | null; problem: TokenPatternProblem | null };

function compileOf(profile: MailProfile): Compiled {
  const source = profile.threadTokenPattern.trim();
  if (source === "") return { re: null, problem: null };
  const r = compileUserRegex(source);
  if (r.ok) return { re: r.re, problem: null };
  // `empty` ist oben ausgeschlossen und `flags` unmoeglich (wir geben keine); beides hiesse „kein gueltiger Ausdruck“.
  return { re: null, problem: r.kind === "risky" ? "risky" : "syntax" };
}

/** Der Ausdruck aus der Einstellung, oder `null`, wenn die Regel nicht wirkt: leer, ungueltig oder vom Veto abgelehnt.
 *  Wirft nie; `tokenPatternProblem` sagt, warum. */
export function tokenRegexOf(profile: MailProfile): RegExp | null {
  return compileOf(profile).re;
}

/** Warum der eingestellte Ausdruck nicht wirkt, oder `null` (auch fuer „leer = aus“). Die Einstellung zeigt den Hinweis. */
export function tokenPatternProblem(profile: MailProfile): TokenPatternProblem | null {
  return compileOf(profile).problem;
}

/** Die Kennung im Betreff: der Inhalt der ersten Gruppe, wenn der Ausdruck eine hat und sie am Treffer beteiligt ist
 *  (`Ticket #(\d+)` gibt `4711`), sonst der ganze erste Treffer. `null` ohne Regel, ohne Treffer oder bei einem leeren
 *  Treffer. Der Ausdruck wird nicht veraendert: ein `g` oder `y` macht das Ergebnis nicht vom vorigen Aufruf abhaengig. */
export function tokenOf(mail: Subjected, re: RegExp | null): string | null {
  if (re === null) return null;
  const subject = mail.subject.slice(0, MAX_SUBJECT);
  const token = firstMatch(subject, re, { nonEmpty: true, group: 1 }) ?? firstMatch(subject, re, { nonEmpty: true });
  return token === null || token === "" ? null : token;
}

/** Der Betreff einer Mail-Notiz aus dem Frontmatter: das Feld `subject`, sonst `title`. */
export function noteSubject(profile: MailProfile, frontmatter: Readonly<Record<string, unknown>>): string {
  for (const name of ["subject", "title"] as const) {
    const key = fmKeyFor(profile, name);
    const v = key === null ? undefined : frontmatter[key];
    if (typeof v === "string" && v !== "") return v;
  }
  return "";
}
