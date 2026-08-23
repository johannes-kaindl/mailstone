# mailstone M2 — Transport (SMTP, Versand, calendar-notes-Brücke) · Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mailstone kann über den authentifizierten SMTP eines Kontos eine `OutgoingMessage` verschicken, registriert sich als `MailTransport` bei `calendar-notes` (iMIP) und hat die Konten-/Identitäten-/Secret-Settings dafür — gegen einen Fake-Socket vollständig getestet, ohne echtes Postfach.

**Architecture:** `core/net` definiert das `SocketTransport`-Interface; `core/smtp` ist ein Zustandsautomat darüber (pur, Dialog-getestet); `core/send` verbindet Identitätsprüfung, MIME-Builder (M1) und SMTP; `src/obsidian/tls-transport.ts` implementiert den Socket mit `Platform.isDesktop`-guarded `await import("node:tls")`; `src/obsidian/calendar-notes-bridge.ts` registriert den Transport defensiv. Fehler sind Werte mit Codes, übersetzt nur in `src/obsidian`.

**Tech Stack:** wie M1; zusätzlich `node:tls`/`node:net` (nur `src/obsidian`, nur dynamisch).

**Spec:** `docs/superpowers/specs/2026-08-23-mailstone-design.md` (§ 1.1 SocketTransport, § 2.1 Konten, § 3.3 Versand, § 3.4 Brücke, § 5 Sicherheit)

## Global Constraints

- Alle Constraints aus M1 gelten weiter (check-pure, keine Inline-disables, Herkunftsstempel, Conventional Commits, kein echtes Postfach in Tests).
- Node-Builtins: ausschließlich `Platform.isDesktop`-guarded `await import("node:tls")` / `await import("node:net")` in `src/obsidian/tls-transport.ts`; `tests/bundle.test.ts` bleibt grün.
- Versand nur über den konfigurierten Anbieter-SMTP; Klartext-Auth ohne TLS → `{ok:false, code:"tls-required"}`; Zertifikatsprüfung nicht abschaltbar.
- Passwort nie loggen; im Debug-Log werden `AUTH`-Zeilen als `AUTH PLAIN ****` ausgegeben.
- Absender nur aus `Account.identities`; unbekannte Identity-ID → `unknown-identity`, nie Fallback auf eine Empfängeradresse.
- Typen aus `calendar-notes` (`MailTransport`, `ImipMessage`) werden **kopiert** (`src/core/api/calendar-notes-transport.ts`, Herkunftsstempel), nie importiert.

---

## Dateistruktur (M2, neu)

```
src/core/net/types.ts                  SocketTransport, ConnectOptions, NetErrorCode
src/core/smtp/client.ts                smtpSend(transport, opts) — Zustandsautomat
src/core/smtp/dotstuff.ts              dotStuff(bytes) / Zeilen-Normalisierung
src/core/send/service.ts               createSendService(deps) → send(accountId, msg)
src/core/send/imip.ts                  imipToOutgoing(msg, accounts), transportAccounts(accounts)
src/core/api/calendar-notes-transport.ts  kopierte Typen MailTransport/ImipMessage + CALENDAR_NOTES_API_VERSION
src/obsidian/tls-transport.ts          nodeSocketTransport(): SocketTransport (desktop-only)
src/obsidian/secrets.ts                obsidianSecretStore / MemorySecretStore (aus calendar-notes)
src/obsidian/calendar-notes-bridge.ts  registerWithCalendarNotes(app, transport) / unregister
src/obsidian/settings-tab.ts           + Kontenblock (Liste, Editor, Identitäten, Secret, Verbindung prüfen)
src/obsidian/modals/account-modal.ts   Konto-Editor
src/main.ts                            SendService, Brücke, Kommando „Test-Mail an mich senden"
tests/helpers/fake-socket.ts           FakeSocketTransport mit Skript-Dialog
tests/core/smtp/*.test.ts · tests/core/send/*.test.ts · tests/obsidian/calendar-notes-bridge.test.ts · tests/obsidian/tls-transport.test.ts
```

---

### Task 1: `core/net/types.ts` + `FakeSocketTransport`

