import { addressOf } from "../mime/headers";
import { fmKeyFor } from "../mirror/profile";
import { validateInput } from "./schema";
import { EMPTY_SCHEMA, type CommandContext, type CommandDescriptor, type CommandProbe, type PlanResult } from "./types";

/** Kein zweites "Re:" davorstellen — auch nicht vor ein deutsches "AW:". */
const REPLY_PREFIX_RE = /^(re|aw)\s*:/i;

export function replySubject(subject: string): string {
  const s = subject.trim();
  if (s === "") return "Re:";
  return REPLY_PREFIX_RE.test(s) ? s : `Re: ${s}`;
}

/** RFC 6068. `@` bleibt roh — encodeURIComponent macht sonst %40 daraus, was zwar zulaessig
 *  ist, aber von aelteren Mailclients unterschiedlich behandelt wird. */
export function buildMailtoUrl(input: { to: string; subject: string; inReplyTo: string | null }): string {
  const to = encodeURIComponent(input.to).replace(/%40/g, "@");
  const params = [`subject=${encodeURIComponent(replySubject(input.subject))}`];
  if (input.inReplyTo) params.push(`in-reply-to=${encodeURIComponent(`<${input.inReplyTo}>`)}`);
  return `mailto:${to}?${params.join("&")}`;
}

function recipientOf(probe: CommandProbe): string | null {
  const key = fmKeyFor(probe.profile, "from");
  const raw = key ? probe.frontmatter[key] : undefined;
  return typeof raw === "string" ? addressOf(raw) : null;
}

export const REPLY_EXTERNAL_COMMAND: CommandDescriptor = {
  id: "mail.replyExternal",
  title: "Reply in the external mail client",
  titleKey: "cmd.mail.replyExternal.title",
  description: "Opens your system mail client with recipient, subject and thread reference filled in. Mailstone does not send this reply itself.",
  descriptionKey: "cmd.mail.replyExternal.desc",
  schema: EMPTY_SCHEMA,

  appliesTo(probe: CommandProbe): boolean {
    return recipientOf(probe) !== null;
  },

  plan(input: Record<string, unknown>, ctx: CommandContext): PlanResult {
    if (!validateInput(EMPTY_SCHEMA, input).ok) return { ok: false, code: "invalid-input" };
    const to = recipientOf(ctx);
    if (!to) return { ok: false, code: "no-recipient" };

    const subjectKey = fmKeyFor(ctx.profile, "subject");
    const rawSubject = subjectKey ? ctx.frontmatter[subjectKey] : undefined;
    const subject = typeof rawSubject === "string" ? rawSubject : "";

    // In-Reply-To ist die ID DIESER Mail, nicht der Wert des Feldes `in_reply_to` (das ist
    // der Vorgaenger). Eine Ersatz-ID (Praefix "noid-", Spec § 2.2) ist keine echte
    // Message-ID und wird weggelassen statt erfunden.
    const ownId = ctx.target.mailId;
    const inReplyTo = ownId && !ownId.startsWith("noid-") ? ownId : null;

    const url = buildMailtoUrl({ to, subject, inReplyTo });
    return {
      ok: true,
      plan: {
        commandId: "mail.replyExternal",
        mailId: ctx.target.mailId,
        summary: `Reply to ${to} in the external mail client`,
        summaryKey: "plan.mail.replyExternal.summary",
        summaryArgs: [to],
        diff: [],
        notes: [],
        openUrl: url,
      },
    };
  },
};
