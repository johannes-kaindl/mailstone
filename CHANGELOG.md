# Changelog

## Unreleased

### M2 — Transport (2026-08-23)
- SMTP-Client (`core/smtp/client.ts`): EHLO/AUTH/MAIL/RCPT/DATA, `smtpProbe` für den Verbindungstest
- `tls-transport.ts`: echter Node-TCP/TLS-Socket hinter `Platform.isDesktop`, STARTTLS-Upgrade mit
  aktiver Zertifikatsprüfung, Connect-Timeout, `close()` mit Fallback auf `destroy()`, Schutz vor
  STARTTLS-Buffer-Injection (CVE-2011-0411-Klasse)
- `SendService` + iMIP-Anbindung (`core/send/service.ts`, `core/send/imip.ts`): Konto-/Identitäts-
  Auflösung, MIME-Bau, Versand über den Socket-Transport, `tls-required`-Guard vor jedem Connect
- Konten-UI (`AccountModal`, deklarativer Settings-Tab): IMAP/SMTP/Identitäten/Ordner/Sync, Secrets
  über `SecretComponent` (nie in `data.json`), Verbindungstest
- calendar-notes-Brücke (`calendar-notes-bridge.ts`): registriert mailstone als `MailTransport` an
  der öffentlichen API des Nachbar-Plugins, robust gegen Ablehnung/Exceptions/Nachbar-Reload
- Fake-SMTP-Server + Integrationstest (`tests/integration`) gegen den echten Transport
- Sicherheits-Härtungen: STARTTLS-Buffer-Injection-Schutz, Connect-Timeout, symmetrischer
  `tls-required`-Guard vor jedem Verbindungsversuch (Service UND Konto-Test), strengere
  `repairAccount`-Validierung (tls/port)

### M1 — Gerüst + Formate (2026-08-23)
- Repo-Gerüst aus calendar-notes (Gate, Vendor-Kit, esbuild-Builtin-Plugin, Lint 0 Warnings, check:pure)
- `.eml` → `ParsedMail` (postal-mime), synthetischer Fixture-Korpus
- Rendering Mail → Markdown/Frontmatter/Dateiname (turndown, Mapping-Profil)
- Merge-Regeln für Re-Render: Fences, Zone-Hash, abgeleitete Keys zeilenweise in-place, melden statt überschreiben
- MIME-Builder für Versand (QP, RFC 2047, multipart/alternative + text/calendar), Header-Injection-Härtung
- Settings (Konten/Identitäten/Profil), NotePlan + Vault-Executor, Kommando „Import .eml files from a vault folder", deklarativer Settings-Tab, i18n EN/DE
- minAppVersion 1.13.0
