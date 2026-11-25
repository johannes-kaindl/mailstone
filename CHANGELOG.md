# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Fixed
- **A mail you sent yourself is marked `richtung: ausgehend` even when the account has no identity.** Mailstone now also counts each account's username as your own address when it is a mail address, and every mail in an allowlist folder that is the account's sent folder counts as outgoing. An account with neither shows a hint in the side panel.

### Changed
- The tab bar styles in `styles.css` are the shared library's (obsidian-kit 0.108.0) word for word, and a test now fails if a vendored library stylesheet is missing. No visible change.

## [0.14.1] — 2026-11-24

### Fixed
- **A subject or title in the form of a time (`14:55`, `1:30:00`) is written quoted into the note's front matter.** Obsidian can read a bare time as a number, so the note title would have shown up as a number in properties and Bases; the shared library now quotes it.

### Changed
- Shared library updated (obsidian-kit 0.108.0, code-kit 0.88.0). The byte comparison of attachments is the library's now.

## [0.14.0] — 2026-11-24

### Added

- Setting *Save attachments in the attachment folder* (off by default): the sync and *Import .eml folder* put the real attachments of each new mail into Obsidian's attachment folder and link them in the note, above the mail text. A file that is already there with the same content is linked instead of copied, also within one run, and a different file with the same name gets a numbered name. Inline images stay in the `.eml` only. With *Pseudonymize* on, no attachments are saved. Existing notes are not touched.

### Changed

- *Remove .eml files* checks each original by reading only the first 64 KB of the file on desktop instead of loading the whole mail with its attachments (measured on 400 files of 5 MB: 843 ms before, 59 ms after). On mobile it still reads the whole file.

### Fixed

- With *Pseudonymize* on, mails that keep waiting for the pseudonymizer (or fail) no longer block newer mails and are no longer fetched again in full on every sync. A sync fetches new mails first and retries at most 20 waiting ones per run, the least often tried first, so a backlog of 200 or more waiting mails does not keep a new mail from becoming a note.
- A value of exactly `true` or `false` under *Extra fields for new mail notes* is now written to the front matter as a real YAML boolean (`done: true`), not as the text `"true"`, so a Bases filter on the checkbox matches. Other text and numbers stay as they are, and existing notes are not touched.
- *Show follow-up mails* no longer stays on “Searching the mailboxes…” when the search throws an error: the dialog now says “Could not search the mailboxes” with the reason.
- A thread you stopped following stays stopped when an earlier mail of the thread later becomes a note and turns into the new first mail. The marker on any mail of a thread now counts for the whole thread (*Show follow-up mails* hides it and *Follow threads* no longer copies it), and *Follow this thread again* removes the marker from every mail that carries it, after the preview.
- *Import .eml folder* no longer runs while a sync is running, for example while *Check waiting mails* has its review window open. Before, an import of the same mail in that moment could create a second note with the same `mail_id`; now the command reports that another operation is running and does nothing.

## [0.13.0] — 2026-11-20

### Added

