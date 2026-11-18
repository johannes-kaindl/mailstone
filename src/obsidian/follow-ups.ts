// „Folge-Mails anzeigen“ (A1): die Obsidian-Seite des lesenden Laufs. Verbindet Konten, Schluesselbund, Socket und Vault-Stand
// mit dem Kern (`runFollowUps`) und dem Dialog. Nur am Desktop (der Aufrufer prueft `networkFeaturesAvailable`).
import type { App } from "obsidian";
import { imapConnect } from "../core/imap/client";
import type { MailProfile } from "../core/mirror/profile";
import { isLoopback } from "../core/send/service";
import type { Account } from "../core/settings";
import type { FollowAccount, FollowRunDeps } from "../core/thread/follow-run";
import { runFollowUps } from "../core/thread/follow-run";
import type { BusyGuard } from "../vendor/code-kit/busy-guard";
import { followContext } from "./follow-context";
import { FollowUpsModal } from "./modals/follow-ups-modal";
import { nodeSocketTransport } from "./tls-transport";

export interface FollowUpsHost {
  app: App;
  busy: BusyGuard;
  profile(): MailProfile;
  accounts(): readonly Account[];
  /** Das Passwort zu einer Schluesselbund-ID, `null` ohne Eintrag. */
  secret(secretId: string): string | null;
}

/** Posteingang und Gesendet-Ordner je Konto; ein Konto ohne Gesendet-Ordner (altes `data.json`) liest nur den Posteingang. */
export function followAccounts(accounts: readonly Account[]): FollowAccount[] {
  return accounts.map((a) => ({ id: a.id, label: a.label || a.id, folders: { inbox: a.folders.inbox, sent: a.folders.sent ?? "" } }));
}

export function followRunDeps(host: FollowUpsHost, ctx: ReturnType<typeof followContext>): FollowRunDeps {
  return {
    accounts: () => followAccounts(host.accounts()),
    connect: async (fa) => {
      const acc = host.accounts().find((a) => a.id === fa.id);
      if (!acc) return { ok: false, code: "connect", detail: "Konto nicht mehr vorhanden" };
      const pw = host.secret(acc.secretId);
      if (pw === null) return { ok: false, code: "no-secret", detail: "kein Geheimnis hinterlegt" };
      // Lesend: imapConnect, nie imapConnectWritable (.claude/rules/imap-vertrag.md).
      return imapConnect(nodeSocketTransport(), {
        host: acc.imap.host, port: acc.imap.port, tls: acc.imap.tls,
        username: acc.username, password: pw, timers: window,
        ...(isLoopback(acc.imap.host) ? { allowInsecureAuth: true } : {}),
      });
    },
    busy: host.busy,
    context: () => ctx,
    now: () => new Date(),
  };
}

export function openFollowUps(host: FollowUpsHost): void {
  new FollowUpsModal(host.app, {
    context: () => followContext(host.app, host.profile()),
    run: (ctx) => runFollowUps(followRunDeps(host, ctx)),
    openNote: (path) => { void host.app.workspace.openLinkText(path, "", false); },
  }).open();
}
