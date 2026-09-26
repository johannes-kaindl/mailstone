# Getting started

> **Diátaxis: Tutorial.** One guided run from nothing to your first mail note. Plan on ten minutes; the last part needs a mailbox you can reach with an app password.

## 1. Install and enable

Install Mailstone by one of the ways in the [README](https://github.com/johannes-kaindl/mailstone#install) — the [AnySource Sideloader](https://github.com/johannes-kaindl/anysource-sideloader) is the least effort — then enable it under Settings → Community plugins. Mailstone needs **Obsidian 1.13.0 or newer**.

You should now see a mail icon in the left ribbon, and Settings has a **Mailstone** page.

## 2. Get a first note without any account

This step needs no mailbox and no network: Mailstone can turn `.eml` files you already have into notes.

1. Put one or two `.eml` files into a folder of your vault, for example `Import`. Most mail programs can save a message as `.eml`.
2. Open the command palette and run **Mailstone: Import .eml files from a vault folder**.
3. In the dialog *Vault folder containing .eml files*, enter the folder (the field suggests your vault folders) and press **OK**.

A notice reports the result, for example *Imported 2 mails (0 updated, 0 skipped, 0 errors)*. Your notes are now in `Mail/<year>/`, named `<date>-<time>-<subject>.md`, and the original messages sit in `Mail/<year>/_eml/`. Open a note: the front matter carries sender, recipients, date and `mail_id`, and the message body sits between the `%% mailstone:begin %%` and `%% mailstone:end %%` markers. Write your own text **outside** those markers — it is never overwritten.

## 3. Connect your mailbox

Before you start, make two folders on your mail server (in webmail or your mail program): one that will act as the **allowlist** — the default name is `Vault` — and one for the **archive** (default `Archive`). You also need an **app-specific password** from your provider; Mailstone cannot use OAuth.

1. Settings → Mailstone → **Add account**.
2. Fill in IMAP and SMTP: host, port and TLS mode (`Implicit`, usually ports 993 and 465, or `STARTTLS`, usually 143 and 587), and your username.
3. Under **Password**, choose or create an entry in Obsidian's secret storage. The password is stored there, never in the vault. (Later, to change it: add a **new** entry with a new ID rather than reusing the old one — Obsidian silently fails to save under an existing ID.)
4. Add at least one **identity** — a name and an address your provider allows you to send from — and mark one as the default.
5. Under **Folders**, enter the folder names exactly as your IMAP server shows them.
6. Press **Test SMTP connection**, then **OK** to save the account. *Connection ok* means host, TLS and login work. If something is off, [Troubleshooting](how-to/troubleshooting.md) lists every message.

## 4. Sync your first real message

1. On the server, move one message into your allowlist folder — from your phone, from webmail, from a mail rule.
2. Open the sidebar with the mail icon in the ribbon (or **Mailstone: Open the sidebar panel**) and press **Synchronise now** on your account.

The panel shows what the run did (for example *1 new*), and the note appears in `Mail/<year>/`. From here on, Mailstone repeats this every five minutes (adjustable per account). Your message is still unread in your mail program: Mailstone reads without marking anything as read.

## 5. Where to go next

- **Inbox tab.** In the sidebar, switch to **Inbox** to see the last 100 messages of your inbox; **Move to vault** files one into the allowlist folder, **Archive** moves it away. Both ask before they act.
- **Commands on a note.** Open a mail note and try **Mailstone: Relink mail threads** or **Mailstone: Extract an attachment from a mail note** — each shows a preview before it writes.
- **Reference.** The settings tables and the design notes are in the [README](https://github.com/johannes-kaindl/mailstone#configuration).
