# Troubleshooting

> **Diátaxis: How-to.** You have a problem and want it gone. Each entry starts with the message as Mailstone shows it — as a notice, in the status bar, or in the sidebar panel — so you can search this page for it.

- [Connecting and syncing](#connecting-and-syncing)
- [The inbox tab](#the-inbox-tab)
- [Commands on a mail note](#commands-on-a-mail-note)
- [Sending](#sending)
- [No network](#no-network)
- [Mobile](#mobile)
- [Getting help](#getting-help)

## Connecting and syncing

### "The server rejected the login. Check username and app password."

**Cause:** The server refused the credentials. Usual suspects: you used your account password although the provider requires an app-specific password (two-factor authentication), a typo in the username, or a password that was saved wrongly.

**Fix:** Create an app-specific password at your provider, then in Settings → Mailstone → *Edit* your account add a **new** entry in the Password field with a **new ID** and select it. Do not reuse the ID of the old entry: Obsidian silently fails to save a secret under an ID that already exists. Then press *Test SMTP connection*.

### "No password stored for this account. Open the settings and select one."

**Cause:** The account has no password entry linked — it was never chosen, or you removed the link with the ✕ in the Password field.

**Fix:** Settings → Mailstone → *Edit* → Password: select or create an entry.

### "Could not reach the server." / "The server did not answer in time."

**Cause:** The host or port is wrong, you are offline, a firewall or VPN blocks the connection, or the server is down.

**Fix:** Check host and port in the account (IMAP and SMTP have their own). Try the same host from another program or network. If it only fails from one network, look at firewall and VPN. See also [No network](#no-network).

### "The encrypted connection could not be established."

**Cause:** The TLS handshake failed. Typically the TLS mode does not match the port (`Implicit` on a STARTTLS port, or the other way round), or the server certificate is not valid — Mailstone cannot switch certificate checking off.

**Fix:** Usual pairs: `Implicit` with IMAP 993 and SMTP 465, `STARTTLS` with IMAP 143 and SMTP 587. If the pair is right, check the certificate of your server (expired, wrong host name, self-signed).

### "The server refuses to authenticate on this connection."

**Cause:** Mailstone never sends a password without encryption. This message appears when the server offers no login on this connection — for example STARTTLS was requested but the server does not support it, or the connection is not encrypted.

**Fix:** Switch the TLS mode of that account (`Implicit` ↔ `STARTTLS`) together with its port. Plaintext is not an option.

### "The server closed the connection." / "The server answered in a way Mailstone did not understand."

**Cause:** The server hung up mid-conversation (rate limit, too many logins, a maintenance restart) or is not an IMAP/SMTP server on that port.

**Fix:** Wait a few minutes and retry; check that the port belongs to the protocol you configured. To see the dialogue, switch on *Debug log* in the settings and open the developer console (Ctrl/Cmd+Shift+I): the IMAP/SMTP conversation appears there with passwords masked. Switch it off again afterwards.

### "The allowlist folder does not exist on the server."

**Cause:** The folder name in the account's *Allowlist* field is not a folder on the server. Names are exact: case, separators (`INBOX/Vault` or `INBOX.Vault`, depending on the server) and umlauts matter.

**Fix:** Create the folder on the server, or copy its name exactly as your mail program shows it into *Folders → Allowlist*.

### "A synchronisation is already running."

**Cause:** A run — or a command that works on notes — is still busy; Mailstone runs one at a time.

**Fix:** Wait for it to finish and try again.

### "{n} notes were not detached: this run could not identify every message in the folder. The next clean run catches up."

**Cause:** During this run the server did not report the identity (Message-ID) of some messages, so Mailstone could not be sure which notes belong to messages that left the folder. It refuses to guess and detaches nothing it cannot prove.

**Fix:** Nothing — the next clean run catches up. If it repeats every time, some messages in the folder have no Message-ID; that is a property of those messages, not of your setup.

## The inbox tab

### "This server cannot move messages safely (no MOVE support)."

**Cause:** *Move to vault*, *Archive* and *Create task* move a message on the server with the `MOVE` command. Mailstone uses nothing else — it does not fall back to copy-and-delete on servers without it.

**Fix:** Move the message yourself in webmail or your mail program into the allowlist folder — the next sync writes the note.

### "That message is no longer there — synchronise and try again."

**Cause:** The message was moved or deleted (by you, a rule, or another device) after the list was loaded.

**Fix:** Press *Refresh* in the inbox tab.

### "The message was moved, but no note appeared within the time limit. Once the note exists, create the task from it directly."

**Cause:** *Create task* first moves the message into the allowlist folder and waits for the sync to write the note. The sync did not finish in time.

**Fix:** The message is already in the allowlist folder. Run *Synchronise now*, open the new note, and use **Mailstone: Create a TaskNotes task** on it.

### "The inbox folder does not exist on the server." / "No target folder configured."

**Cause:** The account's *Inbox* folder name is wrong, or the *Allowlist* / *Archive* folder used by the action is empty.

**Fix:** Settings → Mailstone → *Edit* → Folders: fill in the names exactly as the server shows them.

## Commands on a mail note

### A command is missing from the command palette

**Cause:** Commands on a note appear only when they apply to the note you have open. They need a mail note that Mailstone created. *Re-render* and *Extract an attachment* also need the original message: the `.eml` beside the note or, on the desktop, the message on the server. **Mailstone: Remove stored .eml files** appears only while *Save original as .eml* is off. **Mailstone: Create a TaskNotes task** additionally needs the [TaskNotes](https://github.com/callumalpass/tasknotes) plugin, enabled.

**Fix:** Open a mail note. For the task command, install and enable TaskNotes.

### "Threads are off. Enter a field name under Settings → Thread field first."

**Cause:** *Recompute threads* writes into the front matter field named in *Thread field*. That setting is empty, or it holds a name Mailstone cannot use: one of the fields it manages itself (such as `mail_id`), or a name with accents or special characters. The settings row says which.

**Fix:** Enter a plain field name such as `vorgang` under Settings → Mailstone → Thread field, then run the command again.

### "The .eml belonging to this note was not found. It is expected in the _eml subfolder next to the note — moving or renaming the note breaks that link."

**Cause:** Commands rebuild from the original message. The note was moved out of its folder, or the `.eml` was deleted. Normally Mailstone then fetches the original from the server instead (desktop), so you see this message only in the rare case where no lookup was attempted.

**Fix:** Move the note back next to its `_eml` folder, or restore the `.eml` there under its original name.

### "The original of this mail is neither stored next to the note nor on the server (searched: {0})."

**Cause:** There is no `.eml` beside the note (for example because *Save original as .eml* is off), and the server has no message with this Message-ID in the folders named in `{0}`: the folder from the note's `mail_source`, then the allowlist folder, then the archive folder (all accounts when the note came from an import). The message may have been deleted or moved elsewhere.

**Fix:** Move the message back into the allowlist or archive folder on the server, or restore the `.eml` next to the note under the note's name in the `_eml` subfolder, then run the command again. Mailstone only reads from the server for this; it never marks anything as read.

### "The original of this mail is not stored next to the note, and it cannot be looked up on the server: the mail has no Message-ID, or its Message-ID contains characters an IMAP search cannot carry."

**Cause:** The server is searched by Message-ID. A mail without one (Mailstone gave it a `noid-…` id) or with non-ASCII characters in it cannot be found that way. Mails without a Message-ID always keep their `.eml` for this reason, so this appears for notes whose `.eml` was removed by hand.

**Fix:** Restore the `.eml` next to the note.

### "The original of this mail is not stored next to the note. Fetching it from the server works on the desktop only."

**Cause:** You are on mobile Obsidian, which has no network layer for Mailstone, and the `.eml` is not stored in the vault.

**Fix:** Run the command on the desktop.

### "The message section of this note was edited by hand. Re-rendering would discard those edits, so nothing was written."

**Cause:** You changed text between the `%% mailstone:begin %%` and `%% mailstone:end %%` markers. Mailstone protects your edits and refuses to overwrite them.

**Fix:** Move your own text outside the markers, restore the managed section, and run the command again.

### "This note has no managed message section (the %% mailstone:begin %% … %% mailstone:end %% markers). Mailstone will not guess where its content belongs."

**Cause:** The markers were deleted or damaged.

**Fix:** Restore both marker lines around the message text.

### "The .eml next to this note belongs to a different message. Nothing was changed."

**Cause:** The file in `_eml` has the same name but a different Message-ID than the note, and the server could not supply the right one.

**Fix:** Restore the correct `.eml`, or remove the wrong one so Mailstone fetches the original from the server.

### "TaskNotes is not available, or its API does not have the expected shape." / "TaskNotes rejected or failed to create the task."

**Cause:** TaskNotes is disabled or missing, or its version differs from what Mailstone expects.

**Fix:** Enable TaskNotes; update both plugins. Mailstone hands the task over once and does not manage it afterwards.

## Sending

### "No account with a sending identity is set up yet."

**Cause:** Sending needs an account with at least one identity.

**Fix:** Settings → Mailstone → *Edit* → Identities → *Add identity* — an address your provider allows you to send from.

### "The server rejected the sender address."

**Cause:** The identity's address is not one your provider lets this account send from (catch-all or alias addresses without sending permission are typical).

**Fix:** Use an address the provider lists as a sender identity for that login.

### "The server rejected the recipient address." / "The server rejected the message." / "The server rejected the credentials."

**Cause:** The provider refused the recipient, the message content, or the login for SMTP.

**Fix:** Check the recipient address; check the SMTP login separately with *Test SMTP connection*; consult your provider's limits.

### A confirmation dialog "Send mail on behalf of another plugin?" appears

**Cause:** Another plugin wants to send mail through your account. Mailstone asks once per plugin and shows sender, recipient, subject and text. Without an answer, the dialog closes after a minute **without sending**.

**Fix:** *Send once*, *Send and always allow*, or *Cancel*. Permissions are listed under *Plugins allowed to send* in the settings, where you can revoke each one. Invitations from `calendar-notes` do not ask.

## No network

Mailstone needs the network only for syncing, the inbox tab and sending. Without a connection:

- A manual run shows a notice with the reason (typically "Could not reach the server."), the status bar shows the same text, and the sidebar panel shows the error for that account.
- **Nothing in the vault changes.** No note is deleted or detached because the server was unreachable. Mailstone never deletes notes at all: a message that leaves the folder is only marked `detached`.
- The automatic run tries again after the account's sync interval (default five minutes) — or press **Synchronise now** once you are back online.
- Everything you already have works offline: notes are ordinary Markdown files, and *Relink* uses only the notes. *Re-render* and *Extract an attachment* use the `.eml` beside the note; without one they need the server (see "The original of this mail is neither stored next to the note nor on the server" above).

## Mobile

Mailstone loads on mobile Obsidian (1.13.0 or newer) for **reading**: notes that a desktop already synchronised are ordinary notes there, and the sidebar panel stays. Synchronising, sending and the inbox tab need a network layer that mobile Obsidian does not provide, so they are not offered:

- The sidebar panel says: "Synchronisation only works on the desktop. Already synchronised notes stay readable here; open Mailstone on the desktop to fetch new mail."
- The inbox says: "The inbox reads the mailbox live and only works on the desktop."
- Settings → Mailstone shows the time of the last successful sync: "Last successful sync: …" — or "No successful sync yet."
- The commands *Synchronise mailbox folder* and *Send a test mail to myself* are not registered.

To get new mail onto your phone: sync on the desktop and let your vault sync (Obsidian Sync, iCloud, Syncthing, …) carry the notes across.

## Getting help

Still stuck? [Open an issue](https://github.com/johannes-kaindl/mailstone/issues) with your Obsidian version, the plugin version (Settings → Community plugins), your mail provider (not your password or address), and what you expected to happen. For connection problems, the *Debug log* output from the developer console helps — remove anything personal before you paste it.
