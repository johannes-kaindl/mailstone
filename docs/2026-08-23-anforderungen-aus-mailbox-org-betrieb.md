# Anforderungen an `mailstone` aus dem laufenden Betrieb des Postfachs

**Datum:** 2026-08-23 · **Von:** mailbox-org-Session (Projekt 26-060, nach Teilprojekt ②)
**Status:** Betriebs-Vorgaben, belastbar für alles außer Ordnerstruktur und Regelwerk (Nachtrag nach ③)
**Gegenstück:** [`2026-08-22-anforderungen-aus-calendar-notes.md`](./2026-08-22-anforderungen-aus-calendar-notes.md) — dort steht der iMIP-Transport-Vertrag. Dieses Dokument steht daneben, nicht darüber.

Dieses Dokument beschreibt **kein Feature**. Es beschreibt das Postfach, gegen das `mailstone` laufen soll, und die Entscheidungen, die dort bereits getroffen und live sind. Wer eine davon bricht, baut gegen ein System, das der Nutzer täglich benutzt.

> **Öffentlichkeitsgrenze:** `mailstone` wird Store-Software, dieses Repo wird öffentlich. Deshalb stehen hier **Muster statt Werte** — keine Domain, keine realen Adressen, keine Dienste-Kennungen. Die konkreten Werte liegen unter `/Users/Shared/40_Tools/mailbox-org/` und im Pallas-Vault (`60_Bereiche/30_System/mailbox-org/`). Beim Zitieren bitte die Grenze halten.

---

## 1. Die Plattform

Anbieter **mailbox.org**, Tarif STANDARD, eigene Domain. Serverseitig Dovecot (IMAP) und Postfix (SMTP). Alle Werte am 2026-08-22 gemessen (`skripte/endpunkte.sh` im Arbeitsordner), nicht aus Anbieterdoku abgeschrieben.

| Dienst | Host | Port | Transport |
|---|---|---|---|
| IMAP | `imap.mailbox.org` | 993 | implizites TLS |
| SMTP | `smtp.mailbox.org` | 465 | implizites TLS |
| SMTP | `smtp.mailbox.org` | 587 | STARTTLS |
| **ManageSieve** | `imap.mailbox.org` | **4190** | **extern offen** |

IMAP-`CAPABILITY` meldet `PLAIN`, `LOGIN`, `OAUTHBEARER`, `XOAUTH2`. TLS-Zertifikat `CN=*.mailbox.org` (Thawte/DigiCert).

**Eine automatische Client-Konfiguration existiert nicht** — weder Thunderbird-ISPDB noch der Well-Known-Pfad des Anbieters liefern etwas. Ein Autoconfig-Discovery einzubauen ist für diesen Anbieter vergebliche Mühe; die Werte werden von Hand gesetzt.

**ManageSieve auf 4190 ist der wichtigste Befund.** Das Webinterface bietet keinen Sieve-Quelltext-Zugang, der externe Port ist aber offen. Das Regelwerk ist damit maschinell les- und schreibbar. Siehe § 3.

---

## 2. Auth: App-Passwörter, nie das Hauptpasswort

Das Konto hat 2FA (TOTP). Für Maschinenzugriff existieren **App-Passwörter je Dienst** — bewusst eins pro nutzendem Ding, damit einzelne widerrufen werden können, ohne alle anderen zu stören. Das Master-Passwort wird in **keinen** Client eingetragen.

Für `mailstone` heißt das:

- Die Settings-UI muss **erwartbar machen, dass hier ein App-Passwort hingehört**, nicht das Kontopasswort. Ein Hilfetext, kein Ratespiel. Das ist keine Kosmetik: Wer sein Hauptpasswort einträgt, hebt seine 2FA für diesen Weg auf.
- Ablage in `app.secretStorage` (Obsidian ≥ 1.11.4, OS-verschlüsselt, nicht vault-synct), **nicht** in `data.json`. `calendar-notes` macht das bereits so — gleichziehen hält die Settings-UX identisch (`SecretComponent`).
- Ein Konto = ein Passwort. Kein gemeinsames Credential für IMAP, SMTP und ManageSieve zu erzwingen ist unnötig; der Anbieter erlaubt dasselbe App-Passwort für alle drei. Aber: nicht daran *binden*, dass es dasselbe ist.
- OAuth ist serverseitig verfügbar (`OAUTHBEARER`/`XOAUTH2`), aber für dieses Setup **nicht** vorgesehen — App-Passwort ist der Weg.

