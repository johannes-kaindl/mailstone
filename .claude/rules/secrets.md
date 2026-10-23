---
paths:
  - "src/obsidian/modals/account-modal.ts"
  - "src/core/settings.ts"
---

# `SecretComponent` ist ein Verweis, kein Passwortfeld

Gotchas zum Konten-Modal und zum Schlüsselbund.

Obsidians natives Passwort-Feld bindet **nicht** ein Passwort, sondern einen
Schlüsselbund-Eintrag: `onChange` liefert die **ID** des gewählten Eintrags zurück, nie dessen
Wert. `account-modal.ts` speichert deshalb `account.secretId`. Bis diese Falle gefunden war,
schrieb jede Änderung die ID-Zeichenkette als Passwort, und der Server antwortete mit `535` —
unsichtbar, weil die Zeile befüllt aussah.

Zweiter, unabhängiger Obsidian-Bug an derselben Stelle: das native „Geheimnis hinzufügen"-Formular
scheitert **lautlos**, wenn die ID schon existiert (nur ein Hover-Tooltip, keine Notice). Ein
einmal gesetztes Passwort ist über die UI faktisch unveränderbar. Dasselbe Muster trat in
`calendar-notes` auf; es steht als Registry-Eintrag im Dach.

**Ein verwaister Schlüsselbund-Eintrag wird bewusst NICHT aufgeräumt** (entschieden 2026-09-03,
M1-Nachlese): Wer im Konten-Modal ein Geheimnis anlegt und dann *Abbrechen* drückt, hinterlässt
einen Eintrag ohne Konto — `SecretComponent` schreibt am Save/Cancel-Ausgang vorbei direkt in den
Speicher. Ihn beim Abbrechen zu löschen hieße, in einem **globalen** Namensraum zu räumen: die IDs
vergibt der Nutzer, `app.secretStorage` gehört allen Plugins, und dieselbe ID kann bereits an einem
anderen Konto oder Plugin hängen. Ein verwaister Eintrag kostet nichts; ein fälschlich gelöschter
kostet ein Passwort, das über die UI (s. o.) kaum wiederherzustellen ist.
