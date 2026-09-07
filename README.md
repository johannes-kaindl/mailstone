# Mailstone

Mailstone brings mail into the vault as notes: a server-side folder (an IMAP mailbox chosen on
the mail server, not in the plugin) decides what becomes a note, so triage stays where the mail
already lives instead of duplicating a second inbox inside Obsidian. Sending replies from a note
uses the same account via SMTP, and the plugin sends iMIP calendar invitations on behalf of the
sister plugin [`calendar-notes`](https://git.jkaindl.de/jkaindl/calendar-notes), which owns
the actual event/attendee model.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/mailstone?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/mailstone/releases)
[![Obsidian](https://img.shields.io/badge/obsidian-1.13.0%2B%20·%20desktop%20only-purple)](https://obsidian.md)

*Auch auf Deutsch verfügbar: [`README.de.md`](README.de.md).*

## What it does

- **Mail as notes.** A server-side folder decides what becomes a note; the Message-ID is the
  identity, and the original `.eml` stays beside the note as a fidelity surface.
- **A panel in the right sidebar.** Per account: what the last run did, when the next one is due,
  the counters that are not zero, the error in plain words — and a button to synchronise now,
  for one account or all of them. The last run survives a restart.
- **An inbox tab.** The last 100 messages from your inbox, with a tick for everything that is
  already a note. Three actions per row: move it into the vault, archive it — both server-side,
  both after a confirmation — or, once [TaskNotes](https://github.com/callumalpass/tasknotes) is
  installed, create a task from it directly.
- **Commands on a mail note** — re-render from the `.eml`, turn Message-IDs into wikilinks,
  extract an attachment, reply in your external mail client, create a TaskNotes task from it.
  Each shows a preview before writing.
- **Sending.** SMTP through the same account, including iMIP calendar invitations on behalf of
  `calendar-notes`.

**Status: 0.3.0.** M1 (scaffold and offline format layer), M2 (SMTP transport, accounts,
calendar-notes bridge), M3 (IMAP sync, verified against a real mailbox on 2026-08-30), M3b
(vault commands), the sidebar panel and M4 (inbox tab, server-side move) are done. Still open:
a preview pane inside the list, attachment markers, and keyboard navigation.

## Requirements

- **Obsidian 1.13.0 or newer**, on **desktop only**. The plugin speaks IMAP and SMTP over
  `node:tls`, which mobile Obsidian does not provide.
- **An IMAP/SMTP account** you can reach with an app password. Providers that require OAuth
  (Gmail with 2FA, Microsoft 365) are not supported — there is no OAuth flow.
- **A folder on the mail server** that acts as the allowlist. Anything you file there becomes a
  note; nothing else is touched. A second folder for the archive.
- **TLS is not optional.** Certificate checking cannot be turned off, and plaintext
  authentication without TLS is refused.

## Install

This plugin is **not distributed through the community store**. It lives on its own forge, and
there are three ways to get it.

**Recommended — via [AnySource Sideloader](https://git.jkaindl.de/jkaindl/anysource-sideloader)**,
which installs and updates plugins from any git forge. Subscribe to this catalog once:

```
https://git.jkaindl.de/jkaindl/obsidian-catalog/raw/branch/main/catalog.json
```

Mailstone then appears in the sideloader's plugin list and updates like any other plugin — no
manual copying, and every download is checksum-verified. To install just this one plugin without
the catalog, add its repository URL as a source instead:
`https://git.jkaindl.de/jkaindl/mailstone`.

**By hand**, if you would rather not add another plugin: download `main.js`, `manifest.json` and
`styles.css` from the [latest release](https://git.jkaindl.de/jkaindl/mailstone/releases/latest)
into `<vault>/.obsidian/plugins/mailstone/`, then enable the plugin in Settings → Community
plugins. Updates then have to be repeated by hand.

**From source** — `npm install && npm run build`, then copy the same three files into that
folder. `npm run gate` runs the full check suite (lint, type checks, unit and integration tests,
purity check, build). `npm run smoke:e2e` is a separate, maintainer-only check that drives a
real, running Obsidian window with the [TaskNotes](https://github.com/callumalpass/tasknotes)
plugin actually installed, to prove that a task created from a mail note really lands as a file
in the vault — it is deliberately not part of `gate`, since it needs that second plugin present.

## Configuration

Settings → Mailstone. Per account you set:

| Setting | What it means |
|---|---|
| IMAP/SMTP host, port, TLS | `implicit` (usually port 993/465) or `starttls` (143/587) |
| Username and app password | The password is stored in Obsidian's `secretStorage`, never in `data.json` |
| Identities | One or more sender addresses; one is the default |
| `folders.inbox` | The folder the inbox tab lists. Default `INBOX` |
| `folders.allowlist` | The folder that decides what becomes a note |
| `folders.archive` | Where "Archive" moves a message |
| `folders.sent` | Where a sent copy is filed. Default `Sent`; empty turns the copy off |
| Sync interval | Minutes between runs, per account |

"Test connection" in the settings tab checks host, TLS and credentials without touching any mail.

## Usage

**Set up an account**, then decide on the server which mail matters: move it into your allowlist
folder — from your phone, from webmail, from a mail rule. The next sync turns it into a note with
the original `.eml` beside it.

**Or work from the inbox tab.** Open the sidebar (ribbon icon or the command *Mailstone: open
sidebar*), switch to **Inbox**, and use *Move to vault* on anything worth keeping. The message
moves into the allowlist folder on the server, and the following sync writes the note.

**On a mail note**, the command palette offers *re-render*, *relink threads*, *extract
attachment* and *reply externally*. Each shows what it would change before it writes.

**Reading never marks anything as read.** Listing, previewing and syncing all use `EXAMINE` and
`BODY.PEEK`; moving a message carries its flags along. If another tool in your setup keys off
"unread", Mailstone will not disturb it.

## How it works

**The server decides, not the plugin.** A folder on the mail server is the allowlist. Sync reads
it, and every message in it becomes a note — no rules engine, no filters in the plugin. Triage
stays in the tool you already use for mail.

**The Message-ID is the identity.** It survives re-downloads, folder moves and renamed files. The
`.eml` next to each note is the fidelity surface: everything derived — front matter, rendered
body, attachments — can be rebuilt from it, so a formatting change never costs you data.

**Notes are merged, not overwritten.** Your own text lives outside a marked zone and is compared
by hash before any write. If you edited the managed zone, the write is refused rather than
silently applied. Mailstone never deletes a note — a message that leaves the folder is marked
`detached`, and putting it back reattaches it.

**Two connection types, enforced by the compiler.** The read path (`imapConnect`) has no way to
call `SELECT` or `UID MOVE` — those live on a separate, write-capable session used by exactly one
code path, the two inbox actions. That is why "reading never marks as read" is a property of the
type system here, not a rule someone has to remember.

## License

AGPL-3.0-or-later, see [`LICENSE`](LICENSE) and [`LICENSING.md`](LICENSING.md).
