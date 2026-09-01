# Sidebar-Cockpit — Design

**Stand:** 2026-09-01 · **Status:** entworfen, Implementierungsplan folgt

## Problem

mailstone tut viel und zeigt fast nichts. Sichtbar sind heute genau zwei Dinge: ein
Ribbon-Icon und eine Statusleiste, deren Text der nächste Takt überschreibt. Was ein
Sync-Lauf ergeben hat, existiert nur flüchtig — als Rückgabewert von `runSync()` und als
Zeile am unteren Rand. Nach einem Obsidian-Neustart ist auch die weg.

Gebaut wird deshalb ein **Betriebs-Cockpit** in der rechten Seitenleiste: pro Konto der
letzte Lauf, der nächste Lauf, die Zähler und der Fehler im Klartext, dazu ein Knopf
„Jetzt synchronisieren".

## Abgrenzung

- **Kein Posteingang.** Die ENVELOPE-Liste vom Server ist M4 und braucht zuerst den
  Capability-Fix aus dem M3-Review (`MOVE`/`UIDPLUS` werden von vielen Servern erst
  *nach* der Anmeldung angekündigt).
- **Kein Steuerpult.** Intervall und Kontokonfiguration haben im Settings-Tab bereits
  einen Ort; sie ein zweites Mal anzubieten wäre genau die Doppelung, die die
  Ein-Frontend-Regel vermeiden soll.
- **Kein GUI-Smoke-Treiber.** mailstone hat keinen, die neue View wäre sein erster
  sinnvoller Prüfgegenstand — aber er steht in M4, braucht den CDP-Lock und ist eigene
  Arbeit.

## Herkunfts-Bilanz — was übernommen wird und woher

Ergebnis des Kit-first-Vorher-Checks. **Der Kit-Anteil ist heute null**: das Kit hat
keinen View-Baustein, `hub.ts` ist der einzige einschlägige und kommt erst mit dem
zweiten Tab (siehe *Schale*). Alles Übrige kommt von Nachbar-Plugins.

| Baustein | Herkunft | Was zu tun ist |
|---|---|---|
| Lauf-Register | `calendar-notes/src/core/state/collection-state.ts` — `RunInfo { at, ok, error?, counts }`, `withRun()`, defensives Lesen in `parseState` | übernehmen, `counts` auf `SyncCounts` umstellen |
| Zustandslogik der Anzeige | `calendar-notes/src/obsidian/settings-tab.ts` → `statusDesc()`: *läuft* → *nie gelaufen* → *Fehler* → *Zähler* | Reihenfolge übernehmen, um die §8-Vokabel erweitern |
| Host-Interface | `calendar-notes` (`status(id) => { lastRun, running }`) + `vault-crews/src/obsidian/panel.ts` (`PanelHost`, nur `void`-Methoden) | kombinieren |
| Panel-Aufbau | `vault-crews/src/obsidian/panel.ts` + `panel-view-model.ts` (UI-STANDARD §4-Referenz) | Struktur übernehmen, Inhalt ist crew-spezifisch |
| Zeile mit Aktionsknopf | `wikijs-maintainer/src/obsidian/status-view.ts:97` — `new Setting(row).setName().setDesc().addButton()` | direkt anwendbar, Obsidian-Standard-API |
| Empty-State | `kuro-gamification/src/views/KuroSidebarView.ts:132` (`.kuro-empty`) | §8-Referenz |
| Status-Indikator | `image-to-markdown/src/img_to_md_view.ts` (`setConnState`) | Vokabel übernehmen |
| Startup-Opt-in | `vim-dojo` + `kuro-gamification` (REGISTRY, n=2) | übernehmen |

Jede übernommene Datei bekommt den Herkunftsstempel in Zeile 1
(`// uebernommen aus <repo>/<pfad>, 2026-09-01`), wie die sieben bestehenden Übernahmen
in diesem Repo.

> **Was das Register NICHT ist:** ein dritter Beleg für eine Kit-Extraktion. mailstone
> trägt bereits sieben Übernahmen aus `calendar-notes`; eine achte aus derselben Quelle
> ist ein Glied einer Kopier-Kette, keine unabhängige Instanz. Dazu divergieren die
> `counts` real (`created/updated/skipped/archived/deleted` dort,
> `created/reattached/detached/skipped/detachSkipped` hier) — uniform ist allein die
> Hülle. REGISTRY-Status ist deshalb *Muster-Referenz*, nicht *Kit-Kandidat*.

## Architektur

Vier Bausteine, zwei davon ohne DOM:

| Modul | Art | Aufgabe |
|---|---|---|
| `src/core/sync/run-state.ts` | pur | `RunInfo` je Konto; `recordRun(state, results, at)`, `nextDueAt(account, lastRunMs)` |
| `src/core/view/cockpit-vm.ts` | pur | `buildCockpitViewModel(...)` → fertige Zeilen samt Zustandsvokabel |
| `src/obsidian/views/cockpit-panel.ts` | DOM | Kit-`HubPanel`-Vertrag; rendert das ViewModel, sonst nichts |
| `src/obsidian/views/mailstone-view.ts` | DOM | die eine `ItemView` |

