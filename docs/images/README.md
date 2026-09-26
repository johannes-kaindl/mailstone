# Aufnahme-Vertrag — README-Bilder

Dieser Ordner hält die Bilder, die `README.md` und `README.de.md` einbetten. Diese Datei ist der **Vertrag** dafür: welche Bilder es gibt, was jedes zeigen muss, in welcher Klasse es steht — und wie man sie reproduzierbar neu aufnimmt. Geprüft wird er von `readme_lint.py` (Workspace-Werkzeug, `npm run shots:check`), das Vertrag, Dateien und README-Einbettungen gegeneinander abgleicht.

## Status

**Stand 2026-09-26: alle fünf Bilder stehen.** Aufgenommen in einer Zweitinstanz (Obsidian 1.14.2, eigenes Profil, eigener Port), Oberfläche Englisch, helles Standard-Theme, Fensterbreite 1400 px. Die Mails stammen aus synthetischen `.eml` (nur `example.org`/`.net`/`.com`, `docs/images/fixture/notes/Import/`), kein echtes Postfach kommt in ein Bild.

**Nicht im Vertrag, mit Grund:**

- **Der Posteingangs-Tab** (`inbox`): er liest live per IMAP und braucht ein Postfach mit gültigem TLS-Zertifikat. Ein Fake-Server hilft nicht, weil sich die Zertifikatsprüfung bewusst nicht abschalten lässt, und ein echtes Postfach kommt in kein Bild. Der Tab ist im README beschrieben, nicht abgebildet.
- **Ein Sync-Lauf mit echtem Ergebnis** aus demselben Grund: der Laufzustand im Seitenpanel von `hero.png` ist **gesetzt** (`runState` in `data.json`), nicht gemessen. Das Panel zeigt damit den Zustand nach einem erfolgreichen Lauf, wie ihn das Plugin nach einem echten Sync führt (Zähler, Zeitpunkte), aber kein Lauf hat ihn erzeugt. Die Konten sind ebenfalls gesetzt (Hosts `imap.example.net` bzw. `.org`); das Passwort ist ein Platzhalter im Schlüsselbund des Aufnahme-Vaults.

**Befunde am Prüfling, beim Aufnehmen gefunden** (nicht Teil dieses Auftrags, an den Master gemeldet): die Überschriften **„Notizen“ und „Nachricht“** in jeder geschriebenen Mail-Notiz sind fest deutsch (`src/core/merge/merge.ts`, `src/core/render/body.ts`) und in `mail-note.png`/`hero.png` bei englischer Oberfläche sichtbar; die Konten-Zeile in den Einstellungen zeigt „1 identities“ (Plural nicht behandelt).

## Konventionen

Verbindlich ist der workspace-weite Bild-Standard (`_docs/readme/readme-spec.json`, Block `images`):

| Klasse | Einbettung | Grenze |
|---|---|---|
| `hero` | `width="820"`, zentriert, direkt nach den Badges | Querformat (H ≤ B) |
| `feature` | `width` bis 820 | H/B ≤ 1.6 |
| `detail` | Vorschaubild `width="380"`, verlinkt auf die Vollauflösung | keine Höhengrenze |

Aufnahme bei 1200 px Breite, Vorschauen 380 px unter `thumbs/`, Einbettung per `<img width>` mit absoluter Raw-URL (`https://raw.githubusercontent.com/johannes-kaindl/mailstone/main/docs/images/<name>`), Alt-Text Pflicht. Budget: PNG ≤ 400 KB, Ordner ≤ 5 MB.

## Die Bilder

