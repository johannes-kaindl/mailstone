/** Version des oeffentlichen Vertrags. Steht von Anfang an (nachtraeglich nicht bruchfrei
 *  einfuehrbar); die Stabilitaetszusage gilt erst ab dem zweiten Konsumenten. */
export const MAILSTONE_API_VERSION = 1;

/** Ein Plugin, dem der Nutzer den Versand unter einer bestimmten Identitaet erlaubt hat.
 *  `transportId` hat die Form "accountId/identityId" (s. `core/send/imip.ts`). */
export interface TrustedSender {
  pluginId: string;
  transportId: string;
}

export type TrustDecision =
  | { kind: "trusted"; transportId: string }
  | { kind: "ask" };

export type ApiStatus =
  | { ready: true }
  | { ready: false; reason: "not-configured" | "unloaded" };

export interface ApiSendRequest {
  /** SELBSTAUSKUNFT des Aufrufers, KEINE Authentifizierung: Obsidian kennt keinen
   *  Aufrufer-Kontext, jedes Plugin kann hier alles eintragen. Die Vertrauensliste ist
   *  deshalb ein Schutz vor Versehen und eine Sichtbarkeitshilfe — kein Sicherheitsmechanismus.
   *  Ein boesartiges Plugin braucht diese API ohnehin nicht (voller node-Zugriff auf Desktop). */
  callerId: string;
  to: string[];
  cc?: string[];
  subject: string;
  /** Klartext. HTML und Anhaenge sind in Version 1 bewusst nicht Teil des Vertrags. */
  body: string;
  inReplyTo?: string;
  /** Absender-ADRESSE (nicht die interne Identity-Id) als Vorschlag. Wirkt NUR beim
   *  Erstkontakt als Vorbelegung im Bestaetigungs-Modal. Ist das Plugin bereits vertraut,
   *  gewinnt die gemerkte Identitaet und dieses Feld wird ignoriert. */
  fromHint?: string;
}

export type ApiSendErrorCode =
  | "not-configured"
  | "not-confirmed"
  | "declined"
  | "busy"
  | "invalid"
  | "send-failed"
  | "unloaded";

export type ApiSendResult =
  | { ok: true; messageId: string; sentCopy: "ok" | "failed" | "skipped" }
  | { ok: false; reason: ApiSendErrorCode };

/** Vertrag, den mailstone anderen Obsidian-Plugins als `plugin.api` anbietet.
 *  Zugriff: `app.plugins.plugins["mailstone"]?.api` — defensiv lesen, das Plugin
 *  kann fehlen oder deaktiviert sein. */
export interface MailstoneApi {
  apiVersion: typeof MAILSTONE_API_VERSION;
  /** Synchron und netzfrei: sagt, ob ein Versand ueberhaupt moeglich waere. Sagt NICHTS
   *  ueber die Erreichbarkeit des Servers — das liesse sich nur mit einem Netzaufruf
   *  beantworten, und `status()` macht keinen. */
  status(): ApiStatus;
  send(req: ApiSendRequest): Promise<ApiSendResult>;
}
