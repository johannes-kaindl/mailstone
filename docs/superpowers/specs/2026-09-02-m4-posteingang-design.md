# M4 — Posteingang: Design

> **Verhältnis zur Haupt-Spec:** Ergänzung zu `2026-08-23-mailstone-design.md` § 3.2 und § 4.1.
> Deren Festlegungen gelten weiter, **außer** wo § 7 dieser Datei ausdrücklich abweicht.
> Entschieden am 2026-09-02 (Johannes: drei Vorlagefragen, alle mit der Empfehlung beantwortet).

M4 war ursprünglich „View + Server-Kommandos + GUI-Smoke". Zwei Drittel sind bereits gebaut:
`mail.replyExternal` kam in M3b mit (Haupt-Spec § 3.2, Vermerk vom 2026-08-31), der getrackte
GUI-Smoke-Treiber am 2026-09-02 (`57f3eec`, 12/12, Gegenprobe sauber). Diese Datei beschreibt
den Rest: **den Posteingang und die Server-Aktionen darunter.**

---

## 1. Zuschnitt

| Drin (M4) | Draußen — bleibt V1.1 |
|---|---|
| Inbox-Tab in der bestehenden `MailstoneView` | Vorschau-Panel (Body-Render in der Sidebar) |
| Liste aus `folders.inbox`, die letzten 100 UIDs | „mehr laden" über 100 UIDs hinaus |
| Zeile: Absender · Betreff · Datum · Badge „liegt im Vault" | Anhang-Marker (braucht `BODYSTRUCTURE`) |
| Aktionen je Zeile: Übernehmen, Archivieren | Pfeil-/Enter-Navigation, Fokusmodell |
| IMAP: Capabilities nach Auth, Typ-Trennung, Header-Fetch, `uidMove` | `mail.archive` auf einer **Notiz** |
| Kontowahl, sobald mehr als ein Konto aktiv ist | IMAP `SEARCH`, `IDLE` |

**Warum keine Vorschau in V1.** Der Zweck der Liste ist die Entscheidung „gehört das in den
Vault?", und die fällt an Absender, Betreff und Datum. Wer den Text braucht, übernimmt — dann
ist es eine Notiz, und der Vault ist der bessere Leseort als eine schmale Sidebar. Die Vorschau
kostet einen zweiten Render-Pfad mit eigenem Lade- und Fehlerzustand; sie ist nachrüstbar, ohne
dass etwas aus M4 dafür umgebaut werden müsste.

---

## 2. Der Nur-Lese-Vertrag wird **typisiert** geöffnet

`AGENTS.md` führt „ein Sync-Lauf darf `\Seen` nie setzen" als Zusage gegenüber dem Postfach des
Nutzers. `mail.adopt`/`mail.archive` brauchen `SELECT` und `UID MOVE` — der Vertrag geht also
auf. Er geht **an einer benannten Stelle** auf, und die Trennung trägt der Compiler:

```ts
imapConnect(transport, opts)          → ImapReadSession    // wie heute
imapConnectWritable(transport, opts)  → ImapWriteSession   // Lese-Fläche + select + uidMove
```

`ImapWriteSession` erweitert `ImapReadSession`; ein Verbindungsautomat, zwei Fabriken darüber.
`SyncService` nimmt weiterhin `ImapReadSession` entgegen — `select` steht ihm nicht zur
Verfügung, ein versehentliches `SELECT` im Sync-Pfad ist kein Review-Befund mehr, sondern ein
Typfehler.