| Datei | Klasse | Referenziert von | Muss zeigen |
|---|---|---|---|
| `hero.png` | hero | `README.md`, `README.de.md` (Kopf) | Das Seitenpanel **Mailstone** neben einer geöffneten Mail-Notiz: zwei Konten (**Work mail**, **Personal**), je mit **Last run**, **Next run**, Zähler (**3 new** bzw. **No changes**) und dem Knopf **Synchronise now**, oben **Synchronise all** und die Tabs **Mailstone**/**Inbox**. Links der Datei-Explorer mit aufgeklapptem Ordner `Mail/2026`, in der Mitte der Text der Mail ohne das Eigenschaften-Fenster. Ruhiges Bild, kein Dialog. Der Laufzustand ist gesetzt, nicht gemessen (s. Status). |
| `mail-note.png` | feature | `README.md`, `README.de.md` (Usage) | Eine Mail-Notiz im Lesemodus mit ausgeklappten **Properties**: `mail_id`, `mail_source`, `mail_state`, `from`, `to`, `subject` und `in_reply_to`/`references` als **Wikilinks** auf die Vorgänger-Mail, darunter der Anfang des Nachrichtentexts. Belegt „der Thread ist verlinkt“. |
| `relink-preview.png` | feature | `README.md`, `README.de.md` (Usage) | Der Dialog **Review before writing** des Kommandos *Relink mail threads*: die Zusammenfassung „1 note(s) get new wikilinks …“, die Tabelle **Field / Before / After** mit der Message-ID vorher und dem Wikilink nachher, die Knöpfe **Cancel** und **Apply**. Zeigt, dass jedes Kommando vor dem Schreiben eine Vorschau bietet. Entsteht nur im ersten Lauf nach `--setup`: danach sind die Threads verknüpft und es gibt nichts mehr zu planen. |
| `account.png` | feature | `README.md`, `README.de.md` (Usage) | Der Konto-Dialog **Work mail** ab **Label** bis **Identities**: IMAP und SMTP mit Host, Port und **TLS**-Modus, **Username** und das **Password**-Feld mit dem verknüpften Schlüsselbund-Eintrag (nur Punkte, kein Klartext) samt Erklärtext. Nur Beispiel-Hosts (`example.net`), keine echte Adresse. |
| `settings.png` | detail | `README.md`, `README.de.md` (Configuration) | Der Einstellungen-Tab **Mailstone**: **Language**, **Notes folder**, **Subfolder per year**, **Filename template** und die Kontenliste **Accounts** mit zwei Konten und den Knöpfen **Edit**. Oberer Teil der langen Seite, deshalb als Vorschau eingebettet. |

## Reproduktion

Aufgenommen wird **nie gegen die reguläre Instanz** (Port 9222), sondern in einer Zweitinstanz mit eigenem Profil und Port. Ein Aufnahme-Vault neben dem des GUI-Smokes, weil `buildVault` einen Vault leerräumt und der Smoke-Vault `calendar-notes`/`tasknotes` für `smoke:e2e` trägt.

```bash
npm run build
npm run shots -- --setup      # Vault <staging>/mailstone-shots aus docs/images/fixture bauen

UD=/tmp/obs-test-mailstone; mkdir -p "$UD"
cp ~/Library/Application\ Support/obsidian/obsidian-<version>.asar "$UD"/   # minAppVersion 1.13.0: Pflicht
# $UD/obsidian.json: {"language":"en","vaults":{"shots":{"path":"<staging>/mailstone-shots","ts":<ms>,"open":true}}}
lsof -nP -iTCP:9327 -sTCP:LISTEN                                             # muss leer sein
/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=9327 &
# einmal im Fenster: localStorage.setItem("language","en"); app.plugins.setEnable(true); dann Prozess neu starten

python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label mailstone --intent "shots.ts" --exclusive focus --port 9327 --ttl 600
npm run shots -- --port 9327                       # alles aufnehmen
npm run shots -- --port 9327 --only hero.png       # ein Bild nachziehen
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
npm run shots:check
```

Das Rezept prüft die Oberflächensprache vor dem ersten Bild und bricht sonst ab. Der Import der Mails läuft über das echte Kommando *Import .eml files from a vault folder*, die Threads über *Relink mail threads*. **`relink-preview.png` gibt es nur nach frischem `--setup` samt Neustart der Instanz**; einzeln nachziehen lassen sich die anderen vier. Nach einem `--setup` vor dem Lauf `npm run deploy` bzw. den Build prüfen: `buildVault` kopiert den frisch gebauten Stand ins Vault, ein laufendes Obsidian braucht danach den Neustart.
