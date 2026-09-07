# Mailstone

Mailstone bringt Mail als Notizen in den Vault: ein **Ordner auf dem Mailserver** (ein
IMAP-Postfach, das du auf dem Server wählst, nicht im Plugin) entscheidet, was zur Notiz wird —
die Sichtung bleibt damit dort, wo die Mail ohnehin liegt, statt einen zweiten Posteingang in
Obsidian nachzubauen. Antworten aus einer Notiz heraus gehen über dasselbe Konto per SMTP, und
das Plugin verschickt iMIP-Kalendereinladungen im Auftrag des Schwester-Plugins
[`calendar-notes`](https://git.jkaindl.de/jkaindl/calendar-notes), dem das eigentliche
Termin-/Teilnehmer-Modell gehört.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/mailstone?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/mailstone/releases)
[![Obsidian](https://img.shields.io/badge/obsidian-1.13.0%2B%20·%20nur%20Desktop-purple)](https://obsidian.md)

> **Hinweis:** Diese Übersetzung folgt der englischen [`README.md`](README.md).
> Bei Abweichungen gilt die englische Fassung.

## Was es tut

- **Mail als Notiz.** Ein Ordner auf dem Server entscheidet, was zur Notiz wird; die Message-ID
  ist die Identität, und die ursprüngliche `.eml` bleibt als Treuefläche neben der Notiz liegen.
- **Ein Panel in der rechten Seitenleiste.** Pro Konto: was der letzte Lauf getan hat, wann der
  nächste fällig ist, die Zähler, die nicht null sind, der Fehler in Klartext — und ein Knopf zum
  sofortigen Synchronisieren, für ein Konto oder alle. Der letzte Lauf überlebt einen Neustart.
- **Ein Posteingangs-Tab.** Die letzten 100 Nachrichten aus deinem Posteingang, mit einem Häkchen
  für alles, was schon als Notiz vorliegt. Drei Aktionen je Zeile: ins Vault übernehmen oder
  archivieren — beides serverseitig, beides erst nach einer Rückfrage — oder, sobald
  [TaskNotes](https://github.com/callumalpass/tasknotes) installiert ist, direkt eine Aufgabe
  daraus anlegen.
- **Kommandos auf einer Mail-Notiz** — neu rendern aus der `.eml`, Message-IDs in Wikilinks
  verwandeln, einen Anhang extrahieren, im externen Mailprogramm antworten, eine TaskNotes-
  Aufgabe daraus anlegen. Jedes zeigt eine Vorschau, bevor es schreibt.
- **Versand.** SMTP über dasselbe Konto, einschließlich iMIP-Kalendereinladungen im Auftrag von
  `calendar-notes`.

**Stand: 0.3.0.** M1 (Gerüst und Formatschicht offline), M2 (SMTP-Transport, Konten,
calendar-notes-Brücke), M3 (IMAP-Sync, am 2026-08-30 gegen ein echtes Postfach geprüft), M3b
(Vault-Kommandos), das Sidebar-Panel und M4 (Posteingangs-Tab, serverseitiges Verschieben) sind
fertig. Offen sind noch: eine Vorschau innerhalb der Liste, Anhangs-Marker und
Tastaturnavigation.

## Voraussetzungen

- **Obsidian 1.13.0 oder neuer**, und zwar **nur am Desktop**. Das Plugin spricht IMAP und SMTP
  über `node:tls`, das es im mobilen Obsidian nicht gibt.
- **Ein IMAP-/SMTP-Konto**, das du mit einem App-Passwort erreichst. Anbieter, die OAuth verlangen
  (Gmail mit 2FA, Microsoft 365), werden nicht unterstützt — es gibt keinen OAuth-Ablauf.
- **Einen Ordner auf dem Mailserver**, der als Allowlist dient. Alles, was du dort ablegst, wird
  zur Notiz; nichts anderes wird angefasst. Dazu einen zweiten Ordner für das Archiv.
- **TLS ist nicht optional.** Die Zertifikatsprüfung lässt sich nicht abschalten, und
  Klartext-Anmeldung ohne TLS wird verweigert.

## Installation

Dieses Plugin wird **nicht über den Community-Store verteilt**. Es liegt auf einer eigenen Forge,
und es gibt drei Wege dorthin.

**Empfohlen — über den [AnySource Sideloader](https://git.jkaindl.de/jkaindl/anysource-sideloader)**,
der Plugins von beliebigen Git-Forges installiert und aktualisiert. Diesen Katalog einmal
abonnieren:

```
https://git.jkaindl.de/jkaindl/obsidian-catalog/raw/branch/main/catalog.json
```

Mailstone erscheint danach in der Plugin-Liste des Sideloaders und aktualisiert sich wie jedes
andere Plugin — kein Kopieren von Hand, und jeder Download wird per Prüfsumme verifiziert. Wer
nur dieses eine Plugin ohne den Katalog will, trägt stattdessen dessen Repository-URL als Quelle
ein: `https://git.jkaindl.de/jkaindl/mailstone`.

**Von Hand**, wenn du kein weiteres Plugin hinzufügen möchtest: `main.js`, `manifest.json` und
`styles.css` aus dem [letzten Release](https://git.jkaindl.de/jkaindl/mailstone/releases/latest)
nach `<vault>/.obsidian/plugins/mailstone/` legen und das Plugin unter Einstellungen →
Community-Plugins aktivieren. Aktualisieren muss man dann jedes Mal von Hand.

**Aus dem Quelltext** — `npm install && npm run build`, dann dieselben drei Dateien in denselben
Ordner kopieren. `npm run gate` fährt die vollständige Prüfkette (Lint, Typprüfungen, Unit- und
Integrationstests, Reinheitsprüfung, Build). `npm run smoke:e2e` ist eine separate, nur für den
Maintainer gedachte Prüfung: sie fährt ein echtes, laufendes Obsidian-Fenster mit tatsächlich
installiertem [TaskNotes](https://github.com/callumalpass/tasknotes), um zu belegen, dass eine
aus einer Mail-Notiz angelegte Aufgabe wirklich als Datei im Vault landet — bewusst nicht Teil
von `gate`, weil sie dieses zweite Plugin voraussetzt.

## Konfiguration

Einstellungen → Mailstone. Pro Konto stellst du ein:

| Einstellung | Was sie bedeutet |
|---|---|
| IMAP-/SMTP-Host, Port, TLS | `implicit` (meist Port 993/465) oder `starttls` (143/587) |
| Benutzername und App-Passwort | Das Passwort liegt in Obsidians `secretStorage`, nie in `data.json` |
| Identitäten | Eine oder mehrere Absenderadressen; eine davon ist die Voreinstellung |
| `folders.inbox` | Der Ordner, den der Posteingangs-Tab auflistet. Vorgabe `INBOX` |
| `folders.allowlist` | Der Ordner, der entscheidet, was zur Notiz wird |
| `folders.archive` | Wohin „Archivieren" eine Nachricht verschiebt |
| `folders.sent` | Wohin eine Kopie des Versands abgelegt wird. Vorgabe `Sent`; leer schaltet die Kopie ab |
| Sync-Intervall | Minuten zwischen zwei Läufen, je Konto |

„Verbindung testen" im Einstellungs-Tab prüft Host, TLS und Zugangsdaten, ohne eine einzige Mail
anzufassen.

## Benutzung

**Konto einrichten**, dann auf dem Server entscheiden, welche Mail zählt: ins Allowlist-Verzeichnis
verschieben — vom Telefon, aus dem Webmail, per Serverregel. Der nächste Sync macht daraus eine
Notiz mit der ursprünglichen `.eml` daneben.

**Oder vom Posteingangs-Tab aus arbeiten.** Seitenleiste öffnen (Ribbon-Symbol oder das Kommando
*Mailstone: Seitenleiste öffnen*), auf **Posteingang** wechseln und bei allem, was bleiben soll,
*Ins Vault übernehmen* wählen. Die Nachricht wandert auf dem Server in den Allowlist-Ordner, und
der folgende Sync schreibt die Notiz.

**Auf einer Mail-Notiz** bietet die Kommandopalette *neu rendern*, *Threads verlinken*, *Anhang
extrahieren*, *extern antworten* und — sobald TaskNotes installiert ist — *Aufgabe anlegen*.
Jedes zeigt vor dem Schreiben, was es ändern würde.

**Lesen markiert nie etwas als gelesen.** Auflisten, Vorschau und Sync nutzen durchweg `EXAMINE`
und `BODY.PEEK`; ein Verschieben nimmt die Flags der Nachricht mit. Wenn ein anderes Werkzeug in
deinem Aufbau über „ungelesen" gesteuert wird, kommt Mailstone ihm nicht in die Quere.

## Wie es funktioniert

**Der Server entscheidet, nicht das Plugin.** Ein Ordner auf dem Mailserver ist die Allowlist. Der
Sync liest ihn, und jede Nachricht darin wird zur Notiz — keine Regel-Maschine, keine Filter im
Plugin. Die Sichtung bleibt in dem Werkzeug, das du für Mail ohnehin benutzt.

**Die Message-ID ist die Identität.** Sie übersteht erneutes Herunterladen, Ordnerwechsel und
umbenannte Dateien. Die `.eml` neben jeder Notiz ist die Treuefläche: alles Abgeleitete —
Frontmatter, gerenderter Text, Anhänge — lässt sich daraus neu erzeugen, eine Formatänderung
kostet dich also nie Daten.

**Notizen werden zusammengeführt, nicht überschrieben.** Dein eigener Text steht außerhalb einer
markierten Zone und wird vor jedem Schreibvorgang per Hash verglichen. Hast du die verwaltete Zone
bearbeitet, wird der Schreibvorgang verweigert statt still ausgeführt. Mailstone löscht nie eine
Notiz — eine Nachricht, die den Ordner verlässt, wird als `detached` markiert, und wer sie
zurücklegt, hängt sie wieder an.

**Zwei Verbindungstypen, vom Compiler bewacht.** Der lesende Weg (`imapConnect`) hat gar keine
Möglichkeit, `SELECT` oder `UID MOVE` aufzurufen — die liegen auf einer eigenen, schreibfähigen
Sitzung, die genau ein Codepfad benutzt: die beiden Posteingangs-Aktionen. Deshalb ist „Lesen
markiert nie als gelesen" hier eine Eigenschaft des Typsystems und keine Regel, an die sich jemand
erinnern muss.

## Lizenz

AGPL-3.0-or-later, siehe [`LICENSE`](LICENSE) und [`LICENSING.md`](LICENSING.md).