**Stand:** App-Passwörter existieren noch nicht. Sie entstehen in Teilprojekt ④. Bis dahin ist kein authentifizierter Test gegen dieses Konto möglich — auch nicht für ManageSieve.

---

## 3. Die Filter liegen serverseitig. Das ist eine Grundsatzentscheidung, keine Vorliebe.

Entscheidung G5 des Setups: **alle Filterregeln als Sieve auf dem Server.** Grund: Mac, Linux, iPhone und Browser sehen identisch dasselbe Postfach. Ein Client, der eigene Regeln fährt, erzeugt genau die Abweichung, die das Setup ausschließt.

**Was `mailstone` deshalb nicht tun darf:**

- keine clientseitige Regel-Engine, die parallel zu Sieve sortiert
- kein „intelligentes" automatisches Verschieben beim Abruf
- keine Regel, die nur wirkt, solange Obsidian läuft

**Was `mailstone` stattdessen tun kann — und was der eigentlich interessante Weg wäre:** ManageSieve auf Port 4190 ist erreichbar. Ein Plugin, das das Regelwerk **liest, anzeigt und als Quelltext im Vault versioniert**, wäre kein Konkurrenzsystem, sondern eine Oberfläche für das, was ohnehin gilt. Falls das je gebaut wird, gilt dieselbe Linie wie in `calendar-notes`: **Server ist SSOT, die Notiz ist Spiegel, Schreiben nur über ein explizites Kommando** — nie durch Editieren einer Notiz.

**Und die härteste Regel, Entscheidung G6: keine Regel löscht jemals.** Filter verschieben, sie vernichten nicht. Begründung aus dem Setup-Design, wörtlich sinngemäß: Ein Filter, der eine wichtige Mail verschluckt, kostet das Vertrauen ins System — und ohne Vertrauen wird wieder alles manuell kontrolliert, dann war die Arbeit umsonst. Ein Verwaltungs-Plugin muss dieselbe Linie halten: Löschen nur auf ausdrückliche Einzelanweisung am einzelnen Objekt, nie als Effekt einer Regel oder einer Massenaktion mit Vorauswahl.

---

## 4. Wenige Ordner, Suche statt Sortierung

Entscheidung G9. Ordnerhierarchie ist Entscheidungslast bei jeder einzelnen Mail; der Nutzer hat Autismus und ADHS, und genau diese Last soll das Setup nicht erzeugen. Bewusst **keine** Spiegelung der Vault-Bereichsstruktur ins Postfach.

Für die UI folgt daraus: **Ein Ordnerbaum ist nicht die Hauptnavigation.** Der Zugriffsweg ist Suche und Zeit. IMAP kann `SEARCH` serverseitig — das ist der richtige Hebel, nicht ein lokaler Index über alles.

---

## 5. Der Posteingang ist eine Handlungsliste — hier liegt der Andockpunkt an Obsidian

Design-Regel 4.1, drei strikt getrennte Achsen:

- **Automatik** — was den Nutzer nicht braucht, erreicht den Posteingang nie (Bot- und CI-Mail, Newsletter, Dienst-Benachrichtigungen, Belege). Sieve sortiert das vorbei.
- **Handlung** — was übrig bleibt, ist per Definition von einem Menschen oder verlangt eine Entscheidung. **Das ist der Posteingang.**
- **Ablage** — flach, wenige Ordner, manuell.

Das ist die eigentliche Begründung für ein Mail-Plugin in Obsidian: Wenn der Posteingang bereits gefiltert *eine Liste offener Entscheidungen* ist, dann ist er strukturgleich mit einer Aufgabenliste. Eine Mail → eine TaskNote ist keine Spielerei, sondern die Fortsetzung dessen, was serverseitig schon passiert.

Umgekehrt heißt es auch: **ein Plugin, das den ungefilterten Posteingang spiegelt, hätte keinen Wert.** Der Wert entsteht aus Teilprojekt ③. Vor ③ ist die Datenlage nicht die, gegen die gebaut werden soll.

