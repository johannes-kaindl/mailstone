# Mailstone

Mailstone brings mail into the vault as notes: a server-side folder (an IMAP mailbox chosen on
the mail server, not in the plugin) decides what becomes a note, so triage stays where the mail
already lives instead of duplicating a second inbox inside Obsidian. Sending replies from a note
uses the same account via SMTP, and the plugin sends iMIP calendar invitations on behalf of the
sister plugin [`calendar-notes`](https://github.com/johannes-kaindl/calendar-notes), which owns
the actual event/attendee model.

## What it does

- **Mail as notes.** A server-side folder decides what becomes a note; the Message-ID is the
  identity, and the original `.eml` stays beside the note as a fidelity surface.
- **A panel in the right sidebar.** Per account: what the last run did, when the next one is due,
  the counters that are not zero, the error in plain words — and a button to synchronise now,
  for one account or all of them. The last run survives a restart.
- **Commands on a mail note** — re-render from the `.eml`, turn Message-IDs into wikilinks,
  extract an attachment, reply in your external mail client. Each shows a preview before writing.
- **Sending.** SMTP through the same account, including iMIP calendar invitations on behalf of
  `calendar-notes`.

Desktop only: the plugin speaks IMAP and SMTP over `node:tls`, which mobile Obsidian does not
provide. App passwords live in Obsidian's `secretStorage`, never in `data.json`.

**Status: 0.2.0.** M1 (scaffold and offline format layer), M2 (SMTP transport, accounts,
calendar-notes bridge), M3 (IMAP sync, verified against a real mailbox on 2026-08-30), M3b
(vault commands) and the sidebar panel are done. Still open: an inbox view that browses the
server directly, and a tracked GUI smoke driver — until then the panel's wiring is verified by
the hand-run checklist in [`docs/SMOKE.md`](docs/SMOKE.md).

## License

AGPL-3.0-or-later, see [`LICENSE`](LICENSE) and [`LICENSING.md`](LICENSING.md).