**Files:**
- Create: `src/core/net/types.ts`, `tests/helpers/fake-socket.ts`
- Test: `tests/helpers/fake-socket.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // core/net/types.ts
  export type TlsMode = "implicit" | "starttls" | "none";
  export interface ConnectOptions { host: string; port: number; tls: TlsMode; timeoutMs: number; servername?: string }
  export type NetErrorCode = "connect" | "tls" | "timeout" | "closed" | "protocol";
  export class NetError extends Error { constructor(public readonly code: NetErrorCode, message: string) { super(message); this.name = "NetError"; } }
  export interface SocketTransport {
    connect(opts: ConnectOptions): Promise<void>;
    upgradeTls(): Promise<void>;
    write(data: Uint8Array | string): Promise<void>;
    readLine(): Promise<string>;            // ohne CRLF; wirft NetError("closed") bei EOF, NetError("timeout") nach timeoutMs
    readBytes(n: number): Promise<Uint8Array>;
    close(): Promise<void>;
    readonly closed: boolean;
    readonly secure: boolean;               // true nach implizitem TLS oder upgradeTls()
  }
  // tests/helpers/fake-socket.ts
  export interface DialogStep { expect?: RegExp | string /* nächste Client-Zeile(n) matchen; String = exakt */; send?: string[] /* Server-Zeilen danach */; upgrade?: boolean /* STARTTLS-Erwartung: upgradeTls() muss jetzt kommen */ }
  export class FakeSocketTransport implements SocketTransport { constructor(greeting: string[], steps: DialogStep[]); readonly written: string[]; readonly closed: boolean; readonly secure: boolean; readonly connectCalls: ConnectOptions[]; }
  ```
  Verhalten: `connect` setzt `secure = tls === "implicit"` und legt `greeting` in den Lesepuffer; `write` hängt an `written` an, zerlegt in Zeilen; sobald eine vollständige Zeile den nächsten `expect` erfüllt, werden dessen `send`-Zeilen in den Lesepuffer gelegt; `DATA`-Body: der Step mit `expect: /^\.$/` (Ende-Marker) sammelt alle Zeilen davor in `written`; `upgradeTls` setzt `secure = true` und ist nur erlaubt, wenn der aktuelle Step `upgrade: true` trägt (sonst wirft der Fake, damit ein Client nicht zur falschen Zeit upgraded); `readLine` liefert Puffer oder wirft `NetError("closed")`, wenn kein Step mehr sendet.

- [ ] **Step 1: Failing Test** (`tests/helpers/fake-socket.test.ts`): Greeting `["220 fake ESMTP"]`, Steps `[{expect:/^EHLO /, send:["250-fake","250 AUTH PLAIN"]},{expect:/^QUIT$/, send:["221 bye"]}]`; `connect` → `readLine() === "220 fake ESMTP"`; `write("EHLO x\r\n")` → zwei `readLine()`; `write("QUIT\r\n")` → `"221 bye"`; danach `readLine()` wirft `NetError` mit `code: "closed"`. Zweiter Test: `upgradeTls()` ohne `upgrade:true` wirft.
- [ ] **Step 2: Run** → FAIL. **Step 3:** Implementieren (Types wie oben; Fake mit Zeilenpuffer `pending: string[]`, `lineBuf: string`). **Step 4: Run** → PASS. `check:pure` grün (core/net hat keine Imports).
- [ ] **Step 5: Commit** `feat(net): SocketTransport-Vertrag + FakeSocketTransport mit Skript-Dialogen`

---

### Task 2: `core/smtp/dotstuff.ts` + `core/smtp/client.ts`

**Files:**
- Create: `src/core/smtp/dotstuff.ts`, `src/core/smtp/client.ts`
- Test: `tests/core/smtp/dotstuff.test.ts`, `tests/core/smtp/client.test.ts`

**Interfaces:**
- Consumes: `SocketTransport`, `NetError` (Task 1).
- Produces:
  ```ts
  // dotstuff.ts
  export function dotStuff(message: Uint8Array): Uint8Array;   // jede Zeile, die mit "." beginnt, bekommt ein "." davor; stellt sicher, dass die Nachricht mit CRLF endet
  // client.ts
  export type SmtpErrorCode = "tls-required" | "auth" | "sender-rejected" | "recipient-rejected" | "data-rejected" | "protocol" | NetErrorCode;
  export interface SmtpSendOptions { host: string; port: number; tls: "implicit" | "starttls"; username: string; password: string; from: string /* Envelope-Absender */; recipients: string[]; message: Uint8Array; timeoutMs?: number /* 30000 */; log?: (line: string) => void /* maskiert AUTH */ }
  export type SmtpSendResult = { ok: true; response: string } | { ok: false; code: SmtpErrorCode; detail: string; rejected?: string[] };
  export async function smtpSend(transport: SocketTransport, opts: SmtpSendOptions): Promise<SmtpSendResult>;
  ```
  Ablauf: `connect` → Greeting `220` → `EHLO mailstone.local` → Multiline-250 parsen (Capabilities `STARTTLS`, `AUTH …`) → bei `tls:"starttls"`: wenn `STARTTLS` fehlt → `tls-required`; sonst `STARTTLS` → `220` → `upgradeTls()` → erneut `EHLO` → wenn `!transport.secure` → `tls-required` (kein Klartext-Auth) → `AUTH PLAIN <base64("\0user\0pass")>` → `235` sonst `auth` → `MAIL FROM:<from>` → `250` sonst `sender-rejected` → je `RCPT TO:<r>` → `250`/`251` ok, `5xx` sammeln in `rejected` (alle abgelehnt → `recipient-rejected`) → `DATA` → `354` → `dotStuff(message)` + `.` → `250` sonst `data-rejected` → `QUIT` → `close()`. Jede Antwortzeile `^\d{3}[ -]`; anderes → `protocol`. `NetError` → `{ok:false, code: e.code}`. `log` bekommt jede Zeile, `AUTH PLAIN …` als `AUTH PLAIN ****`.