---

## 6. Identitäten, Catch-All, und warum `From` nicht frei wählbar ist

Das Setup fährt **zwei Rollen** auf **einer** Domain, in **einem** Postfach:

| Rolle | Muster | Wofür | Besonderheit |
|---|---|---|---|
| privat | `mail@` | Menschen, Behörden, Banken | **Standard-Absender**, zugleich Login-Adresse |
| öffentlich | `kontakt@` | Repos, Plugin-Store, Webauftritt | eigener Anzeigename gesetzt |

Der Standard ist bewusst die *private* Rolle: Sie ist die Adresse, die bei Unachtsamkeit rausgeht, und eine versehentlich privat verschickte Fachmail ist folgenlos — umgekehrt nicht. **Ein Plugin, das einen Default-Absender wählt, sollte dieselbe Logik anwenden** oder gar keinen wählen und fragen.

Daneben existieren **Funktionsadressen** (echte Aliase, an einen Login oder einen Versandweg gebunden) und **Dienste-Kennungen über Catch-All**: Für jede neue Anmeldung wird eine Kennung `<dienst>@` benutzt, die vorher nirgends angelegt wurde. Der Catch-All fängt sie auf.

> **Die Falle:** Von einer Catch-All-Kennung kann **nicht gesendet werden.** Versand geht ausschließlich von echten, angelegten Adressen.

Das ist für `mailstone` unmittelbar relevant: Eine Antwort-Funktion, die naiv den `To:`-Header der eingehenden Mail als neuen `From:` setzt, **trifft in der Mehrzahl der Fälle eine Catch-All-Kennung** und schlägt fehl oder geht mit falscher Identität raus. Der Absender muss aus einer geprüften Liste echter Adressen kommen — das ist genau die Liste, die `accounts()` im Transport-Vertrag mit `calendar-notes` liefert (§ 2 des Nachbardokuments). Beide Wege sollten dieselbe Quelle benutzen.

Zwei gemessene Grenzen des Anbieters, die Erwartungen betreffen:

1. **Ein gelöschter Alias bleibt 365 Tage gesperrt.** Eine Adresse zu löschen ist kein umkehrbarer Schritt, sondern eine Ein-Jahres-Sperre. Falls `mailstone` je Adressverwaltung anbietet: Das muss vor der Bestätigung dastehen.
2. **Ein neu angelegter Alias erscheint erst nach einem Reload** in der Absenderauswahl der Weboberfläche. Wer eine Adressliste cacht, braucht einen manuellen Auffrisch-Weg — sonst gilt eine neue Adresse als „defekt".

---

## 7. Versand: DMARC ist scharf. Es gibt genau einen erlaubten Weg raus.

Die Domain ist vollständig authentifiziert und **extern verifiziert** (2026-08-22, gegen die `Authentication-Results` eines fremden Empfängers, nicht als Selbstauskunft): `spf=pass`, `dkim=pass` mit der eigenen Domain als `d=`, `dmarc=pass` mit Alignment über beide Wege.

**Seit 2026-08-23 steht DMARC auf `p=quarantine`.** Stufe 2 (`p=reject`) ist terminiert auf frühestens 2026-09-05.

Daraus folgt hart:

- **Versand ausschließlich über den authentifizierten SMTP des Anbieters** (465 oder 587). Nur der signiert mit DKIM und ist SPF-berechtigt.
- **Kein direkter MX-Versand, kein lokaler MTA, kein `sendmail`/`msmtp`.** Unter `quarantine` landet so etwas beim Empfänger im Spam; ab `reject` wird es abgewiesen. Das gilt auch für die iMIP-Einladungen aus dem `calendar-notes`-Vertrag — eine Einladung, die im Spam landet, ist schlimmer als keine.
- Der Store-Befund zeigt in dieselbe Richtung: `child_process` kostet in der Store-Bewertung immer die Bestnote. Ein externer Mailer-Aufruf wäre also technisch **und** bewertungsseitig falsch.

---

## 8. Größenordnung — zur Kalibrierung, nicht als Ziel

