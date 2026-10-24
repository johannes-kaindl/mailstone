# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Security

- **The `.eml` parser is updated to postal-mime 4.1.4** (3.0.0 → 4.1.4) and closes the advisory GHSA-f2hq-32vh-53cc: a header with very many joinable RFC 2047 base64 words made decoding take quadratic CPU time, so a crafted mail could freeze Obsidian while it was imported. Importing mails works as before; the unit, integration and bundle tests pass with the new version.

### Fixed

- **A mail note with an empty front matter block (`---` directly followed by `---`) now gets its state written.** When a mail moves between live and detached, the plugin used to refuse such a note as unreadable; it now writes the state field into the empty block. The sync itself still refuses an empty block when it merges a mail into a note.
- **A state field with a non-ASCII name (for example `zustand-ä`) is no longer appended again on every run.** The line-by-line writer does not recognise such a name, so it added a new line each time; it now falls back to Obsidian's own front matter API, which writes the field once.

### Changed

- **Relink reports a note whose front matter has a key with a non-ASCII character as skipped** (`frontmatter-unparseable`) instead of silently leaving that key out. A value with a line break is reported the same way. In practice neither occurs with mailstone's own fields.
- Internal: the two line-by-line front matter writers (`setFrontmatterField`, `mergeFrontmatterOnly`) now sit on the kit's `patchFrontmatter`; the sync merge (`mergeNote`) keeps its own writer for now.
- Internal housekeeping: the shared kit libraries were updated (obsidian-kit 0.67.1, code-kit 0.36.0). None of the modules mailstone uses changed in behaviour, and the folder test of the `.eml` import reads exactly as before (the stricter file-system reading of code-kit 0.33.0 and 0.36.0 is opt-in). The new kit module `frontmatter-patch` is vendored but not used yet.

## [0.9.1] — 2026-10-18

### Changed

- Internal housekeeping: the shared kit libraries were updated (obsidian-kit 0.63.0, code-kit 0.31.0). The changes in between (a copy button on the thinking block, a text-area suggester, Claude as a language-model provider, LM Studio detection from model metadata, kit texts for image, OCR and audio errors) touch no part this plugin shows; what changes visibly for you is listed separately.
- The README no longer says the Community Plugins listing is pending review; it is listed, and the install text now starts there.
- **The `.eml` import accepts a folder name with a trailing slash** (`Import/`), and a single `.eml` path as before. Before, `Import/` found nothing. An empty folder name still imports nothing.
- Internal, no visible change: the managed-block split (`%% mailstone:begin/end %%`), the command-input check (including the “no options / one option” rules for the form) and the folder test of the import now come from the shared kit instead of local copies. A note whose block has a begin marker but no end marker is still left alone (“fences missing”); the last end marker still closes the block.

## [0.9.0] — 2026-10-16

### Added

- **Mail notes now carry a `richtung` field (`eingehend` or `ausgehend`).** It is `ausgehend` when the sender is one of your own identities (any account, case and display name ignored) and `eingehend` otherwise, so a mail note fits the same tables as a communication note. Only the sender counts: a mail to your own address stays incoming. New notes get it with the next sync or import; existing notes get it when you run *Re-render* on them. The field name can be changed or switched off in the profile like the other fields, and a hand edit of the value is overwritten by a re-render.

## [0.8.0] — 2026-10-14

### Fixed

- A mail without a subject can now be sent; before, the plugin asked for confirmation and then failed (an empty subject is allowed by the mail standard).
- The accounts list says “1 identity” instead of “1 identities” (and “1 Identität” in German).
- The inbox says “No account yet” with the settings button when no account is set up, instead of “No messages in this folder”.

### Changed