- Setting *Thread token in the subject* (a regular expression, default `\[Ticket#\d+\]`, empty switches it off): mails with the same token in the subject belong to one thread even when their headers do not link them, for example the replies of a helpdesk that start a new thread each time. It is used by *Recompute threads*, by the thread value of new notes, by *Show follow-up mails* and by *Follow threads*, and the headers always come first: a mail whose `In-Reply-To` or `References` points to a note keeps that thread, whatever its subject says. If the expression has a group, its content is the token (`Ticket #(\d+)` makes `Ticket #42` and `Ticket#42` one token). An invalid expression, or one that the safety check of the shared library refuses because it could run very long on some subjects, is ignored and a note under the setting says why; only the first 998 characters of a subject are searched. The default is on, so *Show follow-up mails* and *Follow threads* also match by `[Ticket#1234]` in the subject for existing installations.
- Setting *Fields passed on in a thread* (a list, empty by default, so nothing changes until you add a field): a new mail note copies these front matter fields unchanged from the previous mail of its thread (the mail it replies to, or the last mail in `References` that is in your vault, or the latest earlier mail with the same thread token in the subject, also when that mail arrives in the same run). A list of links stays a list of links and `true` stays `true`; only text, numbers, true/false and lists of text are copied. A field Mailstone manages itself, the thread field and the follow field are refused, with a note under the list.
- Command *Align fields in thread*: copies the values of those fields from the first mail of the thread into all other notes of the thread, after a preview, front matter only. It adds a field where it is missing and never deletes one the first mail lacks; a note without a message section is skipped with a reason.
- Setting *Pseudonymize* (Off, If available, Required; **Off by default**, so nothing changes until you choose): new mails go through the plugin `pseudonymizer` before a note is written, so names, addresses and the like in the subject, sender, recipients, attachment names and message text become placeholders. *If available* pseudonymizes while the plugin is ready and writes plain text otherwise (also when it is missing, not set up or locked). *Required* writes nothing without a ready plugin: the mail stays on the server and is fetched again by the next run, and it counts as waiting, not as an error. A mail the plugin wants you to review first (or you cancelled) also waits in the background sync; the review window only opens for the import and for *Re-render*. The direction (*richtung*) and the thread token come from the original mail, not from the placeholders. The thread link, the message id and the attachment order stay as they are; if the plugin changes them, the mail is not written. **Stored `.eml` files are switched off while Pseudonymize is not Off, whatever *Save original as .eml* says (the choice stays saved and has no effect), also for mails without a Message-ID: an original is plain text.** *Remove stored .eml files* is available then, too. The plugin `pseudonymizer` is not published yet: *Required* therefore writes no new mail until it exists and is ready. *Import .eml files from a vault folder*, *Re-render mail note from its original* and *Extract an attachment* use the same step, with the review window allowed; when the mail waits or fails, they say why and write nothing.
- Mails that wait for the pseudonymizer are now visible: the account line in the sidebar panel shows "N waiting" (only when N is above 0; a waiting mail is not an error, so the line does not turn to a warning), and the notice of a manual sync run names them as a part of the same sentence ("… 2 waiting for pseudonymization (0 errors)"). The quiet interval run stays quiet. Without waiting mails both texts are unchanged.
- Command *Check waiting mails* (desktop; listed only while *Pseudonymize* is not *Off*): a sync run over all accounts, exactly like *Synchronise mailbox folder*, except that the pseudonymizer may open its review window for the waiting mails. The normal sync command, the interval run and the buttons in the sidebar never open it.
- Sending turns placeholders back into the original text before anything leaves Mailstone: recipients (To, Cc, Bcc), subject, text and HTML of a message sent through the plugin API, through the calendar-notes transport and by the test mail, and sender and subject of *Reply to a mail in the external mail client*. For the plugin API this happens **before** the confirmation dialog, so the dialog shows what is really sent. If a placeholder cannot be resolved (unknown to the pseudonymizer, the plugin is locked, not ready or missing while *Pseudonymize* is not *Off*, or the plugin fails), **nothing is sent**, no dialog opens, and the API answers `pseudonym-unresolved` with a `message` that names the number of placeholders (never the plain text); the reply opens no mail client and says why. A placeholder of a forgotten entry in a recipient field is an error as well; in subject or text it is sent as the placeholder, and the confirmation dialog says so (a trusted plugin sends without a dialog and without that note). A recipient that carried a placeholder must be an address after the conversion, otherwise nothing is sent. With *Pseudonymize* on *Off* and a text without placeholders nothing changes, byte for byte.
- A message whose calendar part (the ICS text of an invitation sent through the calendar-notes transport) or whose text attachments (or attachment names) still contain a placeholder is not sent any more: these parts are never turned back (a conversion would fold lines and open a way to inject calendar text), and before this change they went out with the placeholders in them. Nothing is sent, no connection is opened, and the answer is `pseudonym-unresolved` with the number of placeholders found (never a value). Binary attachments are not read. Without a placeholder in these parts nothing changes, byte for byte.
- Plugin API: `send()` can now answer `{ ok: false, reason: "pseudonym-unresolved", message }`. Callers that only read `reason` need no change; every other answer is as before.

### Changed

- Shared building blocks updated to code-kit 0.83.0 (from 0.73.0). Releases 0.74.0 to 0.83.0 change nothing in the modules mailstone uses (the sixteen vendored files are byte-identical to 0.73.0 apart from the origin header; the 0.79.1 and 0.82.0 fixes to secret and IBAN redaction concern modules mailstone does not vendor); the new module `user-regex` is added for the thread token rule (below).
- Shared building blocks updated to obsidian-kit 0.103.0 (from 0.97.0). Apart from the wording of three reasons (next entry) nothing changes for you in what mailstone does: 0.98.0 to 0.103.0 concern the prompt-panel window, the redline view, the number field of the fallback settings walker (mailstone has no number settings) and a new API for a pseudonymizer plugin, which mailstone now uses (see *Pseudonymize* under Added); the segmented switch of the shared library is the three-way control of that setting. The front matter writer now also accepts `true` and `false` as values; mailstone still writes only text and lists, and a text such as `"true"` stays quoted. 0.101.0 to 0.103.0 add building blocks for device files, image fitting, exports and the live-preview swap, none of which mailstone uses (the one vendored front matter file only gains an unused function).
- The reasons "the plugin pseudonymizer is missing / not set up / locked" in the messages about waiting mails and unsent messages now come from the shared library instead of a table of Mailstone's own, in the interface language. German reads as before; English now reads "The pseudonymizer plugin is missing or disabled.", "The pseudonymizer plugin is not set up yet." and "The pseudonymizer plugin is locked." (before: "The plugin pseudonymizer is missing or switched off." and so on). The other reasons keep Mailstone's own texts.