Rund 964 Nachrichten im Posteingang, 255 im Archiv, 797 MB von 20 GB belegt (Stand ①). Das ist ein kleines Postfach — aber kein Argument für „lade beim Start alles". Der Abruf sollte über `ENVELOPE`/`BODYSTRUCTURE` und `FETCH` nach Bedarf laufen, nicht über Volltext-Vorabspiegelung. Der Zugriffsweg ist ohnehin die Suche (§ 4).

---

## 9. Bauart-Vorgaben, die aus der Store-Recherche schon feststehen

Aus dem Nachbardokument, hier bestätigt und nicht neu zu entscheiden:

- IMAP/SMTP sind kein HTTP. `requestUrl` hilft nicht, es braucht `node:net`/`node:tls` → **desktop-only**. `Platform.isDesktop`-guarded `await import("node:tls")` ist die einzige Source-Form, die beide Store-Scan-Regeln besteht.
- Netzwerk + Credentials kosten in der Store-Bewertung nichts. `child_process` kostet immer.
- Das Plugin muss **ohne** `calendar-notes` vollständig laufen, und umgekehrt. Beide sind Store-Software.

---

## 10. Was wir von `mailstone` ausdrücklich **nicht** erwarten

- **Keine zweite Kontaktverwaltung.** Kontakte kommen per CardDAV über `calendar-notes` (`cn.contacts({query})`). Absender → Kontakt-Notiz aufzulösen ist Lesen von Material, keine Zuständigkeitsverletzung — aber ein eigenes Adressbuch wäre eine.
- **Keine Kalenderfunktionen.** Auch nicht „nur schnell die `.ics` anzeigen".
- **Keine Regel-Erfindung** neben Sieve (§ 3).
- **Keine Migrations- oder Aufräum-Automatik** über den Bestand. Der Altbestand wird nach dem Stichtagsprinzip in wenigen Massenaktionen sortiert (Design-Regel 4.3), nicht Mail für Mail bewertet — und schon gar nicht von einem Plugin im Hintergrund.

---

## 11. Was noch offen ist — und wann es kommt

| Offen | Kommt aus | Frühestens |
|---|---|---|
| **Ordnerstruktur** (welche Ordner es überhaupt gibt) | Teilprojekt ③ Posteingang | ③ ist startbereit |
| **Sieve-Regelwerk** als Quelltext | Teilprojekt ③ | dito |
| **App-Passwort** → erster authentifizierter Zugriff auf IMAP/SMTP/ManageSieve | Teilprojekt ④ | nach ③ |
| ob ManageSieve-Login mit App-Passwort funktioniert | ④ | ungeprüft |

**Empfehlung für den Zuschnitt:** Alles bis § 10 ist stabil und kann sofort in die Architektur einfließen — Transport, Auth-Modell, Absenderlogik, Versandweg, die Nicht-Ziele. Die **Datenmodell-Seite** (Ordner, Regeln) sollte auf ③ warten. Ein Ordnermodell jetzt zu erfinden hieße, es nach ③ noch einmal anzufassen — und Nacharbeit ist in diesem Projekt ausdrücklich das, was vermieden wird (Entscheidung G1: fünf Teilprojekte streng nacheinander, kein Durchstich, keine Übergangslösungen).

Ein Nachtrag zu ③ kommt hierher, sobald er existiert.

---

## Wo die Wahrheit steht

| Was | Wo |
|---|---|
| Design-Spec (alle Entscheidungen mit Begründung) | `/Users/Shared/40_Tools/mailbox-org/docs/superpowers/specs/2026-08-22-mailbox-org-setup-design.md` |
| Endpunkte, Auth-Modell, DNS-Stand | Pallas-Vault → `60_Bereiche/30_System/mailbox-org/Technische-Referenz.md` |
| Adressmodell und seine Grenzen | ebenda → `Adressen.md` |
| Filterregelwerk (entsteht in ③) | ebenda → `Filterregeln.md` |
| Messskript, Rohdaten | `40_Tools/mailbox-org/skripte/endpunkte.sh`, `rohdaten/<datum>/` (gitignoriert) |

Rückfragen an die mailbox-org-Session; Antworten am besten als Datei unter `40_Tools/mailbox-org/docs/`, damit sie nicht im Chat verloren gehen.

