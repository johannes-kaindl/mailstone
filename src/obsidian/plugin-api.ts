import { decideTrust } from "../core/api/trust";
import { MAILSTONE_API_VERSION, type ApiSendRequest, type ApiSendResult, type ApiStatus,
         type MailstoneApi, type TrustedSender } from "../core/api/types";
import { splitTransportId, transportAccounts } from "../core/send/imip";
import type { Account } from "../core/settings";
import { isAddress, type OutgoingMessage } from "../core/send/outgoing";
import type { SentCopyResult } from "../core/send/service";
import type { ConsentOutcome, SendConsentOptions } from "./send-consent-modal";

/** Frist des Bestaetigungs-Modals (Spec § 7: 60 s). Steht hier und NUR hier — `SendConsentOptions.timeoutMs`
 *  ist bewusst ein Pflichtfeld ohne Default, damit die Zahl nicht an zwei Orten lebt. */
export const CONSENT_TIMEOUT_MS = 60_000;

export interface MailstoneApiDeps {
  unloaded: () => boolean;
  accounts: () => Account[];
  trusted: () => TrustedSender[];
  remember: (eintrag: TrustedSender) => void;
  /** Anzeigename des Aufrufers; loest ueber app.plugins.manifests auf. */
  callerLabel: (callerId: string) => string;
  consent: (opts: SendConsentOptions) => Promise<ConsentOutcome>;
  send: (accountId: string, msg: OutgoingMessage) =>
    Promise<{ ok: true; messageId: string; sentCopy: SentCopyResult } | { ok: false; code: string }>;
}

/** `app.plugins` ist nicht Teil der offiziellen Obsidian-Typen — lokal nachgebildet, nur so
 *  weit wie hier gebraucht. Faellt auf die rohe Id zurueck: eine `callerId`, zu der kein
 *  Plugin installiert ist, soll im Modal sichtbar bleiben statt zu verschwinden. */
interface AppWithManifests {
  plugins?: { manifests?: Record<string, { name?: string } | undefined> };
}

export function pluginName(app: unknown, id: string): string {
  const a = app as AppWithManifests;
  const n = a?.plugins?.manifests?.[id]?.name;
  return typeof n === "string" && n ? n : id;
}

function adressen(werte: unknown): boolean {
  return Array.isArray(werte) && werte.every((a) => typeof a === "string" && isAddress(a));
}

/** Torwaechter VOR dem Modal. Zwei Dinge, die er ueber eine Typpruefung hinaus tut:
 *
 *  - **Adressgrammatik** (`isAddress`, pur aus `core/send/outgoing.ts` — dieselbe Regel, die
 *    `validateOutgoing` spaeter anwendet). Ohne sie oeffnet eine kaputte Adresse wie
 *    "max.mustermann" das Modal, der Nutzer bestaetigt, und erst `validateOutgoing` faellt
 *    durch → `send-failed`. Der Vertrag (`types.ts`) nennt „kaputte Adresse" aber
 *    ausdruecklich als `invalid`, und ein Modal fuer eine unsendbare Eingabe ist Klickweg
 *    ohne Ertrag.
 *  - **`callerId`**: das einzige Feld, das PERSISTIERT wird (`remember` → `data.json`). Ein
 *    leerer oder Nicht-String-Wert landete dort dauerhaft. */
function eingabeGueltig(req: ApiSendRequest): boolean {
  if (typeof req.callerId !== "string" || !req.callerId) return false;
  if (!adressen(req.to) || req.to.length === 0) return false;
  if (req.cc !== undefined && !adressen(req.cc)) return false;
  if (typeof req.subject !== "string" || typeof req.body !== "string") return false;
  if (req.inReplyTo !== undefined && typeof req.inReplyTo !== "string") return false;
  return true;
}

