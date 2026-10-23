# Entscheidungen in mailstone — das Warum

Verdichtete Design-Essenz zu den Regeln im Kern (`AGENTS.md`). Die Herleitungen (Specs und Pläne) liegen im Coding-Cockpit des Maintainers unter `_SDD/` (CORE-META-14, maintainer-lokal). Vor dem Übernehmen einer Altentscheidung gilt: Grund aufsuchen, messen, ob er heute trägt, Ergebnis melden.

## GitHub als Verteilweg

GitHub ist seit 2026-09-24 wieder der Verteilweg, `origin` auf Forgejo bleibt die Quelle. Vom 2026-09-06 bis 2026-09-24 war GitHub aufgegeben (Remote entfernt, `--no-github` fest im Script, Eintrag in `mirror_drift_check.AUSNAHMEN`); der Mirror trug damals ohnehin nicht (gemessen 2026-09-01: 42 min nach dem Push stand GitHub unverändert). Heute gilt der Dach-Standard (`../.claude/rules/release-und-store.md`): GitHub bekommt Branch und Tag nur über den Dual-Push von `release.mjs`. Das `github`-Remote steht und `npm run release` fährt ohne `--no-github`. Daneben bleibt der AnySource-Katalog ein Weg (mailstone ist dort gelistet).

## Ein verwaister Schlüsselbund-Eintrag wird bewusst nicht aufgeräumt (2026-09-03, M1-Nachlese)

Wer im Konten-Modal ein Geheimnis anlegt und dann abbricht, hinterlässt einen Eintrag ohne Konto. Ihn zu löschen hieße, in einem globalen Namensraum zu räumen (`app.secretStorage` gehört allen Plugins, die IDs vergibt der Nutzer); ein verwaister Eintrag kostet nichts, ein fälschlich gelöschter ein Passwort. Wortlaut und Folgen: `.claude/rules/secrets.md`.

## `hasCapability` und `model.validateTask` bleiben bei TaskNotes ungenutzt (2026-09-05)

Gemessen gegen TaskNotes 4.12.5 (die Version im Staging-Vault, am 2026-10-23 unverändert): `hasCapability("tasks.create")` liefert `false`, obwohl `api.tasks.create` funktioniert, und `validateTask` lehnt jede Erstellungs-Eingabe ab. Gelten die Messungen bei einer neueren TaskNotes-Version noch, ist erst nach einer neuen Messung zu entscheiden. Wortlaut: `.claude/rules/tasknotes.md`.

## `smoke:e2e` ist bewusst nicht Teil des Gates

Der Naht-Lauf gegen ein echt installiertes TaskNotes setzt ein Nachbarplugin voraus, das nicht jeder Klon hat; eine Pflichtstrecke darf nicht daran scheitern. Wortlaut: `.claude/rules/gui-smoke.md`.

## Ausnahmen von Dach-Regeln

Zwei Abweichungen von der Dach-`REGISTRY.md` sind bewusst und mit Begründung in den Pfadregeln festgehalten: der Aufruf von `api.tasks.create` am Fremdplugin TaskNotes (`.claude/rules/tasknotes.md`, entschieden von Johannes 2026-09-05) und das Zustimmungs-Tor der Versand-API (`.claude/rules/versand-api.md`).
