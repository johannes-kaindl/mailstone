// Bruecke zu calendar-notes: registriert mailstone als MailTransport an dessen oeffentlicher
// API. Nachbar-Plugin kann beim Start in beliebiger Reihenfolge laden oder zur Laufzeit
// entladen werden — jede Lese-Operation greift deshalb frisch auf das Plugin-Register zu,
// nichts wird gecacht (Muster koda-agent/src/obsidian/retrieval.ts).
import type { App } from "obsidian";
import type { Account } from "../core/settings";
import type { SendService } from "../core/send/service";
import { imipToOutgoing, transportAccounts } from "../core/send/imip";
import type { CalendarNotesApiSubset, ImipMessage, MailTransport } from "../core/api/calendar-notes-transport";

const PLUGIN_ID = "calendar-notes";
const TRANSPORT_ID = "mailstone";
const SUPPORTED_API_VERSION = 1;

/** `app.plugins` ist nicht Teil der offiziellen Obsidian-Typen — lokal nachgebildet, nur so
 *  weit wie hier gebraucht. */
interface AppWithPlugins {
  plugins?: { plugins?: Record<string, { api?: unknown } | undefined> };
}

function isCalendarNotesApi(v: unknown): v is CalendarNotesApiSubset {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.version === SUPPORTED_API_VERSION &&
    typeof o.registerMailTransport === "function" &&
    typeof o.unregisterMailTransport === "function"
  );
}

/**
 * Liest calendar-notes' oeffentliche API defensiv aus dem Plugin-Register.
 * Bewusst bei jedem Aufruf frisch statt einmal gecacht: das Nachbar-Plugin kann zur Laufzeit
 * (de)aktiviert werden. Form wird geprueft, nicht nur Vorhandensein — ein halb initialisiertes
 * oder fremdes Objekt unter demselben Schluessel darf nicht durchrutschen.
 */
export function readCalendarNotesApi(app: App): CalendarNotesApiSubset | null {
  const api = (app as unknown as AppWithPlugins).plugins?.plugins?.[PLUGIN_ID]?.api;
  return isCalendarNotesApi(api) ? api : null;
}

export interface MailTransportDeps {
  accounts: () => Account[];
  sendService: SendService;
  label: string;
}

export function buildMailTransport(deps: MailTransportDeps): MailTransport {
  return {
    id: TRANSPORT_ID,
    label: deps.label,
    async accounts() {
      return transportAccounts(deps.accounts());
    },
    async send(msg: ImipMessage) {
      const mapped = imipToOutgoing(msg);
      if ("error" in mapped) return { ok: false, error: mapped.error };
      const result = await deps.sendService.send(mapped.accountId, mapped.outgoing);
      if (result.ok) return { ok: true, messageId: result.messageId };
      return { ok: false, error: result.code };
    },
  };
}

export interface CalendarNotesBridge {
  tryRegister(): boolean;
  unregister(): void;
  readonly registered: boolean;
}

/**
 * `tryRegister()` ist idempotent (mehrfacher Aufruf registriert nicht doppelt), `unregister()`
 * liest die API erneut frisch — der Nachbar kann inzwischen entladen worden sein, dann ist es
 * ein No-op statt einer Ausnahme.
 */
export function createCalendarNotesBridge(app: App, transport: MailTransport): CalendarNotesBridge {
  let registered = false;

  return {
    tryRegister() {
      if (registered) return true;
      const api = readCalendarNotesApi(app);
      if (!api) return false;
      api.registerMailTransport(transport);
      registered = true;
      return true;
    },
    unregister() {
      if (!registered) return;
      const api = readCalendarNotesApi(app);
      registered = false;
      if (!api) return;
      api.unregisterMailTransport(transport.id);
    },
    get registered() {
      return registered;
    },
  };
}