Der Typ weicht an einer Stelle bewusst von der Vorlage ab:

```ts
export interface RunInfo {
  at: number;                 // ms, wie Date.now() — calendar-notes speichert ISO-Strings
  ok: boolean;
  code?: SyncErrorCode;       // NICHT error?: string
  counts: SyncCounts;
}
```

`code` statt Freitext, weil mailstone seine Fehlermeldungen über `error.sync.${code}`
auflöst (`main.ts:434`) und das Cockpit denselben Schlüssel zieht — ein Freitext hier
erzwänge einen zweiten Erklärtext und verstieße gegen §10. `at` als Zahl, weil
`dueAccounts` und `nextDueAt` ohnehin in Millisekunden rechnen; ein ISO-String müsste an
jeder Vergleichsstelle geparst werden.

### Datenfluss

`runSync()` hat die vollständigen `SyncRunResult[]` (`main.ts:429`) → `recordRun` →
`saveSettings` → Änderungs-Callback → Panel rendert neu aus dem ViewModel.

**Bewusst nicht über den Emitter.** `SyncEvents` ist laut Kommentar in `events.ts:36`
auch die Fläche, an der Fremdplugins per `api.on(...)` hängen; `synced` trägt weder
Fehlercode noch Zeitstempel und feuert bei einem komplett gescheiterten Lauf gar nicht.
Der öffentliche Vertrag bleibt unangetastet.

### Host-Interface

Sechs Methoden, lesend oder `void`, kein Rückkanal (UI-STANDARD §4: die View kennt weder
Plugin noch Ports):

```ts
export interface CockpitHost {
  accounts(): readonly Account[];
  runState(): Readonly<Record<string, RunInfo>>;
  nextDueAt(accountId: string): number | null;
  isBusy(): boolean;
  syncNow(accountId?: string): void;
  onChange(cb: () => void): Unsubscribe;
}
```

### Schale

Das Cockpit implementiert von Anfang an den Kit-`HubPanel`-Vertrag
(`mount`/`onShow`/`onHide`/`destroy`), die View mountet es direkt in `contentEl` — **ohne
Tab-Leiste, solange es nur einen Tab gibt**. `buildHubInto` rendert die Leiste
unbedingt (`hub.ts:154`); eine Leiste mit einem Knopf wäre sichtbarer Ballast, sie per
CSS zu verstecken eine stillschweigende Abweichung vom §8-Baustein.

Kommt M4, wird aus dem direkten Mount ein `buildHubInto`-Aufruf mit zwei Panels — etwa
fünf Zeilen in der Schale, kein Umbau des Panels. Es entsteht **genau ein**
`registerView`-Type (§1).

### Panel-Muster

**ViewModel-Re-Render** (§4-Referenz `vault-crews`): bei jedem Änderungs-Callback
`contentEl.empty()` und Neuaufbau aus `buildCockpitViewModel(...)`. Das Cockpit hält
keinen langlebigen internen State — kein Stream, kein Eingabefeld —, das
Auswahlkriterium aus §4 greift also eindeutig, und das ViewModel ist ohne DOM testbar.

## Eingriffe in bestehenden Code

1. `MailstoneSettings` bekommt `runState`. `mergeSettings` füllt fehlende Felder mit
   Defaults, eine Schema-Migration ist nicht nötig — `schemaVersion` bleibt 1.
2. `lastRun` wandert aus der lokalen Variable in `onload()` (`main.ts:293`) in ein
   Plugin-Feld, damit „nächster Lauf" berechenbar wird.
3. Das Ribbon-Icon öffnet künftig die View statt einen Sync auszulösen (`main.ts:265`).
   Der Sync bleibt über die Kommandopalette (`sync-mailbox`) und den Cockpit-Knopf
   erreichbar — also besser erreichbar als vorher, nicht schlechter.
4. Neues Bool-Setting fürs Auto-Öffnen, **Default aus**, Gate in `onLayoutReady`.

**Nicht geändert:** `lastRun` wird *nicht* aus dem persistierten `runState` gespeist. Das
wäre naheliegend, würde aber das Scheduler-Verhalten ändern — ein nach dem Neustart
überfälliges Konto liefe sofort statt sein Intervall abzuwarten. Eigene Entscheidung,
eigener Anlass. Folge fürs Cockpit: „letzter Lauf" zeigt nach dem Neustart den
persistierten Stand, „nächster Lauf" rechnet ab Programmstart.

## Anzeige

Zeilenaufbau nach der vertikalen Grammatik aus §8 (Name/Desc/Status/Aktion): Kontolabel,
letzter Lauf als Uhrzeit, nächster Lauf, verdichtete Zähler, rechts der Sync-Knopf.