- Internal housekeeping only, nothing changes for you: the shared kit libraries were updated (obsidian-kit 0.57.0, code-kit 0.24.0), the sync busy-guard, the Node-builtin build helper and the test timer shim now come from the shared library. The built plugin file is byte-identical to the one before this change.
- Internal housekeeping, almost nothing changes for you: the shared kit libraries were updated again (obsidian-kit 0.60.1, code-kit 0.27.1); local date and time and the file-name slug now come from the shared library. One visible difference, for new mails only: a subject with `™` or `Ⅳ` keeps its letters in the file name (`Co™` gives `cotm`, before `co`) and a capital `ẞ` becomes `ss` (before it was dropped). Existing notes are not renamed.
- New mail notes get their headings (“Notes”, “Message”) in the language of the interface instead of always German. Existing notes keep the headings they have; nothing is rewritten.
- The “Notes folder” and “Debug log” descriptions are accurate now (the year subfolder depends on its own switch; the debug log needs a reload to change).
- The calendar-notes link now accepts either `apiVersion` or `version` from calendar-notes' plugin API (same number), so newer and older calendar-notes versions both keep working for invitations.

## [0.7.2] — 2026-10-03

### Added
- The GitHub release now also carries a ready-to-unpack `mailstone.zip` (the plugin folder with `main.js`, `manifest.json` and `styles.css`) and a `checksums.sha256`. For a manual installation, download the zip and unpack it into `.obsidian/plugins/` instead of creating the folder yourself and saving three files one by one.

### Changed

- The changelog is now written entirely in English.
- Internal design notes moved out of the repository; the user documentation is unchanged.

## [0.7.1] — 2026-09-26

### Changed
- Internal: kit vendoring now runs through the central workspace tool (`tools/kit-sync.json`; `tools/sync-kit.sh` is just a call). All vendored files are byte-identical, nothing changes for users.

## [0.7.0] — 2026-09-26

### Added
- Help row at the top of the settings with links to the documentation and the issue tracker (English and German).

## [0.6.1] — 2026-09-26

### Documentation
- **README (EN/DE) rewritten to the workspace standard.** The "0.3.0" status and the statements "desktop only" and "not in the Community Store" were outdated; installation paths (Community Plugins, Sideloader, manual, BRAT, source), the mobile read mode and the configuration tables (account and global, with defaults) are now included, all links absolute on GitHub.
- **User documentation under `docs/`:** index organised by Diátaxis, "Getting started" (from installation to the first mail note, with `.eml` import without an account) and "Troubleshooting" (the messages verbatim, cause, remedy; offline behaviour and mobile limits).
- **Five README images** together with a recording contract (`docs/images/README.md`), fixture and recipe (`npm run shots`); `LICENSE-DOCS` added.

## [0.6.0] — 2026-09-24

### Added
- **Read mode on mobile.** `isDesktopOnly` is now `false`: mail notes that have already been
  synced are readable on mobile like any other Markdown note, and the overview (cockpit) and
  the TaskNotes link stay active. Sync, sending (test mail) and the inbox tab
  (live-reading IMAP browsing) need the socket layer, which does not load on mobile — their
  commands/tabs/buttons therefore stay off, and a hint text replaces them. On mobile, the settings
  show the time of the last successful desktop sync. No editing,
  no merge path — both remain a later stage, once a concrete mobile case
  calls for it (decision by Johannes, 2026-09-16/17).
- **New setting "Allowed values on creation".** On load, the values in the
  `onCreate` frontmatter (e.g. `type: mail`) are checked against a plugin-specific list that is
  configurable in the settings (default: `mail`). A value outside the list is not
  silently discarded but reset to the default and reported with a notice

### Changed
- **`authorUrl` in the manifest points to the GitHub profile again** (`https://github.com/johannes-kaindl`) — return to the Community Store.
- **Kit pin on `obsidian-kit` 0.36.2 / `code-kit` 0.6.0.**
- **Kit pin on `obsidian-kit` 0.37.1.** Additionally vendored: the keychain module
  (`src/vendor/kit/secrets.ts` + `src/vendor/kit-obsidian/secrets.ts`) replaces the
  own copy. Visible behaviour changes (CORE-META-21): a password with a
  trailing line break (the typical `pbcopy < file` leftover) is now cleaned before
  saving; an empty keychain secret now returns `null` instead of an
  empty string — sync and sending correctly report "no secret" instead of
  attempting a login with an empty password; removing an account now calls `delete()`
  instead of `set(id, "")` (technically the same effect with the Obsidian keychain, since the
  API has no real delete).
