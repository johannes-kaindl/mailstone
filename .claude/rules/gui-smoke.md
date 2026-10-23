---
paths:
  - "scripts/gui-smoke.ts"
  - "scripts/e2e-crossplugin.ts"
  - "docs/SMOKE.md"
---

# Was Unit-Tests hier nicht belegen — GUI-Smoke und E2E

Gotchas zu den beiden Treibern. Allgemeines zu Treibern: die Dach-Regel `gui-smoke-treiber.md` (`.claude/rules/` im Elternordner des Repos).

`onload()` ist nicht erreichbar, die Plugin-Instanz sehr wohl (Konstruktor plus gesetzte Felder
genügen — `tests/obsidian/main-cockpit.test.ts`). Außerhalb bleiben genau drei Dinge, und für
sie ist `docs/SMOKE.md` der einzige Beleg: `registerView` und die Ribbon-Umstellung (der
vendorte `Plugin`-Mock verwirft Titel **und** Callback von `addRibbonIcon`), das
`onLayoutReady`-Gate, und alles Sichtbare — ob ein Element Pixel hat, wo ein Knopf sitzt, ob
eine Animation läuft. Dafür gibt es seit M4 den getrackten Treiber `npm run smoke:gui`
(`scripts/gui-smoke.ts`, Prüfpunkte gegen ein **laufendes** Obsidian) — er braucht
den CDP-Lock des Dachs und ein offenes Fenster für den Staging-Vault, das Protokoll steht in
`docs/SMOKE.md`.

**Seit M5 gibt es einen zweiten, getrackten Treiber: `npm run smoke:e2e`**
(`scripts/e2e-crossplugin.ts`). `smoke:gui` prüft mailstones Hälfte der TaskNotes-Kopplung
gegen einen Stub auf `app.plugins.plugins.tasknotes` — TaskNotes selbst kennt mailstone dabei
gar nicht. `smoke:e2e` ist der Naht-Lauf gegen ein **echt installiertes** TaskNotes im
Staging-Vault: er belegt, dass eine Aufgabe wirklich als Datei im Vault ankommt, mit welcher
Feldform, und ob ein Fehlschlag als Wert oder als Ausnahme zurückkommt (Spec § 8.1/§ 9). Er
setzt dieses zweite Plugin voraus und ist deshalb **bewusst nicht Teil von `gate` oder
`smoke:gui`** — eine Pflichtstrecke darf nicht an einem Nachbarplugin scheitern, das nicht
jeder Klon hat. Wer ihn ins Gate zieht, macht das Gate von einer Voraussetzung abhängig, die
dort nicht hingehört.