---

## Nachtrag nach Teilprojekt ③ (2026-08-23): Ordnerstruktur und Regelwerk

§ 11 hatte diesen Nachtrag angekündigt. Teilprojekt ③ ist umgesetzt, das Regelwerk ist live, jede
Regel per Testmail von extern belegt, der Altbestand einsortiert. **Die Datenmodell-Seite steht.**

### Die Ordner

Sechs Stück, **alle flach auf oberster Ebene** — kein `INBOX/`-Präfix, keine Unterordner.
Das ist eine Entscheidung (G9), keine Momentaufnahme.

| Ordner | Achse | Was hineinkommt | Wer füllt ihn |
|---|---|---|---|
| `INBOX` | **Handlung** | was alle Automatik-Regeln passiert hat | Zustellung |
| `Listen` | Automatik | Newsletter und Verteiler (`List-Id`/`List-Unsubscribe` vorhanden) | Sieve |
| `Systempost` | Automatik | maschinelle Einzelmails ohne Listen-Marker (`Auto-Submitted`, `Precedence`, No-Reply-Absender) | Sieve |
| `Belege` | Automatik | Rechnungen und Quittungen bekannter Versender | Sieve |
| `Fremd` | Automatik | Post an Kennungen, die niemand angelegt hat (Türsteher) | Sieve |
| `Vault` | Ablage | **nichts automatisch** — hier landet, was ein Mensch von Hand hineinschiebt | der Nutzer |
| `Archive` | Ablage | Langzeitablage | der Nutzer |

Dazu die Standardordner `Sent`, `Drafts`, `Junk`, `Trash`.

### Was ein Plugin darüber wissen muss

- **Ein Ordnerbaum ist nicht die Hauptnavigation.** Sechs flache Ordner, und die meisten füllt
  eine Regel. Der Zugriffsweg ist Suche und Zeit, nicht Klicken durch Hierarchie.
- **`INBOX` ist die Handlungs-Achse und damit die interessante Menge.** Nach der Sortierung
  enthält sie nur noch Post von Menschen oder etwas, das eine Entscheidung verlangt — gemessen
  fiel sie von 973 auf 409, die ungelesenen darin von 409 auf 38. *Das* ist die Liste, die für
  eine Aufgaben-Ansicht taugt, nicht „alle Mails".
- **`Vault` ist euer Allowlist-Ordner.** Er existiert, ist leer, heißt genau so, liegt auf
  oberster Ebene und hat **keine Sieve-Regel**. Was dort liegt, hat ein Mensch hineinbewegt.
  Zwei Eigenschaften, auf die ihr euch verlassen könnt, ohne dass jemand sie pflegt: Sieve läuft
  nur bei der **Zustellung**, nicht beim Verschieben — eine dorthin bewegte Mail holt keine Regel
  zurück. Und weil jede Regel mit `stop` endet, kann auch keine spätere Regel sie zusätzlich
  woanders einsortieren. Der Ordner ist stabil gegenüber allem, was am Regelwerk noch geändert wird.
- **`Fremd` ist Quarantäne, kein Müll.** Dort landet auch eine gerade erst vergebene
  Dienste-Kennung, bis sie im Regelwerk nachgetragen ist. Ein Plugin, das diesen Ordner sichtbar
  macht, hilft genau bei diesem Nachtrag. Aktueller Bestand: 3 Mails, alle aus eigenen Tests.
- **`Belege` trägt das IMAP-Keyword `$beleg` und bleibt ungelesen.** Das ist kein Zufall,
  sondern der Andockpunkt für paperless-ngx in Teilprojekt ⑤: Es holt aus dem Ordner alles
  Ungelesene ab und markiert es danach als gelesen, der Ordner leert sich also selbst.
  **Ein Plugin, das beim Anzeigen `\Seen` setzt, bricht diesen Weg.** Deshalb überall
  `BODY.PEEK`, nie `BODY` — und `EXAMINE` statt `SELECT`, wo nur gelesen wird.

### Das Regelwerk

Sechs Blöcke, Reihenfolge ist Bedeutung, jede einsortierende Regel endet mit `stop`:

