import { decideTrust } from "../core/api/trust";
import { MAILSTONE_API_VERSION, type ApiSendRequest, type ApiSendResult, type ApiStatus,
         type MailstoneApi, type TrustedSender } from "../core/api/types";
import { splitTransportId, transportAccounts } from "../core/send/imip";
import type { Account } from "../core/settings";
import type { OutgoingMessage } from "../core/send/outgoing";
import type { SentCopyResult } from "../core/send/service";
import type { ConsentOutcome, SendConsentOptions } from "./send-consent-modal";

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
      if (!Array.isArray(req.to) || req.to.length === 0 || typeof req.subject !== "string"
          || typeof req.body !== "string") {
        return { ok: false, reason: "invalid" };
      }

      const entscheidung = decideTrust(deps.trusted(), req.callerId);
      let transportId: string;

      if (entscheidung.kind === "trusted") {
        transportId = entscheidung.transportId;
      } else {
        // Eine Anfrage zur Zeit: gestapelte Bestaetigungen klickt man weg, ohne noch zu
        // wissen, worum es ging — eine ehrliche Absage ist besser.
        if (modalOffen) return { ok: false, reason: "busy" };
        const moeglich = transportAccounts(deps.accounts());
        const vorbelegt = moeglich.find((i) => i.address === req.fromHint) ?? moeglich[0];
        if (!vorbelegt) return { ok: false, reason: "not-configured" };
        modalOffen = true;
        let ausgang: ConsentOutcome;
        try {
          ausgang = await deps.consent({
            callerLabel: deps.callerLabel(req.callerId),
            identities: moeglich.map((i) => ({ id: i.id, label: i.label })),
            preselectId: vorbelegt.id,
            req,
          });
        } finally {
          modalOffen = false;
        }
        if (ausgang.kind === "declined") return { ok: false, reason: "declined" };
        if (ausgang.kind === "timeout") return { ok: false, reason: "not-confirmed" };
        transportId = ausgang.transportId;
        if (ausgang.remember) deps.remember({ pluginId: req.callerId, transportId });
      }

      const geteilt = splitTransportId(transportId);
      if (!geteilt) return { ok: false, reason: "invalid" };

      // ⚠️ OutgoingMessage.from traegt die identityId, NICHT die Adresse (resolveSender).
      const msg: OutgoingMessage = {
        from: geteilt.identityId,
        to: req.to,
        ...(req.cc ? { cc: req.cc } : {}),
        subject: req.subject,
        text: req.body,
        ...(req.inReplyTo ? { inReplyTo: req.inReplyTo } : {}),
      };

      const ergebnis = await deps.send(geteilt.accountId, msg);
      if (!ergebnis.ok) return { ok: false, reason: "send-failed" };
      return { ok: true, messageId: ergebnis.messageId, sentCopy: ergebnis.sentCopy };
    },
  };
}