- [ ] **Step 1: Failing Tests**
  - `dotStuff`: `"a\r\n.b\r\n..c"` → `"a\r\n..b\r\n...c\r\n"`; leere Eingabe → `"\r\n"`.
  - `smtpSend` Happy-Path (implicit): Greeting `["220 smtp.example.net ESMTP"]`, Steps EHLO→`["250-smtp.example.net","250-STARTTLS","250 AUTH PLAIN LOGIN"]`, `AUTH PLAIN AHVzZXIAcGFzcw==`→`["235 2.7.0 ok"]`, `MAIL FROM:<mail@example.net>`→`["250 ok"]`, `RCPT TO:<gast@example.org>`→`["250 ok"]`, `DATA`→`["354 go"]`, `/^\.$/`→`["250 2.0.0 queued as abc"]`, `QUIT`→`["221 bye"]`. Erwartung `{ok:true, response:"250 2.0.0 queued as abc"}`; `written` enthält die dot-gestopfte Nachricht; `transport.closed === true`.
  - STARTTLS-Pfad: `connect tls:"starttls"`, `secure` anfangs false; Steps EHLO→250 mit STARTTLS, `STARTTLS`→`["220 ready"]` mit `upgrade:true`, zweites EHLO→…; Erwartung ok und `connectCalls[0].tls === "starttls"`.
  - `tls-required`: starttls ohne STARTTLS-Capability → `{ok:false, code:"tls-required"}` und **kein** `AUTH` in `written`.
  - `auth`: `535 5.7.8 bad credentials` → `code:"auth"`, `detail` enthält `535`.
  - Teilweise abgelehnte Empfänger: zwei RCPT, einer `550` → ok:true, aber `rejected` … — Entscheidung: `smtpSend` liefert bei mindestens einem akzeptierten Empfänger `ok:true` und (neu im Typ) `rejected?: string[]` auch im ok-Zweig; Test prüft `rejected: ["bad@example.org"]`. (Typ anpassen: `{ ok: true; response: string; rejected?: string[] }`.)
  - Log-Maskierung: `log`-Spy erhält `C: AUTH PLAIN ****`, nie den Base64-Wert.
- [ ] **Step 2: Run** → FAIL. **Step 3:** Implementieren (Hilfsfunktion `readResponse(): Promise<{code:number; lines:string[]}>`, die Multiline `250-…` sammelt bis `250 `). **Step 4:** PASS, `check:pure` grün.
- [ ] **Step 5: Commit** `feat(smtp): SMTP-Client (EHLO/STARTTLS/AUTH PLAIN/MAIL/RCPT/DATA) als Zustandsautomat ueber SocketTransport`

---

### Task 3: `src/obsidian/tls-transport.ts` — Node-Socket hinter Desktop-Guard

**Files:**
- Create: `src/obsidian/tls-transport.ts`
- Test: `tests/obsidian/tls-transport.test.ts`

**Interfaces:**
- Produces: `export function nodeSocketTransport(): SocketTransport` und `export async function loadNodeNet(): Promise<{ tls: typeof import("node:tls"); net: typeof import("node:net") } | null>` (null auf Mobile).

- [ ] **Step 1: Failing Test:** `loadNodeNet()` liefert in Vitest (Node, `Platform.isDesktop` im Mock = true — prüfen/setzen über `tests/__mocks__/obsidian.ts`, dort `Platform` exportieren mit `isDesktop: true, isMobile: false`) ein Objekt mit `tls.connect`; mit `Platform.isDesktop=false` (Mock temporär umschalten) `null`. Zweiter Test: `nodeSocketTransport().connect({ host: "127.0.0.1", port: <freier Port eines lokalen net.Server aus dem Test>, tls: "none", timeoutMs: 1000 })` → Server sendet `"220 hi\r\n"` → `readLine() === "220 hi"`; `write("X\r\n")` kommt beim Server an; `close()` → `closed`. Dritter Test: Verbindung zu geschlossenem Port → `NetError` mit `code:"connect"`; `readLine`-Timeout (Server schweigt, `timeoutMs: 200`) → `code:"timeout"`. (Tests nutzen `node:net` direkt — erlaubt in `tests/`.)
- [ ] **Step 2: Run** → FAIL. **Step 3: Implementierung**

