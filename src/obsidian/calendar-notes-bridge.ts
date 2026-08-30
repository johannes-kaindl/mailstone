// Bruecke zu calendar-notes: registriert mailstone als MailTransport an dessen oeffentlicher
// API. Nachbar-Plugin kann beim Start in beliebiger Reihenfolge laden oder zur Laufzeit
// entladen werden — jede Lese-Operation greift deshalb frisch auf das Plugin-Register zu,
// nichts wird gecacht (Muster koda-agent/src/obsidian/retrieval.ts).
import type { App } from "obsidian";
import type { Account } from "../core/settings";
import type { SendService } from "../core/send/service";
import { imipToOutgoing, transportAccounts } from "../core/send/imip";
import {
  CALENDAR_NOTES_API_VERSION,
  type CalendarNotesApiSubset,
  type ImipMessage,
  type MailTransport,
} from "../core/api/calendar-notes-transport";

const PLUGIN_ID = "calendar-notes";
const TRANSPORT_ID = "mailstone";

/** `app.plugins` ist nicht Teil der offiziellen Obsidian-Typen — lokal nachgebildet, nur so
 *  weit wie hier gebraucht. */
interface AppWithPlugins {
  plugins?: { plugins?: Record<string, { api?: unknown } | undefined> };
}

function isCalendarNotesApi(v: unknown): v is CalendarNotesApiSubset {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.version === CALENDAR_NOTES_API_VERSION &&
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
 * `tryRegister()` ist idempotent (mehrfacher Aufruf registriert nicht doppelt). `unregister()`
 * spricht bewusst nicht die aktuell im Plugin-Register stehende API an, sondern `lastApi` — die
 * Instanz, die die Registrierung seinerzeit angenommen hat; ohne gemerkte Instanz (nie
 * registriert, oder bereits als unregistriert erkannt) ist es ein No-op statt einer Ausnahme.
 *
 * Der Nachbar ist fremder Code an einer nicht-oeffentlichen Grenze (app.plugins.plugins) — zwei
 * Haertungen dagegen: (1) `registerMailTransport` kann ablehnen ({ error: ... }) oder werfen;
 * beides darf nicht aus onload() propagieren, also try/catch UND Form-Pruefung des Ergebnisses
 * statt Erfolg blind anzunehmen. (2) Ein Plugin-Reload des Nachbarn ersetzt dessen `api`-Objekt
 * durch eine neue Instanz, ohne dass mailstone das mitbekommt — `lastApi` haelt die Identitaet
 * fest, gegen die zuletzt registriert wurde; weicht ein frischer Read davon ab, gilt das als
 * unregistriert (die alte Registrierung lebt nur noch im entladenen Nachbarn, nicht mehr hier).
 * Dieselbe gemerkte Identitaet ist es auch, mit der `unregister()` spricht statt frisch zu
 * lesen: ein frischer Read koennte nach einem Reload des Nachbarn eine andere, fremde Instanz
 * liefern, und der Aufruf mit unserer eigenen ID liefe dort ins Leere — harmlos, aber beim
 * Lesen irrefuehrend, weil es aussieht, als spraeche mailstone noch mit der Instanz, bei der es
 * registriert war.
 */
export function createCalendarNotesBridge(app: App, transport: MailTransport): CalendarNotesBridge {
  let registered = false;
  let lastApi: CalendarNotesApiSubset | null = null;

  function isStillRegistered(): boolean {
    if (!registered) return false;
    if (readCalendarNotesApi(app) !== lastApi) {
      registered = false;
      lastApi = null;
      return false;
    }
    return true;
  }

  return {
    tryRegister() {
      if (isStillRegistered()) return true;
      const api = readCalendarNotesApi(app);
      if (!api) return false;
      try {
        const result = api.registerMailTransport(transport);
        if (typeof result === "object" && result !== null && (result as { ok?: unknown }).ok === true) {
          registered = true;
          lastApi = api;
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    unregister() {
      if (!registered) return;
      // lastApi statt frischem Read — s. Doc-Kommentar oben.
      const api = lastApi;
      registered = false;
      lastApi = null;
      if (!api) return;
      api.unregisterMailTransport(transport.id);
    },
    get registered() {
      return isStillRegistered();
    },
  };
}