Die Alternative war eine gemeinsame Session mit Konvention plus Test. Verworfen, weil `AGENTS.md`
für genau diese Stelle bereits notiert, dass Aufmerksamkeit hier zu dünn trägt („ein `SELECT`
genügt allein schon, um Flags schreibbar zu machen").

**Was der Vertrag nach der Öffnung besagt** — Fassung für `AGENTS.md`:

> Lesende Pfade (Sync, Inbox-Liste, Body-Abruf) nutzen `EXAMINE` und `BODY.PEEK` und bekommen
> eine `ImapReadSession`. Schreibend ist genau ein Pfad: die beiden Posteingangs-Aktionen, über
> `imapConnectWritable` und eine eigene kurze Verbindung. Auch dieser Pfad setzt **kein**
> `\Seen`: `UID MOVE` verschiebt die Nachricht mitsamt ihren Flags.

---

## 3. IMAP-Erweiterungen (`src/core/imap/`)

### a) Capabilities auch **nach** der Anmeldung lesen

Heute liest `imapConnect` die `CAPABILITY` nur vor `AUTHENTICATE` (`client.ts:239–241`). Viele
Server kündigen `MOVE` und `UIDPLUS` erst danach an — typisch als `[CAPABILITY …]` im
Response-Code der `OK`-Zeile der Anmeldung. Wer auf die vorhandene Liste baut, baut auf eine,
die systematisch zu kurz ist; die Folge wäre ein „Server kann kein MOVE" auf einem Server, der
es kann.

Nach erfolgreicher Anmeldung werden deshalb **beide** Quellen vereinigt: `capabilitiesFrom(auth.untagged)`
und der `[CAPABILITY …]`-Response-Code der Tagged-OK-Zeile. Für M3 war das folgenlos (der Sync
fragt keine Capability ab) — es ist trotzdem der erste Schritt, weil alles Weitere darauf steht.

### b) Typ-Trennung — siehe § 2.

### c) Listen-Fetch **ohne** `ENVELOPE`

```
UID FETCH <set> (FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])
```

Die Header-Bytes gehen durch `parseEml`. **Gemessen am 2026-09-02:** `parseEml` verarbeitet
einen Header-Block ohne Body vollständig — RFC-2047-dekodierter Betreff, zerlegte Absenderadresse,
Datum als ISO-Zeitstempel, und `id` bereits durch dieselbe Normalisierung wie der Sync-Pfad.
Es braucht also **keinen neuen Parser**.

Das ist die Fortschreibung der M3-Entscheidung aus Haupt-Spec § 3.1, wo `ENVELOPE` schon einmal
verworfen wurde: es verlangt einen Parser für verschachtelte Adresslisten, und es liefert die
Message-ID in der *Interpretation des Servers*, während `normalizeMessageId` denselben Rohstring
normalisiert, aus dem die `mail.id` der Notiz entsteht. Für den Badge „liegt im Vault" ist das
der Unterschied zwischen exaktem Abgleich und Heuristik: er vergleicht dieselbe Normalisierung
auf beiden Seiten.

Haupt-Spec § 4.1 nennt `UID FETCH ENVELOPE FLAGS`. Diese Zeile ist damit überholt (§ 7).

### d) `uidMove` — ohne `EXPUNGE`-Zweig

`UID MOVE <uid> <ziel>`, wenn `MOVE` in den (nach a) vollständigen Capabilities steht. Sonst
bricht die Aktion mit einem eigenen Code ab; die Knöpfe sind dann nicht anklickbar und tragen
den Grund als Tooltip.

**Kein `COPY` + `STORE \Deleted` + `EXPUNGE`-Fallback**, abweichend von Haupt-Spec § 3.2. Ein
UID-loses `EXPUNGE` entfernt *alle* als gelöscht markierten Nachrichten des Ordners — auch
solche, die ein anderer Client markiert hat und die mailstone nie angefasst hat. Der sichere
Zweig (`UID EXPUNGE`) setzt `UIDPLUS` voraus; ein Server ohne `MOVE` **und** ohne `UIDPLUS` ist
bei Dovecot-Gegenstellen wie mailbox.org nicht zu erwarten. Fällt je einer auf, wird der
Fallback nachgerüstet — dann mit einem echten Server zum Messen statt gegen einen Fake, an dem
sich ein Löschverhalten nicht überzeugend absichern lässt.

Fehlerfälle als Werte: `unsupported` (Server kann kein sicheres Verschieben), `gone` (Quell-UID
existiert nicht mehr — die Mail wurde anderswo verschoben, Hinweis „erneut synchronisieren"),
dazu die bestehenden Verbindungs-Codes.

---

## 4. Server-Aktionen stehen **neben** dem Deskriptor-Rahmen

Haupt-Spec § 3.2 führt `mail.adopt`/`mail.archive` in derselben Tabelle wie `rerender`,
`relink`, `extractAttachment`. Gemessen passen sie dort nicht hinein:

- `MailTarget` ist immer **eine Notiz** (`path`, `mailId`, `source`, `state`). Eine Mail in der
  Liste hat keine Notiz — sie ist UID plus Ordner plus Konto.
- `MailCommandPlan` trägt `notes: NotePlan[]`, also Vault-Schreibvorgänge. Für eine Server-Aktion
  gibt es dort keinen Kanal.
- Der Rahmen existiert für Schema-Formular, `PlanPreviewModal` und Merge-Risiko. `mail.adopt`
  hat davon nichts: keine Eingabe, kein Diff, kein Vault-Schreiben — die Notiz entsteht
  anschließend durch den Sync.

**Entscheidung:** ein eigener Dienst `src/core/inbox/actions.ts`, pur, mit injizierter
Session-Fabrik. Er teilt sich mit dem Sync **nur** den Busy-Guard (`tryAcquire`/`release`) und
läuft wie in Haupt-Spec § 3.2 vorgesehen über eine kurze eigene Verbindung: connect → select →
move → logout. Nach Erfolg wird ein Sync angestoßen, der die Notiz erzeugt.

```ts
adoptMessage(ctx: InboxActionContext): Promise<InboxActionResult>   // inbox → allowlist
archiveMessage(ctx: InboxActionContext): Promise<InboxActionResult> // inbox → archive
```

Verworfen wurde, `MailCommandPlan` um eine Server-Achse und `MailTarget` um eine Ziel-Union zu
erweitern. Das verbreitert einen bewährten Rahmen für alle fünf bestehenden Kommandos, von denen
keines je einen Server anfasst — eine Abstraktion aus einer einzigen Instanz, wovor die
Dach-Regeln ausdrücklich warnen („aus einem einzigen Beispiel extrahiert man fast immer die
falsche Abstraktion").

**Preis, benannt:** Die beiden Aktionen sind Knöpfe in der Liste, nicht Einträge der
Kommandopalette. `mail.archive` auf einer Mail-**Notiz** entfällt in M4 ganz (§ 1). Wer eine
Notiz hat, hat die Mail bereits im Allowlist-Ordner; sie von dort ins Archiv zu bewegen ist eine
andere Handlung als „aus dem Posteingang wegräumen" und wartet auf einen belegten Bedarf.

---

## 5. UI

**Der Hub-Tab.** `src/obsidian/views/mailstone-view.ts:21–23` hält die Andockstelle bereits fest:
aus dem direkten Mount wird `buildHubInto(this.contentEl, [cockpit, inbox], "cockpit")`. Es
bleibt bei **einem** `registerView`-Typ (UI-STANDARD § 1), der Posteingang ist ein zweiter Tab.

Zwei Dinge fehlen dafür heute und kommen über `npm run kit:sync` (Vendor-Stand 0.28.0):
`obsidian-kit/src/obsidian/hub.ts` und das Hub-CSS in `styles.css` — die Darstellung ist laut
Kit-Vertrag eine Kopie beim Consumer. `CockpitPanel` erfüllt den `HubPanel`-Vertrag bereits
vollständig (`id`, `icon`, `label` als Getter, `mount`, `onShow`, `destroy` — nachgesehen, nicht
dem Kommentar geglaubt), es ist dort kein Umbau nötig.

**Die Aufteilung folgt dem Cockpit**, das als Vorbild taugt und dessen Muster geprüft ist:

- `src/core/view/inbox-vm.ts` — rein und testbar: Zeilen aus Header-Daten bauen, Badge gegen den
  Message-ID-Index abgleichen, die Zustände `leer` / `lädt` / `Fehler` / `gefüllt` bestimmen,
  entscheiden welche Aktionen eine Zeile anbietet (Capabilities, Busy-Guard).
- `src/obsidian/views/inbox-panel.ts` — zeichnet nur, kein Urteil. Schmaler Host-Vertrag wie
  `CockpitHost`: lesend oder `void`, kein Rückkanal.

**Die Kontowahl** ist ein Auswahlfeld im Kopf des Tabs, das erst erscheint, wenn mehr als ein
Konto mit `sync.enabled` existiert; bei genau einem gibt es keine Wahl und damit kein Feld. Die
Wahl lebt im Panel-Zustand, nicht in `data.json` — sie ist eine Blickrichtung, keine Einstellung.

**§ 8-Bausteine werden übernommen, nicht erfunden:** Empty-State (verbindlich), Status-Indikator
mit der Zustands-Vokabel `is-checking`/`is-ok`/`is-error`/`is-warning`, Listen-Zeile. Für das
Confirm-Modal vor dem Verschieben gilt `obsidian-kit/obsidian/confirm.ts`, bereits vendort.
Typografie explizit setzen (`--font-ui-small`/`--font-ui-smaller` an Metazeilen) — der
`ui_adoption_check` sieht sie nicht, und genau daran ist am 2026-09-02 ein Nachbar-Repo
aufgefallen.

---

## 6. Prüfung

**Unit.** `inbox-vm` (Zeilenaufbau, Badge-Abgleich, Zustände, Aktions-Verfügbarkeit),
`core/inbox/actions` (Erfolg, `unsupported`, `gone`, Busy, Verbindungsfehler; die Session-Fabrik
ist injiziert, es braucht kein Netz).

**Client gegen `FakeSocketTransport`**, neue Dialog-Fixtures unter `tests/fixtures/imap/`:
Capability erst in der Auth-`OK`-Zeile · `UID MOVE` erfolgreich · `UID MOVE` mit `NO` · Quell-UID
verschwunden · Server ohne `MOVE`. Dazu der Header-Fetch mit Literalen und RFC-2047-Betreff.

**Integration.** `scripts/fake-imap.mjs` bekommt `SELECT` und `UID MOVE` — ohne das ist der
GUI-Smoke für die neuen Punkte blind.

**GUI-Smoke.** Zwei bis drei Prüfpunkte dazu (Inbox-Tab erscheint und ist klickbar, Liste rendert
gegen den Fake, Empty-State bei leerem Ordner). ⚠️ **Baseline vor dem Umbau festhalten:** der
Treiber ist beim Hub-Umbau selbst der Prüfling, und ein grüner Lauf danach ist ohne
festgehaltenen Lauf davor nicht von „anders grün" zu unterscheiden.

**Was strukturell grün sein kann und trotzdem falsch:** dass die Liste *rendert*, sagt nicht,
dass sie die richtigen Mails zeigt. Der Badge-Abgleich bekommt deshalb einen Unit-Test mit zwei
Mails, deren Message-IDs sich nur in der Normalisierung unterscheiden.

---

## 7. Abweichungen von der Haupt-Spec — vollständig

| Haupt-Spec | Neu | Grund |
|---|---|---|
| § 4.1 „`UID FETCH ENVELOPE FLAGS`" | `FLAGS` + `BODY.PEEK[HEADER.FIELDS …]` durch `parseEml` | kein Adresslisten-Parser, **eine** Message-ID-Normalisierung (§ 3c) |
| § 4.1 Vorschau-Panel, Anhang-Marker, „mehr laden", Tastaturbedienung in V1 | V1.1 | Zuschnitt (§ 1) |
| § 3.2 `mail.adopt`/`mail.archive` als Deskriptor-Kommandos | eigener Dienst `core/inbox/actions.ts` | der Rahmen ist notiz-zentriert (§ 4) |
| § 3.2 MOVE-Fallback `COPY` + `STORE \Deleted` + `EXPUNGE` | entfällt, `unsupported` stattdessen | UID-loses `EXPUNGE` löscht Fremdes (§ 3d) |
| § 3.2 `mail.archive` auch auf `kind: "note"` | nur auf Mails der Liste | kein belegter Bedarf (§ 4) |

---

## 8. Bekannte Grenzen

- **Die Liste ist eine Momentaufnahme.** Sie wird beim Öffnen des Tabs, per Knopf und nach
  `synced`/`changed` geholt — nicht per `IDLE`. Wer im Mailprogramm parallel aufräumt, sieht das
  erst nach dem Aktualisieren; eine Aktion auf einer verschwundenen Mail endet in `gone` statt in
  einem stillen Fehlgriff.
- **Kein Löschen**, auch hier nicht. mailstone verschiebt, es entfernt nie.
- **Ein Konto ohne `folders.inbox`** zeigt den Empty-State mit Verweis in die Einstellungen, nicht
  einen Fehler.
- **`\Seen` bleibt unberührt**, auch beim Verschieben: `UID MOVE` nimmt die Flags mit.
- **Eine Nebenwirkung hat `SELECT` doch, und sie sei benannt:** es setzt den `\Recent`-Status der
  Nachrichten im geöffneten Ordner für andere Sitzungen zurück. Das trifft nur den kurzen
  Aktions-Pfad (§ 4), nie den Sync, und `\Recent` wird von keinem der beteiligten Wege
  ausgewertet — der Beleg-Abholer aus Haupt-Spec § 5 steuert über *ungelesen*, also `\Seen`.
  Der Vollständigkeit halber steht es hier: der Vertrag ist genau oder er ist nichts.
