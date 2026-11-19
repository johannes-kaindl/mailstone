---
paths:
  - "src/obsidian/plugin-api.ts"
  - "src/obsidian/send-consent-modal.ts"
  - "src/obsidian/calendar-notes-bridge.ts"
  - "src/core/api/trust.ts"
  - "src/core/api/types.ts"
  - "src/core/api/calendar-notes-transport.ts"
  - "src/core/transform/restore.ts"
---

# Versand-API — eine deklarierte Abweichung vom Anbieter-Muster

Gotchas zu `plugin.api` und zum Zustimmungs-Tor.

`plugin.api` bietet fremden Plugins Mail-Versand an (`src/obsidian/plugin-api.ts`,
`createMailstoneApi`). Ein nicht gelistetes Plugin löst ein Bestätigungs-Modal aus; *„Senden und
immer erlauben"* trägt es in `settings.trustedSenders` ein, danach sendet es still. Spec:
`$VAULT/25_Coding/mailstone/_SDD/2026-09-06-versand-api-design.md`.

**Das Anbieter-Muster der Dach-`REGISTRY.md` sagt in Punkt (6) „kein Zustimmungs-Tor"** — mit der
Begründung, wer die API rufen könne, habe ohnehin vollen Vault-Zugriff. **Diese Begründung setzt
voraus, dass die API nichts anbietet, was der Aufrufer nicht ohnehin hätte.** Bei `vault-rag`
(Retrieval) und `local-image-generator` (lokale Bilderzeugung) trifft das zu. Hier nicht: die API
gibt Zugriff auf ein **authentifiziertes SMTP-Konto**, dessen Zugangsdaten im Schlüsselbund von
mailstone liegen — eine Rechteerweiterung, kein Convenience-Wrapper. Die tragende Achse von (6)
lautet deshalb präzisiert: **ein Tor ist überflüssig, wo die API nur bündelt, was der Aufrufer
schon darf — und nötig, wo sie ihm etwas Neues gibt.**

⚠️ **`callerId` ist eine Selbstauskunft, keine Authentifizierung.** Obsidian kennt keinen
Aufrufer-Kontext; jedes Plugin kann dort alles eintragen. Die Vertrauensliste schützt vor
**Versehen** und schafft **Sichtbarkeit** — sie ist **kein Sicherheits-Perimeter**. Ein
bösartiges Desktop-Plugin hat vollen Node-Zugriff und spricht SMTP selbst; dagegen schützt hier
nichts, und die API soll auch nicht so beschrieben werden. Wer das später „absichert", optimiert
an der falschen Stelle.

**Zwei Namen, die nicht verwechselt werden dürfen:** `folders.allowlist` ist der **Server-Ordner**,
der entscheidet, was Notiz wird — der Kernbegriff der Architektur. Die Plugin-Liste heißt
`trustedSenders`, in Texten „vertraute Plugins". Das Wort „Allowlist" wird dafür nie verwendet.

**Wer die API an einer zweiten Stelle exponiert, trägt sie hier ein** — bislang gilt:
`createMailstoneApi` in `src/obsidian/plugin-api.ts` ist die einzige.

**Der bestehende iMIP-Weg läuft unverändert weiter** (`registerMailTransport` bei
`calendar-notes`) und geht **nicht** durch die Bestätigung — sonst würde eine heute
funktionierende, im Echtbetrieb belegte Funktion plötzlich Modals werfen. Bewacht wird das als
**Unit-Test** in `tests/obsidian/calendar-notes-bridge.test.ts`, nicht im GUI-Smoke:
`CalendarNotesBridge` exponiert nur `tryRegister`/`unregister`/`registered`, ein GUI-Prüfpunkt
hätte gar keinen Zugriff auf den Transport. Der Test sichert zweierlei — der Transport ruft
`sendService.send` direkt, und die Bridge importiert `plugin-api` nicht. ⓘ Die zweite Hälfte
prüft Importzeilen als Text und sieht deshalb **keine dynamischen** Importe; die Grenze steht im
Testkommentar.

**Rückwandlung vor dem Modal (A5, Schritt 5).** `createMailstoneApi` bekommt optional `restore` (Port) und wandelt `to`, `cc`, `subject` und `body` des Schnappschusses zurück, BEVOR das Bestätigungs-Modal oder die Abkürzung für vertraute Plugins etwas sieht; das Modal zeigt damit den Klartext, der wirklich hinausgeht. Reihenfolge im Adapter: Typprüfung (`eingabeForm`) → Rückwandlung → Adressgrammatik (`adressenGueltig`) → Vertrauensentscheidung. Ein Platzhalter-Empfänger `Person_…_Mail` ist vor der Rückwandlung keine Adresse, deshalb darf die Grammatik nicht vor ihr laufen. Der Aufruf von `deps.send` trägt dann `{ restored: true }`, damit der Dienst nicht ein zweites Mal zurückwandelt (ein Klartext, der zufällig wie ein Platzhalter aussieht, würde sonst NACH dem Modal als `hold` scheitern); ohne `restore` ist der Aufruf wie vor A5.

**Neuer Fehlercode `pseudonym-unresolved`** (`ApiSendErrorCode`) mit optionalem `message` im Fehlerfall von `ApiSendResult`: nichts gesendet, kein Modal. Auslöser: `hold` bei irgendeinem Teil (Empfänger, Betreff, Text), ein vergessener Platzhalter (`forgotten`) in `to`/`cc`, eine Adresse, die einen Platzhalter trug und nach der Rückwandlung kein `@` hat. `message` nennt Art und Anzahl (`restoreFailureText`), nie den Klartext oder den Platzhalter. Vergessene Platzhalter in Betreff und Text gehen als Platzhalter hinaus (Spec 8.7), das Modal zeigt dann einen Hinweis (`SendConsentOptions.forgotten`); ein vertrautes Plugin sendet ohne Modal und damit ohne Hinweis (Spec 8.8: „der Satz ‚der Nutzer sieht, was hinausgeht‘ gilt dort nicht“). Der iMIP-Weg (`calendar-notes-bridge.ts`) geht weiter ohne Modal direkt in `sendService.send` und wird dort zurückgewandelt.
