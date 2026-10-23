---
paths:
  - "src/core/send/**"
  - "src/core/smtp/**"
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