```ts
// src/obsidian/tls-transport.ts
import { Platform } from "obsidian";
import { NetError, type ConnectOptions, type SocketTransport } from "../core/net/types";

type NodeTls = typeof import("node:tls"); type NodeNet = typeof import("node:net");
export async function loadNodeNet(): Promise<{ tls: NodeTls; net: NodeNet } | null> {
  if (!Platform.isDesktop) return null;
  // Registry § Node-Builtin desktop-only: dynamischer Import ist die einzige store-saubere Form;
  // esbuild-Plugin node-builtin-require schreibt ihn im Bundle auf require() um.
  const [tls, net] = await Promise.all([import("node:tls"), import("node:net")]);
  return { tls, net };
}

export function nodeSocketTransport(): SocketTransport {
  let sock: import("node:net").Socket | null = null; let buf = Buffer.alloc(0); let eof = false; let err: Error | null = null;
  let waiter: (() => void) | null = null; let timeoutMs = 30000; let secure = false; let hostName = "";
  const wake = (): void => { const w = waiter; waiter = null; w?.(); };
  const attach = (s: import("node:net").Socket): void => {
    sock = s; s.on("data", (d: Buffer) => { buf = Buffer.concat([buf, d]); wake(); }); s.on("end", () => { eof = true; wake(); });
    s.on("close", () => { eof = true; wake(); }); s.on("error", (e: Error) => { err = e; eof = true; wake(); });
  };
  const waitData = (): Promise<void> => new Promise((res, rej) => {
    const t = setTimeout(() => { waiter = null; rej(new NetError("timeout", `no data within ${timeoutMs} ms`)); }, timeoutMs);
    waiter = () => { clearTimeout(t); res(); };
  });
  return {
    get closed() { return sock === null || eof; }, get secure() { return secure; },
    async connect(opts: ConnectOptions) {
      const mods = await loadNodeNet(); if (!mods) throw new NetError("connect", "desktop only");
      timeoutMs = opts.timeoutMs; hostName = opts.servername ?? opts.host;
      await new Promise<void>((res, rej) => {
        const onErr = (e: Error): void => rej(new NetError(opts.tls === "implicit" ? "tls" : "connect", e.message));
        if (opts.tls === "implicit") { const s = mods.tls.connect({ host: opts.host, port: opts.port, servername: hostName }, () => { secure = true; res(); }); s.once("error", onErr); attach(s); }
        else { const s = mods.net.connect({ host: opts.host, port: opts.port }, () => res()); s.once("error", onErr); attach(s); }
      });
    },
    async upgradeTls() {
      const mods = await loadNodeNet(); if (!mods || !sock) throw new NetError("tls", "no socket");
      const plain = sock;
      await new Promise<void>((res, rej) => {
        const s = mods.tls.connect({ socket: plain, servername: hostName }, () => { secure = true; res(); });
        s.once("error", (e: Error) => rej(new NetError("tls", e.message)));
        plain.removeAllListeners("data"); attach(s);
      });
    },
    async write(data) { if (!sock || eof) throw new NetError("closed", "socket closed"); await new Promise<void>((res, rej) => sock!.write(data, (e) => (e ? rej(new NetError("closed", e.message)) : res()))); },
    async readLine() {
      for (;;) {
        const i = buf.indexOf("\r\n");
        if (i >= 0) { const line = buf.subarray(0, i).toString("utf8"); buf = buf.subarray(i + 2); return line; }
        if (err) throw new NetError("closed", err.message); if (eof) throw new NetError("closed", "EOF");
        await waitData();
      }
    },
    async readBytes(n) {
      while (buf.length < n) { if (err) throw new NetError("closed", err.message); if (eof) throw new NetError("closed", "EOF"); await waitData(); }
      const out = new Uint8Array(buf.subarray(0, n)); buf = buf.subarray(n); return out;
    },
    async close() { if (sock && !eof) await new Promise<void>((res) => sock!.end(() => res())); eof = true; },
  };
}
```
`Buffer` ist ein Node-Global — in `src/obsidian` erlaubt (nicht `core`); `tsconfig.json` hat `types: []` → für diese Datei `import type { Buffer } from "node:buffer"` wäre ein statischer Node-Import (verboten) → stattdessen `@types/node` über `tsconfig.json` `"types": ["node"]` **nur dann** aufnehmen, wenn der Typecheck es verlangt; Alternative ohne Typabhängigkeit: `Uint8Array`-Puffer mit eigener `indexOf`-CRLF-Suche und `TextDecoder` — **bevorzugt**, weil `check-no-inline-disables` und `types: []` unangetastet bleiben. Der Implementierer wählt die `Uint8Array`-Variante, wenn `tsc` über `Buffer` stolpert.