- **C0 guard retrofitted** (`scripts/check-no-nul-bytes.mjs`, wired into `check:pure`).

## [0.5.0] — 2026-09-07

### Added
- **Other plugins can send mail through mailstone.** The first time, a dialog asks
  and shows sender, recipient, subject and the full text; anyone who chooses *Send and always allow*
  is not asked again for that plugin. The permissions are listed in the
  settings and can be revoked individually. Without an answer, the dialog closes after one
  minute **without** sending
- **The sender is fixed at approval, not by the calling plugin.** A plugin
  can suggest an address; it is decided in the dialog, and from then on the remembered one applies —
  a later suggestion does not change that
- **The previous path stays unchanged:** calendar invitations from `calendar-notes` keep working
  as before and do not trigger a dialog

### Changed
- **GitHub is abandoned — distribution goes through Forgejo and the plugin catalog.** The
  `github` remote is removed and `npm run release` runs with `--no-github` fixed. Nothing
  changes for users: the recommended path (AnySource Sideloader with the subscribed catalog) and
  the download from `git.jkaindl.de` were already the only ones that worked. The
  GitHub mirror answered anonymously with 404 and was no longer being updated anyway
- **The provenance link to `obsidian-kit` in `THIRD-PARTY.md` pointed nowhere** (to a
  GitHub profile that answers with 404, and even there to the profile instead of the repo). It
  now points to `git.jkaindl.de/jkaindl/obsidian-kit`

## [0.4.1] — 2026-09-05

### Fixed
- **Extracting the same attachment twice no longer creates a second file.** If a
  **byte-identical** file already exists at the target name, it is linked instead of copied. The bytes are compared,
  not the file name — two attachments of the same mail with the same name but different content
  both remain extractable
- **A form without a selectable option no longer opens at all.** If the frontmatter listed
  attachments that the `.eml` no longer contains, a dropdown without an entry appeared, and every
  attempt to submit failed with a technical message; cancelling was the only way out.
  Now a message explains the reason before the form appears
- **Wikilinks are no longer built when they do not hold up.** A note name containing `#`, `|`,
  `[`, `]` or `^` produced a link that pointed to something else. Such targets now
  stay as a plain message ID — affects `mail.relink` and the re-derivation on re-render
- **`mail.relink` shows skipped notes instead of silently leaving them out.** A
  note with unreadable frontmatter or without a managed zone now appears in the
  final message as skipped
- **An unbalanced opening `[` in a server response no longer loses the rest of the
  response.** Affected servers that send a keyword flag with a square bracket — allowed
  under RFC 3501. Previously all following fields of the same response were lost

### Changed
- **A form without a real choice no longer appears.** If a mail has exactly one attachment,
  `mail.extractAttachment` no longer asks — there was nothing to choose. The preview
  still confirms as before; only a click without content is gone

### Internal
- `mail.rerender` no longer resolves attachment paths it never uses (one vault access per
  attachment and run saved)
- The GUI smoke driver exits after an abort instead of hanging on the open debug socket
- 685 → 715 unit tests

## [0.4.0] — 2026-09-05

### Added
- **Create a task from a mail (M5).** From a mail note or directly from the inbox,
  a task can now be created in the neighbouring plugin TaskNotes (`mail.createTask`), with
  a wikilink back to the mail. Only available with TaskNotes installed and enabled;
  without TaskNotes, `taskPreset` (see below) remains the way to get queryable extra fields
- **`taskPreset` revived — the path without TaskNotes (M5 § 5).** In the settings you can now
  enter extra fields (e.g. `status: open`) that are written into the frontmatter once, when a
  mail note is FIRST created — queryable in Obsidian Bases.
  Existing notes stay untouched, and a value once changed by the user is never
  overwritten again. No task system, no logic on top of it

