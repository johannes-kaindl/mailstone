# Changelog

## Unreleased

### M1 — Gerüst + Formate (2026-08-23)
- Repo-Gerüst aus calendar-notes (Gate, Vendor-Kit, esbuild-Builtin-Plugin, Lint 0 Warnings, check:pure)
- `.eml` → `ParsedMail` (postal-mime), synthetischer Fixture-Korpus
- Rendering Mail → Markdown/Frontmatter/Dateiname (turndown, Mapping-Profil)
- Merge-Regeln für Re-Render: Fences, Zone-Hash, abgeleitete Keys zeilenweise in-place, melden statt überschreiben
- MIME-Builder für Versand (QP, RFC 2047, multipart/alternative + text/calendar), Header-Injection-Härtung
- Settings (Konten/Identitäten/Profil), NotePlan + Vault-Executor, Kommando „Import .eml files from a vault folder", deklarativer Settings-Tab, i18n EN/DE
- minAppVersion 1.13.0