/** Duenner Adapter statt der internen Fassade (Anbieter-Muster, Punkt 1): die Fassade traegt
 *  Faehigkeiten, die bewusst NICHT zum externen Vertrag gehoeren.
 *
 *  ⚠️ Abweichung von Punkt 6 des Musters ("kein Zustimmungs-Tor"), bewusst und deklariert:
 *  dessen Begruendung setzt voraus, dass die API nichts anbietet, was der Aufrufer nicht
 *  ohnehin haette. Hier ist es eine Rechteerweiterung (authentifiziertes SMTP-Konto), also
 *  greift sie nicht. Details in AGENTS.md § Versand-API. */
export function createMailstoneApi(deps: MailstoneApiDeps): MailstoneApi {
  let modalOffen = false;

  const status = (): ApiStatus => {
    if (deps.unloaded()) return { ready: false, reason: "unloaded" };
    if (transportAccounts(deps.accounts()).length === 0) return { ready: false, reason: "not-configured" };
    return { ready: true };
  };

  return {
    apiVersion: MAILSTONE_API_VERSION,
    status,
    async send(req: ApiSendRequest): Promise<ApiSendResult> {
      const st = status();
      if (!st.ready) return { ok: false, reason: st.reason };
      if (!eingabeGueltig(req)) return { ok: false, reason: "invalid" };

      // SCHNAPPSCHUSS beim Eintritt, mit kopierten Arrays. Der Aufrufer haelt dieselbe
      // Referenz und darf sie waehrend der bis zu 60 s im Modal veraendern — ohne Kopie
      // zeigte das Modal einen Empfaenger und heraus gingen zwei. Das trifft die tragende
      // Begruendung von Spec § 5.2 (v1 ist auf Klartext beschraenkt, DAMIT das Modal
      // vollstaendig zeigen kann, was rausgeht): eine lebende Referenz hebt die Zusage
      // strukturell auf. Kein boeser Wille noetig — ein Konsument, der sein Request-Objekt
      // ueber einen Retry hinweg wiederverwendet, genuegt.
      const anfrage: ApiSendRequest = {
        callerId: req.callerId,
        to: [...req.to],
        ...(req.cc ? { cc: [...req.cc] } : {}),
        subject: req.subject,
        body: req.body,
        ...(req.inReplyTo !== undefined ? { inReplyTo: req.inReplyTo } : {}),
        ...(req.fromHint !== undefined ? { fromHint: req.fromHint } : {}),
      };
      // `freeze` richtet sich nicht gegen den Aufrufer (der hat die Kopie nie gesehen),
      // sondern gegen den eigenen Code: der Schnappschuss ist ab hier Beweisstueck.
      Object.freeze(anfrage.to);
      if (anfrage.cc) Object.freeze(anfrage.cc);
      Object.freeze(anfrage);

      const entscheidung = decideTrust(deps.trusted(), anfrage.callerId);
      const moeglich = transportAccounts(deps.accounts());
      let transportId: string;

      // Die Abkuerzung gilt nur, solange die freigegebene Identitaet noch existiert — eine
      // Freigabe galt DIESER Identitaet, nicht dem Plugin an sich. Loescht der Nutzer sie,
      // zeigte `decideTrust` weiter auf eine tote transportId; `resolveSender` scheitert und
      // der Aufruf endet DAUERHAFT in `send-failed` — laut Vertrag „SMTP hat abgelehnt",
      // obwohl nie ein Socket im Spiel war, und das Modal kaeme nie wieder. Zurueck auf
      // `ask` ist auch inhaltlich die richtige Antwort: der Nutzer muss neu waehlen.
      if (entscheidung.kind === "trusted"
          && moeglich.some((i) => i.id === entscheidung.transportId)) {
        transportId = entscheidung.transportId;
      } else {
        // Eine Anfrage zur Zeit: gestapelte Bestaetigungen klickt man weg, ohne noch zu
        // wissen, worum es ging — eine ehrliche Absage ist besser.
        if (modalOffen) return { ok: false, reason: "busy" };
        const vorbelegt = moeglich.find((i) => i.address === anfrage.fromHint) ?? moeglich[0];
        // Unter heutiger Logik nicht erreichbar: `status()` oben hat bereits sichergestellt,
        // dass `transportAccounts` nicht leer ist, und `moeglich` stammt aus demselben Lauf.
        // Bleibt als Absicherung stehen, falls die Reihenfolge der Torwaechter je umgestellt
        // wird — ein `moeglich[0]` auf leerer Liste waere sonst `undefined` unter
        // `noUncheckedIndexedAccess`-freier Nutzung.
        if (!vorbelegt) return { ok: false, reason: "not-configured" };
        modalOffen = true;
        let ausgang: ConsentOutcome;
        try {
          ausgang = await deps.consent({
            callerLabel: deps.callerLabel(anfrage.callerId),
            identities: moeglich.map((i) => ({ id: i.id, label: i.label })),
            preselectId: vorbelegt.id,
            req: anfrage,
            timeoutMs: CONSENT_TIMEOUT_MS,
          });
        } catch {
          // "Fehler sind Werte, nie Ausnahmen" (Anbieter-Muster, s. tasknotes-bridge.ts).
          // Ein werfendes consent ist inhaltlich KEIN "declined" — der Nutzer hat nichts
          // abgelehnt, das Modal ist kaputtgegangen. "not-confirmed" bildet das ehrlich ab:
          // es gab keine erfolgreiche Bestaetigung, exakt dieselbe Lage wie beim Timeout.
          return { ok: false, reason: "not-confirmed" };
        } finally {
          modalOffen = false;
        }
        // ZWEITE Zustandspruefung, vor der Auswertung des Ausgangs. Zwischen Eintritt und
        // hier liegen bis zu 60 s, in denen der Nutzer mailstone deaktivieren oder sein
        // letztes Konto loeschen kann. Spec § 4: „ein deaktiviertes mailstone darf keine Mail
        // verschicken." Die zweite Haelfte ist schwerer als die erste: `remember` ruft
        // `saveSettings()` auf der TOTEN Instanz und schreibt deren gesamten Snapshot nach
        // `data.json` — settings, zoneHashes, uidCache UND runState. Das waere Datenverlust
        // an Zustand, der mit dieser API nichts zu tun hat. Vor der Ausgangs-Auswertung, weil
        // beides hier abzubrechen ist, egal wie der Nutzer geklickt hat.
        const danach = status();
        if (!danach.ready) return { ok: false, reason: danach.reason };

        if (ausgang.kind === "declined") return { ok: false, reason: "declined" };
        if (ausgang.kind === "timeout") return { ok: false, reason: "not-confirmed" };
        transportId = ausgang.transportId;
        if (ausgang.remember) deps.remember({ pluginId: anfrage.callerId, transportId });
      }

      const geteilt = splitTransportId(transportId);
      if (!geteilt) return { ok: false, reason: "invalid" };

      // ⚠️ OutgoingMessage.from traegt die identityId, NICHT die Adresse (resolveSender).
      // Frische Kopien der Arrays statt der eingefrorenen: nachgelagerte Schichten duerfen
      // an ihrer OutgoingMessage arbeiten, ohne am Beweisstueck zu haengen.
      const msg: OutgoingMessage = {
        from: geteilt.identityId,
        to: [...anfrage.to],
        ...(anfrage.cc ? { cc: [...anfrage.cc] } : {}),
        subject: anfrage.subject,
        text: anfrage.body,
        ...(anfrage.inReplyTo ? { inReplyTo: anfrage.inReplyTo } : {}),
      };

      let ergebnis: Awaited<ReturnType<MailstoneApiDeps["send"]>>;
      try {
        ergebnis = await deps.send(geteilt.accountId, msg);
      } catch {
        // Wie oben: "Fehler sind Werte, nie Ausnahmen". Ein werfendes deps.send heisst,
        // der Versand kam nicht zustande — derselbe Ausgang wie ein regulaeres { ok: false }.
        return { ok: false, reason: "send-failed" };
      }
      if (!ergebnis.ok) return { ok: false, reason: "send-failed" };
      return { ok: true, messageId: ergebnis.messageId, sentCopy: ergebnis.sentCopy };
    },
  };
}