- [ ] **Step 4: Run** → PASS; `npm run build` → ok; `npm test` → `bundle.test.ts` grün (der dynamische Import ist im Bundle als `require` umgeschrieben — prüfen: `grep -c 'require("node:tls")' main.js` ≥ 1).
- [ ] **Step 5: Commit** `feat(obsidian): Node-Socket-Transport (tls/net) hinter Platform.isDesktop-Guard`

---

### Task 4: `core/send/service.ts` + `core/send/imip.ts` + kopierte Vertragstypen

**Files:**
- Create: `src/core/send/service.ts`, `src/core/send/imip.ts`, `src/core/api/calendar-notes-transport.ts`
- Test: `tests/core/send/service.test.ts`, `tests/core/send/imip.test.ts`

**Interfaces:**
- Consumes: `OutgoingMessage`/`validateOutgoing` (M1 Task 7), `buildMime` (M1 Task 7), `smtpSend` (Task 2), `Account`/`Identity` (M1 Task 8), `SocketTransport`.
- Produces:
  ```ts
  // core/api/calendar-notes-transport.ts  — Zeile 1: "// uebernommen (Typen kopiert) aus calendar-notes/src/core/api/types.ts + src/core/commands/imip.ts, 2026-08-23"
  export const CALENDAR_NOTES_API_VERSION = 1 as const;
  export interface ImipMessage { method: "REQUEST" | "CANCEL" | "REPLY"; from: string; to: string[]; subject: string; text: string; ics: string }
  export interface MailTransport { id: string; label: string; accounts(): Promise<{ id: string; address: string; label: string }[]>; send(msg: ImipMessage): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> }
  export interface CalendarNotesApiSubset { version: number; registerMailTransport(t: MailTransport): unknown; unregisterMailTransport(id: string): unknown }
  // core/send/service.ts
  export type SendErrorCode = "unknown-account" | "unknown-identity" | "no-secret" | "invalid" | SmtpErrorCode;
  export interface SendDeps { accounts: () => Account[]; secret: (secretId: string) => string | null; transport: () => SocketTransport; now: () => Date; randomId: () => string /* uuid-artig */; log?: (line: string) => void }
  export interface SendService { send(accountId: string, msg: OutgoingMessage): Promise<{ ok: true; messageId: string; rejected?: string[] } | { ok: false; code: SendErrorCode; detail?: string }> }
  export function createSendService(deps: SendDeps): SendService;
  export function resolveSender(accounts: Account[], accountId: string, identityId: string): { ok: true; account: Account; identity: Identity } | { ok: false; code: "unknown-account" | "unknown-identity" };
  // core/send/imip.ts
  export function transportAccounts(accounts: Account[]): { id: string; address: string; label: string }[];   // id = `${account.id}/${identity.id}`, label = `${identity.name || identity.address} (${account.label})`
  export function splitTransportId(id: string): { accountId: string; identityId: string } | null;
  export function imipToOutgoing(msg: ImipMessage): { accountId: string; outgoing: OutgoingMessage } | { error: "bad-from" };
  ```
  `send()`: `resolveSender` → `validateOutgoing` (→ `invalid`) → Secret (`no-secret`) → `messageId = `${randomId()}@${domainOf(identity.address)}`` → `buildMime(msg, { sender: identity, messageId, date: now() })` → `smtpSend(transport(), { host/port/tls aus account.smtp, username: account.username, password, from: identity.address, recipients: envelopeRecipients, message })` → Ergebnis mappen.

- [ ] **Step 1: Failing Tests**
  - `resolveSender`: unbekanntes Konto/Identity → Codes; bekannt → Objekt.
  - `transportAccounts` mit zwei Konten × Identitäten → IDs `privat/mail`, `privat/kontakt`, `arbeit/mail`; `splitTransportId("privat/mail")` → `{accountId:"privat", identityId:"mail"}`; `"kaputt"` → null.
  - `imipToOutgoing({method:"REQUEST", from:"privat/mail", to:[...], subject, text, ics})` → `outgoing.calendar.method === "REQUEST"`, `outgoing.from === "mail"`, `accountId === "privat"`; `from:"x"` → `{error:"bad-from"}`.
  - `createSendService` Happy-Path mit `FakeSocketTransport` (Dialog wie Task 2) → `{ok:true, messageId: /@example\.net$/}`; der an den Fake geschriebene `DATA`-Body enthält `From: Max Muster <mail@example.net>` und `To: gast@example.org`; Envelope `MAIL FROM:<mail@example.net>`.
  - Catch-All-Falle: `send("privat", { from: "dienst-kennung", … })` → `unknown-identity`, Fake-Transport wurde **nicht** verbunden (`connectCalls.length === 0`).
  - `no-secret`: `secret: () => null` → Code, kein connect.
  - SMTP-Fehler wird durchgereicht: Fake antwortet `535` → `{ok:false, code:"auth"}`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** Implementieren. **Step 4:** PASS, `check:pure` grün.
