import { buildFilename } from "../../vendor/code-kit/filename-template";
import type { ParsedMail } from "../mime/types";
import type { MailProfile } from "../mirror/profile";
import { slugify } from "../../vendor/code-kit/slug";
import { localDate, localTime } from "../../vendor/code-kit/local-stamp";

export function subjectSlug(subject: string, max = 60): string {
  let s = subject.trim();
  for (;;) {
    const n = s.replace(/^(re|aw|fwd?|wg|sv|vs)\s*:\s*/i, "");
    if (n === s) break;
    s = n;
  }
  return slugify(s, { maxLength: max });
}

function vars(mail: ParsedMail): Record<string, string> {
  const parts = mail.date ? { date: localDate(mail.date), time: localTime(mail.date) } : null;
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
