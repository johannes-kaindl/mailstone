// SendService: bindet Identitaets-/Konto-Aufloesung, MIME-Bau (buildMime) und SMTP-Versand
// (smtpSend) zu einem einzigen Aufruf zusammen. Kein Node-/Obsidian-Import (siehe
// scripts/check-pure.mjs) — Secrets, Transport-Factory und Uhrzeit kommen als Deps von aussen.
import type { Account, Identity } from "../settings";
import { buildMime } from "../mime/build";
import { validateOutgoing, type OutgoingMessage } from "./outgoing";
import { smtpSend, type SmtpErrorCode } from "../smtp/client";
import type { SocketTransport } from "../net/types";
import { imapConnect } from "../imap/client";
import type { TimeoutTimers } from "../../vendor/code-kit/timeout";

export type SendErrorCode = "unknown-account" | "unknown-identity" | "no-secret" | "invalid" | SmtpErrorCode;

export interface SendDeps {
  accounts: () => Account[];
  secret: (secretId: string) => string | null;
  /** Fabrik statt Instanz: jeder send()-Aufruf bekommt einen frischen Transport. */
  transport: () => SocketTransport;
  /** Zweite Fabrik fuer die Ablage im Sent-Ordner (IMAP). Fehlt sie, unterbleibt die Kopie —
   *  so bleiben Aufrufer, die nur versenden wollen, ohne IMAP-Abhaengigkeit. */
  imapTransport?: () => SocketTransport;
  /** Timer-Port fuer den IMAP-Schritt (withTimeout). Nur noetig, wenn imapTransport gesetzt ist. */
  timers?: TimeoutTimers;
  now: () => Date;
  /** uuid-artig — Eindeutigkeit reicht, kein bestimmtes Format vorausgesetzt. */
  randomId: () => string;
  log?: (line: string) => void;
}

export interface SendService {
  send(
    accountId: string,
    msg: OutgoingMessage,
  ): Promise<{ ok: true; messageId: string; rejected?: string[]; sentCopy: SentCopyResult } | { ok: false; code: SendErrorCode; detail?: string }>;
}

/** Was mit der Kopie im Sent-Ordner geschah. `skipped` heisst: nicht versucht (kein Ordner
 *  konfiguriert oder keine IMAP-Fabrik) — nicht etwa fehlgeschlagen. */
export type SentCopyResult = "ok" | "failed" | "skipped";

export type ResolveSenderResult =
  | { ok: true; account: Account; identity: Identity }
  | { ok: false; code: "unknown-account" | "unknown-identity" };

export function resolveSender(accounts: Account[], accountId: string, identityId: string): ResolveSenderResult {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return { ok: false, code: "unknown-account" };
  const identity = account.identities.find((i) => i.id === identityId);
  if (!identity) return { ok: false, code: "unknown-identity" };
  return { ok: true, account, identity };
}

/** Loopback-Adressen, fuer die ein Konto mit smtp.tls==="none" (nur ueber data.json erreichbar,
 *  die Settings-UI bietet den Wert nie an) unverschluesselt versenden darf — z. B. ein lokaler
 *  Fake-SMTP-Server fuer Tests/Debugging. Jeder andere Host wird mit "tls-required" abgewiesen,
 *  BEVOR ueberhaupt verbunden wird. */
export function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function domainOf(address: string): string {
  const at = address.indexOf("@");
  return at === -1 ? address : address.slice(at + 1);
}

export function createSendService(deps: SendDeps): SendService {
  return {
    async send(accountId, msg) {
      const resolved = resolveSender(deps.accounts(), accountId, msg.from);
      if (!resolved.ok) return { ok: false, code: resolved.code };
      const { account, identity } = resolved;

      const validation = validateOutgoing(msg);
      if (!validation.ok) return { ok: false, code: "invalid", detail: validation.code };

      const password = deps.secret(account.secretId);
      if (password === null) return { ok: false, code: "no-secret" };

      const messageId = `${deps.randomId()}@${domainOf(identity.address)}`;
      let built: { bytes: Uint8Array; envelopeRecipients: string[] };
      try {
        built = buildMime(msg, { sender: identity, messageId, date: deps.now() });
      } catch (e) {
        return { ok: false, code: "invalid", detail: String(e) };
      }

      if (account.smtp.tls === "none" && !isLoopback(account.smtp.host)) {
        return { ok: false, code: "tls-required" };
      }

      const result = await smtpSend(deps.transport(), {
        host: account.smtp.host,
        port: account.smtp.port,
        tls: account.smtp.tls,
        username: account.username,
        password,
        from: identity.address,
        recipients: built.envelopeRecipients,
        message: built.bytes,
        ...(deps.log ? { log: deps.log } : {}),
        ...(account.smtp.tls === "none" && isLoopback(account.smtp.host) ? { allowInsecureAuth: true } : {}),
      });

      if (!result.ok) return { ok: false, code: result.code, detail: result.detail };

      // Die Kopie ist ein eigener Vorgang: sie darf einen bereits zugestellten Versand nicht
      // nachtraeglich als Fehlschlag ausgeben. Ihr Ausgang steht deshalb im Ergebnis, nicht im ok.
      const sentCopy = await ablegenImSent(deps, account, built.bytes, password);
      return { ok: true, messageId, ...(result.rejected ? { rejected: result.rejected } : {}), sentCopy };
    },
  };
}

/** Legt die gerade versandte Nachricht im Sent-Ordner des Kontos ab. Jeder Fehlschlag bleibt
 *  hier — der Aufrufer erfaehrt ihn als Wert, nie als Ausnahme. */
async function ablegenImSent(
  deps: SendDeps,
  account: Account,
  bytes: Uint8Array,
  password: string,
): Promise<SentCopyResult> {
  const ordner = account.folders.sent;
  if (!ordner || !deps.imapTransport || !deps.timers) return "skipped";
  try {
    const verbunden = await imapConnect(deps.imapTransport(), {
      host: account.imap.host,
      port: account.imap.port,
      tls: account.imap.tls,
      username: account.username,
      password,
      timers: deps.timers,
      ...(isLoopback(account.imap.host) ? { allowInsecureAuth: true } : {}),
      ...(deps.log ? { log: deps.log } : {}),
    });
    if (!verbunden.ok) {
      deps.log?.(`Sent-Kopie: Verbindung fehlgeschlagen (${verbunden.code})`);
      return "failed";
    }
    try {
      // \Seen, weil der Nutzer die Mail selbst geschrieben hat — sie als ungelesen abzulegen
      // wuerde in jedem Mailclient einen falschen Zaehler erzeugen.
      const r = await verbunden.session.append(ordner, bytes, ["\\Seen"]);
      if (!r.ok) deps.log?.(`Sent-Kopie: APPEND abgelehnt (${r.code}) ${r.detail}`);
      return r.ok ? "ok" : "failed";
    } finally {
      await verbunden.session.logout();
    }
  } catch (e) {
    deps.log?.(`Sent-Kopie: ${e instanceof Error ? e.message : String(e)}`);
    return "failed";
  }
}
