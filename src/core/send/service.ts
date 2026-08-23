// SendService: bindet Identitaets-/Konto-Aufloesung, MIME-Bau (buildMime) und SMTP-Versand
// (smtpSend) zu einem einzigen Aufruf zusammen. Kein Node-/Obsidian-Import (siehe
// scripts/check-pure.mjs) — Secrets, Transport-Factory und Uhrzeit kommen als Deps von aussen.
import type { Account, Identity } from "../settings";
import { buildMime } from "../mime/build";
import { validateOutgoing, type OutgoingMessage } from "./outgoing";
import { smtpSend, type SmtpErrorCode } from "../smtp/client";
import type { SocketTransport } from "../net/types";

export type SendErrorCode = "unknown-account" | "unknown-identity" | "no-secret" | "invalid" | SmtpErrorCode;

export interface SendDeps {
  accounts: () => Account[];
  secret: (secretId: string) => string | null;
  /** Fabrik statt Instanz: jeder send()-Aufruf bekommt einen frischen Transport. */
  transport: () => SocketTransport;
  now: () => Date;
  /** uuid-artig — Eindeutigkeit reicht, kein bestimmtes Format vorausgesetzt. */
  randomId: () => string;
  log?: (line: string) => void;
}

export interface SendService {
  send(
    accountId: string,
    msg: OutgoingMessage,
  ): Promise<{ ok: true; messageId: string; rejected?: string[] } | { ok: false; code: SendErrorCode; detail?: string }>;
}

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

      if (result.ok) return { ok: true, messageId, ...(result.rejected ? { rejected: result.rejected } : {}) };
      return { ok: false, code: result.code, detail: result.detail };
    },
  };
}