### Fixed

- An HTML mail without any text (only a tracking pixel) now shows *(no text content)* in new notes from sync and import and on re-render, like a mail without a body, instead of an empty section.
- *Show follow-up mails* no longer stops when the header of one message in a folder cannot be read; that message is left out and the rest is matched as usual.

## [0.12.0] — 2026-11-19

### Added

- Setting *Save original as .eml* (on by default, so existing vaults stay as they are). Switched off, sync and import no longer write the `.eml` next to each note; mails without a Message-ID keep theirs, because the server cannot find them again.
- *Re-render mail note* and *Extract an attachment* fetch the original from the server by Message-ID when no `.eml` is stored next to the note (or it belongs to another mail or cannot be read). Read-only (`EXAMINE`, `BODY.PEEK`), desktop only; the fetched original is not saved. If the server does not have it either, the message lists the folders searched. Re-render is now called *Re-render mail note from its original*.
- Command *Remove stored .eml files*, available while *Save original as .eml* is off: moves the `.eml` files next to your mail notes to the trash (the trash follows the vault's setting for deleted files). A preview lists the files first; a `.eml` whose Message-ID does not match its note, or that cannot be read, is left alone. Notes are never touched, and the files you imported from are not covered.
- Optional thread field (setting *Thread field*, empty by default, so nothing changes until you name one): every new mail note gets a link to the earliest mail of its thread, the first mail links to itself, so a Base can group by it. A new note takes the value of the mail it replies to (`In-Reply-To` and then the last of `References`), also when that mail arrives in the same run.
- Command *Recompute threads*: fills the thread field in on all existing mail notes and corrects it where an earlier mail of the thread has turned up since. Shows a preview first, changes only that one field (the message section stays byte for byte), and compares where the existing link points, not how it is written. A note without a message section is skipped with a reason.
- Command *Show follow-up mails* (desktop): reads the inbox and the sent folder of every account and lists, grouped by thread, the mails of the last 60 days that belong to a thread in your vault through `In-Reply-To` or `References` but have no note yet. Read-only (`EXAMINE`, `BODY.PEEK`, nothing marked as read); it writes nothing to the vault or the server, and a thread you stopped following is left out.
- Commands *Stop following this thread* and *Follow this thread again*, and the setting *Follow field* (default `mail_follow`). They set and remove a marker (`false` in that field) on the first mail of the thread, after a preview, changing nothing else. A stopped thread is left out of *Show follow-up mails* and of *Follow threads* (below).
- Account setting **Follow threads (copies mails on the server)**, **off by default, also for existing installations**: with it on, each sync run copies the follow-up mails of threads you already have in your vault (the mails *Show follow-up mails* lists: last 60 days, inbox and sent folder, by `In-Reply-To` or `References`) into the allowlist folder with `UID COPY`, at most 50 per run, oldest first, so they become notes in the same run. **This is the first place where a sync run writes on your mail server on its own.** The original stays in the inbox or sent folder, nothing is marked as read, moved or deleted; the copy keeps the flags of the original, so an unread mail is unread in the allowlist folder too (anything else watching that folder sees new mail). A mail is never copied twice (the allowlist folder is searched for its Message-ID first); a mail without a usable Message-ID is not copied. The writing connection is opened only when there is something to copy; failed copies (quota, rights, missing folder) count as errors in the run and do not stop it. A stopped thread is left out. Nothing is copied while the *Follow field* is empty or unusable, because stopped threads could not be recognised then: the step is skipped, the normal sync still runs, and a note under the switch in the account dialog says so. Desktop only. Turn it off and nothing is copied any more; copies already made stay.

### Changed

- Shared building blocks updated to obsidian-kit 0.97.0 (from 0.94.0; code-kit stays at 0.73.0). 0.95.0 and 0.97.0 change nothing in the modules mailstone uses (the 0.96.0 number-field limits of the fallback settings walker do not apply, mailstone has no number settings); the user-visible effects of 0.96.0 are listed under Fixed.
- When a sync run creates a note, it now also replaces the raw message id in `in_reply_to` and `references` of **existing** mail notes with a link to that new note (before, those stayed raw until *Relink threads* was run by hand, for example when a ticket confirmation arrived days before your own original). Only ids of notes created in that run, only those two fields; the message section and its checksum stay untouched, and a note that cannot be updated counts as an error without stopping the run.

### Fixed

- Kit 0.96.0: Frontmatter values with `]`, a comma or a line break are written validly. A subject, address or message id containing a line break no longer stops a note from being written or relinked (before, such a value made the note count as unreadable); it is stored as a quoted escape (`"a\nb"`) and read back unchanged.
- Kit 0.96.0: Text that YAML would read as a number or an inline-list break (`1e3`, `0x1`, `.inf`, an empty list entry, `}` at the start, `:` before a tab) is quoted when a mail note's front matter is written, so it comes back as the same text in any YAML reader. Values that were already valid stay as they are, except digit strings with an underscore (`1_0`), which are now quoted.
- Kit 0.96.0: Reading front matter decodes the escapes of double-quoted values (`\n`, `\xNN`, `\uNNNN`), and a quote in the middle of an inline-list entry (`don't`) is text, as in YAML.
- Replies and their original mail synced (or imported) in the same run now link to each other. Before, the link was only written for mails from earlier runs, so a reply that arrived together with its original kept the raw message id; the order of the mails in the run no longer matters.
- `References` headers without angle brackets (a bare `id@host`) are no longer dropped, and spaces inside the brackets are tolerated.
- A mail that lists its own message id in `References` or `In-Reply-To` no longer links to itself; the id stays raw. A message id with spaces inside the angle brackets (`<  id@host  >`) is read like in `References`.

## [0.11.1] — 2026-11-15

### Fixed

- Front matter is only written when Obsidian can read it; notes whose front matter Obsidian shows as “Invalid properties” stay untouched (before, the plugin wrote into them without the property becoming visible). A block list with a blank line or a comment line inside no longer leaves the rest of the list behind as the value of the key before it when a mail note is updated (kit `frontmatter-patch` 0.94.0).

### Changed

- Shared building blocks updated to obsidian-kit 0.94.0 and code-kit 0.73.0. The loopback check for mail servers (`::1` with or without brackets) and the link written for a related mail note now come from the kit.

## [0.11.0] — 2026-11-14

### Added

- Settings: a "Status bar" switch (on by default). Turn it off if the status bar gets too wide. Existing installs keep the entry; nothing disappears after the update.

### Changed

- A mail server given as `[::1]` now counts as the local machine for the unencrypted-test-server exception, like `::1`, `localhost` and `127.0.0.1` (the check now uses the shared code-kit module). Host names are compared case-insensitively.

## [0.10.3] — 2026-11-11

### Fixed

- Documentation: the numbered steps under *Usage* in the README (English and German) no longer show raw `**bold**` markers on the Community Plugins page; a screenshot line was swallowing the step below it. The plugin itself is unchanged.

## [0.10.2] — 2026-10-25

### Changed

- Documentation: the README hero image is retaken with a shorter window, so it no longer ends in a large empty area below the note and the sidebar (42 % of its height was blank, the README linter now reports 16 %). The plugin itself is unchanged.

## [0.10.1] — 2026-10-25

### Fixed

- **A mail note with an empty front matter block (`---` directly followed by `---`) is now updated by the sync.** The sync used to refuse such a note as unreadable and left it alone; it now writes the mail fields into the empty block.
- **A front matter value with a line break is no longer written into the note as broken YAML.** The sync used to write `key: one` followed by `two` as separate lines, which no reader can parse; the note is now skipped (`frontmatter-unparseable`) and stays untouched, on every sync, instead of being damaged.
- **A field name with a non-ASCII character in the mail profile (hand-edited `data.json`, there is no setting for it) is no longer added again on every sync.** The line-by-line writer did not recognise such a name and appended a new line each time; the note is now skipped (`frontmatter-unparseable`) instead.
- **A mail note with Windows line endings (CRLF) and no front matter gets a front matter block with Windows line endings** instead of a block with Unix line endings in front of the CRLF text.

### Changed

- Internal: the sync merge (`mergeNote`) now writes the front matter through the kit's `patchFrontmatter` as well, so all three front matter writers of the plugin sit on the same code. The old line-by-line writer and its helpers are gone. Measured against the previous writer on 40,000 random notes: 33,526 identical, the other 6,474 are exactly the four cases above (an empty block, a line break in a value, a non-ASCII field name, CRLF without front matter).

## [0.10.0] — 2026-10-24

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
