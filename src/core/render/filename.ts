import { buildFilename } from "../../vendor/code-kit/filename-template";
import type { ParsedMail } from "../mime/types";
import type { MailProfile } from "../mirror/profile";
import { localDateParts } from "./frontmatter";

const TRANSLIT: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "ae", Ö: "oe", Ü: "ue" };

export function subjectSlug(subject: string, max = 60): string {
  let s = subject.trim();
  for (;;) {
    const n = s.replace(/^(re|aw|fwd?|wg|sv|vs)\s*:\s*/i, "");
    if (n === s) break;
    s = n;
  }
  s = s
    .replace(/[äöüßÄÖÜ]/g, (c) => TRANSLIT[c] ?? c)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length > max) s = s.slice(0, max).replace(/-+$/, "");
  return s;
}

function vars(mail: ParsedMail): Record<string, string> {
  const parts = mail.date ? localDateParts(mail.date) : null;
  return {
    date: parts ? parts.date : "undated",
    time: parts ? parts.time.replace(":", "") : "",
    slug: subjectSlug(mail.subject) || "mail",
    year: parts ? parts.date.slice(0, 4) : "",
  };
}

export function mailFilename(p: MailProfile, mail: ParsedMail): string {
  const v = vars(mail);
  const tpl = v.time ? p.filename : p.filename.replace(/\{time\}[-_ ]?/g, "");
  return buildFilename(tpl, v, { fallbacks: ["{date}-mail"], lastResort: "mail" });
}

export function mailFolder(p: MailProfile, mail: ParsedMail): string {
  const y = vars(mail).year;
  return p.yearSubfolder && y ? `${p.folder}/${y}` : p.folder;
}

export function emlFolder(p: MailProfile, mail: ParsedMail): string {
  return `${mailFolder(p, mail)}/${p.emlSubfolder}`;
}