- [ ] **Step 5: Commit** `feat(send): SendService (Identitaetspruefung, Message-ID, MIME→SMTP) + iMIP-Abbildung + kopierte calendar-notes-Typen`

---

### Task 5: Secrets + Settings-Tab Kontenblock + Konto-Editor

**Files:**
- Create: `src/obsidian/secrets.ts` (Kopie aus `calendar-notes/src/obsidian/secrets.ts`, Herkunftsstempel; `SecretStore`-Interface lokal in `src/core/send/secrets.ts` definieren: `{ get(id): string|null; set(id, v): void; has(id): boolean }`), `src/obsidian/modals/account-modal.ts`
- Modify: `src/obsidian/settings-tab.ts`, `src/i18n/strings.ts`
- Test: `tests/obsidian/secrets.test.ts` (MemorySecretStore; obsidianSecretStore gegen Mock-`app.secretStorage` — im Mock ergänzen, falls fehlend: `secretStorage: { getSecret(id), setSecret(id,v) }` mit Map)

**Settings-UI (Obsidian-nativ, `Setting`-Komponenten, Kit `settings_walker` für Listen, `confirm` für Löschen):**
- Abschnitt „Accounts": Liste (Label, Host, Anzahl Identitäten) mit Buttons Bearbeiten/Entfernen (Entfernen mit `confirm`, entfernt auch das Secret: `secrets.set(secretId, "")`), Button „Add account" → `AccountModal` mit neuem `newAccount(id)` (`id` = Slug aus Label, Kollision `-2`).
- `AccountModal` (Muster `SchemaFormModal`-Layout aus calendar-notes, aber feste Felder): Label; IMAP Host/Port/TLS-Dropdown (implicit/starttls); SMTP Host/Port/TLS; Username; **Passwort:** `new SecretComponent(app, setting.controlEl).setValue(account.secretId).onChange(v => secrets.set(account.secretId, v))` mit `setDesc(t("settings.account.secret.desc"))` = „Use an app-specific password from your provider, not your account password (2FA). Stored in Obsidian's secret storage, not in the vault."; Identitäten: Liste (Name, Adresse, Default-Radio) + „Add identity" (Adresse-Validierung wie `validateOutgoing`) + Hinweis „Only addresses your provider allows you to send from — catch-all or alias names without send permission will be rejected."; Ordner inbox/allowlist/archive/sent (Textfelder, Default-Werte sichtbar; Hinweis „Folder names as shown by your IMAP server"); Sync-Toggle + Intervall; Buttons „Save" / „Cancel" / **„Test SMTP connection"** (ruft `smtpProbe(account)` → `EHLO`+`AUTH`+`QUIT` ohne MAIL FROM über `smtpSend`-internen Pfad; dafür in `core/smtp/client.ts` `smtpProbe(transport, opts: Omit<SmtpSendOptions,"from"|"recipients"|"message">): Promise<{ok:true; capabilities:string[]}|{ok:false; code; detail}>` ergänzen, mit eigenem Dialog-Test).
- i18n-Keys: `settings.accounts`, `settings.accounts.add`, `settings.account.label`, `settings.account.imap`, `settings.account.smtp`, `settings.account.host`, `settings.account.port`, `settings.account.tls`, `settings.account.tls.implicit`, `settings.account.tls.starttls`, `settings.account.username`, `settings.account.secret`, `settings.account.secret.desc`, `settings.account.identities`, `settings.account.identities.add`, `settings.account.identities.hint`, `settings.account.identity.name`, `settings.account.identity.address`, `settings.account.identity.default`, `settings.account.folders`, `settings.account.folders.inbox|allowlist|archive|sent`, `settings.account.sync`, `settings.account.sync.interval`, `settings.account.test`, `settings.account.test.ok`, `settings.account.test.fail`, `settings.account.remove`, `settings.account.remove.confirm`, `error.send.<code>` für alle `SendErrorCode`s (EN + DE).