### Documentation
- **German README** (`README.de.md`), badge row in both versions
- **The installation path pointed nowhere.** It named the Community Store, from which this plugin
  cannot be obtained, and linked the GitHub mirror, which answers anonymously with 404.
  Both replaced: the AnySource Sideloader with the plugin catalog is recommended, alongside the
  download from `git.jkaindl.de` and building from source

### Fixed
- **A note with Windows line endings keeps them.** The sync always wrote the managed zone
  with `LF`, while the frontmatter took over the note's line ending — in a CRLF note
  a run therefore mixed both. The zone comparison now explicitly ignores line endings,
  otherwise the same change would have reported every such note as "changed by hand" on the next
  run
- **A folder that a parallel operation is just creating no longer makes the sync fail.**
  A second write fits between "does the folder exist?" and "create it"; its success
  is no longer an error, a real folder error remains one
- **A note's state change now writes only the one line it means.** Previously it went
  through Obsidian's `processFrontMatter`, which reads the frontmatter as YAML and rewrites it
  completely: custom fields lose their formatting (`to: [address]` becomes a
  block list) and **YAML comments disappear entirely**. Anyone who maintains
  custom fields in the frontmatter of a mail note now keeps them unchanged

### Internal
- The read-only contract of the sync run (`EXAMINE` + `BODY.PEEK`, never `SELECT` or `BODY[]`) is
  now verified over a real socket: the fake IMAP server logs every received
  command line, and the integration test checks the whole dialog of a run for the **absence**
  of the forbidden forms — not just the calls for which a unit test exists today
- The writing path (`Adopt` → `SELECT` + `UID MOVE`) has its first integration test.
  The fake announces `MOVE`/`UIDPLUS` only **after** login and thus drives exactly the
  server design because of which the capabilities are read a second time

## [0.3.0] — 2026-09-03

### Inbox — review and adopt mail without leaving the vault (2026-09-03)
- New **Inbox** tab next to the cockpit, in the same view: the latest 100 messages
  from `folders.inbox` with sender, subject, date and a checkmark for everything that is already
  a note in the vault. Unread messages are shown in semi-bold
- **"Adopt into vault"** moves the mail server-side into the allowlist folder; the note
  is then created by the regular sync run, not by the action itself. **"Archive"**
  moves it to the archive folder. Both only after confirmation — none of this can be
  undone on the server
- The "is in the vault" badge is an **exact** match, not a heuristic: the message ID from the
  list goes through the same normalisation as the one in the sync path, and both sides of the comparison
  are normalised
- The list refreshes when the tab is opened, via a button and after every sync run. Switching
  tabs keeps scroll position and state — the panels stay mounted and are only
  hidden
- Without an account or without messages, a statement with an offered action appears instead of an
  empty area. If a server cannot move safely, the buttons stay visible but
  disabled and state the reason — instead of disappearing without a word

### The read-only contract opens — in exactly one place, guarded by the compiler
- Up to here the IMAP client was purely reading, and that is a promise to the mailbox: a
  mirrored mail must look unread in the mail program, because in the `Belege` folder another
  fetcher is controlled by exactly this "unread". "Adopt" needs `SELECT` and
  `UID MOVE` — the contract had to open
- Solved with **two types instead of a convention**: `imapConnect` still returns an
  `ImapReadSession` without `select`/`uidMove`, the connection becomes writable only via
  `imapConnectWritable`, and exactly one path takes that. An accidental `SELECT` in the sync is
  thus a **type error**, not a review finding. The writing path does not set `\Seen` either:
  `UID MOVE` carries the flags along
- **`UID MOVE` measures success by evidence, not by the status line.** Per RFC 6851 § 3.3
  a server answers a UID that matches nothing with `OK` — a success in which nothing
  was moved. Without a `COPYUID` code or an untagged `EXPUNGE`, the action is therefore treated as
  failed ("sync again") instead of triggering a sync that finds nothing
- No `COPY`+`EXPUNGE` fallback: a UID-less `EXPUNGE` also removes messages that another
  program has marked as deleted. If a server cannot do `MOVE`, nothing at all is sent

### Fixed
- **Capabilities are now also read after login.** Many servers announce `MOVE` and
  `UIDPLUS` only afterwards, often only in the response code of the `OK` line — a capable server thus looked
  incapable
