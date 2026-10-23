# AGENTS — mailstone

## Project character

Mail als Vault-Notiz: ein **Server-Ordner** entscheidet als Allowlist, was Notiz wird; die
Message-ID ist die Identität, das `.eml` liegt als Treuefläche daneben. Dazu SMTP-Versand, den
`calendar-notes` als iMIP-Transport registriert. Specs und Pläne liegen im Vault-Cockpit unter `_SDD/` (CORE-META-14), z. B. `_SDD/2026-08-23-mailstone-design.md`; Handproben-Protokoll `docs/SMOKE.md`.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in
> `_docs/CONVENTIONS.md` im Multi-Projekt-Workspace des Maintainers, `../../workspace/_docs` relativ zu
> diesem Repo — nicht Teil dieses Repos, ignorieren falls im Klon nicht vorhanden. Modell
> comply-or-explain.

## Architecture principles

- `src/core/**` ist obsidian-/DOM-/node-frei (`npm run check:pure` verbietet dort auch
  `process` und `window`). Sockets, Dateisystem und Secrets werden aus `src/obsidian/**`
  hineingereicht.
- Kit-Module nur über `npm run kit:sync` (Herkunfts-Header + `VENDOR.json`), nie von Hand:
  `src/vendor/kit` (obsidian-kit, pur), `src/vendor/kit-obsidian`, `src/vendor/code-kit`.
- **Netzwerkfunktionen (Sync, Versand, Posteingang) laufen nur am Desktop:** `node:tls`/`node:net` kommen per dynamischem Import aus `src/obsidian/tls-transport.ts`, ein `Platform.isMobile`-Guard (`networkFeaturesAvailable` in `src/main.ts`) hält Befehle und Tabs auf Mobile aus. Das Plugin selbst lädt mobil (`isDesktopOnly: false`) und zeigt dort nur bereits synchronisierte Notizen. `src/obsidian/node-sockets.d.ts` ist bewusst kein Modul.

## Commands

```bash
npm run gate                       # das VOLLE Gate: Lint, drei Typprüfungen, Unit, Integration, check:pure, Build, Bundle-Test
npm test                           # nur Unit (ohne tests/integration)
npm run test:integration           # Integrationstests (Fake-IMAP, Fake-SMTP)
npm run kit:sync                   # Kit-Module vendoren (tools/sync-kit.sh → zentrales kit-sync im Dach)
npm run smoke:gui -- --port <port> # GUI-Smoke in einer Zweitinstanz (Port Pflicht), Protokoll docs/SMOKE.md
npm run smoke:e2e                  # Naht gegen ein echt installiertes TaskNotes (nicht Teil des Gates)
npm run shots -- --setup           # Staging-Vault für die README-Bilder aus dem Fixture bauen
npm run shots -- --port <port>     # README-Bilder in einer Zweitinstanz aufnehmen (Vertrag docs/images/README.md)
npm run shots:check                # Vertrag ↔ Dateien ↔ README-Einbettungen abgleichen
npm run deploy                     # build + nach $OBSIDIAN_PLUGIN_DIR kopieren
npm run release                    # nur der Master (CORE-AGENT-14), nach Freigabe von Johannes
```

## Conventions

- `eslint.config.mjs`, `scripts/check-no-inline-disables.mjs` und
  `scripts/check-no-abs-paths.mjs` sind byte-identische Template-Kopien (Dach
  `tools/release-template/` bzw. `_docs/templates/scripts/`) — Änderungen gehören in die Quelle.
- **`.github/workflows/release.yml`** ist ebenfalls eine byte-identische Template-Kopie (`tools/template_drift_check.py` bewacht sie). Releases fährt der Master über `npm run release` (CORE-AGENT-14); Regeln: `../.claude/rules/release-und-store.md`.
- **Volles Gate ist `npm run gate`**, und es ist mehr als `typecheck`: Lint, drei Typprüfungen,
  Unit, **Integration**, `check:pure`, Build und ein Bundle-Test. Wer nur `npm test` fährt,
  sieht die Integrationstests nicht — durch genau diese Lücke lag ein Bruch tagelang auf `main`.
- **Nutzer-Doku:** `docs/README.md` ist der Doku-Index (Diátaxis, nur Quadranten mit Inhalt), `docs/getting-started.md` und `docs/how-to/troubleshooting.md` sind die zwei Pflichtteile; alles andere unter `docs/` (`SMOKE.md`, `internal/`) ist Maintainer-Material und wird aus der README nicht verlinkt. Die Symptomtexte im Troubleshooting sind wörtliche Strings aus `src/i18n/strings.ts`: wer dort einen Text ändert, zieht die Doku mit (CORE-META-18). Die README-Bilder entstehen mit `npm run shots` in einer Zweitinstanz (Vertrag `docs/images/README.md`); zwei Dinge daran sind gesetzt statt gemessen (Konto und Laufzustand im Seitenpanel), weil ein Sync ein echtes Postfach braucht.

## Gotchas

**Ein Sync-Lauf darf `\Seen` nie setzen.**

Lesende Pfade nutzen `EXAMINE` und `BODY.PEEK[…]`, nie `SELECT` oder `BODY[…]`. Das ist ein
Vertrag gegenüber dem Postfach des Nutzers, kein Implementierungsdetail: eine Mail, die
mailstone gespiegelt hat, muss im Mailprogramm weiterhin ungelesen aussehen — im Ordner
`Belege` steuert ein anderer Abholer (paperless-ngx) über genau dieses „ungelesen".

