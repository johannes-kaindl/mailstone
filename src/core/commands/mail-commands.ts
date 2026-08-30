import { EXTRACT_ATTACHMENT_COMMAND } from "./extract";
import { RELINK_COMMAND } from "./relink";
import { REPLY_EXTERNAL_COMMAND } from "./reply";
import { RERENDER_COMMAND } from "./rerender";
import type { CommandDescriptor } from "./types";

/** Der eingebaute Kommando-Satz. Reihenfolge = Anzeigereihenfolge. */
export const MAIL_COMMANDS: CommandDescriptor[] = [
  RERENDER_COMMAND,
  RELINK_COMMAND,
  EXTRACT_ATTACHMENT_COMMAND,
  REPLY_EXTERNAL_COMMAND,
];
