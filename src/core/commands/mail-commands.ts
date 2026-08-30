import { RELINK_COMMAND } from "./relink";
import { RERENDER_COMMAND } from "./rerender";
import type { CommandDescriptor } from "./types";

/** Der eingebaute Kommando-Satz. Reihenfolge = Anzeigereihenfolge. */
export const MAIL_COMMANDS: CommandDescriptor[] = [RERENDER_COMMAND, RELINK_COMMAND];
