---
paths:
  - "src/core/mime/**"
  - "src/core/commands/extract.ts"
---

# Anhänge

Gotchas zur Adressierung und zum Extrahieren von Anhängen.

Der MIME-Speicher darf nicht mit `contentId ?? name` keyen: zwei nicht-inline Anhänge gleichen
Namens teilen sich sonst einen Eintrag, und die extrahierte Datei trägt den Namen des einen und
den Inhalt des anderen — ohne Fehlermeldung. Der Defekt lag seit M1 im Parser und wurde erst
sichtbar, als M3b sein erster Konsument wurde. Fixture dafür: `Import/dup-attachments.eml` im Staging-Vault, getrackt `tests/fixtures/eml/duplicate-attachment-names.eml` (zwei `rechnung.pdf` mit unterscheidbarem Inhalt) — ein Ein-Anhang-Fixture kann diesen Fall
strukturell nie zeigen.

**Dieselbe Achse entscheidet, ob ein zweiter Extrakt eine zweite Datei anlegt** (seit
2026-09-05): liegt am unnummerierten Zielnamen bereits eine **byte-gleiche** Datei, wird sie
verlinkt statt kopiert, und der Plan trägt gar keinen Schreibvorgang mehr. Verglichen werden
die **Bytes**, nicht der Basename — ein Basename-Vergleich hätte genau die zwei gleichnamigen,
aber verschiedenen Anhänge oben zusammengeworfen und den zweiten unerreichbar gemacht. Die
Bytes der vorhandenen Datei löst `buildContext` vorab auf; ein Kommando bekommt sie nur mit
`needs: { attachments: true }`, sonst **wirft** der Zugriff (ein stiller Fehlwert wäre hier
nicht unterscheidbar von „nichts vorhanden").
