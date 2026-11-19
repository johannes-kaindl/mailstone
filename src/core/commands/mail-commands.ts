import { ALIGN_THREAD_FIELDS_COMMAND } from "./align-thread-fields";
import { CREATE_TASK_COMMAND } from "./create-task";
import { EXTRACT_ATTACHMENT_COMMAND } from "./extract";
import { RESUME_FOLLOWING_COMMAND, STOP_FOLLOWING_COMMAND } from "./follow-commands";
import { RECOMPUTE_THREADS_COMMAND } from "./recompute-threads";
import { RELINK_COMMAND } from "./relink";
import { REMOVE_EML_COMMAND } from "./remove-eml";
import { REPLY_EXTERNAL_COMMAND } from "./reply";
import { RERENDER_COMMAND } from "./rerender";
import type { CommandDescriptor } from "./types";

/** Der eingebaute Kommando-Satz. Reihenfolge = Anzeigereihenfolge. */
export const MAIL_COMMANDS: CommandDescriptor[] = [
  RERENDER_COMMAND,
  RELINK_COMMAND,
  RECOMPUTE_THREADS_COMMAND,
  ALIGN_THREAD_FIELDS_COMMAND,
  STOP_FOLLOWING_COMMAND,
  RESUME_FOLLOWING_COMMAND,
  EXTRACT_ATTACHMENT_COMMAND,
  REPLY_EXTERNAL_COMMAND,
  CREATE_TASK_COMMAND,
  REMOVE_EML_COMMAND,
];
