# Mailstone

> [🇬🇧 English](https://github.com/johannes-kaindl/mailstone/blob/main/README.md) · 🇩🇪 Deutsch

**Mailstone macht aus einem Mail-Ordner auf deinem Server Notizen in deinem Vault — der Server entscheidet, was zur Notiz wird, und Lesen markiert nie eine Nachricht als gelesen.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://github.com/johannes-kaindl/mailstone/blob/main/LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](https://github.com/johannes-kaindl/mailstone/blob/main/LICENSE-DOCS)
[![Release](https://img.shields.io/github/v/release/johannes-kaindl/mailstone?label=release)](https://github.com/johannes-kaindl/mailstone/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.13%2B%20·%20Desktop%20%26%20Mobil%20(lesen)-7c3aed)

> **Hinweis:** Diese Übersetzung folgt der englischen [`README.md`](https://github.com/johannes-kaindl/mailstone/blob/main/README.md). Bei Abweichungen gilt die englische Fassung.

Die Sichtung bleibt dort, wo die Mail ohnehin liegt: Verschiebe eine Nachricht in einen bestimmten IMAP-Ordner — vom Handy, aus dem Webmailer, per Mail-Regel —, und der nächste Sync schreibt sie als Markdown-Notiz in den Vault, mit der ursprünglichen `.eml` daneben. Der Versand läuft über dasselbe Konto per SMTP, und das Plugin verschickt iMIP-Kalendereinladungen im Auftrag des Schwester-Plugins [`calendar-notes`](https://github.com/johannes-kaindl/calendar-notes).

<p align="center"><img src="https://raw.githubusercontent.com/johannes-kaindl/mailstone/main/docs/images/hero.png" width="820" alt="Das Mailstone-Seitenpanel neben einer importierten Mail-Notiz: zwei Konten mit letztem und nächstem Lauf und dem Zähler „3 new“, je ein Knopf „Synchronise now“, dazu der Ordnerbaum mit den Mail-Notizen im Datei-Explorer."></p>

## Funktionen

- **Mail als Notiz.** Ein Ordner auf dem Server entscheidet, was zur Notiz wird. Die Message-ID ist die Identität, und die ursprüngliche `.eml` bleibt neben der Notiz liegen — alles Abgeleitete lässt sich daraus neu aufbauen.
- **Ein Panel in der rechten Seitenleiste.** Pro Konto: was der letzte Lauf getan hat, wann der nächste fällig ist, die Zähler, die nicht null sind, der Fehler in Klartext — und ein Knopf zum sofortigen Synchronisieren, für ein Konto oder alle. Der letzte Lauf überlebt einen Neustart.
- **Ein Posteingangs-Tab.** Die letzten 100 Nachrichten deines Posteingangs, mit einem Häkchen für alles, was schon als Notiz vorliegt. Drei Aktionen je Zeile: *Ins Vault übernehmen* und *Archivieren* (beides serverseitig, beides erst nach einer Rückfrage) und — sobald [TaskNotes](https://github.com/callumalpass/tasknotes) installiert ist — *Aufgabe erstellen*.
- **Kommandos auf einer Mail-Notiz.** Neu aufbauen aus der `.eml`, Threads neu verknüpfen, einen Anhang herausholen, im externen Mailprogramm antworten, eine TaskNotes-Aufgabe anlegen. Jedes zeigt eine Vorschau, bevor es schreibt.
- **Import ohne Server.** *.eml-Dateien aus einem Vault-Ordner importieren* macht aus `.eml`-Dateien, die du schon hast, Notizen — ganz ohne Konto.
- **Versand.** SMTP über dasselbe Konto, einschließlich iMIP-Einladungen für `calendar-notes`. Auch andere Plugins können über Mailstone senden, nachdem du jedes einmal bestätigt hast.
- **Lesen markiert nie etwas als gelesen.** Auflisten, Vorschau und Sync nutzen `EXAMINE` und `BODY.PEEK`; beim Verschieben reisen die Flags mit. Ein anderes Werkzeug, das auf „ungelesen“ reagiert, wird nicht gestört.
- **Mobil: lesen, was schon synchronisiert ist.** Synchronisierte Notizen sind auf Mobilgeräten gewöhnliche Markdown-Notizen. Sync, Versand und Posteingangs-Tab brauchen eine Netzwerkschicht, die mobiles Obsidian nicht bietet, und bleiben dort aus.

## Voraussetzungen

- **Obsidian 1.13.0 oder neuer.** Alles am Desktop; mobil nur das Lesen von Notizen, die ein Desktop schon synchronisiert hat.
- **Ein IMAP/SMTP-Konto**, das du mit einem App-Passwort erreichst. Anbieter, die OAuth verlangen (Gmail mit 2FA, Microsoft 365), werden nicht unterstützt — es gibt keinen OAuth-Ablauf.
- **Ein Ordner auf dem Mailserver**, der als Allowlist dient (Standardname `Vault`), und ein zweiter für das Archiv. Was du in den Allowlist-Ordner legst, wird zur Notiz; sonst wird nichts angefasst.
- **TLS ist nicht optional.** Die Zertifikatsprüfung lässt sich nicht abschalten, und Klartext-Anmeldung ohne TLS wird verweigert.

## Installation

### Community Plugins

Die Aufnahme ins Community-Plugin-Verzeichnis steht noch im Review aus. Danach: Einstellungen → Community-Plugins → Durchsuchen → „Mailstone“. Bis dahin einen der folgenden Wege nutzen.

### AnySource Sideloader

Der [AnySource Sideloader](https://github.com/johannes-kaindl/anysource-sideloader) installiert und aktualisiert Plugins von jeder Git-Forge. Diesen Katalog einmal abonnieren:

```
https://git.jkaindl.de/jkaindl/obsidian-catalog/raw/branch/main/catalog.json
```

Mailstone erscheint dann in der Plugin-Liste des Sideloaders und wird wie jedes andere Plugin aktualisiert, jeder Download mit Prüfsumme verifiziert.

### Manuell

`main.js`, `manifest.json` und `styles.css` aus dem [letzten Release](https://github.com/johannes-kaindl/mailstone/releases/latest) nach `<vault>/.obsidian/plugins/mailstone/` legen, dann das Plugin unter Einstellungen → Community-Plugins aktivieren. Updates müssen dann von Hand wiederholt werden.

### BRAT (Beta)

`johannes-kaindl/mailstone` in [BRAT](https://github.com/TfTHacker/obsidian42-brat) eintragen.

### Aus dem Quelltext

```bash
git clone https://git.jkaindl.de/jkaindl/mailstone
cd mailstone && npm install && npm run build
# main.js manifest.json styles.css → <vault>/.obsidian/plugins/mailstone/
```

`npm run gate` fährt die komplette Prüfstrecke (Lint, Typprüfungen, Unit- und Integrationstests, Reinheitsprüfung, Build). `npm run smoke:e2e` ist eine reine Maintainer-Prüfung gegen ein laufendes Obsidian mit installiertem TaskNotes und bewusst nicht Teil von `gate`.

## Verwendung

1. **Konto einrichten.** Einstellungen → Mailstone → *Konto hinzufügen*: IMAP- und SMTP-Host, Port und TLS-Modus, Benutzername, ein App-spezifisches Passwort, mindestens eine Identität und die Ordnernamen, wie dein IMAP-Server sie anzeigt. *SMTP-Verbindung testen* prüft Host, TLS und Anmeldung, ohne etwas zu senden.

<img src="https://raw.githubusercontent.com/johannes-kaindl/mailstone/main/docs/images/account.png" width="600" alt="Der Konto-Dialog: IMAP- und SMTP-Host, Port und TLS-Modus, Benutzername und ein mit Obsidians Secret-Storage verknüpftes Passwort.">
2. **Auf dem Server entscheiden, welche Mail wichtig ist.** In den Allowlist-Ordner verschieben. Der nächste Sync — alle paar Minuten oder *Jetzt synchronisieren* in der Seitenleiste — schreibt eine Notiz nach `Mail/<Jahr>/` und die `.eml` nach `Mail/<Jahr>/_eml/`.

<img src="https://raw.githubusercontent.com/johannes-kaindl/mailstone/main/docs/images/mail-note.png" width="600" alt="Eine Mail-Notiz: Frontmatter mit Absender, Empfängern, Datum und Message-ID, in_reply_to und references als Wikilinks auf die frühere Mail, darunter der Nachrichtentext.">
3. **Oder im Posteingangs-Tab arbeiten.** Seitenleiste über das Ribbon-Symbol oder den Befehl *Mailstone: Seitenleiste öffnen* öffnen, zu **Posteingang** wechseln und bei allem Aufhebenswerten *Ins Vault übernehmen* nutzen. Die Nachricht wandert auf dem Server in den Allowlist-Ordner, und der folgende Sync schreibt die Notiz.
4. **Auf einer Mail-Notiz** bietet die Befehlspalette *Mail-Notiz aus ihrer .eml neu aufbauen*, *Mail-Threads neu verknüpfen*, *Anhang aus einer Mail-Notiz herausholen*, *Auf eine Mail im externen Mailprogramm antworten* und *TaskNotes-Aufgabe anlegen*. Es erscheinen nur die, die zur geöffneten Notiz passen. Jedes zeigt vor dem Schreiben, was es ändern würde:

<img src="https://raw.githubusercontent.com/johannes-kaindl/mailstone/main/docs/images/relink-preview.png" width="820" alt="Der Dialog „Review before writing“ des Kommandos Mail-Threads neu verknüpfen: Eine Notiz bekommt einen Wikilink in in_reply_to, dargestellt als Vorher und Nachher, mit Cancel und Apply.">

### Konfiguration

<a href="https://raw.githubusercontent.com/johannes-kaindl/mailstone/main/docs/images/settings.png"><img src="https://raw.githubusercontent.com/johannes-kaindl/mailstone/main/docs/images/thumbs/settings.png" width="380" alt="Der Mailstone-Einstellungs-Tab: Sprache, Notiz-Ordner, Unterordner je Jahr, Dateinamen-Vorlage und die Liste der Konten mit Edit-Knöpfen."></a><br><sub>Auf die Vorschau klicken für das Bild in voller Größe</sub>

Einstellungen → Mailstone. Pro Konto (*Konto hinzufügen* / *Bearbeiten*):

| Einstellung | Wirkung | Standard |
|---|---|---|
| IMAP / SMTP: Host, Port, TLS | `Implizit` (meist 993/465) oder `STARTTLS` (143/587) | — |
| Benutzername, Passwort | Das Passwort liegt in Obsidians Secret-Storage, nie in `data.json` oder im Vault | — |
| Identitäten | Adressen, von denen du senden darfst; eine ist der Standard | — |
| Ordner: Posteingang | Der Ordner, den der Posteingangs-Tab auflistet | `INBOX` |
| Ordner: Allowlist | Der Ordner, der entscheidet, was zur Notiz wird | `Vault` |
| Ordner: Archiv | Wohin *Archivieren* eine Nachricht verschiebt | `Archive` |
| Ordner: Gesendet | Wo eine Kopie des Gesendeten abgelegt wird; leer schaltet die Kopie ab | `Sent` |
| Synchronisation aktiv / Sync-Intervall (Minuten) | Automatischer Sync pro Konto | an / 5 |

Globale Einstellungen:

| Einstellung | Wirkung | Standard |
|---|---|---|
| Notiz-Ordner | Wo Mail-Notizen entstehen, je Jahr ein Unterordner | `Mail` |
| Unterordner je Jahr | Schaltet die Jahres-Unterordner ab | an |
| Dateinamen-Vorlage | Platzhalter `{date}`, `{time}`, `{slug}`, `{year}` | `{date}-{time}-{slug}` |
| Zusatzfelder für neue Mail-Notizen | Felder, die beim ersten Anlegen einmalig ins Frontmatter geschrieben werden, etwa `status: open` | keine |
| Erlaubte Werte bei Neuanlage | Werte, die für die beim Anlegen geschriebenen Felder zulässig sind | `mail` |
| Plugins mit Sendeerlaubnis | Plugins, die ohne Rückfrage über Mailstone senden; Widerruf fragt wieder | keine |
| Beim Start öffnen | Öffnet das Seitenleisten-Panel beim Start von Obsidian | aus |
| Debug-Protokoll | Schreibt den IMAP-/SMTP-Dialog in die Entwicklerkonsole, Passwörter maskiert | aus |
| Sprache | Oberflächensprache | Automatisch |

## Dokumentation

- [Dokumentations-Index](https://github.com/johannes-kaindl/mailstone/blob/main/docs/README.md) (englisch)
- [Erste Schritte](https://github.com/johannes-kaindl/mailstone/blob/main/docs/getting-started.md) (englisch) — von der Installation bis zur ersten Mail-Notiz
- [Fehlerbehebung](https://github.com/johannes-kaindl/mailstone/blob/main/docs/how-to/troubleshooting.md) (englisch) — die Fehlermeldungen, ihre Ursachen und was zu tun ist

## Funktionsweise

**Der Server entscheidet, nicht das Plugin.** Ein Ordner auf dem Mailserver ist die Allowlist. Der Sync liest ihn, und jede Nachricht darin wird zur Notiz — keine Regel-Engine, keine Filter im Plugin.

**Die Message-ID ist die Identität.** Sie überlebt erneutes Herunterladen, Ordnerwechsel und umbenannte Dateien. Die `.eml` neben jeder Notiz ist die Treuefläche: Frontmatter, gerenderter Text und Anhänge lassen sich daraus neu aufbauen, eine Formatänderung kostet also nie Daten.

**Notizen werden zusammengeführt, nicht überschrieben.** Dein eigener Text steht außerhalb einer markierten Zone (`%% mailstone:begin %%` … `%% mailstone:end %%`) und wird vor jedem Schreiben per Hash verglichen. Hast du den verwalteten Abschnitt von Hand bearbeitet, wird das Schreiben verweigert, statt es still anzuwenden. Mailstone löscht nie eine Notiz: Eine Nachricht, die den Ordner verlässt, wird als `detached` markiert, und beim Zurücklegen wird sie wieder verbunden.

**Zwei Arten von IMAP-Sitzung, vom Compiler erzwungen.** Der Lesepfad kann weder `SELECT` noch `UID MOVE` aufrufen; beides liegt auf einer getrennten Sitzung, die nur die Posteingangs-Aktionen nutzen. Deshalb ist „Lesen markiert nie als gelesen“ eine Eigenschaft des Typsystems und keine Regel, an die jemand denken muss. Architektur und Konventionen stehen in [`AGENTS.md`](https://github.com/johannes-kaindl/mailstone/blob/main/AGENTS.md).

## Mitwirken

Issues und Pull Requests auf [GitHub](https://github.com/johannes-kaindl/mailstone/issues); das kanonische Repository liegt auf [git.jkaindl.de](https://git.jkaindl.de/jkaindl/mailstone). Testgetrieben (`npm test`, volle Prüfung mit `npm run gate`); größere Features laufen über Brainstorm → Spec → Plan → TDD. Siehe [`AGENTS.md`](https://github.com/johannes-kaindl/mailstone/blob/main/AGENTS.md).

## Lizenz

- **Code:** AGPL-3.0-or-later ([`LICENSE`](https://github.com/johannes-kaindl/mailstone/blob/main/LICENSE); Dual-License-Option in [`LICENSING.md`](https://github.com/johannes-kaindl/mailstone/blob/main/LICENSING.md)).
- **Doku/Text:** CC BY-SA 4.0 ([`LICENSE-DOCS`](https://github.com/johannes-kaindl/mailstone/blob/main/LICENSE-DOCS)).

Copyright © 2026 Johannes Kaindl.
