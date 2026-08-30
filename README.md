# Mailstone

Mailstone brings mail into the vault as notes: a server-side folder (an IMAP mailbox chosen on
the mail server, not in the plugin) decides what becomes a note, so triage stays where the mail
already lives instead of duplicating a second inbox inside Obsidian. Sending replies from a note
uses the same account via SMTP, and the plugin sends iMIP calendar invitations on behalf of the
sister plugin [`calendar-notes`](https://github.com/johannes-kaindl/calendar-notes), which owns
the actual event/attendee model.

**Status: pre-release — M1 (scaffold + offline format layer) complete; M2 (SMTP transport, accounts, calendar-notes bridge) complete; M3 (IMAP sync) built and tested against a real socket (fake IMAP server, child process) — live probe against a real mailbox still pending.** No installable release exists yet.

## License

AGPL-3.0-or-later, see [`LICENSE`](LICENSE) and [`LICENSING.md`](LICENSING.md).
