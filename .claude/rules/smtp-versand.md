---
paths:
  - "src/core/send/**"
  - "src/core/smtp/**"
  - "src/core/transform/restore.ts"
---

# Versand und Sent-Kopie

Gotchas zum SMTP-Versand.

`send()` legt die Nachricht nach erfolgreichem Versand per `APPEND` im Ordner aus `folders.sent`
ab. Scheitert das, bleibt `ok: true` — die Mail **ist** zugestellt, und sie als gescheitert zu
melden würde zu einem zweiten Sendeversuch verleiten. Der Ausgang steht getrennt als
`sentCopy: "ok" | "failed" | "skipped"` im Ergebnis.

Beim `APPEND` gehen die Bytes **erst nach der Continuation** (`+`) raus. Lehnt der Server vorher
ab (fehlender Ordner, volles Postfach), bleiben sie ungeschrieben — sonst lägen sie herrenlos auf
einer Leitung, die schon auf das nächste Kommando wartet.

**Rückwandlung (A5, Schritt 5).** `createSendService` bekommt optional `restore` (Port, im Plugin `restoreFor` aus dem Kit): `send()` wandelt Empfänger (`to`, `cc`, `bcc`), Betreff, Text und HTML zurück, NACH `resolveSender` und VOR `validateOutgoing` und dem Bauen der Nachricht. Scheitert das (`hold`, vergessener Platzhalter in einem Adressfeld, Adresse ohne `@` nach der Rückwandlung), ist das Ergebnis `{ ok: false, code: "pseudonym-unresolved", detail }` ohne Verbindung. Nicht zurückgewandelt werden `calendar.ics` und `attachments` (Grenze, steht in der README), aber angehalten: trägt der ICS-Text, ein Anhangname oder ein Textanhang einen Platzhalter (`unrestorablePlaceholders`, `findPlaceholders` aus dem Kit), ist das Ergebnis `{ ok: false, code: "pseudonym-unresolved", detail: "unrestorable-part", count }` ohne Verbindung (P13; gilt auch mit `{ restored: true }`, nur wenn ein `restore`-Port gebunden ist). Die Sent-Kopie speichert die Bytes, die hinausgingen, also den zurückgewandelten Text; das ist beabsichtigt (ein Postfach ist kein Vault), nicht ändern. Bei „Aus“ und Text ohne Platzhalter ist der Versand byte-gleich zu vor A5 (Test `tests/core/send/service-restore.test.ts`, Integrationstest mit Fake-SMTP unverändert).