- [ ] **Step 1: Failing Tests** (`secrets.test.ts`: Memory-Store get/set/has; Obsidian-Store wirft, wenn `setSecret` nicht persistiert — Mock, dessen `getSecret` immer null liefert). `tests/core/smtp/client.test.ts` um `smtpProbe`-Dialog ergänzen (EHLO → AUTH → QUIT, `capabilities` enthält `"AUTH PLAIN LOGIN"`).
- [ ] **Step 2: Run** → FAIL. **Step 3:** Implementieren (UI-Dateien werden durch `npm run lint` + Typecheck geprüft; `eslint-plugin-obsidianmd` verlangt `Setting`-Definitionen statt roher DOM-Inputs — `settings-tab/prefer-setting-definitions`). **Step 4:** `npm run gate` grün.
- [ ] **Step 5: Manuelle Probe:** Deploy in den Test-Vault, Konto anlegen, Secret setzen, Obsidian neu laden → Secret bleibt (SecretStorage), `data.json` enthält **kein** Passwort (prüfen mit `grep`). „Test SMTP connection" gegen ein erreichbares Postfach ist erst nach ④ möglich — stattdessen gegen `scripts/fake-smtp.mjs` (Task 7).
- [ ] **Step 6: Commit** `feat(settings): Konten/Identitaeten/Secrets-UI mit App-Passwort-Hinweis und SMTP-Probe`

---

### Task 6: `calendar-notes`-Brücke

**Files:**
- Create: `src/obsidian/calendar-notes-bridge.ts`
- Test: `tests/obsidian/calendar-notes-bridge.test.ts`

**Interfaces:**
- Consumes: `MailTransport`, `CalendarNotesApiSubset`, `CALENDAR_NOTES_API_VERSION` (Task 4), `SendService`, `transportAccounts`, `imipToOutgoing`.
- Produces:
  ```ts
  export function readCalendarNotesApi(app: App): CalendarNotesApiSubset | null;   // frisch lesen: (app as any).plugins?.plugins?.["calendar-notes"]?.api; Form prüfen: version === 1 && typeof registerMailTransport === "function" && typeof unregisterMailTransport === "function"; sonst null
  export function buildMailTransport(deps: { accounts: () => Account[]; sendService: SendService; label: string }): MailTransport;   // id "mailstone"; accounts() → transportAccounts; send(imip) → imipToOutgoing → sendService.send → {ok:true,messageId} | {ok:false,error:<code>}
  export function createCalendarNotesBridge(app: App, transport: MailTransport): { tryRegister(): boolean; unregister(): void; readonly registered: boolean };
  ```
  `tryRegister()` ist idempotent; `unregister()` liest die API erneut frisch (der Nachbar kann inzwischen entladen sein → dann no-op). `main.ts` ruft `tryRegister()` in `onload` (nach Aufbau des SendService), erneut in `app.workspace.onLayoutReady`, und registriert einen `window.setInterval`-freien Re-Versuch über `this.registerEvent(this.app.workspace.on("layout-change", …))` nur solange `!registered` (Plugin-Reihenfolge beim Start ist sonst Glückssache). Zugriff auf `app.plugins` ist nicht in den Typen → lokales Interface `AppWithPlugins` casten (Muster `koda-agent/src/obsidian/retrieval.ts`).

- [ ] **Step 1: Failing Tests:** Stub-`app` mit `plugins.plugins["calendar-notes"].api = { version: 1, registerMailTransport: vi.fn(), unregisterMailTransport: vi.fn() }` → `tryRegister()` true, `registerMailTransport` mit Objekt `id:"mailstone"` aufgerufen; ohne Plugin → false; mit `version: 2` → false; `api` ohne `unregisterMailTransport` → false; `unregister()` nach Entladen des Nachbarn (api = undefined) wirft nicht. `buildMailTransport(...).accounts()` liefert `privat/mail`-IDs; `send(imip)` mit `from:"privat/mail"` ruft `sendService.send("privat", …)` und gibt `{ok:true, messageId}`; mit `from:"x"` → `{ok:false, error:"bad-from"}`; SendService-Fehler → `{ok:false, error:"auth"}`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** Implementieren. **Step 4:** PASS, lint grün.
- [ ] **Step 5: Commit** `feat(bridge): Transport-Registrierung bei calendar-notes — frisch lesen, Form pruefen, idempotent`

---

### Task 7: Fake-SMTP-Server (Maintainer-Skript) + Verdrahtung + Kommando „Test-Mail an mich"

