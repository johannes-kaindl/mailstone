# M1 — Nachlese (Deferred-Punkte aus Task-Reviews und Final-Review)

**Stand:** 2026-08-23, nach Merge `af6de62`. Quelle: SDD-Ledger (gelöscht nach Abschluss). Nichts hiervon blockiert M2; jeder Punkt nennt, wo er hingehört.

| # | Punkt | Wohin |
|---|---|---|
| 1 | `wrapBlock` (fences.ts) fügt die Zone mit LF ein, auch in einer CRLF-Notiz — Frontmatter-Rewrite ist EOL-treu, die Zone nicht | M3 (Sync schreibt unbeaufsichtigt): EOL aus der Notiz übernehmen |
| 2 | Kommando-Name wechselt die Sprache erst nach Neustart (`addCommand` liest `t()` einmal); Kommentar in settings-tab.ts überclaimt | M2 Settings-Arbeit: Kommentar korrigieren; Neustart-Hinweis im Sprach-Dropdown |
| 3 | `encodeHeaderWord` erzeugt EIN encoded-word — lange Nicht-ASCII-Betreffs überschreiten RFC-2047 (≤ 75) / RFC-5322 (≤ 78) | M2 (Versand real): in mehrere encoded-words splitten + Test |
| 4 | `invite.ics` wird immer angehängt, Typ `application/ics` statt `text/calendar`; Spec sagt optional | M2 Smoke gegen echten Empfänger (Apple/Google/Thunderbird) entscheiden |
| 5 | `ensureFolder` prüft Präfixe doppelt und kann mit nebenläufig erzeugtem Ordner rennen | M3 (Sync + Kommandos parallel): `createFolder` in try/catch „already exists" |
| 6 | `splitReferences`: `.trim()` ist inert (Regex schließt Whitespace aus) | Kosmetik, nächste Berührung von headers.ts |
| 7 | Kein isolierter Test „leere Message-ID → throw"; `/` im Token-Zeichensatz von `sanitizeAttachmentType` (durch `type/subtype`-Form begrenzt); Boundary-Seed aus roher messageId (kein Header-Pfad) | Kosmetik/Tests, M2 |
| 8 | `mergeNote`: managed Key, der in `derived` fehlt, bleibt unverändert — gepinnt per Test (Ruling: gewollt) | erledigt, nur Hinweis |
| 9 | `profile.onCreate` wird ersetzt statt gemerged (Ruling: gewollt — Nutzer darf `type` weglassen) | erledigt, nur Hinweis |
| 10 | `getControlValue`/`setControlValue` if/else-Kette im Settings-Tab wächst mit M2 | M2: Lookup-Tabelle beim Konten-Ausbau |
| 11 | Vault-Schema-Seite (Typ `mail` in `_types/`, Linter-Ausnahme für `Mail/`, `.eml` aus Vault-Git) ist Vault-Arbeit, nicht Plugin | Maintainer, vor M3-Nutzung im Pallas-Vault |
| 12 | GUI-Probe lief per Hand-CDP (Protokoll in `docs/SMOKE.md`); getrackter Treiber fehlt | M4 (Skill `gui-smoke-setup`), Staging-Vault `$STAGING_VAULTS_DIR/mailstone` existiert bereits |