| # | Erkennt woran | Ziel |
|---|---|---|
| 0 | zwei übernommene Kategorie-Regeln des Anbieters | setzen nur Flags, **kein** `stop` |
| 1 | Empfängeradresse **nicht** in der Liste angelegter Adressen | `Fremd` |
| 2 | Absender-Domain **und** Betreff-Muster | `Belege` (+ Keyword) |
| 3 | `List-Id` oder `List-Unsubscribe` vorhanden | `Listen` |
| 4 | `Auto-Submitted`, `Precedence`, No-Reply-Absender | `Systempost` |
| 5 | kein Treffer | bleibt in `INBOX` |

Drei Konstruktionsregeln, die auch für ein Plugin gelten, das je Regeln anfasst:

1. **`envelope` statt `To:`-Header.** Bei aktivem Catch-All ist der `To:`-Header nicht die
   Zustelladresse — bei einer BCC-Mail steht dort eine fremde. Eine Regel auf `to` wäre blind
   für genau den Fall, gegen den sie schützt.
2. **`addflag`, niemals `setflag`.** `setflag` ersetzt *alle* Flags und löscht damit die Flags
   der anderen Regeln.
3. **Kein `discard`, nirgends.** Filter verschieben, sie vernichten nicht.

Zur Regel 2 ein Befund, der auch für Plugin-Heuristiken zählt: Sie verknüpft Absender **und**
Betreff, nicht *oder*. Gemessen wären von den Beleg-Treffern im Posteingang über 90 % sonst als
Post von Menschen dort liegengeblieben — eine Betreff-Heuristik allein hätte also den Normalfall
falsch behandelt, nicht einen Randfall. Wer über Betreff-Muster klassifiziert, sollte das wissen.

### Der ManageSieve-Befund

**Der Login auf Port 4190 funktioniert mit einem App-Passwort** (gemessen, `AUTH: OK`). Das
Regelwerk ist damit maschinell les- und schreibbar, und die versionierte Quelldatei ist die
Wahrheit — der Server bekommt eine Kopie. Ein Plugin *könnte* das Regelwerk also lesen und
anzeigen. Falls ihr das je baut: dieselbe Linie wie bei `calendar-notes` — Server ist SSOT,
Notiz ist Spiegel, Schreiben nur über ein explizites Kommando, nie durch Editieren einer Notiz.

Zwei Randbedingungen dazu: Ein App-Passwort kennt nur die Berechtigungen **IMAP** und **SMTP** —
ManageSieve fällt offenbar unter IMAP, eine eigene Option gibt es nicht. Und der Anbieter kennt
genau **ein aktives Skript**; ein zweites zu aktivieren deaktiviert das erste. Wer dort schreibt,
verdrängt also, was vorher galt.

### Was hier bewusst nicht steht

Keine realen Absender-Domains, keine Adressen, keine Dienste-Kennungen — auch nicht die
Beleg-Absenderliste. Dieses Repo wird öffentlich; die Werte stehen im Arbeitsordner und im
Vault. Falls ihr für einen Test konkrete Muster braucht, fragt nach, statt zu raten.

---

## Zwischenstand aus Teilprojekt ④ (2026-08-23) — betrifft eure Terminplanung

**Kurz: Die Scheduling-Frage verschiebt sich, euer Transport-Vertrag bleibt vorerst gültig.**

Der Plan sah vor, früh in ④ zu klären, ob der DAV-Server Einladungen selbst verschicken kann
(RFC 6638, `schedule-outbox-URL`). Fällt die Antwort positiv aus, bräuchte `calendar-notes`
euren Mail-Transport für iTIP-Einladungen **nicht** — dann wäre ein ganzer Vertrag zwischen den
beiden Plugins gegenstandslos.

**Diese Klärung ließ sich nicht vorziehen.** Der DAV-Endpunkt des Anbieters nimmt **kein
App-Passwort**; er verlangt das Kontopasswort (gemessen und durch die Anbieter-Anleitung
bestätigt). Jede Discovery-Messung braucht aber einen Login. In der Betriebs-Session wurde
entschieden, dafür kein zweites Depot für ein Notfall-Credential anzulegen — die Erhebung wird
nachgeholt, sobald der DAV-Zugang regulär eingerichtet ist.

**Für euch heißt das:**