- **Zähler verdichtet.** `SyncCounts` hat sechs Felder; angezeigt werden nur die von null
  verschiedenen („3 neu · 1 wieder verknüpft"). Sonst stehen dort fünf Nullen und die
  eine Zahl, auf die es ankommt, geht darin unter.
- **Zeiten absolut, nicht relativ.** „vor 5 Minuten" bräuchte ein Intervall nur fürs
  Nachzählen; `clock.ts` im Kit ist ein `ClockPort`, kein Ticker. Die Statusleiste nutzt
  bereits `toLocaleTimeString()`.
- **Fehlertexte über die bestehenden Schlüssel** `error.sync.no-secret` … `.protocol`
  (`strings.ts:65–75`, beide Sprachen). Kein zweiter Erklärtext (§10).

### Status-Indikator (§8, verbindlich)

Form **und** Farbe **und** Klasse **und** `aria-label`:

| Lage | Klasse | Icon |
|---|---|---|
| Lauf läuft | `is-checking` | `loader` |
| letzter Lauf ok, `errors` = 0 | `is-ok` | `circle-check` |
| letzter Lauf ok, aber `errors` > 0 oder `detachSkipped` > 0 | `is-warning` | `alert-triangle` |
| letzter Lauf gescheitert | `is-error` | `circle-x` |

Die dritte Zeile ist genau der Fall, für den `is-warning` am 2026-08-30 in den Katalog
kam: ein Lauf, der durchlief und trotzdem etwas ausgelassen hat, ist weder ok noch
Fehler. **„Noch nie gelaufen" bekommt bewusst keinen Indikator**, nur Text — für diesen
Fall gibt es keine Vokabel, und einen der vier Zustände zu behaupten wäre falsch.

**Bekannte Grenze:** der `BusyGuard` ist global (`busy.ts` hält ein einzelnes Bool) und
weiß nicht, *welches* Konto läuft. `is-checking` erscheint deshalb in der Kopfzeile, nicht
in der Kontozeile; die Zeilen behalten ihren letzten Stand, die Knöpfe werden deaktiviert.
Konto-genaues „läuft gerade" hieße, `runSync()` ein Start-Signal je Konto beizubringen —
eigener Umfang.

### Empty-State (§8, verbindlich)

Ohne Konten `.mailstone-empty` mit kurzem Text und genau einem `mod-cta`, der die
Einstellungen öffnet.

## Zwei Fallen, die aus der REGISTRY kommen

Beide standen im Katalog und wären sonst gebaut worden.

**1. Die View öffnet mit 0×0 px** (REGISTRY §UI, Z. 221; Muster-Referenz n=2).
`getRightLeaf(false)` + `setViewState()` erzeugt das Blatt, klappt die Seitenleiste aber
nicht auf. Ist sie zu — der Normalzustand eines frisch eingerichteten Vaults — entsteht
die View mit null Pixeln, das Kommando meldet Erfolg, und für den Erstnutzer tut der Klick
sichtbar nichts. Erst ein zweiter Klick nimmt den anderen Zweig. Fix: `revealLeaf(leaf)`
nach dem `setViewState` (Variante `image-to-markdown`) oder `rightSplit.expand()`
(Variante `3d-codeblocks` — ausdrücklich `.expand()`, **nicht** `collapsed = false`).
Kein Unit-Test sieht das: es ist eine Aussage über Sichtbarkeit, nicht über Zustand.

**2. `addAction()` ist in Seitenleisten strukturell unsichtbar** (REGISTRY §UI, Z. 223;
Eintrag vom 2026-09-01). Obsidians `app.css` blendet den View-Kopf in *jeder* Seitenleiste
aus; eine per `addAction` registrierte Kopf-Aktion steht im DOM und ist null Pixel hoch.
Der „Jetzt synchronisieren"-Knopf gehört deshalb in eine **Kopfzeile im View-Inhalt** —
so machen es Obsidians eigene Sidebar-Views, so verlangt es §4 — plus je ein
`addCommand`, das von der Darstellung unabhängig ist. ⚠️ Der naheliegende Prüfpunkt ist
blind: `querySelectorAll(".view-action").length` zählt Existenz und ist grün, während
niemand den Knopf sieht.

## Testen

- **ViewModel** (pur, vitest) trägt die Last: Zustandszuordnung, Zählerverdichtung,
  Empty-State, „nie gelaufen", busy.
- **Panel** gegen den Obsidian-Mock aus `obsidian-kit/testing`: die vier Zustandsklassen
  landen am DOM, `aria-label` ist gesetzt.
- **Mutation als Gegenprobe, für jeden Test.** Code kaputtmachen, Test rot sehen, zurück.
  Tests für Code, den man gerade selbst schreibt, sind sofort grün und belegen sonst
  nichts — dieselbe Regel wie in Abschnitt 2 der M3-Nachlese.
- **Der Beleg-Test muss den Fall herstellen, nicht den Nachbarzweig treffen**
  (LESSONS 2026-09-01, koda-agent). Konkret beim busy-Gate: der Test braucht einen echt
  gesperrten Guard **und** die Gegenprobe, dass derselbe Knopf bei freiem Guard auslöst.
  Ein Test, der nur prüft, dass ein Klick ohne Konto nichts tut, belegt das Gate nicht.

## Offen

- Sichtbarkeit (0×0 px, Knopf-Position) ist per Unit-Test nicht prüfbar. Beide Fallen
  oben wurden anderswo vom GUI-Smoke gefunden. Solange mailstone keinen Treiber hat
  (M4), bleibt das eine Handprobe im Staging-Vault.