- Inbox error messages are fully translated. Previously nine of thirteen
  cases appeared as raw key text or, worse, as a plausible untruth
- `tools/sync-kit.sh` reads kit modules from a **fixed ref** instead of from the working state of the
  neighbouring repos, checks all sources before the first write
  and writes via `.tmp` + `mv`. Previously vendoring was coupled to foreign HEADs and, with a missing source,
  would have left a target file as a stub (internal, no user impact)

## [0.2.0] — 2026-09-01

### Sidebar cockpit — operations view per account (2026-09-01)
- New view in the right sidebar: per account a status indicator, the last run with
  time, the next run, the counters of the last run and the error in plain text, plus
  "Sync now" per account and for all. Previously all of this only flashed up in the status bar
  and was gone at the next tick
- **The last run now survives a restart.** New `runState` in `data.json` — next to
  `settings`, `zoneHashes` and `uidCache`, not in the settings: it is runtime state,
  not configuration. An unusable entry drops out individually instead of toppling the register
- Counters condensed: only what is non-zero ("3 new · 1 relinked"). Six
  zeros side by side hide the one number that matters
- Status indicator per the binding component catalog: shape **and** colour **and**
  class **and** `aria-label`. `is-warning` for the run that completed and still skipped something —
  neither ok nor error. "Never run" deliberately gets no indicator,
  because there is no state for it
- **The ribbon icon now opens the view instead of syncing.** The sync stays reachable via
  the command palette (`sync-mailbox`) and the button in the cockpit — thus easier to
  reach than before
- Auto-open on startup is opt-in, default off
- **"Sync now" ignores the auto switch.** Anyone who has switched off automatic
  sync can still sync by hand — previously the button was ineffective in exactly
  this configuration, depending on whether *another* account was active
- The view follows changes to the accounts: creating, renaming, deleting and toggling the
  sync switch redraw it while it is open
- Error messages use the same text keys as the notifications; an unknown
  code from a hand-written `data.json` no longer shows a raw key

## [0.1.0] — 2026-09-01

### M3b — vault commands (2026-09-01)
- Four commands on a mail note, each with a preview before writing:
  - `mail.rerender` — rebuild the message section and derived frontmatter fields from the local
    `.eml`. The only way to `allowUpdate: true` outside the import; `mail_source`
    and `mail_state` are taken over from the note, never re-determined, and the `.eml` must carry
    the same `mail_id` as the note (`eml-mismatch`, otherwise a wrongly named file would overwrite the note with foreign content)
- `mail.relink` — message IDs in `in_reply_to`/`references` to wikilinks where the target note
    exists; forward only, an existing wikilink is never turned back. Changes
    only frontmatter lines in place (`mergeFrontmatterOnly`), comments and
    block scalars stay byte-identical
- `mail.extractAttachment` — an attachment from the `.eml` into the attachment folder, link into the
    free area of the note (not into the managed zone, where it would not survive a re-render)
- `mail.replyExternal` — `mailto:` with `Re:` subject and `In-Reply-To`; a substitute ID
    (`noid-…`) is omitted instead of invented
- Descriptor framework (`core/commands/`): mini JSON schema with validator, registry with
  idempotent default population, `executeCommandPlan` as the only write path, shared
  busy guard with the sync. `CommandProbe`/`CommandContext` separated so that `checkCallback`
  stays synchronous; optional `schemaFor(ctx)` turns the attachment list into a dropdown
- Protection against lost writes: the plan remembers the state it was built
  from (`NotePlan.expectedContent`); if the note changes while the preview is open,
  it is skipped instead of overwritten — with a message that names the way out
- Error texts for all command codes in EN and DE, secured by a parity test over
  the real command set with compiler-enforced completeness over `CommandErrorCode`

### Fixed
- **Two attachments with the same file name shared one key** in the byte store of the
  MIME parser (`contentId ?? name`): the extracted file would have carried the name of one and the
  content of the other, and the first would have been unreachable. Every attachment now has
  a unique key. The defect had been in the parser since M1 and was harmless until M3b became its
  first consumer
