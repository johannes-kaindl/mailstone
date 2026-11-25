# Troubleshooting

> **Diátaxis: How-to.** You have a problem and want it gone. Each entry starts with the message as Mailstone shows it — as a notice, in the status bar, or in the sidebar panel — so you can search this page for it.

- [Connecting and syncing](#connecting-and-syncing)
- [The inbox tab](#the-inbox-tab)
- [Commands on a mail note](#commands-on-a-mail-note)
- [Follow threads (copies on the server)](#follow-threads-copies-on-the-server)
- [Pseudonymization](#pseudonymization)
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

### "No own address: this account has no identity and its username is not a mail address, so every mail is marked as incoming. Add an identity in the account settings."

**Cause:** Mailstone writes `richtung: ausgehend` for a mail whose sender is one of your own addresses: the identities of all accounts, and each account's username when it is a mail address. This account has neither, so a mail you sent yourself and moved into the allowlist folder is marked as incoming. Mails in an allowlist folder that is the account's sent folder always count as outgoing.

**Fix:** Settings → Mailstone → *Edit* → Identities → *Add identity* with the address you send from. Notes written before keep their value until *Re-render mail note from its original* writes them again.

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

### "Following is off. Enter a field name under Settings → Follow field first."

**Cause:** *Stop following this thread* and *Follow this thread again* write a marker into the front matter field named in *Follow field*. That setting is empty, or it holds a name Mailstone cannot use: one of the fields it manages itself (such as `mail_id`), the same name as the *Thread field*, or a name with accents or special characters. The settings row says which.

**Fix:** Enter a plain field name such as `mail_follow` under Settings → Mailstone → Follow field, then run the command again.

### "This is not a valid regular expression. The subject token is ignored until you fix it."

**Cause:** This note appears under Settings → Mailstone → *Thread token in the subject*. The text there is not a regular expression the engine can read (an unclosed bracket or parenthesis, a stray backslash at the end). Until it is fixed, mails are matched by their headers only; the other thread settings are not affected.

**Fix:** Correct the expression, or empty the field to switch the subject token off. The default is `\[Ticket#\d+\]`.

### "This expression could run very long on some subjects (a repeat inside a repeat, or repeats that overlap). The subject token is ignored until you rewrite it."

**Cause:** Mailstone checks the expression before it uses it and refuses shapes that can make a regular expression take exponentially long on some text, such as `(a+)+` or `(\w+\s?)+`. The check is cautious, so a harmless expression can be refused too: several reply prefixes written as one repeated group, `^(?:(?:Re|AW):\s*)+`, are an example. The token is ignored until it is rewritten.

**Fix:** Write the part you need without a repeat inside a repeat, for example `^(?:Re|AW):\s*` for one prefix. For a ticket number, a plain expression such as `\[Ticket#\d+\]` or `Ticket ?#(\d+)` is enough.

### "No fields are passed on. Add a field name under Settings → Fields passed on in a thread first."

**Cause:** *Align fields in thread* copies the fields listed under *Fields passed on in a thread*. The list is empty, or every entry in it is refused: one of the fields Mailstone manages itself (such as `mail_id` or `subject`), the *Thread field* or the *Follow field*, or a name with accents or special characters. The settings page says which, under the list.

**Fix:** Add a plain field name such as `projekt` under Settings → Mailstone → Fields passed on in a thread, then run the command again.

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

## Follow-up mails

*Show follow-up mails* reads the inbox and the sent folder of every account and writes nothing. Its messages:

### "Another operation is running. Try again when it has finished."

**Cause:** A synchronisation or another command holds the one shared lock, so the dialog does not start a second mailbox connection next to it.

**Fix:** Wait for the run to finish (the sidebar panel shows it), then open *Show follow-up mails* again.

### "{account}, folder “{folder}”: The folder does not exist on the server."

**Cause:** The inbox or sent folder named for that account under Settings → Mailstone → Accounts → Folders does not exist on the server (typical for *Sent*: some providers call it `Sent Items` or `Gesendet`).

**Fix:** Correct the folder name in the account settings. The other folders and accounts are still listed.

### "{account}: …" with a connection or login reason

**Cause:** The dialog reuses the texts of a failed synchronisation for the account (for example “The server rejected the login. Check username and app password.”); the causes are the ones described under [Connecting and syncing](#connecting-and-syncing). The dialog shows the problem next to the results of the accounts that did work.

**Fix:** See the matching entry above.

### "No follow-up mails found."

**Cause:** Nothing in the last 60 days in the inbox or sent folder has an `In-Reply-To` or `References` header that points to a mail with a note in your vault, or a subject token (setting *Thread token in the subject*) that a mail with a note carries, or every such thread is stopped. A mail only counts if its thread is already in the vault; mails of unrelated threads are not listed.

**Fix:** Nothing is broken. To see a stopped thread again, run *Follow this thread again* on any note of it.

## Follow threads (copies on the server)

The account setting *Follow threads (copies mails on the server)* is the one place where a sync run writes on your mail server by itself: it copies follow-up mails of threads in your vault into the allowlist folder. It is off by default. Its problems show up as part of the normal sync summary.

### "{0} new, {1} reattached, {2} detached ({3} errors)" with Follow threads switched on

**Cause:** Besides the usual causes, each mail Mailstone could not copy counts as one error: the server refused the copy (mailbox quota exceeded, no right to add mails to the allowlist folder), the folder named under *Folders: Allowlist* does not exist, the *Inbox* or *Sent* folder of the account does not exist on the server, the connection broke while copying, or the folder's numbering changed between looking and copying (the server renumbers a folder only rarely; the next run starts again). A failed copy never stops the run: the notes that could be made are made.

The *Sent* folder deserves a second look: the default is `Sent`, and some providers name it differently (`[Gmail]/Sent Mail`, `Sent Items`, `Gesendet`). Mailstone looks for follow-up mails in the inbox and in the sent folder; a folder the server does not know counts as one error in every run while *Follow threads* is on, and mails in the other folder are still found and copied. An empty *Sent* name is skipped without an error.

**Fix:** Switch on *Debug log* in the settings and restart Obsidian; the developer console (Ctrl/Cmd+Shift+I) then shows lines starting with `follow-copy:` with the server's reason, and the IMAP dialogue with passwords masked. Free up quota or fix the folder name (for a missing *Inbox* or *Sent* folder: correct it under Settings → Mailstone → Accounts → Folders), then synchronise again; mails that were not copied are tried again in the next run. If you would rather not have Mailstone write on the server, switch the setting off.

### "The Follow field (Settings → Follow field) is empty or cannot be used, so Follow threads copies nothing: without it Mailstone cannot tell which threads you stopped following. Enter a plain field name there first; the sync itself keeps running."

**Cause:** This note appears under the *Follow threads* switch in the account dialog. The *Follow field* marks a thread you stopped following (`false` in that field). While the field is empty, names a field Mailstone manages itself, contains accents or special characters, or has the same name as the *Thread field*, Mailstone cannot read that marker, and a stopped thread would be copied on the server against your wish. So the copy step is skipped entirely; the normal sync still runs. With *Debug log* on, the console shows a line starting with `follow-copy: skipped`.

**Fix:** Enter a plain field name such as `mail_follow` under Settings → Mailstone → Follow field. The next sync run copies again.

### Mails I did not move appear in the allowlist folder

**Cause:** That is what *Follow threads* does: it puts copies of follow-up mails there (the original stays in the inbox or sent folder). A copy keeps the flags of the original, so an unread mail is also unread in the allowlist folder, and anything else that watches the folder sees it as new mail.

**Fix:** Switch the setting off to stop further copies (copies already made stay; delete them in your mail program if you do not want them). To keep a single thread from being followed, run *Stop following this thread* on one of its notes.

### A follow-up mail is never copied

**Cause:** Either its thread is not in your vault yet (a mail only counts if it answers a mail that has a note or carries the subject token of one), the thread is stopped, the mail is older than 60 days, or it has no usable Message-ID (missing, or with characters an IMAP search cannot carry): such a mail cannot be checked for a copy that already exists, so Mailstone leaves it alone. At most 50 mails are copied per run; the rest follows in the next ones.

**Fix:** *Show follow-up mails* lists what Mailstone sees. Move a mail into the allowlist folder by hand if it cannot be followed automatically.

## Pseudonymization

The setting *Pseudonymize* hands new mails to the plugin `pseudonymizer` before a note is written. A mail that cannot be pseudonymized is not written at all (no half note, no `.eml`). The plugin `pseudonymizer` is not published yet.

### New mails do not appear as notes while Pseudonymize is on Required

**Cause:** *Required* writes nothing without a ready plugin `pseudonymizer`: it is missing, switched off, not set up or locked, or it wants you to review the mail first (the background sync never opens that window). The mail stays on the server, the sync run counts it as waiting, not as an error, and the next run fetches it again. With *Debug log* on, the console shows a line starting with `transform: waiting` and the reason.

**Fix:** Set up and unlock the plugin `pseudonymizer`, or set *Pseudonymize* to *If available* (plain text while the plugin is not ready) or *Off*. To review a mail the plugin has held back, run *Check waiting mails* (a sync over all accounts that may open the review window), import it with *Import .eml files from a vault folder* or open its note and run *Re-render mail note from its original*: all three may open the review window.

### The sidebar says "{0} waiting", or the sync notice says "{4} waiting for pseudonymization"

**Cause:** That many new mails did not become notes in the last run because the plugin `pseudonymizer` is not ready for them (see the entry above). It is not an error: they are still on the server and the next run fetches them again. In the notice the part reads "… , {4} waiting for pseudonymization ({3} errors)"; in the panel the account line reads "{0} waiting".

**Fix:** Run *Check waiting mails*, or fix the reason as described above.

### "{0} mails were not imported and left untouched: {1}"

**Cause:** *Pseudonymize* is on, and the plugin `pseudonymizer` gave no result for these files. `{1}` names the reason of the first one: "The pseudonymizer plugin is missing or disabled." / "The pseudonymizer plugin is not set up yet." / "The pseudonymizer plugin is locked." / "The plugin pseudonymizer is not ready yet." / "The mail has passages the pseudonymizer wants you to review first." / "The review in the pseudonymizer was cancelled." / "The pseudonymizer could not store its table." The files in the vault folder are not changed.

**Fix:** Fix the reason (set up or unlock the plugin, finish the review) and run the import again; mails that were written already are skipped as unchanged.

### "Nothing was changed: the mail is waiting for pseudonymization. {0}"

**Cause:** A command that reads the original (*Re-render mail note from its original*, *Extract an attachment*) runs the same step as the sync, and the plugin `pseudonymizer` gave no result; `{0}` names the reason (the same texts as in the entry above). The note and the vault are untouched.

**Fix:** Fix the reason and run the command again, or set *Pseudonymize* to *Off*.

### "Nothing was changed: pseudonymization failed. {0}"

**Cause:** The plugin `pseudonymizer` rejected the mail or failed: "The pseudonymizer rejected the mail." / "The pseudonymizer failed unexpectedly." / "The pseudonymizer changed fields Mailstone needs unchanged." / "The pseudonymizer did not return every part of the mail." / "The pseudonymizer gave an unknown answer." During a sync run the same failure counts as one error and the mail is fetched again next time.

**Fix:** Update the plugin `pseudonymizer`. If it persists, switch on *Debug log* and report the reason from the console line starting with `transform: failed`.

### "Nothing was sent: {0} placeholders could not be resolved to the original text. {1}"

**Cause:** A message (sent through the plugin API, the calendar-notes transport or the test mail) contained placeholders of the plugin `pseudonymizer` that Mailstone could not turn back into the original text, so it sent nothing and opened no confirmation dialog. `{0}` is the number of placeholders, `{1}` the reason: "The pseudonymizer plugin is missing or disabled." / "The pseudonymizer plugin is not set up yet." / "The pseudonymizer plugin is locked." / "The plugin pseudonymizer is not ready yet." / "The placeholders are not in the pseudonymizer's table." / "The pseudonymizer reported an error." / "The pseudonymizer failed unexpectedly." A text can also carry placeholders that another device has not synchronised yet. Sending through the plugin API answers `pseudonym-unresolved` with the same text as `message`; the calendar-notes transport and the test mail show "Nothing was sent: a placeholder of the pseudonymizer could not be resolved to the original text."

**Fix:** Unlock or set up the plugin `pseudonymizer`, wait until the device has synchronised its table, and send again.

### "Nothing was sent: placeholders could not be resolved to the original text. {0}"

**Cause:** The same as above, but the plugin gave no number (it is locked, not ready or failed). `{0}` is the reason.

**Fix:** As above.

### "Nothing was sent: the calendar invitation or an attachment contains {0} placeholders of the pseudonymizer. Mailstone does not turn these parts back into the original text."

**Cause:** The ICS part of an invitation (sent through the calendar-notes transport), the name of an attachment or a text attachment contains placeholders of the plugin `pseudonymizer`. Mailstone does not turn these parts back into the original text (a conversion would fold lines and could inject calendar text), and it does not send them with the placeholders in them either. `{0}` is the number of different placeholders; binary attachments are not read.

**Fix:** Create the event or the attachment with the original text instead of the placeholders, then send again.

### "Nothing was sent: {0} placeholders in the recipients belong to forgotten entries."

**Cause:** A recipient (To, Cc or Bcc) is a placeholder of an entry you made the pseudonymizer forget; its address cannot be restored.

**Fix:** Enter the address again, as an address, in the message you send.

### "Nothing was sent: {0} recipient addresses have no usable address after resolving the placeholders."

**Cause:** A recipient was a placeholder, and the entry behind it holds a name or a value that is not an e-mail address (for example a placeholder that belongs to nobody).

**Fix:** Give the recipient as an address, or add the address to the entry in the pseudonymizer.

### "{0} placeholders of forgotten entries are sent as placeholders."

**Cause:** This line in the confirmation dialog for a plugin's message says that the subject or text contains placeholders of forgotten entries: they cannot be turned back and go out as they are. A trusted plugin sends without a dialog, so without this line.

**Fix:** Cancel and ask the sending plugin to leave the passage out, or send as is.

### "Nothing was opened: the sender address or the subject still contains placeholders that cannot be resolved to the original text."

**Cause:** *Reply to a mail in the external mail client* turns the sender and subject of the note back into the original text before it builds the link. A placeholder could not be resolved (unknown, the plugin is locked or missing, an entry was forgotten, or the sender has no address after the conversion), so no mail client opened.

**Fix:** Unlock or set up the plugin `pseudonymizer` and run the command again, or write to the sender by hand.

### There is no .eml next to a new note although *Save original as .eml* is on

**Cause:** While *Pseudonymize* is not *Off*, no `.eml` is stored, because an original is plain text. The choice under *Save original as .eml* stays saved and has no effect.

**Fix:** Nothing is broken. Set *Pseudonymize* to *Off* to get stored originals again. *Remove stored .eml files* moves the ones you already have to the trash.

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