- **Baut den iTIP-Transport weiter.** Er ist nicht abbestellt, nur noch nicht bestätigt.
- Eine Antwort ist realistisch in einigen Tagen zu erwarten, nicht heute.

### Euer App-Passwort — Stand

Noch nicht angelegt, und das ist Absicht: Der Anbieter zeigt jeden Wert **genau einmal** an.
Ein Passwort auf Vorrat erzwänge eine Zwischenlagerung, und die ist für Maschinen-Credentials
ausgeschlossen. Es entsteht, sobald das Plugin eine Stelle hat, die den Wert entgegennimmt
(`app.secretStorage`) — der Nutzer trägt ihn dann selbst ein, weder wir noch ihr bekommen ihn
zu sehen.

**Was unverändert gilt:** Bis zum **2026-09-05** steht die Domain-Policy auf `quarantine` — ein
fehlgeschlagener Versandtest landet dann beim Empfänger im Spam statt abgewiesen zu werden.
Das ist das günstigere Testfenster.

---

## Stand nach ④ (2026-08-27) — euer Passwort liegt vor, beide Rollen sind belegt

**Das ersetzt den Abschnitt „Euer App-Passwort — Stand" von 2026-08-23.**

**Das App-Passwort für das Plugin existiert** und ist mit IMAP **und** SMTP berechtigt. Der
Nutzer hat den Wert selbst eingetragen; weder wir noch ihr haben ihn gesehen — so war es
vereinbart und so ist es geblieben.

Wir haben die Bedingung dafür nicht aus eurer Meldung übernommen, sondern nachgeprüft: Es gibt
die Stelle im Code, die den Wert entgegennimmt, und die Oberflächentexte nennen den
Secret-Storage der Anwendung statt der Plugin-Konfigurationsdatei. Dieselbe Regel wie überall
in diesem Vorhaben — eine Meldung aus einer anderen Sitzung ist ein Hinweis, ein Messwert ist
etwas anderes.

**Beide Identitäten sind nachweislich sendefähig.** Je eine Testmail aus der privaten und aus
der öffentlichen Rolle wurde von einer **externen Gegenstelle** geprüft und bestätigt:

| Prüfung | Ergebnis |
|---|---|
| `spf` | `pass` |
| `dkim` | `pass`, `header.d` = die eigene Domain, Selector wie in der Betriebsdoku |
| `dmarc` | `pass` |
| Absender | die jeweils gewählte Rolle — nicht beide Male die private |

Die öffentliche Rolle wurde vom Empfänger in den **Posteingang** gelegt, nicht in den Spam. Unter
der derzeit laufenden Policy ist das die aussagekräftige Probe. Belegt wurde das über einen
Desktop-Client; die Einrichtung des Mobilgeräts steht noch aus, ändert an der Aussage aber
nichts — geprüft wurde die Absenderkette, nicht das Gerät.

**Damit ist eure Vorbedingung erfüllt:** Der Punkt „kein Test gegen das echte Konto möglich, bis
④ das App-Passwort liefert" ist aufgehoben. Ihr könnt gegen das echte Konto testen.

### Das Zeitfenster, in dem ein Fehlschlag billig ist

| Zeitraum | Policy | Was ein fehlgeschlagener Versandtest kostet |
|---|---|---|
| **bis 2026-09-05** | `quarantine` | Die Mail landet beim Empfänger im Spam. Sichtbar, aber folgenlos. |
| danach | `reject` | Dieselbe Mail wird endgültig abgewiesen — der Fehlschlag kostet eine echte Nachricht. |

Das ist keine Warnung, sondern eine Preisangabe: **Wer vor dem 5. September testet, testet
billiger.** Die Verschärfung ist beschlossen und terminiert; sie wird nicht für einen Test
verschoben.

### Was weiterhin offen ist

Die Scheduling-Frage (C9) ist unverändert offen — dieselbe Ursache wie am 2026-08-23: Der
DAV-Endpunkt verlangt das Kontopasswort, und die Erhebung wandert deshalb hinter die reguläre
Einrichtung des DAV-Zugangs. **Euer iTIP-Transport-Vertrag bleibt bis dahin gültig.** Baut ihn
weiter.
