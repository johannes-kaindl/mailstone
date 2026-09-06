import type { TrustedSender, TrustDecision } from "./types";

/** Entscheidet, ob ein Aufrufer ohne Rueckfrage senden darf. Pur — die Obsidian-Schicht
 *  fuehrt aus, was hier entschieden wird.
 *
 *  Eine leere `callerId` ist nie vertraut: ein Eintrag mit leerer `pluginId` (Hand-Edit an
 *  `data.json`) wuerde sonst jedem Anrufer ohne Selbstauskunft Vertrauen schenken. */
export function decideTrust(trusted: readonly TrustedSender[], callerId: string): TrustDecision {
  if (!callerId) return { kind: "ask" };
  const treffer = trusted.find((t) => t.pluginId === callerId);
  return treffer ? { kind: "trusted", transportId: treffer.transportId } : { kind: "ask" };
}

/** Nimmt eine Erlaubnis auf und ERSETZT eine bestehende desselben Plugins. Anhaengen waere
 *  falsch: es entstuenden mehrere Eintraege je Plugin, und ein Widerruf in der UI entfernte
 *  nur einen — die Erlaubnis bliebe bestehen, obwohl der Nutzer sie zurueckgenommen hat.
 *  Gibt eine neue Liste zurueck; die Eingabe bleibt unveraendert. */
export function rememberSender(
  liste: readonly TrustedSender[],
  eintrag: TrustedSender,
): TrustedSender[] {
  return [...liste.filter((t) => t.pluginId !== eintrag.pluginId), eintrag];
}
