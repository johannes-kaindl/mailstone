# Anforderungen an `mailstone` aus Sicht von `calendar-notes`

**Datum:** 2026-08-22 · **Von:** calendar-notes-Design-Session · **Status:** Vorab-Vertrag, noch nicht implementiert auf beiden Seiten
**Kontext:** `calendar-notes` (CalDAV/CardDAV → Notizen, Server = SSOT, Schreiben nur über Kommandos) verschickt **keine Mail**. Einladungen (iTIP) verschickt entweder der DAV-Server (RFC 6638) oder — wenn er das nicht kann — ein registrierter Mail-Transport. `mailstone` ist der vorgesehene Transport.

## 1. Kopplungsrichtung: mailstone registriert sich bei calendar-notes, nicht umgekehrt

calendar-notes kennt keine Plugin-ID von mailstone. Stattdessen ruft mailstone beim Laden (defensiv, nur wenn calendar-notes geladen ist — Registry-Muster „fremde Plugin-API konsumieren, bei jedem Aufruf frisch lesen"):

```ts
const cn = app.plugins.plugins["calendar-notes"]?.api;   // { version: 1, ... } | undefined
if (cn?.version === 1) cn.registerMailTransport(transport);
// und beim Entladen: cn?.unregisterMailTransport(transport.id)
```

Beide Plugins sind Store-Software: jede Seite läuft vollständig ohne die andere.

## 2. Der Transport-Vertrag (v1)

```ts
interface MailTransport {
  id: string;                         // "mailstone"
  label: string;                      // für die Auswahl, falls mehrere Transporte registriert sind
  accounts(): Promise<{ id: string; address: string; label: string }[]>;  // NUR sendefähige Identitäten (mail@ / kontakt@) — keine Catch-All-Kennungen
  send(msg: ImipMessage): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }>;
}

interface ImipMessage {                // RFC 6047 iMIP
  method: "REQUEST" | "CANCEL" | "REPLY";
  from: string;                        // Account-ID aus accounts()
  to: string[];                        // Teilnehmer-Adressen
  subject: string;                     // von calendar-notes gebaut ("Einladung: <Titel>, <Datum>")
  text: string;                        // Klartext-Teil (Titel, Zeit, Ort, Beschreibung)
  ics: string;                         // vollständiges VCALENDAR mit METHOD:<method>
}
```

Was mailstone daraus bauen muss: eine `multipart/alternative`-Mail mit `text/plain` **und** `text/calendar; method=<METHOD>; charset=utf-8` (+ optional als Anhang `invite.ics`). Das `text/calendar`-Teil mit `method=` ist das, was Apple/Google/Thunderbird als Einladung erkennen; ohne diesen Parameter ist es nur ein Anhang.

## 3. Was calendar-notes NICHT von mailstone erwartet
- kein Lesen von Posteingängen für Kalenderzwecke (eingehende iTIP-REPLYs verarbeitet der DAV-Server; calendar-notes sieht die PARTSTAT-Änderung beim nächsten Sync)
- keine Kontaktverwaltung (Absender → Kontakt-Notiz auflösen kann mailstone selbst über `cn.contacts({query})` — Lesen ist Material, keine Zuständigkeitsverletzung)
- keine Bestätigungs-UI: calendar-notes zeigt vor `send()` selbst, was verschickt wird

## 4. Was mailstone umgekehrt von calendar-notes bekommt (Lese-API v1)
`cn.contacts({ query })`, `cn.get(uid)`, `cn.events({from,to})` — damit mailstone z. B. eine Mail einer Person zuordnen oder eine eingehende `.ics` gegen bestehende Termine prüfen kann. Schreiben geht nur über `cn.plan(commandId, input)` → `cn.execute(plan)` (zwei Schritte, Bestätigung beim Aufrufer).

## 5. Für den Zuschnitt von mailstone relevante Befunde (aus der calendar-notes-Recherche)
- IMAP/SMTP sind kein HTTP: `requestUrl` hilft nicht, es braucht `node:net`/`node:tls` → **desktop-only**, `Platform.isDesktop`-guarded `await import("node:tls")` ist die einzige Source-Form, die beide Store-Scan-Regeln besteht (REGISTRY § Node-Builtin desktop-only).
- Zugangsdaten: `app.secretStorage` (Obsidian ≥ 1.11.4, OS-verschlüsselt, nicht vault-synct) statt `data.json` — calendar-notes macht das so, mailstone sollte gleichziehen, dann ist die Settings-UX identisch (`SecretComponent`).
- Der Store misst Bauarten: Netzwerk + Credentials kosten nichts, `child_process` kostet immer die Bestnote — ein `msmtp`/`sendmail`-Aufruf wäre der falsche Weg.
- Die Mail-Plattform ist mailbox.org (Spec in `/Users/Shared/40_Tools/mailbox-org/docs/superpowers/specs/`), Identitäten `mail@` (privat) und `kontakt@` (öffentlich) — `accounts()` sollte beide liefern können.

## Nachtrag 2026-08-23 — Pflichten aus dem mailbox.org-Betrieb

Quelle: `2026-08-23-anforderungen-aus-mailbox-org-betrieb.md` (§ 6 Identitäten/Catch-All, § 7 Versandweg),
übermittelt von der mailbox-org-Session; in `calendar-notes/docs/API.md` (§ Mail-Transport) gespiegelt.

1. **`accounts()` = sendefähige Identitäten, sonst nichts.** Das Postfach fährt einen aktiven
   Catch-All; calendar-notes zeigt die Liste unverändert als Absenderauswahl und routet die
   Einladung nur dann über den Transport, wenn sie mindestens einen Eintrag hat. Eine Kennung, von
   der nicht gesendet werden kann, erzeugt dort einen stillen Fehlversand.
2. **`send()` geht über den authentifizierten SMTP des Anbieters.** DMARC ist seit 2026-08-23
   `p=quarantine`, Ziel `p=reject` (frühestens 2026-09-05): unsignierter Versand landet im Spam
   oder wird abgewiesen. `{ ok: false, error }` bei SMTP-Fehlern — calendar-notes bietet dann den
   `.ics`-Fallback an, statt die Einladung für zugestellt zu halten.
3. **Offen bleibt C9 (Scheduling-Outbox auf dav.mailbox.org).** Hat der Server eine
   `schedule-outbox-URL`, versendet er selbst und calendar-notes wählt die Route „scheduling" vor
   dem Transport — der Vertrag bleibt dann für Server ohne Outbox (Radicale, manche Nextcloud-
   Setups) relevant, wird aber für mailbox.org nicht genutzt. Antwort kommt aus Teilprojekt ④.