**Files:**
- Create: `scripts/fake-smtp.mjs` (Node: `net.createServer` auf 127.0.0.1:2525, spielt den Dialog aus Task 2 nach, akzeptiert AUTH PLAIN beliebig, schreibt empfangene Nachrichten nach `.fake-smtp/<n>.eml` (gitignored); **kein TLS** — deshalb nur mit `tls:"none"`-Transport erreichbar, und `tls:"none"` ist in den Settings **nicht** wählbar: der Transport akzeptiert `none` ausschließlich, wenn `host` `127.0.0.1`/`localhost` ist — Guard in `core/send/service.ts`: `tls === "none" && !isLoopback(host)` → `tls-required`. Settings-Dropdown bietet `none` nicht an; für den Fake-Test setzt der Maintainer `"tls": "none"` von Hand in `data.json`.)
- Modify: `src/main.ts` (SendService + Brücke + Kommando), `src/i18n/strings.ts`, `.gitignore` (`.fake-smtp/`), `docs/SMOKE.md`
- Test: `tests/core/send/service.test.ts` (+ Loopback-Guard-Test: `tls:"none"` + `host:"smtp.example.net"` → `tls-required`; + `host:"127.0.0.1"` → geht durch)

- [ ] **Step 1:** Guard-Tests schreiben → FAIL → Guard implementieren → PASS.
- [ ] **Step 2: `main.ts` erweitern:**
```ts
// Auszug
this.secrets = obsidianSecretStore(this.app);
this.sendService = createSendService({
  accounts: () => this.settings.accounts, secret: (id) => this.secrets.get(id), transport: () => nodeSocketTransport(),
  now: () => new Date(), randomId: () => crypto.randomUUID(), log: this.settings.debugLog ? (l) => console.debug("[mailstone smtp]", l) : undefined,
});
this.bridge = createCalendarNotesBridge(this.app, buildMailTransport({ accounts: () => this.settings.accounts, sendService: this.sendService, label: "Mailstone" }));
this.bridge.tryRegister();
this.app.workspace.onLayoutReady(() => { this.bridge.tryRegister(); });
this.registerEvent(this.app.workspace.on("layout-change", () => { if (!this.bridge.registered) this.bridge.tryRegister(); }));
this.addCommand({ id: "send-test-mail", name: t("cmd.sendTest.name"), callback: () => this.sendTestMail() });
// onunload: this.bridge.unregister();
```
`sendTestMail()`: Konto-/Identitäts-Auswahl (`SuggestModal` bei > 1, sonst Default), Versand an die eigene Identitäts-Adresse mit Betreff `Mailstone test` und Text mit Zeitstempel; Ergebnis als Notice (`notice.sendTest.ok` / `error.send.<code>`). `crypto.randomUUID()` ist Web-Crypto (Renderer + Node ≥ 19) — kein Node-Import.
- [ ] **Step 3:** `npm run gate` grün; `node scripts/fake-smtp.mjs` starten, Test-Konto mit `127.0.0.1:2525`, `tls:"none"` (manuell in `data.json`) → Kommando „Send test mail" → Datei in `.fake-smtp/1.eml` enthält `Subject: Mailstone test` und korrekte `From:`. Festhalten in `docs/SMOKE.md`.
- [ ] **Step 4: Commit** `feat: SendService + calendar-notes-Bruecke verdrahtet, Kommando Test-Mail, Fake-SMTP-Skript`

---

## Self-Review (Plan gegen Spec)

- § 1.1 `SocketTransport` (1), Desktop-Guard + Bundle (3) ✔ · § 2.1 Konten/Identitäten/Secrets/Hilfetext/Mehrkonto/„Verbindung prüfen" SMTP-Teil (5; IMAP-Teil M3) ✔ · § 3.3 Versand inkl. `unknown-identity`, TLS-Pflicht, AUTH PLAIN, bcc-Envelope, Message-ID (2/4) — `APPEND` in Gesendet braucht IMAP → **M3** (im M3-Plan: `SendService` bekommt optionales `afterSend(account, bytes)`-Hook) ✔ · § 3.4 Brücke frisch lesen/Form/idempotent/unregister (6) ✔ · § 5 Passwort-Maskierung (2), Zertifikatsprüfung nicht abschaltbar (3: kein `rejectUnauthorized:false`), Loopback-Guard für `none` (7) ✔ · § 6 Fake-Dialog-Tests (1/2/4), Fake-Server (7), GUI-Smoke → M4 ✔.
- Platzhalter: Task-1/2-Tests sind beschrieben statt voll ausgeschrieben — Dialog-Schritte und Erwartungen sind aber vollständig angegeben; der Implementierer schreibt die `it(...)`-Blöcke daraus (Referenzstil: M1 Task 3). ✔
- Typ-Konsistenz: `SmtpSendResult` erweitert um `rejected` im ok-Zweig (2, 4); `SendErrorCode` schließt `SmtpErrorCode` ein (4, 5 i18n-Keys); `MailTransport`-Kopie (4, 6) ✔.