- An empty required field got through the schema validation (`required` only checked for
  `undefined`)
- A throw between command palette and read access (deleted note) became an unhandled
  rejection — the command visibly did nothing; now a translated message
- `unregister()` of the calendar-notes bridge calls the instance that accepted the registration
  and catches a throw from the neighbour instead of letting it escape from `onunload()`
- Multi-line SMTP greeting (`220-`) is now tested (carry-over from the M1 follow-up)

### M3 — IMAP sync (2026-08-30)
- IMAP client (`core/imap/client.ts`): state machine CAPABILITY -> AUTHENTICATE PLAIN
  (fallback LOGIN) -> EXAMINE (read-only) -> UID SEARCH ALL -> UID FETCH -> LOGOUT, reading
  commands only (`BODY.PEEK` instead of `BODY`), every network step under `withTimeout`
- Message-ID comparison instead of ENVELOPE (`BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]`), deliberate
  deviation from the spec (rationale see task brief), UID→message-ID cache per
  `<account>/<folder>/<UIDVALIDITY>` (`core/sync/uid-cache.ts`)
- `planSync` (`core/mirror/apply.ts`): `create`/`reattach`/`detach` from server versus
  vault state, `SyncService` (`core/sync/service.ts`) runs one run per account via
  busy guard, emitter (`synced`/`changed`) and `PlanExecutor`
- Wiring into the plugin: command, ribbon, interval trigger and status bar; hint for a missing
  password in the account row, debug switch for the IMAP dialog
- Fake IMAP server + integration test (`scripts/fake-imap.mjs`,
  `tests/integration/fake-imap.test.ts`) against the real Node socket transport — speaks only
  the command subset used by the client, no TLS, exclusively `127.0.0.1`
- `IDLE` stays V1.1, not part of this milestone
- **A live probe against a real mailbox is still outstanding** — the sync is tested against the fake IMAP
  server over a real socket (child process, real TCP), but has not yet been run against
  a real mailbox.org server; follows separately

### M2 — transport (2026-08-23)
- SMTP client (`core/smtp/client.ts`): EHLO/AUTH/MAIL/RCPT/DATA, `smtpProbe` for the connection test
- `tls-transport.ts`: real Node TCP/TLS socket behind `Platform.isDesktop`, STARTTLS upgrade with
  active certificate verification, connect timeout, `close()` with fallback to `destroy()`, protection against
  STARTTLS buffer injection (CVE-2011-0411 class)
- `SendService` + iMIP integration (`core/send/service.ts`, `core/send/imip.ts`): account/identity
  resolution, MIME construction, sending over the socket transport, `tls-required` guard before every connect
- Accounts UI (`AccountModal`, declarative settings tab): IMAP/SMTP/identities/folders/sync, secrets
  via `SecretComponent` (never in `data.json`), connection test
- calendar-notes bridge (`calendar-notes-bridge.ts`): registers mailstone as `MailTransport` on
  the neighbouring plugin's public API, robust against rejection/exceptions/neighbour reload
- Fake SMTP server + integration test (`tests/integration`) against the real transport
- Security hardening: STARTTLS buffer-injection protection, connect timeout, symmetric
  `tls-required` guard before every connection attempt (service AND account test), stricter
  `repairAccount` validation (tls/port)

### M1 — scaffold + formats (2026-08-23)
- Repo scaffold from calendar-notes (gate, vendored kit, esbuild builtin plugin, lint 0 warnings, check:pure)
- `.eml` → `ParsedMail` (postal-mime), synthetic fixture corpus
- Rendering mail → Markdown/frontmatter/file name (turndown, mapping profile)
- Merge rules for re-render: fences, zone hash, derived keys line by line in place, report instead of overwrite
- MIME builder for sending (QP, RFC 2047, multipart/alternative + text/calendar), header-injection hardening
- Settings (accounts/identities/profile), NotePlan + vault executor, command "Import .eml files from a vault folder", declarative settings tab, i18n EN/DE
- minAppVersion 1.13.0