**Seit M4 ist der Client nicht mehr rein lesend, sondern in zwei Typen geteilt** — und die
Grenze bewacht der Compiler, nicht die Aufmerksamkeit eines Reviewers:

| Einstieg | Typ | Kann | Wer nimmt ihn |
|---|---|---|---|
| `imapConnect` | `ImapReadSession` | `examine`, `uidSearchAll`, `uidFetchMessageIds`, `uidFetchHeaders`, `uidFetchBody`, `append` | Sync, Inbox-Liste, Sent-Kopie (`src/core/send/service.ts`) |
| `imapConnectWritable` | `ImapWriteSession` | zusätzlich `select`, `uidMove` | **nur** `src/core/inbox/actions.ts` |

Die Pfade, Typen und der Test dazu: `.claude/rules/imap-vertrag.md`.

- **`SecretComponent` bindet eine Schlüsselbund-ID, nie ein Passwort.** `onChange` liefert die ID des Eintrags; gespeichert wird `account.secretId`. Ein verwaister Eintrag nach „Abbrechen“ wird bewusst nicht aufgeräumt. Mehr: `.claude/rules/secrets.md`.
- **Ein Fehlschlag der Sent-Kopie ist kein Fehlschlag des Versands:** `send()` bleibt `ok: true`, der Ausgang steht getrennt als `sentCopy`. Mehr: `.claude/rules/smtp-versand.md`.
- **Anhänge werden nach Index adressiert, nicht nach Namen,** und ein zweiter Extrakt verlinkt eine byte-gleiche Datei statt zu kopieren. Mehr: `.claude/rules/anhaenge.md`.
- **Dieses Plugin ruft `api.tasks.create` am Fremdplugin TaskNotes** (von Johannes 2026-09-05 entschiedene Abweichung von der Dach-REGISTRY), und seine Versand-API hat ein Zustimmungs-Tor. Bevor du diese Stellen anfasst: `.claude/rules/tasknotes.md` und `.claude/rules/versand-api.md`.

## Context index

- Bevor du IMAP-Client, Sync oder Posteingangs-Aktionen (`src/core/imap/`, `src/core/sync/`, `src/core/inbox/`) änderst: `.claude/rules/imap-vertrag.md`.
- Bevor du das Konten-Modal oder den Umgang mit Schlüsselbund-Einträgen änderst: `.claude/rules/secrets.md`.
- Bevor du Versand oder Sent-Kopie (`src/core/send/`, `src/core/smtp/`) änderst: `.claude/rules/smtp-versand.md`.
- Bevor du MIME oder Anhänge (`src/core/mime/`, `src/core/commands/extract.ts`) änderst: `.claude/rules/anhaenge.md`.
- Bevor du die TaskNotes-Brücke oder `mail.createTask` änderst: `.claude/rules/tasknotes.md`.
- Bevor du `plugin.api`, die Vertrauensliste oder die Bestätigung änderst: `.claude/rules/versand-api.md`.
- Bevor du den GUI-Smoke oder den E2E-Lauf fährst oder änderst: `.claude/rules/gui-smoke.md`, `docs/SMOKE.md`, `../.claude/rules/gui-smoke-treiber.md`, `../.claude/rules/obsidian-instanz.md`, `../.claude/rules/cdp-lock.md`, `../.claude/rules/staging-vaults.md`.
- Bevor du README-Bilder aufnimmst: `docs/images/README.md`, `../.claude/rules/readme-shots.md`, Skill `readme-shots`.
- Bevor du eine Entscheidung „bewusst so“ übernimmst: `docs/internal/decisions.md`.
- Bevor du `styles.css` oder UI änderst: `../.claude/rules/store-css.md`, `../.claude/rules/ui-bausteine.md`, `../UI-STANDARD.md`.
- Vor einem Release oder einer Store-Einreichung: `../.claude/rules/release-und-store.md`, Skills `plugin-release-setup` und `store-rescan`.
- Dach-Regeln gelten: `../AGENTS.md` (Kit-first, Release über `../tools/release/`, Store-Flow, CDP-Lock vor jedem Zugriff auf ein laufendes Obsidian).

## Memory

- Specs und Pläne liegen im Vault-Cockpit unter `_SDD/` (CORE-META-14, maintainer-lokal), das Repo behält die Essenz in `docs/internal/decisions.md`.
- Projekt-Memory unter `~/.claude/projects/<slug>/memory/` mit `MEMORY.md`-Index.

## Abweichungen von der Leitkonvention

Keine.

## UI-Abweichungen

Deklaration nach `UI-STANDARD.md` §1a — von einem verbindlichen §8-Baustein abzuweichen ist
erlaubt, stillschweigend abzuweichen nicht.

- **endpoint-list** — Grund: `taskPresetGroup` in `src/obsidian/settings-tab.ts` ist ein
  schlichter Schlüssel/Wert-Editor für `taskPreset` (zwei Textfelder je Zeile), keine
  Provider-Endpunkte. Der Kit-Baustein `buildEndpointList` ist auf Endpunkte zugeschnitten (URL +
  Schlüssel + Modell-Dropdown + Probe + Presets) und in mailstone nicht vendort — ihn für zwei
  Textfelder zu importieren wäre semantisch falsch und zöge unbenutzten Ballast (Modell-Cache,
  Erreichbarkeitsprobe) mit. Struktur ist trotzdem dieselbe native `SettingDefinitionList`
  (Add/Delete, `emptyState`) wie bei den Konten, nicht neu erfunden.
  gilt-solange: `src/obsidian/settings-tab.ts` enthaelt-nicht `from "../vendor/kit-obsidian/endpoint-list"`.
