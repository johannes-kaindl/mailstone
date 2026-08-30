# mailstone M3 — IMAP-Client + Allowlist-Sync · Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mailstone holt aus dem Allowlist-Ordner eines IMAP-Kontos die dort liegenden Mails, legt für jede neue eine Notiz plus `.eml` im Vault an, setzt `mail_state` auf `detached`, wenn eine Mail den Ordner verlassen hat, und auf `live`, wenn sie zurückkehrt — periodisch und per Kommando, vollständig gegen einen Fake-Socket getestet, ohne echtes Postfach.

**Architecture:** `core/imap` ist ein reiner Zustandsautomat über dem bestehenden `SocketTransport` aus M2 (Parser mit Literalen, Kommando-Builder, Session-API); `core/sync` verbindet ihn mit `core/mirror` zu einem Lauf pro Konto und liefert `NotePlan[]`, die ausschließlich der `PlanExecutor` schreibt. Der Sync entscheidet nichts über den Inhalt einer bestehenden Notiz (`allowUpdate: false`) — er legt Neues an und setzt Zustand. Fehler sind Werte mit Codes, übersetzt erst in `src/obsidian`.

**Tech Stack:** wie M1/M2; keine neuen Laufzeit-Abhängigkeiten. IMAP-Subset selbst gebaut (RFC 3501: `CAPABILITY`, `AUTHENTICATE PLAIN`/`LOGIN`, `EXAMINE`, `UID SEARCH`, `UID FETCH`, `LOGOUT`).

**Spec:** `docs/superpowers/specs/2026-08-23-mailstone-design.md` (§ 1.1 Schnitt/SocketTransport, § 2.2 Die Mail-Notiz, § 3.1 Allowlist-Sync, § 5 Fehlerbehandlung)

**Vorgänger:** `docs/superpowers/plans/2026-08-23-mailstone-m2-transport.md` (Transport, Konten, Secrets — dieser Plan baut direkt darauf auf)

**Nicht in diesem Plan:** die Vault-Kommandos `mail.rerender` / `mail.relink` / `mail.extractAttachment` samt Kommando-Rahmen (`core/commands/*`, `SchemaFormModal`/`PlanPreviewModal`). Sie sind ein eigenes Subsystem mit eigenem Testzyklus und bekommen einen eigenen Plan (`…-m3-mail-commands.md`), sobald der Sync live steht. Ebenfalls nicht hier: Server-Kommandos (`mail.adopt`/`mail.archive`), View und `IDLE` — das ist M4 bzw. V1.1.

## Global Constraints

- Alle Constraints aus M1/M2 gelten weiter. Insbesondere:
  - `src/core/**` bleibt frei von `obsidian`-, Node- und DOM-Imports (`npm run check:pure`); der Transport ist die einzige Außenwelt.
  - Node-Builtins ausschließlich `Platform.isDesktop`-guarded in `src/obsidian/tls-transport.ts`; `tests/bundle.test.ts` bleibt grün.
  - Keine Inline-ESLint-disables (`scripts/check-no-inline-disables.mjs`).
  - Übernahme aus einem Nachbar-Repo bekommt in Zeile 1 den Herkunftsstempel `// uebernommen aus <repo>/<pfad>, 2026-08-30`.
  - Conventional Commits; ein Commit pro Task-Ende.
  - Kein echtes Postfach in `npm test`. Echte Sockets nur in `tests/integration/**` (läuft über `npm run test:integration`, nicht in `npm test`).
- **Passwort nie loggen.** Im Debug-Log wird die Auth-Zeile als `a002 AUTHENTICATE PLAIN ****` bzw. `a002 LOGIN **** ****` ausgegeben.
- **Der Sync liest nur.** `EXAMINE` (read-only), nie `SELECT`, nie `STORE`, nie `EXPUNGE`, `BODY.PEEK[]` statt `BODY[]` — kein Lauf darf `\Seen` setzen. Das ist ein Vertrag gegenüber dem Postfach des Nutzers, kein Detail.
- **Injektionsschutz:** kein aus Settings stammender Wert (Ordnername, Benutzername) geht ungeprüft in eine Kommandozeile. `CR`/`LF` in einem Argument → `{ok:false, code:"protocol"}`, bevor geschrieben wird (dieselbe Härtung wie der STARTTLS-Injektionsschutz aus dem M2-Final-Review).
- **Jeder Netz-Schritt unter `withTimeout`** (`src/vendor/code-kit/timeout.ts`) — M2 hatte nur Connect-/Read-Timeout, ein hängendes `UID FETCH` würde sonst den Intervall-Lauf blockieren. Beachte die tatsächliche Signatur: `withTimeout(work, ms, timers)` liefert `{timedOut: true} | {timedOut: false, value: T}`, **nicht** `T`, und der dritte Parameter ist ein `TimeoutTimers`-Port. Der Port wird injiziert, nie aus `window` in `core` gegriffen (`check:pure` verbietet `window`, und `obsidianmd/prefer-window-timers` verbietet nacktes `setTimeout` in `src/`). `src/main.ts` füllt ihn mit `window`, Tests mit dem Helfer aus Task 1.
- **`PlanInput.allowUpdate = false` für jeden Sync-Pfad.** Eine bestehende Notiz wird vom Sync nie neu gerendert (Merge-Regel 5 der Spec § 2.2). Nur das Import-Kommando aus M1 darf `true`.
- Allowlist-Ordner heißt im Default `Vault` (③-Nachtrag), Archivordner `Archive`, Posteingang `INBOX` — alle drei stehen schon in `newAccount()`.
- Der Meilenstein gilt erst als erledigt, wenn `npm run gate` grün ist **und** die Live-Probe aus Task 9 in `docs/SMOKE.md` protokolliert ist.

---

## Dateistruktur (M3, neu bzw. geändert)

```
src/core/imap/types.ts           ImapErrorCode, ImapItem, ImapResponse, ImapSession, MAX_LITERAL_BYTES
src/core/imap/parser.ts          readRawLine(transport), tokenize(text, literals), asAtom/asText/findItem
src/core/imap/commands.ts        encodeMailbox (modified UTF-7), quoteArg, buildFetchSet, assertNoCrlf
src/core/imap/client.ts          imapConnect(transport, opts) → ImapSession (Zustandsautomat, withTimeout)
src/core/sync/uid-cache.ts       UidCacheStore: get/put/forget, UIDVALIDITY-Wechsel verwirft
src/core/sync/errors.ts          SyncErrorCode + mapping von ImapErrorCode
src/core/sync/busy.ts            BusyGuard  (Übernahme aus calendar-notes, Herkunftsstempel)
src/core/sync/events.ts          Emitter/SyncEvents (Übernahme aus calendar-notes, angepasst)
src/core/sync/service.ts         createSyncService(deps) → syncAccount(id) / syncAll()
src/core/mirror/execute.ts       PlanExecutor + PlanExecutionResult (Umzug aus src/obsidian/vault-notes.ts)
src/core/mirror/apply.ts         planSync(input) → NotePlan[] (create / reattach / detach)
src/obsidian/vault-notes.ts      + mailIndex(app, profile) mit state+source; importiert Typen aus core/mirror/execute
src/obsidian/settings-tab.ts     + Passwort-fehlt-Anzeige in der Kontenzeile, + Schalter „Debug-Protokoll"
src/main.ts                      + SyncService, Kommando/Ribbon „Postfach synchronisieren", Intervall, Statusleiste
src/i18n/strings.ts              + Sync-Keys (EN kanonisch + DE)
scripts/fake-imap.mjs            Fake-IMAP-Server für den Integrationstest (kein TLS, nur 127.0.0.1)
tests/helpers/fake-socket.ts     Byte-Puffer statt Zeilenliste: echtes readBytes, Teilzeilen, closed vor connect
tests/helpers/timers.ts          testTimers: TimeoutTimers-Port fuer withTimeout in Tests
tests/core/imap/*.test.ts · tests/core/sync/*.test.ts · tests/core/mirror/apply.test.ts
tests/obsidian/vault-notes.test.ts (erweitert) · tests/integration/fake-imap.test.ts
```

---

### Task 1: `FakeSocketTransport` byte-genau machen

Der Fake aus M2 kann kein `readBytes` (wirft `protocol`), modelliert keine Teilzeilen und meldet `closed === false` vor dem `connect()`, während der echte Transport dort `true` meldet. IMAP-Literale brauchen alle drei Eigenschaften. Der Umbau ersetzt die Zeilen-Queue durch einen Byte-Puffer; die bestehenden SMTP-Tests müssen unverändert grün bleiben.

**Files:**
- Modify: `tests/helpers/fake-socket.ts` (vollständiger Umbau des Puffers)
- Create: `tests/helpers/timers.ts` (Timer-Port für `withTimeout`, ab Task 4 in jedem IMAP-Test gebraucht)
- Test: `tests/helpers/fake-socket.test.ts` (bestehende Fälle bleiben, neue kommen dazu)

**Interfaces:**
- Consumes: `SocketTransport`, `NetError`, `ConnectOptions` aus `src/core/net/types.ts` (M2, unverändert).
- Produces:
  ```ts
  // tests/helpers/fake-socket.ts
  /** Server-Antwort eines Dialog-Schritts: String = Zeile (CRLF wird angehängt),
   *  Uint8Array = rohe Bytes ohne Zusatz (IMAP-Literal-Inhalt). */
  export type SendPart = string | Uint8Array;
  export interface DialogStep { expect?: RegExp | string; send?: SendPart[]; upgrade?: boolean }
  export class FakeSocketTransport implements SocketTransport {
    constructor(greeting: SendPart[], steps: DialogStep[]);
    readonly written: string[];
    readonly connectCalls: ConnectOptions[];
    closed: boolean;   // true vor connect() — wie der echte Transport
    secure: boolean;
  }
  ```

- [ ] **Step 1: Die neuen Fälle als failing tests schreiben**

An `tests/helpers/fake-socket.test.ts` anhängen:

```ts
  it("closed ist true vor connect() — wie der echte nodeSocketTransport", () => {
    const fake = new FakeSocketTransport(["* OK ready"], []);
    expect(fake.closed).toBe(true);
  });

  it("readBytes liefert Literal-Bytes und der Rest der Zeile bleibt lesbar", async () => {
    const literal = new TextEncoder().encode("Message-ID: <a@b>\r\n");
    const fake = new FakeSocketTransport(
      ["* OK ready"],
      [{ expect: /^a001 UID FETCH /, send: [`* 1 FETCH (UID 7 BODY[HEADER] {${String(literal.byteLength)}}`, literal, ")", "a001 OK done"] }],
    );
    await fake.connect(opts);
    expect(await fake.readLine()).toBe("* OK ready");
    await fake.write("a001 UID FETCH 7 (BODY.PEEK[HEADER])\r\n");
    expect(await fake.readLine()).toBe("* 1 FETCH (UID 7 BODY[HEADER] {19}");
    expect(new TextDecoder().decode(await fake.readBytes(literal.byteLength))).toBe("Message-ID: <a@b>\r\n");
    expect(await fake.readLine()).toBe(")");
    expect(await fake.readLine()).toBe("a001 OK done");
  });

  it("readBytes darf ueber eine Zeilengrenze hinweg lesen (Teilzeilen-Modell)", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], []);
    await fake.connect(opts);
    expect(new TextDecoder().decode(await fake.readBytes(4))).toBe("* OK");
    expect(await fake.readLine()).toBe(" ready");
  });

  it("readBytes wirft NetError('closed'), wenn der Puffer nicht mehr genug Bytes hat", async () => {
    const fake = new FakeSocketTransport(["ab"], []);
    await fake.connect(opts);
    await expect(fake.readBytes(99)).rejects.toMatchObject({ name: "NetError", code: "closed" });
  });
```

Den bestehenden Fall `readBytes wirft NetError('protocol') — vom Fake nicht unterstuetzt` **löschen** — er beschreibt genau die Lücke, die dieser Task schließt.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag sehen**

Run: `npx vitest run tests/helpers/fake-socket.test.ts`
Expected: FAIL — `closed` ist `false` vor `connect`, `readBytes` wirft `protocol`.

- [ ] **Step 3: Den Puffer auf Bytes umstellen**

`tests/helpers/fake-socket.ts` — Puffer, Konstruktor und die vier Lese-/Schreibmethoden ersetzen:

```ts
const CRLF = new TextEncoder().encode("\r\n");

function toBytes(part: SendPart): Uint8Array {
  if (part instanceof Uint8Array) return part;
  const line = new TextEncoder().encode(part);
  const out = new Uint8Array(line.byteLength + CRLF.byteLength);
  out.set(line, 0);
  out.set(CRLF, line.byteLength);
  return out;
}

export class FakeSocketTransport implements SocketTransport {
  readonly written: string[] = [];
  readonly connectCalls: ConnectOptions[] = [];
  closed = true;
  secure = false;

  /** Ungelesene Server-Bytes. readLine schneidet bis CRLF, readBytes schneidet n Bytes ab —
   *  beide aus demselben Puffer, damit ein Literal mitten in einer Zeile enden darf. */
  private buffer: Uint8Array = new Uint8Array(0);
  private stepIndex = 0;
  /** Angefangene Client-Zeile: write() darf mit beliebigen Bruchstuecken aufgerufen werden. */
  private partial = "";

  constructor(
    private readonly greeting: SendPart[],
    private readonly steps: DialogStep[],
  ) {}

  private push(parts: SendPart[]): void {
    for (const p of parts) {
      const b = toBytes(p);
      const next = new Uint8Array(this.buffer.byteLength + b.byteLength);
      next.set(this.buffer, 0);
      next.set(b, this.buffer.byteLength);
      this.buffer = next;
    }
  }

  private take(n: number): Uint8Array {
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.slice(n);
    return out;
  }

  async connect(opts: ConnectOptions): Promise<void> {
    this.connectCalls.push(opts);
    this.closed = false;
    this.secure = opts.tls === "implicit";
    this.push(this.greeting);
    return Promise.resolve();
  }

  async readLine(): Promise<string> {
    for (let i = 0; i + 1 < this.buffer.byteLength; i++) {
      if (this.buffer[i] === 13 && this.buffer[i + 1] === 10) {
        const line = new TextDecoder().decode(this.take(i));
        this.take(2);
        return Promise.resolve(line);
      }
    }
    throw new NetError("closed", "Fake-Skript zu Ende (keine vollstaendige Zeile mehr im Puffer)");
  }

  async readBytes(n: number): Promise<Uint8Array> {
    if (this.buffer.byteLength < n) throw new NetError("closed", `Fake-Skript hat nur ${String(this.buffer.byteLength)} von ${String(n)} Bytes`);
    return Promise.resolve(this.take(n));
  }
}
```

`write()` bleibt in seiner Aufgabe (Client-Zeilen sammeln, Schritt-`expect` matchen, `send` in den Puffer legen), arbeitet aber über `this.partial`, damit Teil-Writes zulässig sind:

```ts
  async write(data: Uint8Array | string): Promise<void> {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    this.partial += text;
    for (;;) {
      const nl = this.partial.indexOf("\r\n");
      if (nl === -1) break;
      const line = this.partial.slice(0, nl);
      this.partial = this.partial.slice(nl + 2);
      this.written.push(line);
      this.matchStep(line);
    }
    return Promise.resolve();
  }

  private matchStep(line: string): void {
    const step = this.steps[this.stepIndex];
    if (!step) return;
    const e = step.expect;
    const hit = e === undefined || (typeof e === "string" ? e === line : e.test(line));
    if (!hit) return;
    this.stepIndex++;
    if (step.send) this.push(step.send);
  }
```

`upgradeTls()` und `close()` bleiben wie in M2 (Prüfung auf `upgrade: true` im gerade abgearbeiteten Schritt, `closed = true`).

- [ ] **Step 3b: Den Timer-Port für Tests anlegen**

`tests/helpers/timers.ts`:

```ts
import type { TimeoutTimers } from "../../src/vendor/code-kit/timeout";

/** `withTimeout` bekommt seine Timer injiziert (der Kit-Code darf `window` nicht kennen).
 *  Im Test reichen die echten Node-Timer: die Dialoge des Fake-Transports laufen synchron
 *  durch, ein Timeout tritt nie ein — der Port muss nur vorhanden sein. */
export const testTimers: TimeoutTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => { globalThis.clearTimeout(id); },
};
```

- [ ] **Step 4: Alle Transport-abhängigen Tests laufen lassen**

Run: `npx vitest run tests/helpers tests/core/smtp tests/core/send`
Expected: PASS — die SMTP-Dialoge aus M2 laufen unverändert, die vier neuen Fälle sind grün.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/fake-socket.ts tests/helpers/fake-socket.test.ts tests/helpers/timers.ts
git commit -m "test(fake-socket): Byte-Puffer statt Zeilenliste — readBytes, Teilzeilen, closed vor connect"
```

---

### Task 2: IMAP-Antworten lesen und zerlegen (`core/imap/parser.ts`)

Eine IMAP-Antwortzeile kann in Literale übergehen: `* 1 FETCH (BODY[] {2048}` + 2048 rohe Bytes + `)`. Der Leser fügt das zu **einer logischen Zeile** zusammen und hebt die Literale getrennt auf; der Tokenizer setzt sie beim Token `{n}` wieder ein. Eckige Klammern gehören zum Atom (`BODY[]`, `[UIDVALIDITY 42]`) — das erspart eine zweite Klammergrammatik und reicht für das Subset vollständig aus.

**Files:**
- Create: `src/core/imap/types.ts`, `src/core/imap/parser.ts`
- Test: `tests/core/imap/parser.test.ts`

**Interfaces:**
- Consumes: `SocketTransport`, `NetError` aus `src/core/net/types.ts`.
- Produces:
  ```ts
  // core/imap/types.ts
  import type { NetErrorCode } from "../net/types";
  export type ImapErrorCode = "auth" | "folder-missing" | "tls-required" | NetErrorCode;
  /** Obergrenze fuer ein einzelnes Literal (64 MiB). Ein groesserer Wert ist kein
   *  Postfach-Inhalt mehr, sondern ein defekter oder feindlicher Server. */
  export const MAX_LITERAL_BYTES = 64 * 1024 * 1024;
  export type ImapItem =
    | { kind: "atom"; value: string }
    | { kind: "string"; value: string }
    | { kind: "literal"; bytes: Uint8Array }
    | { kind: "nil" }
    | { kind: "list"; items: ImapItem[] };
  export interface ImapResponse { tag: string; items: ImapItem[]; text: string }

  // core/imap/parser.ts
  export interface RawLine { text: string; literals: Uint8Array[] }
  export async function readRawLine(t: SocketTransport): Promise<RawLine>;
  export function tokenize(text: string, literals: Uint8Array[]): ImapItem[];
  export function parseResponse(raw: RawLine): ImapResponse;
  /** Erstes Literal in einer (auch verschachtelten) Item-Liste — FETCH-Antworten tragen
   *  genau eines, und seine Position variiert je nach Server-Reihenfolge der Datenitems. */
  export function firstLiteral(items: ImapItem[]): Uint8Array | null;
  /** Wert hinter einem Atom-Schluessel innerhalb einer Liste: findValue(items, "UID") → "7" */
  export function findAtomValue(items: ImapItem[], key: string): string | null;
  ```

- [ ] **Step 1: Die failing tests schreiben**

`tests/core/imap/parser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FakeSocketTransport } from "../../helpers/fake-socket";
import { readRawLine, tokenize, parseResponse, firstLiteral, findAtomValue } from "../../../src/core/imap/parser";
import type { ConnectOptions } from "../../../src/core/net/types";

const opts: ConnectOptions = { host: "imap.example.net", port: 993, tls: "implicit", timeoutMs: 1000 };

describe("readRawLine", () => {
  it("setzt eine Zeile mit Literal zu einer logischen Zeile zusammen", async () => {
    const body = new TextEncoder().encode("Message-ID: <x@y>\r\n");
    const fake = new FakeSocketTransport([`* 1 FETCH (UID 7 BODY[HEADER] {${String(body.byteLength)}}`, body, ")"], []);
    await fake.connect(opts);
    const raw = await readRawLine(fake);
    expect(raw.text).toBe("* 1 FETCH (UID 7 BODY[HEADER] {19})");
    expect(raw.literals).toHaveLength(1);
    expect(new TextDecoder().decode(raw.literals[0])).toBe("Message-ID: <x@y>\r\n");
  });

  it("liest eine Zeile ohne Literal unveraendert", async () => {
    const fake = new FakeSocketTransport(["a001 OK EXAMINE completed"], []);
    await fake.connect(opts);
    expect((await readRawLine(fake)).text).toBe("a001 OK EXAMINE completed");
  });

  it("weist ein unplausibel grosses Literal ab, statt es zu lesen", async () => {
    const fake = new FakeSocketTransport(["* 1 FETCH (BODY[] {99999999999}"], []);
    await fake.connect(opts);
    await expect(readRawLine(fake)).rejects.toMatchObject({ name: "NetError", code: "protocol" });
  });
});

describe("tokenize", () => {
  it("zerlegt Atome, Strings, NIL und geschachtelte Listen", () => {
    const items = tokenize('* 1 FETCH (UID 7 FLAGS (\\Seen \\Answered) X NIL SUBJ "Hallo Welt")', []);
    expect(items[0]).toEqual({ kind: "atom", value: "*" });
    const list = items[3];
    expect(list?.kind).toBe("list");
    if (list?.kind !== "list") throw new Error("unreachable");
    expect(findAtomValue(list.items, "UID")).toBe("7");
    expect(list.items).toContainEqual({ kind: "nil" });
    expect(list.items).toContainEqual({ kind: "string", value: "Hallo Welt" });
  });

  it("nimmt eckige Klammern samt Inhalt als Teil des Atoms", () => {
    const items = tokenize("* OK [UIDVALIDITY 3857529045] UIDs valid", []);
    expect(items[2]).toEqual({ kind: "atom", value: "[UIDVALIDITY 3857529045]" });
    const fetch = tokenize("(BODY[HEADER.FIELDS (MESSAGE-ID)] {4})", [new Uint8Array([1, 2, 3, 4])]);
    const list = fetch[0];
    if (list?.kind !== "list") throw new Error("unreachable");
    expect(list.items[0]).toEqual({ kind: "atom", value: "BODY[HEADER.FIELDS (MESSAGE-ID)]" });
    expect(list.items[1]?.kind).toBe("literal");
  });

  it("entschluesselt Escapes im quoted string", () => {
    expect(tokenize('"a\\"b\\\\c"', [])).toEqual([{ kind: "string", value: 'a"b\\c' }]);
  });

  it("setzt Literale in der Reihenfolge ihres Auftretens ein", () => {
    const a = new TextEncoder().encode("AA");
    const b = new TextEncoder().encode("BB");
    const items = tokenize("({2} {2})", [a, b]);
    const list = items[0];
    if (list?.kind !== "list") throw new Error("unreachable");
    expect(list.items).toEqual([{ kind: "literal", bytes: a }, { kind: "literal", bytes: b }]);
  });
});

describe("parseResponse / Helfer", () => {
  it("trennt Tag und Rest", () => {
    const r = parseResponse({ text: "a003 NO [TRYCREATE] Mailbox does not exist", literals: [] });
    expect(r.tag).toBe("a003");
    expect(r.text).toBe("NO [TRYCREATE] Mailbox does not exist");
  });

  it("firstLiteral findet ein Literal auch geschachtelt", () => {
    const bytes = new TextEncoder().encode("hi");
    expect(firstLiteral(tokenize("* 1 FETCH (UID 7 BODY[] {2})", [bytes]))).toBe(bytes);
    expect(firstLiteral(tokenize("a001 OK done", []))).toBeNull();
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag sehen**

Run: `npx vitest run tests/core/imap/parser.test.ts`
Expected: FAIL — `Cannot find module '../../../src/core/imap/parser'`.

- [ ] **Step 3: `types.ts` und `parser.ts` schreiben**

`src/core/imap/types.ts` mit den Typen aus dem Interfaces-Block oben.

`src/core/imap/parser.ts`:

```ts
// IMAP-Antworten (RFC 3501 § 4): Leser fuer logische Zeilen mit Literalen und ein Tokenizer
// fuer Atome/Strings/NIL/Listen. Kein Node-/Obsidian-Import (siehe scripts/check-pure.mjs).
import type { SocketTransport } from "../net/types";
import { NetError } from "../net/types";
import { MAX_LITERAL_BYTES, type ImapItem, type ImapResponse } from "./types";

export interface RawLine { text: string; literals: Uint8Array[] }

/** Ein Literal wird durch `{n}` am ZEILENENDE angekuendigt (`{n+}` = LITERAL+, RFC 7888).
 *  Nur dort — dieselbe Zeichenfolge mitten in einem quoted string ist Text. */
const LITERAL_AT_END = /\{(\d+)\+?\}$/;

export async function readRawLine(t: SocketTransport): Promise<RawLine> {
  const literals: Uint8Array[] = [];
  let text = await t.readLine();
  for (;;) {
    const m = LITERAL_AT_END.exec(text);
    if (!m) return { text, literals };
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n) || n < 0 || n > MAX_LITERAL_BYTES) {
      throw new NetError("protocol", `unplausible Literal-Groesse: ${String(m[1])}`);
    }
    literals.push(await t.readBytes(n));
    text += await t.readLine();
  }
}

const DELIM = new Set([" ", "(", ")"]);

export function tokenize(text: string, literals: Uint8Array[]): ImapItem[] {
  let i = 0;
  let litIndex = 0;

  function readList(): ImapItem[] {
    const out: ImapItem[] = [];
    for (;;) {
      while (text[i] === " ") i++;
      const c = text[i];
      if (c === undefined || c === ")") return out;
      out.push(readItem());
    }
  }

  function readQuoted(): ImapItem {
    i++; // oeffnendes "
    let v = "";
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") { v += text[i + 1] ?? ""; i += 2; continue; }
      if (c === '"') { i++; return { kind: "string", value: v }; }
      v += c;
      i++;
    }
    return { kind: "string", value: v };
  }

  function readAtom(): ImapItem {
    const start = i;
    let depth = 0; // eckige Klammern gehoeren zum Atom, inkl. Leerzeichen darin
    while (i < text.length) {
      const c = text[i];
      if (c === undefined) break;
      if (c === "[") depth++;
      else if (c === "]") depth--;
      else if (depth === 0 && DELIM.has(c)) break;
      i++;
    }
    const value = text.slice(start, i);
    if (value === "NIL") return { kind: "nil" };
    const lit = LITERAL_AT_END.exec(value);
    if (lit) {
      const bytes = literals[litIndex++];
      return bytes ? { kind: "literal", bytes } : { kind: "atom", value };
    }
    return { kind: "atom", value };
  }

  function readItem(): ImapItem {
    const c = text[i];
    if (c === "(") { i++; const items = readList(); if (text[i] === ")") i++; return { kind: "list", items }; }
    if (c === '"') return readQuoted();
    return readAtom();
  }

  return readList();
}

export function parseResponse(raw: RawLine): ImapResponse {
  const items = tokenize(raw.text, raw.literals);
  const first = items[0];
  const tag = first?.kind === "atom" ? first.value : "";
  const space = raw.text.indexOf(" ");
  return { tag, items, text: space === -1 ? "" : raw.text.slice(space + 1) };
}

export function firstLiteral(items: ImapItem[]): Uint8Array | null {
  for (const it of items) {
    if (it.kind === "literal") return it.bytes;
    if (it.kind === "list") { const inner = firstLiteral(it.items); if (inner) return inner; }
  }
  return null;
}

export function findAtomValue(items: ImapItem[], key: string): string | null {
  for (let i = 0; i < items.length - 1; i++) {
    const k = items[i];
    const v = items[i + 1];
    if (k?.kind === "atom" && k.value.toUpperCase() === key.toUpperCase() && v?.kind === "atom") return v.value;
  }
  return null;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/core/imap/parser.test.ts && npm run check:pure`
Expected: PASS, `check:pure` ohne Befund.

- [ ] **Step 5: Commit**

```bash
git add src/core/imap/types.ts src/core/imap/parser.ts tests/core/imap/parser.test.ts
git commit -m "feat(imap): Antwort-Leser mit Literalen und Tokenizer fuer Atome/Strings/Listen"
```

---

### Task 3: Kommando-Bausteine (`core/imap/commands.ts`)

Ordnernamen sind der einzige Ort, an dem Nutzereingaben in eine Protokollzeile wandern. Sie brauchen zwei Dinge: die IMAP-eigene Kodierung (modified UTF-7, RFC 3501 § 5.1.3 — sonst findet `EXAMINE Entwürfe` den Ordner nicht) und einen harten Riegel gegen CR/LF.

**Files:**
- Create: `src/core/imap/commands.ts`
- Test: `tests/core/imap/commands.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function encodeMailbox(name: string): string;      // "Entwürfe" → "Entw&APw-rfe"
  export function quoteArg(value: string): string;          // → "…" mit \" und \\ escaped
  /** Wirft NetError("protocol"), wenn ein Argument CR oder LF enthaelt. */
  export function assertNoCrlf(value: string, what: string): void;
  /** UID-Mengen kompakt: [1,2,3,7] → "1:3,7" — haelt die Kommandozeile kurz. */
  export function buildUidSet(uids: readonly number[]): string;
  /** Zerlegt eine UID-Liste in Bloecke fuer je ein FETCH (Default 200). */
  export function chunk<T>(items: readonly T[], size: number): T[][];
  ```

- [ ] **Step 1: Die failing tests schreiben**

`tests/core/imap/commands.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encodeMailbox, quoteArg, assertNoCrlf, buildUidSet, chunk } from "../../../src/core/imap/commands";

describe("encodeMailbox (modified UTF-7)", () => {
  it("laesst reines ASCII unveraendert", () => {
    expect(encodeMailbox("Vault")).toBe("Vault");
    expect(encodeMailbox("INBOX/Sub")).toBe("INBOX/Sub");
  });
  it("kodiert Umlaute nach RFC 3501 § 5.1.3", () => {
    expect(encodeMailbox("Entwürfe")).toBe("Entw&APw-rfe");
    expect(encodeMailbox("Gelöschte Objekte")).toBe("Gel&APY-schte Objekte");
  });
  it("kodiert das Und-Zeichen als &-", () => {
    expect(encodeMailbox("R&D")).toBe("R&-D");
  });
});

describe("quoteArg / assertNoCrlf", () => {
  it("umschliesst mit Anfuehrungszeichen und escaped Sonderzeichen", () => {
    expect(quoteArg('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
  it("assertNoCrlf wirft bei CR oder LF", () => {
    expect(() => assertNoCrlf("Vault\r\nX LOGOUT", "Ordner")).toThrow(/Ordner/);
    expect(() => assertNoCrlf("Vault", "Ordner")).not.toThrow();
  });
});

describe("buildUidSet / chunk", () => {
  it("fasst zusammenhaengende UIDs zu Bereichen", () => {
    expect(buildUidSet([1, 2, 3, 7, 9, 10])).toBe("1:3,7,9:10");
    expect(buildUidSet([5])).toBe("5");
    expect(buildUidSet([])).toBe("");
  });
  it("chunk teilt in Bloecke", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag sehen**

Run: `npx vitest run tests/core/imap/commands.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: `commands.ts` schreiben**

```ts
// Bausteine fuer IMAP-Kommandozeilen: Ordnernamen-Kodierung (modified UTF-7, RFC 3501 § 5.1.3),
// Quoting und der CR/LF-Riegel. Alles, was aus den Settings kommt, laeuft hier durch — eine
// Kommandozeile darf nie durch einen Ordnernamen zu zwei Zeilen werden (vgl. STARTTLS-
// Injektionsschutz aus dem M2-Final-Review).
import { NetError } from "../net/types";

export function assertNoCrlf(value: string, what: string): void {
  if (/[\r\n]/.test(value)) throw new NetError("protocol", `${what} enthaelt Zeilenumbrueche`);
}

/** Base64 der UTF-16BE-Bytes, wie modified UTF-7 es verlangt — mit "," statt "/" und ohne "=". */
function b64Utf16(s: string): string {
  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      bytes.push(hi >> 8, hi & 0xff, lo >> 8, lo & 0xff);
    } else {
      bytes.push(cp >> 8, cp & 0xff);
    }
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\//g, ",");
}

export function encodeMailbox(name: string): string {
  assertNoCrlf(name, "Ordnername");
  let out = "";
  let buf = "";
  const flush = (): void => {
    if (buf) { out += `&${b64Utf16(buf)}-`; buf = ""; }
  };
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === "&") { flush(); out += "&-"; continue; }
    if (cp >= 0x20 && cp <= 0x7e) { flush(); out += ch; continue; }
    buf += ch;
  }
  flush();
  return out;
}

export function quoteArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildUidSet(uids: readonly number[]): string {
  const sorted = [...uids].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i];
    if (start === undefined) break;
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) { i++; end += 1; }
    parts.push(start === end ? String(start) : `${String(start)}:${String(end)}`);
    i++;
  }
  return parts.join(",");
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/core/imap/commands.test.ts`
Expected: PASS (alle 8 Fälle).

- [ ] **Step 5: Commit**

```bash
git add src/core/imap/commands.ts tests/core/imap/commands.test.ts
git commit -m "feat(imap): Ordnernamen in modified UTF-7, Quoting und CR/LF-Riegel"
```

---

### Task 4: Der IMAP-Zustandsautomat (`core/imap/client.ts`)

Ein Lauf ist: verbinden → Greeting → `CAPABILITY` → `AUTHENTICATE PLAIN` (Fallback `LOGIN`) → `EXAMINE` → `UID SEARCH` → `UID FETCH` (Header, dann Bodies) → `LOGOUT`. Jeder Schritt läuft unter `withTimeout`; jeder Fehler ist ein Wert.

**Files:**
- Create: `src/core/imap/client.ts`
- Test: `tests/core/imap/client.test.ts`

**Interfaces:**
- Consumes: `readRawLine`/`parseResponse`/`firstLiteral`/`findAtomValue` (Task 2), `encodeMailbox`/`quoteArg`/`assertNoCrlf`/`buildUidSet`/`chunk` (Task 3), `withTimeout` + `TimeoutTimers` aus `src/vendor/code-kit/timeout.ts` (Signatur: `withTimeout(work, ms, timers) → {timedOut:true} | {timedOut:false, value:T}`), `normalizeMessageId` aus `src/core/mime/headers.ts`, `TlsMode` aus `src/core/net/types.ts`.
- Produces:
  ```ts
  export interface ImapConnectOptions {
    host: string; port: number;
    /** TlsMode, nicht nur implicit/starttls: "none" ist ausschliesslich fuer einen lokalen
     *  Fake-Server auf 127.0.0.1 gedacht (wie smtp.tls === "none" in M2) und wird von der
     *  Settings-UI nie angeboten. */
    tls: TlsMode;
    username: string; password: string;
    /** Timer-Port fuer withTimeout — main.ts uebergibt `window`, Tests testTimers. */
    timers: TimeoutTimers;
    timeoutMs?: number;                  // Default 30000, gilt pro Kommando
    log?: (line: string) => void;        // Auth-Zeilen werden maskiert
  }
  export interface ImapSession {
    readonly capabilities: string[];
    examine(mailbox: string): Promise<{ ok: true; uidValidity: number; exists: number } | { ok: false; code: ImapErrorCode; detail: string }>;
    uidSearchAll(): Promise<number[]>;
    /** uid → normalisierte Message-ID; null, wenn die Mail keinen Message-ID-Header hat. */
    uidFetchMessageIds(uids: readonly number[]): Promise<Map<number, string | null>>;
    /** Rohe RFC-5322-Bytes via BODY.PEEK[] — null, wenn die UID nicht mehr existiert. */
    uidFetchBody(uid: number): Promise<Uint8Array | null>;
    logout(): Promise<void>;
  }
  export type ImapConnectResult = { ok: true; session: ImapSession } | { ok: false; code: ImapErrorCode; detail: string };
  export async function imapConnect(transport: SocketTransport, opts: ImapConnectOptions): Promise<ImapConnectResult>;
  ```

- [ ] **Step 1: Die failing tests schreiben**

`tests/core/imap/client.test.ts` — der Dialog wird als Skript vorgegeben, es fließt kein echtes Byte:

```ts
import { describe, it, expect } from "vitest";
import { FakeSocketTransport, type DialogStep, type SendPart } from "../../helpers/fake-socket";
import { testTimers } from "../../helpers/timers";
import { imapConnect } from "../../../src/core/imap/client";

const base = { host: "imap.example.net", port: 993, tls: "implicit" as const, username: "u@example.net", password: "geheim", timers: testTimers };

function literal(text: string): SendPart[] {
  const bytes = new TextEncoder().encode(text);
  return [`* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(bytes.byteLength)}}`, bytes, ")"];
}

const greetingAndAuth: DialogStep[] = [
  { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN UIDPLUS MOVE", "a001 OK done"] },
  { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
];

describe("imapConnect", () => {
  it("verbindet, liest Capabilities und authentifiziert mit AUTH=PLAIN", async () => {
    const fake = new FakeSocketTransport(["* OK [CAPABILITY IMAP4rev1] server ready"], greetingAndAuth);
    const r = await imapConnect(fake, base);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.session.capabilities).toContain("UIDPLUS");
    expect(fake.written.some((l) => l.includes("geheim"))).toBe(false);
  });

  it("maskiert die Auth-Zeile im Log", async () => {
    const lines: string[] = [];
    const fake = new FakeSocketTransport(["* OK ready"], greetingAndAuth);
    await imapConnect(fake, { ...base, log: (l) => lines.push(l) });
    expect(lines.some((l) => l.includes("geheim"))).toBe(false);
    expect(lines.some((l) => /AUTHENTICATE PLAIN \*{4}/.test(l))).toBe(true);
  });

  it("liefert code 'auth' bei abgelehnter Anmeldung", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN", "a001 OK done"] },
      { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 NO [AUTHENTICATIONFAILED] Invalid credentials"] },
    ]);
    const r = await imapConnect(fake, base);
    expect(r).toMatchObject({ ok: false, code: "auth" });
  });

  it("faellt auf LOGIN zurueck, wenn der Server AUTH=PLAIN nicht anbietet", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1", "a001 OK done"] },
      { expect: /^a002 LOGIN /, send: ["a002 OK logged in"] },
    ]);
    const r = await imapConnect(fake, base);
    expect(r.ok).toBe(true);
    expect(fake.written.some((l) => l.startsWith("a002 LOGIN"))).toBe(true);
  });

  it("weist LOGINDISABLED ohne Verbindungsaufbau zum Postfach ab", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 LOGINDISABLED", "a001 OK done"] },
    ]);
    expect(await imapConnect(fake, base)).toMatchObject({ ok: false, code: "tls-required" });
  });
});

describe("ImapSession", () => {
  async function session(steps: DialogStep[]) {
    const fake = new FakeSocketTransport(["* OK ready"], [...greetingAndAuth, ...steps]);
    const r = await imapConnect(fake, base);
    if (!r.ok) throw new Error(`connect fehlgeschlagen: ${r.detail}`);
    return { fake, s: r.session };
  }

  it("examine liefert UIDVALIDITY und EXISTS und benutzt EXAMINE, nie SELECT", async () => {
    const { fake, s } = await session([
      { expect: /^a003 EXAMINE /, send: ["* 12 EXISTS", "* OK [UIDVALIDITY 3857529045] UIDs valid", "a003 OK [READ-ONLY] EXAMINE completed"] },
    ]);
    expect(await s.examine("Vault")).toEqual({ ok: true, uidValidity: 3857529045, exists: 12 });
    expect(fake.written.some((l) => /\bSELECT\b/.test(l))).toBe(false);
  });

  it("examine meldet folder-missing bei NO", async () => {
    const { s } = await session([{ expect: /^a003 EXAMINE /, send: ["a003 NO Mailbox doesn't exist: Vault"] }]);
    expect(await s.examine("Vault")).toMatchObject({ ok: false, code: "folder-missing" });
  });

  it("examine kodiert Umlaute im Ordnernamen", async () => {
    const { fake, s } = await session([{ expect: /^a003 EXAMINE /, send: ["* 0 EXISTS", "* OK [UIDVALIDITY 1] ok", "a003 OK done"] }]);
    await s.examine("Entwürfe");
    expect(fake.written).toContain('a003 EXAMINE "Entw&APw-rfe"');
  });

  it("uidSearchAll liest die UID-Liste", async () => {
    const { s } = await session([
      { expect: /^a003 EXAMINE /, send: ["* 3 EXISTS", "* OK [UIDVALIDITY 1] ok", "a003 OK done"] },
      { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 4 8 15", "a004 OK done"] },
    ]);
    await s.examine("Vault");
    expect(await s.uidSearchAll()).toEqual([4, 8, 15]);
  });

  it("uidSearchAll liefert [] bei leerer SEARCH-Antwort", async () => {
    const { s } = await session([
      { expect: /^a003 EXAMINE /, send: ["* 0 EXISTS", "* OK [UIDVALIDITY 1] ok", "a003 OK done"] },
      { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH", "a004 OK done"] },
    ]);
    await s.examine("Vault");
    expect(await s.uidSearchAll()).toEqual([]);
  });

  it("uidFetchMessageIds normalisiert die Message-ID und meldet null ohne Header", async () => {
    const withId = new TextEncoder().encode("Message-ID: <abc@example.net>\r\n\r\n");
    const { s } = await session([
      { expect: /^a003 EXAMINE /, send: ["* 1 EXISTS", "* OK [UIDVALIDITY 1] ok", "a003 OK done"] },
      {
        expect: /^a004 UID FETCH 7,9 \(BODY\.PEEK\[HEADER\.FIELDS \(MESSAGE-ID\)\]\)$/,
        send: [
          `* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(withId.byteLength)}}`, withId, ")",
          "* 2 FETCH (UID 9 BODY[HEADER.FIELDS (MESSAGE-ID)] {2}", new TextEncoder().encode("\r\n"), ")",
          "a004 OK done",
        ],
      },
    ]);
    await s.examine("Vault");
    const map = await s.uidFetchMessageIds([7, 9]);
    expect(map.get(7)).toBe("abc@example.net");
    expect(map.get(9)).toBeNull();
  });

  it("uidFetchBody liefert die rohen Bytes und benutzt BODY.PEEK", async () => {
    const eml = new TextEncoder().encode("From: a@b\r\nSubject: x\r\n\r\nHallo\r\n");
    const { fake, s } = await session([
      { expect: /^a003 EXAMINE /, send: ["* 1 EXISTS", "* OK [UIDVALIDITY 1] ok", "a003 OK done"] },
      { expect: /^a004 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: [`* 1 FETCH (UID 7 BODY[] {${String(eml.byteLength)}}`, eml, ")", "a004 OK done"] },
    ]);
    await s.examine("Vault");
    expect(new TextDecoder().decode((await s.uidFetchBody(7)) ?? new Uint8Array())).toContain("Subject: x");
    expect(fake.written.some((l) => /BODY\[\]\)$/.test(l) && !l.includes("PEEK"))).toBe(false);
  });

  it("uidFetchBody liefert null, wenn die UID verschwunden ist", async () => {
    const { s } = await session([
      { expect: /^a003 EXAMINE /, send: ["* 0 EXISTS", "* OK [UIDVALIDITY 1] ok", "a003 OK done"] },
      { expect: /^a004 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: ["a004 OK done"] },
    ]);
    await s.examine("Vault");
    expect(await s.uidFetchBody(7)).toBeNull();
  });

  it("meldet code 'protocol' bei einer BAD-Antwort mitten im Dialog", async () => {
    const { s } = await session([{ expect: /^a003 EXAMINE /, send: ["a003 BAD Error in IMAP command"] }]);
    expect(await s.examine("Vault")).toMatchObject({ ok: false, code: "protocol" });
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag sehen**

Run: `npx vitest run tests/core/imap/client.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: `client.ts` schreiben**

```ts
// IMAP-Client als Zustandsautomat ueber SocketTransport (RFC 3501, Subset): CAPABILITY ->
// AUTHENTICATE PLAIN (Fallback LOGIN) -> EXAMINE -> UID SEARCH -> UID FETCH -> LOGOUT.
// Nur lesend: EXAMINE statt SELECT, BODY.PEEK statt BODY — ein Sync-Lauf darf \Seen nie setzen.
// Kein Node-/Obsidian-Import (siehe scripts/check-pure.mjs).
import type { SocketTransport, TlsMode } from "../net/types";
import { NetError } from "../net/types";
import { withTimeout, type TimeoutTimers } from "../../vendor/code-kit/timeout";
import { normalizeMessageId } from "../mime/headers";
import { assertNoCrlf, buildUidSet, chunk, encodeMailbox, quoteArg } from "./commands";
import { findAtomValue, firstLiteral, parseResponse, readRawLine } from "./parser";
import type { ImapErrorCode, ImapResponse } from "./types";

export interface ImapConnectOptions {
  host: string;
  port: number;
  tls: TlsMode;
  username: string;
  password: string;
  timers: TimeoutTimers;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export interface ImapSession {
  readonly capabilities: string[];
  examine(mailbox: string): Promise<{ ok: true; uidValidity: number; exists: number } | { ok: false; code: ImapErrorCode; detail: string }>;
  uidSearchAll(): Promise<number[]>;
  uidFetchMessageIds(uids: readonly number[]): Promise<Map<number, string | null>>;
  uidFetchBody(uid: number): Promise<Uint8Array | null>;
  logout(): Promise<void>;
}

export type ImapConnectResult = { ok: true; session: ImapSession } | { ok: false; code: ImapErrorCode; detail: string };

const DEFAULT_TIMEOUT_MS = 30000;
/** UIDs je FETCH-Kommando. 200 haelt die Kommandozeile deutlich unter jeder ueblichen
 *  Laengengrenze und begrenzt zugleich, was ein einzelner Fehlschlag kostet. */
const HEADER_BATCH = 200;

interface Tagged { status: "OK" | "NO" | "BAD"; text: string; untagged: ImapResponse[] }

function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

class Connection {
  private counter = 0;
  constructor(
    readonly transport: SocketTransport,
    private readonly timeoutMs: number,
    private readonly timers: TimeoutTimers,
    private readonly log?: (line: string) => void,
  ) {}

  nextTag(): string {
    this.counter += 1;
    return `a${String(this.counter).padStart(3, "0")}`;
  }

  /** withTimeout liefert eine diskriminierte Union, keinen Wert — hier wird ein abgelaufener
   *  Schritt in den NetError uebersetzt, den der ganze Client ohnehin schon behandelt. Die
   *  Arbeit selbst bricht nicht ab (der Kit-Kommentar sagt das ausdruecklich); der Transport
   *  wird deshalb im Fehlerfall geschlossen, damit nichts im Hintergrund weiterlaeuft. */
  async guard<T>(work: Promise<T>, what: string): Promise<T> {
    const r = await withTimeout(work, this.timeoutMs, this.timers);
    if (r.timedOut) {
      await this.transport.close().catch(() => undefined);
      throw new NetError("timeout", `${what} hat nicht innerhalb von ${String(this.timeoutMs)} ms geantwortet`);
    }
    return r.value;
  }

  /** Schickt ein Kommando und liest bis zur gleichnamig getaggten Antwort. `masked` ersetzt die
   *  Zeile im Log (Passwoerter). Jeder Schritt laeuft unter guard() — ein haengendes FETCH
   *  darf den Intervall-Lauf nicht blockieren. */
  async command(tag: string, line: string, masked?: string): Promise<Tagged> {
    this.log?.(`C: ${masked ?? line}`);
    await this.guard(this.transport.write(`${line}\r\n`), "imap-write");
    const untagged: ImapResponse[] = [];
    for (;;) {
      const raw = await this.guard(readRawLine(this.transport), "imap-read");
      const r = parseResponse(raw);
      this.log?.(`S: ${raw.text}`);
      if (r.tag === tag) {
        const m = /^(OK|NO|BAD)\b\s*(.*)$/s.exec(r.text);
        if (!m) throw new NetError("protocol", `unverstaendliche Abschlusszeile: ${raw.text}`);
        return { status: m[1] as "OK" | "NO" | "BAD", text: m[2] ?? "", untagged };
      }
      if (r.tag !== "*" && r.tag !== "+") throw new NetError("protocol", `fremder Tag in der Antwort: ${raw.text}`);
      untagged.push(r);
    }
  }
}

function capabilitiesFrom(responses: ImapResponse[]): string[] {
  const out: string[] = [];
  for (const r of responses) {
    if (!/^\*\s+CAPABILITY\b/i.test(`* ${r.text}`)) continue;
    for (const it of r.items) if (it.kind === "atom" && it.value !== "*" && it.value.toUpperCase() !== "CAPABILITY") out.push(it.value.toUpperCase());
  }
  return out;
}

/** `* OK [UIDVALIDITY 42] …` — der Wert steckt im eckigen Klammer-Atom (siehe Tokenizer). */
function bracketNumber(responses: ImapResponse[], key: string): number | null {
  for (const r of responses) {
    for (const it of r.items) {
      if (it.kind !== "atom") continue;
      const m = new RegExp(`^\\[${key}\\s+(\\d+)\\]$`, "i").exec(it.value);
      if (m?.[1]) return Number(m[1]);
    }
  }
  return null;
}

function existsFrom(responses: ImapResponse[]): number {
  for (const r of responses) {
    const m = /^(\d+)\s+EXISTS$/i.exec(r.text);
    if (m?.[1]) return Number(m[1]);
  }
  return 0;
}

function messageIdFromHeader(bytes: Uint8Array): string | null {
  const text = new TextDecoder().decode(bytes);
  const m = /^message-id:\s*(.+)$/im.exec(text);
  return m?.[1] ? normalizeMessageId(m[1].trim()) : null;
}

export async function imapConnect(transport: SocketTransport, opts: ImapConnectOptions): Promise<ImapConnectResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const conn = new Connection(transport, timeoutMs, opts.timers, opts.log);
  try {
    assertNoCrlf(opts.username, "Benutzername");
    assertNoCrlf(opts.password, "Passwort");
    await conn.guard(transport.connect({ host: opts.host, port: opts.port, tls: opts.tls, timeoutMs }), "imap-connect");

    const greeting = await conn.guard(readRawLine(transport), "imap-greeting");
    opts.log?.(`S: ${greeting.text}`);
    if (!/^\*\s+(OK|PREAUTH)\b/i.test(greeting.text)) return { ok: false, code: "protocol", detail: `Greeting nicht OK: ${greeting.text}` };

    if (opts.tls === "starttls") {
      const tag = conn.nextTag();
      const r = await conn.command(tag, "STARTTLS");
      if (r.status !== "OK") return { ok: false, code: "tls-required", detail: r.text };
      await conn.guard(transport.upgradeTls(), "imap-starttls");
    }

    const capTag = conn.nextTag();
    const cap = await conn.command(capTag, "CAPABILITY");
    if (cap.status !== "OK") return { ok: false, code: "protocol", detail: `CAPABILITY abgelehnt: ${cap.text}` };
    const capabilities = capabilitiesFrom(cap.untagged);

    if (capabilities.includes("LOGINDISABLED") && !capabilities.includes("AUTH=PLAIN")) {
      return { ok: false, code: "tls-required", detail: "Server erlaubt keine Anmeldung auf dieser Verbindung (LOGINDISABLED)" };
    }

    const authTag = conn.nextTag();
    const auth = capabilities.includes("AUTH=PLAIN")
      ? await conn.command(authTag, `AUTHENTICATE PLAIN ${base64Utf8(`\0${opts.username}\0${opts.password}`)}`, `${authTag} AUTHENTICATE PLAIN ****`)
      : await conn.command(authTag, `LOGIN ${quoteArg(opts.username)} ${quoteArg(opts.password)}`, `${authTag} LOGIN **** ****`);
    if (auth.status !== "OK") return { ok: false, code: "auth", detail: auth.text };

    return { ok: true, session: makeSession(conn, capabilities) };
  } catch (e) {
    if (e instanceof NetError) return { ok: false, code: e.code, detail: e.message };
    throw e;
  }
}
```

Die Session darunter, im selben Modul:

```ts
function makeSession(conn: Connection, capabilities: string[]): ImapSession {
  return {
    capabilities,

    async examine(mailbox) {
      const tag = conn.nextTag();
      const r = await conn.command(tag, `EXAMINE ${quoteArg(encodeMailbox(mailbox))}`);
      if (r.status === "NO") return { ok: false, code: "folder-missing", detail: r.text };
      if (r.status !== "OK") return { ok: false, code: "protocol", detail: r.text };
      const uidValidity = bracketNumber(r.untagged, "UIDVALIDITY");
      if (uidValidity === null) return { ok: false, code: "protocol", detail: "keine UIDVALIDITY in der EXAMINE-Antwort" };
      return { ok: true, uidValidity, exists: existsFrom(r.untagged) };
    },

    async uidSearchAll() {
      const tag = conn.nextTag();
      const r = await conn.command(tag, "UID SEARCH ALL");
      if (r.status !== "OK") throw new NetError("protocol", `UID SEARCH abgelehnt: ${r.text}`);
      const uids: number[] = [];
      for (const resp of r.untagged) {
        if (!/^SEARCH\b/i.test(resp.text)) continue;
        for (const part of resp.text.split(/\s+/).slice(1)) {
          const n = Number(part);
          if (Number.isSafeInteger(n) && n > 0) uids.push(n);
        }
      }
      return uids;
    },

    async uidFetchMessageIds(uids) {
      const out = new Map<number, string | null>();
      for (const batch of chunk(uids, HEADER_BATCH)) {
        if (batch.length === 0) continue;
        const tag = conn.nextTag();
        const r = await conn.command(tag, `UID FETCH ${buildUidSet(batch)} (BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])`);
        if (r.status !== "OK") throw new NetError("protocol", `UID FETCH (Header) abgelehnt: ${r.text}`);
        for (const resp of r.untagged) {
          const list = resp.items.find((i) => i.kind === "list");
          if (list?.kind !== "list") continue;
          const uidText = findAtomValue(list.items, "UID");
          const bytes = firstLiteral(list.items);
          if (!uidText || !bytes) continue;
          out.set(Number(uidText), messageIdFromHeader(bytes));
        }
      }
      return out;
    },

    async uidFetchBody(uid) {
      const tag = conn.nextTag();
      const r = await conn.command(tag, `UID FETCH ${String(uid)} (BODY.PEEK[])`);
      if (r.status !== "OK") throw new NetError("protocol", `UID FETCH (Body) abgelehnt: ${r.text}`);
      for (const resp of r.untagged) {
        const list = resp.items.find((i) => i.kind === "list");
        if (list?.kind !== "list") continue;
        if (findAtomValue(list.items, "UID") !== String(uid)) continue;
        const bytes = firstLiteral(list.items);
        if (bytes) return bytes;
      }
      return null;
    },

    async logout() {
      try {
        await conn.command(conn.nextTag(), "LOGOUT");
      } catch {
        /* Ein gescheiterter LOGOUT ist folgenlos — die Verbindung wird ohnehin geschlossen. */
      } finally {
        if (!conn.transport.closed) await conn.transport.close().catch(() => undefined);
      }
    },
  };
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/core/imap && npm run check:pure && npm run typecheck`
Expected: PASS — alle Fälle aus Step 1 grün, `check:pure` ohne Befund.

- [ ] **Step 5: Commit**

```bash
git add src/core/imap/client.ts tests/core/imap/client.test.ts
git commit -m "feat(imap): Zustandsautomat mit CAPABILITY/AUTH/EXAMINE/UID SEARCH/UID FETCH, nur lesend"
```

---

### Task 5: UID→Message-ID-Cache (`core/sync/uid-cache.ts`)

Ohne Cache holt jeder Lauf für jede UID den Message-ID-Header. Der Cache hängt an `<accountId>|<folder>` und trägt die `UIDVALIDITY` mit: ändert der Server sie, sind alle UIDs bedeutungslos und der Eintrag wird verworfen — nicht repariert.

**Files:**
- Create: `src/core/sync/uid-cache.ts`
- Test: `tests/core/sync/uid-cache.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Persistierte Form (data.json): { "<accountId>|<folder>": { uidValidity, map: { "<uid>": "<mailId>" } } } */
  export interface UidCacheEntry { uidValidity: number; map: Record<string, string> }
  export type UidCacheData = Record<string, UidCacheEntry>;
  export interface UidCacheStore {
    /** Liefert die bekannten uid→mailId-Paare, oder eine leere Map bei UIDVALIDITY-Wechsel. */
    known(accountId: string, folder: string, uidValidity: number): Map<number, string>;
    /** Merkt sich ein Paar; legt den Eintrag an bzw. ersetzt ihn bei neuer UIDVALIDITY. */
    remember(accountId: string, folder: string, uidValidity: number, uid: number, mailId: string): void;
    /** Entfernt UIDs, die der Server nicht mehr meldet — sonst waechst data.json unbegrenzt. */
    retain(accountId: string, folder: string, uidValidity: number, uids: readonly number[]): void;
    data(): UidCacheData;
  }
  export function createUidCache(initial: unknown): UidCacheStore;
  ```

- [ ] **Step 1: Die failing tests schreiben**

`tests/core/sync/uid-cache.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createUidCache } from "../../../src/core/sync/uid-cache";

describe("createUidCache", () => {
  it("liefert gemerkte Paare zurueck", () => {
    const c = createUidCache(undefined);
    c.remember("acc", "Vault", 42, 7, "a@b");
    expect(c.known("acc", "Vault", 42).get(7)).toBe("a@b");
  });

  it("verwirft den Eintrag bei geaenderter UIDVALIDITY", () => {
    const c = createUidCache(undefined);
    c.remember("acc", "Vault", 42, 7, "a@b");
    expect(c.known("acc", "Vault", 43).size).toBe(0);
    c.remember("acc", "Vault", 43, 1, "c@d");
    expect(c.known("acc", "Vault", 43).get(1)).toBe("c@d");
    expect(c.known("acc", "Vault", 43).has(7)).toBe(false);
  });

  it("haelt Konten und Ordner getrennt", () => {
    const c = createUidCache(undefined);
    c.remember("a", "Vault", 1, 7, "x@y");
    c.remember("b", "Vault", 1, 7, "z@y");
    expect(c.known("a", "Vault", 1).get(7)).toBe("x@y");
    expect(c.known("b", "Vault", 1).get(7)).toBe("z@y");
    expect(c.known("a", "Archive", 1).size).toBe(0);
  });

  it("retain wirft verschwundene UIDs weg", () => {
    const c = createUidCache(undefined);
    c.remember("acc", "Vault", 1, 7, "a@b");
    c.remember("acc", "Vault", 1, 8, "c@d");
    c.retain("acc", "Vault", 1, [8]);
    const known = c.known("acc", "Vault", 1);
    expect(known.has(7)).toBe(false);
    expect(known.get(8)).toBe("c@d");
  });

  it("uebersteht kaputte persistierte Daten, ohne zu werfen", () => {
    const c = createUidCache({ "acc|Vault": { uidValidity: "nope", map: 5 }, broken: null });
    expect(c.known("acc", "Vault", 1).size).toBe(0);
    expect(() => c.data()).not.toThrow();
  });

  it("data() ist rundreisefaehig", () => {
    const c = createUidCache(undefined);
    c.remember("acc", "Vault", 42, 7, "a@b");
    expect(createUidCache(JSON.parse(JSON.stringify(c.data()))).known("acc", "Vault", 42).get(7)).toBe("a@b");
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag sehen**

Run: `npx vitest run tests/core/sync/uid-cache.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: `uid-cache.ts` schreiben**

```ts
// UID -> Message-ID pro <Konto>|<Ordner>, damit nicht jeder Sync-Lauf alle Header holt.
// Der Cache ist Beschleunigung, nie Wahrheit: bei UIDVALIDITY-Wechsel wird er verworfen und
// der Lauf faellt auf den vollen Header-Abgleich zurueck.
export interface UidCacheEntry { uidValidity: number; map: Record<string, string> }
export type UidCacheData = Record<string, UidCacheEntry>;

export interface UidCacheStore {
  known(accountId: string, folder: string, uidValidity: number): Map<number, string>;
  remember(accountId: string, folder: string, uidValidity: number, uid: number, mailId: string): void;
  retain(accountId: string, folder: string, uidValidity: number, uids: readonly number[]): void;
  data(): UidCacheData;
}

const keyOf = (accountId: string, folder: string): string => `${accountId}|${folder}`;

function repair(raw: unknown): UidCacheData {
  const out: UidCacheData = {};
  if (raw === null || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    if (typeof e.uidValidity !== "number" || e.map === null || typeof e.map !== "object") continue;
    const map: Record<string, string> = {};
    for (const [uid, id] of Object.entries(e.map as Record<string, unknown>)) if (typeof id === "string") map[uid] = id;
    out[k] = { uidValidity: e.uidValidity, map };
  }
  return out;
}

export function createUidCache(initial: unknown): UidCacheStore {
  const data = repair(initial);

  function entry(accountId: string, folder: string, uidValidity: number): UidCacheEntry {
    const k = keyOf(accountId, folder);
    const cur = data[k];
    if (cur && cur.uidValidity === uidValidity) return cur;
    const fresh: UidCacheEntry = { uidValidity, map: {} };
    data[k] = fresh;
    return fresh;
  }

  return {
    known(accountId, folder, uidValidity) {
      const cur = data[keyOf(accountId, folder)];
      const out = new Map<number, string>();
      if (!cur || cur.uidValidity !== uidValidity) return out;
      for (const [uid, id] of Object.entries(cur.map)) out.set(Number(uid), id);
      return out;
    },
    remember(accountId, folder, uidValidity, uid, mailId) {
      entry(accountId, folder, uidValidity).map[String(uid)] = mailId;
    },
    retain(accountId, folder, uidValidity, uids) {
      const cur = entry(accountId, folder, uidValidity);
      const keep = new Set(uids.map((u) => String(u)));
      for (const uid of Object.keys(cur.map)) if (!keep.has(uid)) delete cur.map[uid];
    },
    data: () => data,
  };
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/core/sync/uid-cache.test.ts`
Expected: PASS (6 Fälle).

- [ ] **Step 5: Commit**

```bash
git add src/core/sync/uid-cache.ts tests/core/sync/uid-cache.test.ts
git commit -m "feat(sync): UID-zu-Message-ID-Cache je Konto/Ordner, verworfen bei UIDVALIDITY-Wechsel"
```

---

### Task 6: Pläne für einen Sync-Lauf (`core/mirror/apply.ts`) + Executor-Typen nach `core`

Zwei Dinge in einem Task, weil sie dieselbe Grenze betreffen: `planSync` muss den `PlanExecutor`-Typ benennen können, ohne aus `src/obsidian` zu importieren. Die Typen ziehen deshalb nach `core/mirror/execute.ts` um; `vault-notes.ts` re-exportiert sie, damit bestehende Importe gültig bleiben.

**Files:**
- Create: `src/core/mirror/execute.ts`, `src/core/mirror/apply.ts`
- Modify: `src/obsidian/vault-notes.ts` (Typen importieren + re-exportieren, `mailIndex` ergänzen)
- Test: `tests/core/mirror/apply.test.ts`, `tests/obsidian/vault-notes.test.ts` (Ergänzung)

**Interfaces:**
- Consumes: `planMailNote`, `NotePlan`, `ExistingNote` aus `core/mirror/plan.ts`; `MailProfile` aus `core/mirror/profile.ts`; `ParsedMail` aus `core/mime/types.ts`.
- Produces:
  ```ts
  // core/mirror/execute.ts (Umzug, Inhalt unveraendert)
  export interface PlanExecutionResult { created: number; updated: number; skipped: NotePlan[]; stateChanged: number; errors: { plan: NotePlan; message: string }[] }
  export interface PlanExecutor { execute(plans: NotePlan[]): Promise<PlanExecutionResult> }
  export interface ZoneHashStore { get(mailId: string): string | null; set(mailId: string, hash: string): void }

  // core/mirror/apply.ts
  export interface MailIndexEntry { path: string; state: string | null; source: string | null }
  export type MailIndex = Map<string, MailIndexEntry>;
  export interface ApplyInput {
    profile: MailProfile;
    /** "<accountId>/<ordner>" — identifiziert die Notizen, fuer die DIESER Lauf zustaendig ist. */
    source: string;
    syncedAt: Date;
    index: MailIndex;
    takenPaths: Set<string>;
    /** Frisch geholte Mails, die im Vault noch fehlen. */
    fetched: { mail: ParsedMail; eml: Uint8Array }[];
    /** Alle mailIds, die JETZT im Allowlist-Ordner liegen (auch die laengst bekannten). */
    onServer: Set<string>;
    linkFor?: (id: string) => string | null;
  }
  export function planSync(input: ApplyInput): NotePlan[];

  // src/obsidian/vault-notes.ts
  export function mailIndex(app: App, profile: MailProfile): MailIndex;
  ```

- [ ] **Step 1: Die failing tests schreiben**

`tests/core/mirror/apply.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planSync, type MailIndex } from "../../../src/core/mirror/apply";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import type { ParsedMail } from "../../../src/core/mime/types";

const profile = defaultMailProfile();
const syncedAt = new Date("2026-08-30T09:00:00Z");
const SOURCE = "acc/Vault";

function mail(id: string): ParsedMail {
  return {
    id, messageIdRaw: `<${id}>`, inReplyTo: null, references: [],
    from: { name: "A", address: "a@example.net" }, to: [], cc: [],
    subject: `Betreff ${id}`, date: new Date("2026-08-29T08:00:00Z"),
    text: "Hallo", html: null, attachments: [], attachmentData: new Map(), rawSize: 10,
  };
}
const eml = new TextEncoder().encode("From: a@example.net\r\n\r\nHallo\r\n");

describe("planSync", () => {
  it("legt fuer eine unbekannte Mail eine Notiz an", () => {
    const plans = planSync({ profile, source: SOURCE, syncedAt, index: new Map(), takenPaths: new Set(), fetched: [{ mail: mail("neu@x"), eml }], onServer: new Set(["neu@x"]) });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ kind: "create", mailId: "neu@x" });
  });

  it("setzt detached, wenn eine bekannte Mail den Ordner verlassen hat", () => {
    const index: MailIndex = new Map([["weg@x", { path: "Mail/2026/weg.md", state: "live", source: SOURCE }]]);
    const plans = planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(), fetched: [], onServer: new Set() });
    expect(plans).toEqual([{ kind: "setState", path: "Mail/2026/weg.md", mailId: "weg@x", state: "detached", stateField: "mail_state" }]);
  });

  it("setzt live, wenn eine detachte Mail zurueckkehrt", () => {
    const index: MailIndex = new Map([["zurueck@x", { path: "Mail/2026/z.md", state: "detached", source: SOURCE }]]);
    const plans = planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(), fetched: [], onServer: new Set(["zurueck@x"]) });
    expect(plans).toEqual([{ kind: "setState", path: "Mail/2026/z.md", mailId: "zurueck@x", state: "live", stateField: "mail_state" }]);
  });

  it("laesst eine live-Notiz, die weiter im Ordner liegt, unberuehrt", () => {
    const index: MailIndex = new Map([["bleibt@x", { path: "Mail/2026/b.md", state: "live", source: SOURCE }]]);
    expect(planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(), fetched: [], onServer: new Set(["bleibt@x"]) })).toEqual([]);
  });

  it("fasst Notizen eines ANDEREN Kontos nicht an", () => {
    const index: MailIndex = new Map([["fremd@x", { path: "Mail/2026/f.md", state: "live", source: "anderes-konto/Vault" }]]);
    expect(planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(), fetched: [], onServer: new Set() })).toEqual([]);
  });

  it("laesst eine Notiz ohne mail_source unberuehrt (Altbestand aus dem Import)", () => {
    const index: MailIndex = new Map([["alt@x", { path: "Mail/2026/a.md", state: "live", source: null }]]);
    expect(planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(), fetched: [], onServer: new Set() })).toEqual([]);
  });

  it("rendert eine bestehende Notiz nie neu, auch wenn die Mail mitgeliefert wird", () => {
    const index: MailIndex = new Map([["da@x", { path: "Mail/2026/d.md", state: "live", source: SOURCE }]]);
    const plans = planSync({ profile, source: SOURCE, syncedAt, index, takenPaths: new Set(), fetched: [{ mail: mail("da@x"), eml }], onServer: new Set(["da@x"]) });
    expect(plans.some((p) => p.kind === "update")).toBe(false);
  });

  it("vergibt kollisionsfreie Pfade fuer zwei Mails desselben Betreffs am selben Zeitpunkt", () => {
    const a = mail("eins@x");
    const b = { ...mail("zwei@x"), subject: a.subject, date: a.date };
    const plans = planSync({ profile, source: SOURCE, syncedAt, index: new Map(), takenPaths: new Set(), fetched: [{ mail: a, eml }, { mail: b, eml }], onServer: new Set(["eins@x", "zwei@x"]) });
    const paths = plans.flatMap((p) => (p.kind === "create" ? [p.path, p.emlPath] : []));
    expect(new Set(paths).size).toBe(paths.length);
  });
});
```

`tests/obsidian/vault-notes.test.ts` bekommt zusätzlich:

```ts
  it("mailIndex liest id, state und source aus dem Frontmatter", () => {
    const app = makeApp([
      { path: "Mail/2026/a.md", frontmatter: { mail_id: "a@x", mail_state: "live", mail_source: "acc/Vault" } },
      { path: "Notiz.md", frontmatter: { title: "ohne mail_id" } },
    ]);
    const index = mailIndex(app, defaultMailProfile());
    expect(index.get("a@x")).toEqual({ path: "Mail/2026/a.md", state: "live", source: "acc/Vault" });
    expect(index.size).toBe(1);
  });
```

(`makeApp` ist der bestehende Helfer der Datei; falls er noch keine Frontmatter-Einträge kennt, in derselben Datei um `metadataCache.getFileCache` erweitern — `findMailNotes` nutzt ihn bereits.)

- [ ] **Step 2: Tests laufen lassen, Fehlschlag sehen**

Run: `npx vitest run tests/core/mirror/apply.test.ts tests/obsidian/vault-notes.test.ts`
Expected: FAIL — `apply` fehlt, `mailIndex` ist kein Export.

- [ ] **Step 3: Umzug und `apply.ts` schreiben**

`src/core/mirror/execute.ts` — die drei Interfaces aus `src/obsidian/vault-notes.ts` unverändert hierher, mit `import type { NotePlan } from "./plan";`.

In `src/obsidian/vault-notes.ts` die lokalen Definitionen ersetzen durch:

```ts
import type { PlanExecutionResult, PlanExecutor, ZoneHashStore } from "../core/mirror/execute";
import type { MailIndex } from "../core/mirror/apply";
import type { MailProfile } from "../core/mirror/profile";
export type { PlanExecutionResult, PlanExecutor, ZoneHashStore };
```

und `mailIndex` ergänzen (`findMailNotes` bleibt, das Import-Kommando nutzt es):

```ts
/** Wie findMailNotes, liefert aber zusaetzlich Zustand und Herkunft — der Sync braucht beide,
 *  um fremde Notizen (anderes Konto, Import ohne mail_source) nicht anzufassen. */
export function mailIndex(app: App, profile: MailProfile): MailIndex {
  const out: MailIndex = new Map();
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    const id: unknown = fm?.[profile.idField];
    if (typeof id !== "string" || !id) continue;
    const state: unknown = fm?.[profile.stateField];
    const source: unknown = fm?.[profile.sourceField];
    out.set(id, { path: f.path, state: typeof state === "string" ? state : null, source: typeof source === "string" ? source : null });
  }
  return out;
}
```

`src/core/mirror/apply.ts`:

```ts
// Server-Stand x Vault-Stand -> NotePlan[]. Der Sync legt Neues an und setzt mail_state; er
// rendert nie eine bestehende Notiz neu (Spec § 2.2, Merge-Regel 5) — deshalb geht hier
// ausnahmslos allowUpdate: false an planMailNote.
import type { ParsedMail } from "../mime/types";
import { planMailNote, type NotePlan } from "./plan";
import type { MailProfile } from "./profile";

export interface MailIndexEntry { path: string; state: string | null; source: string | null }
export type MailIndex = Map<string, MailIndexEntry>;

export interface ApplyInput {
  profile: MailProfile;
  source: string;
  syncedAt: Date;
  index: MailIndex;
  takenPaths: Set<string>;
  fetched: { mail: ParsedMail; eml: Uint8Array }[];
  onServer: Set<string>;
  linkFor?: (id: string) => string | null;
}

export function planSync(input: ApplyInput): NotePlan[] {
  const { profile, index } = input;
  const plans: NotePlan[] = [];
  const taken = input.takenPaths;

  for (const { mail, eml } of input.fetched) {
    if (index.has(mail.id)) continue; // bekannt -> Zustand entscheidet unten, nie neu rendern
    const plan = planMailNote({
      mail, eml, profile,
      source: input.source,
      syncedAt: input.syncedAt,
      existing: null,
      takenPaths: taken,
      allowUpdate: false,
      ...(input.linkFor ? { linkFor: input.linkFor } : {}),
    });
    if (plan.kind === "create") { taken.add(plan.path); taken.add(plan.emlPath); }
    plans.push(plan);
  }

  for (const [mailId, entry] of index) {
    // Fremde Notiz (anderes Konto/Ordner) oder Altbestand ohne Herkunft: nicht unsere Sache.
    if (entry.source !== input.source) continue;
    const here = input.onServer.has(mailId);
    if (here && entry.state === "detached") {
      plans.push({ kind: "setState", path: entry.path, mailId, state: "live", stateField: profile.stateField });
    } else if (!here && entry.state !== "detached") {
      plans.push({ kind: "setState", path: entry.path, mailId, state: "detached", stateField: profile.stateField });
    }
  }

  return plans;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/core/mirror tests/obsidian/vault-notes.test.ts && npm run typecheck && npm run check:pure`
Expected: PASS — 8 apply-Fälle plus der `mailIndex`-Fall; keine Typfehler durch den Umzug.

- [ ] **Step 5: Commit**

```bash
git add src/core/mirror/execute.ts src/core/mirror/apply.ts src/obsidian/vault-notes.ts tests/core/mirror/apply.test.ts tests/obsidian/vault-notes.test.ts
git commit -m "feat(mirror): planSync fuer create/reattach/detach, Executor-Typen nach core/mirror"
```

---

### Task 7: Der Sync-Lauf (`core/sync/service.ts`)

Ein Lauf pro Konto, eine Verbindung, Busy-Guard geteilt mit allem, was später schreibt. Der Service kennt weder Vault noch Obsidian: er bekommt Index, Pfade und Executor als Deps und liefert ein Ergebnis.

**Files:**
- Create: `src/core/sync/busy.ts`, `src/core/sync/events.ts`, `src/core/sync/errors.ts`, `src/core/sync/service.ts`
- Test: `tests/core/sync/service.test.ts`

**Interfaces:**
- Consumes: `imapConnect`/`ImapSession` (Task 4), `createUidCache` (Task 5), `planSync`/`MailIndex` (Task 6), `parseEml` aus `core/mime/parse.ts`, `Account`/`MailProfile` aus den Settings, `PlanExecutor` aus `core/mirror/execute.ts`.
- Produces:
  ```ts
  // core/sync/busy.ts  — uebernommen aus calendar-notes, unveraendert
  export interface BusyGuard { tryAcquire(): boolean; release(): void; isBusy(): boolean }
  export function createBusyGuard(): BusyGuard;

  // core/sync/events.ts — uebernommen aus calendar-notes, Payloads an mailstone angepasst
  /** Liegt hier und nicht in service.ts: sonst importierten sich events.ts und service.ts
   *  gegenseitig, nur um einen Zaehler-Typ zu teilen. */
  export interface SyncCounts { created: number; reattached: number; detached: number; skipped: number; errors: number }
  export interface SyncEvents extends Record<string, unknown> {
    synced: { accountId: string; counts: SyncCounts };
    changed: { path: string; kind: NotePlan["kind"]; mailId: string };
  }
  export type SyncEmitter = Emitter<SyncEvents>;
  export function createEmitter<E extends Record<string, unknown>>(): Emitter<E>;

  // core/sync/errors.ts
  export type SyncErrorCode = "no-secret" | "busy" | "no-account" | ImapErrorCode;

  // core/sync/service.ts  (SyncCounts kommt aus events.ts, siehe oben)
  export type SyncRunResult =
    | { ok: true; accountId: string; counts: SyncCounts }
    | { ok: false; accountId: string; code: SyncErrorCode; detail?: string };
  export interface SyncDeps {
    accounts: () => Account[];
    profile: () => MailProfile;
    secret: (secretId: string) => string | null;
    transport: () => SocketTransport;
    index: () => MailIndex;
    takenPaths: () => Set<string>;
    executor: () => PlanExecutor;
    uidCache: UidCacheStore;
    busy: BusyGuard;
    events: SyncEmitter;
    /** Timer-Port, den der Service an imapConnect durchreicht (withTimeout). */
    timers: TimeoutTimers;
    now: () => Date;
    log?: (line: string) => void;
  }
  export interface SyncService {
    syncAccount(accountId: string): Promise<SyncRunResult>;
    /** Alle Konten mit sync.enabled, nacheinander — nie parallel gegen denselben Vault. */
    syncAll(): Promise<SyncRunResult[]>;
  }
  export function createSyncService(deps: SyncDeps): SyncService;
  ```

- [ ] **Step 1: Die failing tests schreiben**

`tests/core/sync/service.test.ts` — der Test fährt den echten Dialog gegen `FakeSocketTransport` und einen Executor-Doppelgänger:

```ts
import { describe, it, expect, vi } from "vitest";
import { FakeSocketTransport, type DialogStep } from "../../helpers/fake-socket";
import { testTimers } from "../../helpers/timers";
import { createSyncService } from "../../../src/core/sync/service";
import { createBusyGuard } from "../../../src/core/sync/busy";
import { createEmitter } from "../../../src/core/sync/events";
import { createUidCache } from "../../../src/core/sync/uid-cache";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import { newAccount, type Account } from "../../../src/core/settings";
import type { MailIndex } from "../../../src/core/mirror/apply";
import type { NotePlan } from "../../../src/core/mirror/plan";
import type { PlanExecutor } from "../../../src/core/mirror/execute";

const EML = "From: a@example.net\r\nTo: b@example.net\r\nSubject: Testmail\r\nMessage-ID: <neu@example.net>\r\nDate: Sat, 29 Aug 2026 08:00:00 +0000\r\n\r\nHallo\r\n";

function account(): Account {
  const a = newAccount("acc");
  a.imap = { host: "imap.example.net", port: 993, tls: "implicit" };
  a.username = "u@example.net";
  a.folders.allowlist = "Vault";
  return a;
}

function recordingExecutor(): { executor: PlanExecutor; seen: NotePlan[] } {
  const seen: NotePlan[] = [];
  return {
    seen,
    executor: {
      execute: (plans) => {
        seen.push(...plans);
        return Promise.resolve({
          created: plans.filter((p) => p.kind === "create").length,
          updated: 0,
          stateChanged: plans.filter((p) => p.kind === "setState").length,
          skipped: plans.filter((p) => p.kind === "skip"),
          errors: [],
        });
      },
    },
  };
}

function dialog(extra: DialogStep[]): DialogStep[] {
  return [
    { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN", "a001 OK done"] },
    { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
    { expect: /^a003 EXAMINE /, send: ["* 1 EXISTS", "* OK [UIDVALIDITY 42] ok", "a003 OK done"] },
    ...extra,
  ];
}

function service(steps: DialogStep[], index: MailIndex, exec = recordingExecutor()) {
  const fake = new FakeSocketTransport(["* OK ready"], steps);
  const svc = createSyncService({
    accounts: () => [account()],
    profile: () => defaultMailProfile(),
    secret: () => "geheim",
    transport: () => fake,
    index: () => index,
    takenPaths: () => new Set<string>(),
    executor: () => exec.executor,
    uidCache: createUidCache(undefined),
    busy: createBusyGuard(),
    events: createEmitter(), timers: testTimers,
    now: () => new Date("2026-08-30T09:00:00Z"),
  });
  return { svc, fake, exec };
}

describe("createSyncService", () => {
  it("legt fuer eine neue Mail im Allowlist-Ordner eine Notiz an", async () => {
    const header = new TextEncoder().encode("Message-ID: <neu@example.net>\r\n\r\n");
    const body = new TextEncoder().encode(EML);
    const { svc, exec } = service(
      dialog([
        { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 7", "a004 OK done"] },
        { expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[HEADER\.FIELDS \(MESSAGE-ID\)\]\)$/, send: [`* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(header.byteLength)}}`, header, ")", "a005 OK done"] },
        { expect: /^a006 UID FETCH 7 \(BODY\.PEEK\[\]\)$/, send: [`* 1 FETCH (UID 7 BODY[] {${String(body.byteLength)}}`, body, ")", "a006 OK done"] },
        { expect: /^a007 LOGOUT$/, send: ["* BYE", "a007 OK done"] },
      ]),
      new Map(),
    );
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: 1 } });
    expect(exec.seen[0]).toMatchObject({ kind: "create", mailId: "neu@example.net" });
  });

  it("holt keinen Body fuer eine Mail, deren Notiz es schon gibt", async () => {
    const header = new TextEncoder().encode("Message-ID: <da@example.net>\r\n\r\n");
    const index: MailIndex = new Map([["da@example.net", { path: "Mail/2026/d.md", state: "live", source: "acc/Vault" }]]);
    const { svc, fake } = service(
      dialog([
        { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH 7", "a004 OK done"] },
        { expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[HEADER\.FIELDS \(MESSAGE-ID\)\]\)$/, send: [`* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(header.byteLength)}}`, header, ")", "a005 OK done"] },
        { expect: /^a006 LOGOUT$/, send: ["* BYE", "a006 OK done"] },
      ]),
      index,
    );
    const r = await svc.syncAccount("acc");
    expect(r.ok).toBe(true);
    expect(fake.written.some((l) => l.includes("BODY.PEEK[]"))).toBe(false);
  });

  it("setzt detached fuer eine Notiz, deren Mail den Ordner verlassen hat", async () => {
    const index: MailIndex = new Map([["weg@example.net", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }]]);
    const { svc, exec } = service(
      dialog([
        { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH", "a004 OK done"] },
        { expect: /^a005 LOGOUT$/, send: ["* BYE", "a005 OK done"] },
      ]),
      index,
    );
    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { detached: 1 } });
    expect(exec.seen).toEqual([{ kind: "setState", path: "Mail/2026/w.md", mailId: "weg@example.net", state: "detached", stateField: "mail_state" }]);
  });

  it("nutzt beim zweiten Lauf den UID-Cache statt erneut Header zu holen", async () => {
    const header = new TextEncoder().encode("Message-ID: <da@example.net>\r\n\r\n");
    const index: MailIndex = new Map([["da@example.net", { path: "Mail/2026/d.md", state: "live", source: "acc/Vault" }]]);
    const cache = createUidCache(undefined);
    const steps = (n: number, withHeader: boolean): DialogStep[] => [
      { expect: new RegExp(`^a00${String(n)} UID SEARCH ALL$`), send: ["* SEARCH 7", `a00${String(n)} OK done`] },
      ...(withHeader ? [{ expect: /^a005 UID FETCH 7 \(BODY\.PEEK\[HEADER/, send: [`* 1 FETCH (UID 7 BODY[HEADER.FIELDS (MESSAGE-ID)] {${String(header.byteLength)}}`, header, ")", "a005 OK done"] }] : []),
      { expect: /LOGOUT$/, send: ["* BYE", "a006 OK done"] },
    ];
    const mk = (withHeader: boolean): FakeSocketTransport => new FakeSocketTransport(["* OK ready"], dialog(steps(4, withHeader)));
    let current = mk(true);
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim",
      transport: () => current, index: () => index, takenPaths: () => new Set<string>(),
      executor: () => recordingExecutor().executor, uidCache: cache, busy: createBusyGuard(),
      events: createEmitter(), timers: testTimers, now: () => new Date("2026-08-30T09:00:00Z"),
    });
    await svc.syncAccount("acc");
    current = mk(false);
    expect((await svc.syncAccount("acc")).ok).toBe(true);
    expect(current.written.some((l) => l.includes("HEADER.FIELDS"))).toBe(false);
  });

  it("meldet no-secret, ohne eine Verbindung aufzubauen", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], []);
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => null,
      transport: () => fake, index: () => new Map(), takenPaths: () => new Set<string>(),
      executor: () => recordingExecutor().executor, uidCache: createUidCache(undefined),
      busy: createBusyGuard(), events: createEmitter(), timers: testTimers, now: () => new Date(),
    });
    expect(await svc.syncAccount("acc")).toMatchObject({ ok: false, code: "no-secret" });
    expect(fake.connectCalls).toHaveLength(0);
  });

  it("meldet busy, wenn der Guard belegt ist, und laesst den Guard danach frei", async () => {
    const busy = createBusyGuard();
    busy.tryAcquire();
    const fake = new FakeSocketTransport(["* OK ready"], []);
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim",
      transport: () => fake, index: () => new Map(), takenPaths: () => new Set<string>(),
      executor: () => recordingExecutor().executor, uidCache: createUidCache(undefined),
      busy, events: createEmitter(), timers: testTimers, now: () => new Date(),
    });
    expect(await svc.syncAccount("acc")).toMatchObject({ ok: false, code: "busy" });
    busy.release();
    expect(busy.isBusy()).toBe(false);
  });

  it("gibt den Busy-Guard auch frei, wenn der Dialog mittendrin abbricht", async () => {
    const busy = createBusyGuard();
    const fake = new FakeSocketTransport(["* OK ready"], [{ expect: /^a001 CAPABILITY$/, send: ["a001 BAD kaputt"] }]);
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim",
      transport: () => fake, index: () => new Map(), takenPaths: () => new Set<string>(),
      executor: () => recordingExecutor().executor, uidCache: createUidCache(undefined),
      busy, events: createEmitter(), timers: testTimers, now: () => new Date(),
    });
    expect((await svc.syncAccount("acc")).ok).toBe(false);
    expect(busy.isBusy()).toBe(false);
    expect(fake.closed).toBe(true);
  });

  it("feuert synced mit den Zaehlern und changed je ausgefuehrtem Plan", async () => {
    const index: MailIndex = new Map([["weg@example.net", { path: "Mail/2026/w.md", state: "live", source: "acc/Vault" }]]);
    const events = createEmitter<{ synced: { accountId: string; counts: { detached: number } }; changed: { path: string } }>();
    const synced = vi.fn();
    const changed = vi.fn();
    events.on("synced", synced);
    events.on("changed", changed);
    const fake = new FakeSocketTransport(["* OK ready"], dialog([
      { expect: /^a004 UID SEARCH ALL$/, send: ["* SEARCH", "a004 OK done"] },
      { expect: /^a005 LOGOUT$/, send: ["* BYE", "a005 OK done"] },
    ]));
    const svc = createSyncService({
      accounts: () => [account()], profile: () => defaultMailProfile(), secret: () => "geheim",
      transport: () => fake, index: () => index, takenPaths: () => new Set<string>(),
      executor: () => recordingExecutor().executor, uidCache: createUidCache(undefined),
      busy: createBusyGuard(), events: events as never, timers: testTimers, now: () => new Date(),
    });
    await svc.syncAccount("acc");
    expect(synced).toHaveBeenCalledWith(expect.objectContaining({ accountId: "acc" }));
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ path: "Mail/2026/w.md" }));
  });

  it("meldet no-account fuer eine unbekannte Konto-ID", async () => {
    const { svc } = service([], new Map());
    expect(await svc.syncAccount("gibtsnicht")).toMatchObject({ ok: false, code: "no-account" });
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag sehen**

Run: `npx vitest run tests/core/sync/service.test.ts`
Expected: FAIL — Module fehlen.

- [ ] **Step 3: Die vier Module schreiben**

`src/core/sync/busy.ts` — byte-identische Übernahme aus `calendar-notes/src/core/sync/busy.ts`, Zeile 1:
```ts
// uebernommen aus calendar-notes/src/core/sync/busy.ts, 2026-08-30
```

`src/core/sync/events.ts` — Übernahme desselben Emitters (inkl. des Kommentars zum werfenden Listener und der Kopie beim Iterieren), Zeile 1:
```ts
// uebernommen aus calendar-notes/src/core/sync/events.ts, 2026-08-30 — Payloads an mailstone angepasst
```
Statt `RunInfo`/`uid` trägt `SyncEvents` hier:
```ts
export interface SyncEvents extends Record<string, unknown> {
  synced: { accountId: string; counts: SyncCounts };
  changed: { path: string; kind: NotePlan["kind"]; mailId: string };
}
export type SyncEmitter = Emitter<SyncEvents>;
```

`src/core/sync/errors.ts`:
```ts
import type { ImapErrorCode } from "../imap/types";
/** Alles, was ein Sync-Lauf als Wert melden kann. Uebersetzt wird erst in src/obsidian
 *  (Schluessel `error.sync.<code>` in src/i18n/strings.ts). */
export type SyncErrorCode = "no-secret" | "busy" | "no-account" | ImapErrorCode;
```

`src/core/sync/service.ts`:

```ts
// Ein Sync-Lauf pro Konto: eine Verbindung, EXAMINE auf den Allowlist-Ordner, UID-Abgleich
// gegen den Vault-Index, Plaene ueber den PlanExecutor. Der Service kennt weder Vault noch
// Obsidian (siehe scripts/check-pure.mjs) — Index, Pfade und Executor kommen als Deps.
import type { Account } from "../settings";
import type { MailProfile } from "../mirror/profile";
import type { SocketTransport } from "../net/types";
import type { PlanExecutor } from "../mirror/execute";
import type { NotePlan } from "../mirror/plan";
import { planSync, type MailIndex } from "../mirror/apply";
import { parseEml } from "../mime/parse";
import type { ParsedMail } from "../mime/types";
import { imapConnect, type ImapSession } from "../imap/client";
import type { UidCacheStore } from "./uid-cache";
import type { BusyGuard } from "./busy";
import type { SyncCounts, SyncEmitter } from "./events";
import type { SyncErrorCode } from "./errors";
import type { TimeoutTimers } from "../../vendor/code-kit/timeout";

export type SyncRunResult =
  | { ok: true; accountId: string; counts: SyncCounts }
  | { ok: false; accountId: string; code: SyncErrorCode; detail?: string };

export interface SyncDeps {
  accounts: () => Account[];
  profile: () => MailProfile;
  secret: (secretId: string) => string | null;
  transport: () => SocketTransport;
  index: () => MailIndex;
  takenPaths: () => Set<string>;
  executor: () => PlanExecutor;
  uidCache: UidCacheStore;
  busy: BusyGuard;
  events: SyncEmitter;
  timers: TimeoutTimers;
  now: () => Date;
  log?: (line: string) => void;
}

export interface SyncService {
  syncAccount(accountId: string): Promise<SyncRunResult>;
  syncAll(): Promise<SyncRunResult[]>;
}

const empty = (): SyncCounts => ({ created: 0, reattached: 0, detached: 0, skipped: 0, errors: 0 });

export function createSyncService(deps: SyncDeps): SyncService {
  async function run(account: Account): Promise<SyncRunResult> {
    const profile = deps.profile();
    const folder = account.folders.allowlist;
    const source = `${account.id}/${folder}`;
    const password = deps.secret(account.secretId);
    if (password === null) return { ok: false, accountId: account.id, code: "no-secret" };

    const connected = await imapConnect(deps.transport(), {
      host: account.imap.host, port: account.imap.port, tls: account.imap.tls,
      username: account.username, password, timers: deps.timers,
      ...(deps.log ? { log: deps.log } : {}),
    });
    if (!connected.ok) return { ok: false, accountId: account.id, code: connected.code, detail: connected.detail };
    const session: ImapSession = connected.session;

    try {
      const examined = await session.examine(folder);
      if (!examined.ok) return { ok: false, accountId: account.id, code: examined.code, detail: examined.detail };

      const uids = await session.uidSearchAll();
      const known = deps.uidCache.known(account.id, folder, examined.uidValidity);
      const unknownUids = uids.filter((u) => !known.has(u));
      if (unknownUids.length > 0) {
        for (const [uid, mailId] of await session.uidFetchMessageIds(unknownUids)) {
          if (mailId === null) continue; // ohne Message-ID-Header: ID entsteht erst beim Parsen
          known.set(uid, mailId);
          deps.uidCache.remember(account.id, folder, examined.uidValidity, uid, mailId);
        }
      }

      const index = deps.index();
      const onServer = new Set<string>();
      const fetched: { mail: ParsedMail; eml: Uint8Array }[] = [];
      let errors = 0;

      for (const uid of uids) {
        const cachedId = known.get(uid);
        if (cachedId !== undefined) {
          onServer.add(cachedId);
          if (index.has(cachedId)) continue; // Notiz existiert — kein Body noetig
        }
        const eml = await session.uidFetchBody(uid);
        if (!eml) { errors += 1; continue; } // UID zwischenzeitlich verschwunden
        try {
          const mail = await parseEml(eml);
          onServer.add(mail.id);
          deps.uidCache.remember(account.id, folder, examined.uidValidity, uid, mail.id);
          if (!index.has(mail.id)) fetched.push({ mail, eml });
        } catch {
          errors += 1; // unparsbare Mail ueberspringt der Lauf, er bricht nicht ab
        }
      }
      deps.uidCache.retain(account.id, folder, examined.uidValidity, uids);

      const plans = planSync({
        profile, source, syncedAt: deps.now(), index,
        takenPaths: deps.takenPaths(), fetched, onServer,
        linkFor: (id) => index.get(id)?.path.replace(/\.md$/, "") ?? null,
      });

      const result = await deps.executor().execute(plans);
      const counts: SyncCounts = {
        created: result.created,
        reattached: plans.filter((p) => p.kind === "setState" && p.state === "live").length,
        detached: plans.filter((p) => p.kind === "setState" && p.state === "detached").length,
        skipped: result.skipped.length,
        errors: errors + result.errors.length,
      };
      for (const p of executed(plans, result.errors.map((e) => e.plan))) {
        deps.events.emit("changed", { path: p.path, kind: p.kind, mailId: p.mailId });
      }
      deps.events.emit("synced", { accountId: account.id, counts });
      return { ok: true, accountId: account.id, counts };
    } finally {
      await session.logout();
    }
  }

  /** Plaene, die tatsaechlich gewirkt haben: keine skips, keine gescheiterten. */
  function executed(plans: NotePlan[], failed: NotePlan[]): NotePlan[] {
    return plans.filter((p) => p.kind !== "skip" && !failed.includes(p));
  }

  return {
    async syncAccount(accountId) {
      const account = deps.accounts().find((a) => a.id === accountId);
      if (!account) return { ok: false, accountId, code: "no-account" };
      if (!deps.busy.tryAcquire()) return { ok: false, accountId, code: "busy" };
      try {
        return await run(account);
      } catch (e) {
        return { ok: false, accountId, code: "protocol", detail: e instanceof Error ? e.message : String(e) };
      } finally {
        deps.busy.release();
      }
    },

    async syncAll() {
      const out: SyncRunResult[] = [];
      // Nacheinander, nie parallel: der Busy-Guard laesst ohnehin nur einen Lauf zu, und zwei
      // gleichzeitige Laeufe wuerden dieselben freien Pfade doppelt vergeben.
      for (const a of deps.accounts().filter((x) => x.sync.enabled)) out.push(await this.syncAccount(a.id));
      return out;
    },
  };
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/core/sync && npm run check:pure && npm run typecheck`
Expected: PASS — alle 9 Service-Fälle grün.

- [ ] **Step 5: Commit**

```bash
git add src/core/sync tests/core/sync/service.test.ts
git commit -m "feat(sync): Lauf pro Konto mit Busy-Guard, UID-Cache und Emitter"
```

---

### Task 8: Verdrahtung in Obsidian

Kommando, Ribbon, Intervall, Statusleiste, die Fehlermeldungen — und die zwei Carry-over-Punkte, die hier hingehören: „Passwort fehlt" sichtbar in der Kontenzeile (`SecretStore.has` liegt seit M2 ungenutzt herum) und ein UI-Schalter für `debugLog`, das bisher nur über `data.json` erreichbar war.

**Files:**
- Modify: `src/main.ts`, `src/obsidian/settings-tab.ts`, `src/i18n/strings.ts`
- Test: `tests/obsidian/settings-tab.test.ts` (ergänzen bzw. anlegen)

**Interfaces:**
- Consumes: `createSyncService`/`SyncRunResult` (Task 7), `createUidCache`/`UidCacheData` (Task 5), `mailIndex` (Task 6), `vaultPlanExecutor` (M1).
- Produces:
  ```ts
  // src/main.ts — PersistedState waechst um den UID-Cache
  interface PersistedState { settings: MailstoneSettings; zoneHashes: Record<string, string>; uidCache: UidCacheData }
  ```

- [ ] **Step 1: Die neuen i18n-Schlüssel eintragen**

In `src/i18n/strings.ts`, EN-Block (DE-Block spiegelbildlich, gleiche Reihenfolge):

```ts
  "cmd.sync.name": "Synchronise mailbox folder",
  "ribbon.sync": "Mailstone: synchronise",
  "status.sync.running": "Mailstone: synchronising…",
  "status.sync.idle": "Mailstone: {0} notes · last sync {1}",
  "notice.sync.done": "{0} new, {1} reattached, {2} detached ({3} errors)",
  "notice.sync.noAccounts": "No account with synchronisation enabled.",
  "error.sync.no-secret": "No password stored for this account. Open the settings and select one.",
  "error.sync.no-account": "This account no longer exists.",
  "error.sync.busy": "A synchronisation is already running.",
  "error.sync.auth": "The server rejected the login. Check username and app password.",
  "error.sync.folder-missing": "The allowlist folder does not exist on the server.",
  "error.sync.tls-required": "The server refuses to authenticate on this connection.",
  "error.sync.connect": "Could not reach the server.",
  "error.sync.tls": "The encrypted connection could not be established.",
  "error.sync.timeout": "The server did not answer in time.",
  "error.sync.closed": "The server closed the connection.",
  "error.sync.protocol": "The server answered in a way Mailstone did not understand.",
  "settings.account.noSecret": "No password stored",
  "settings.debugLog": "Debug log",
  "settings.debugLog.desc": "Writes the IMAP/SMTP dialogue to the developer console. Passwords are masked. Off by default.",
```

DE (gleiche Schlüssel):
```ts
  "cmd.sync.name": "Postfach-Ordner synchronisieren",
  "ribbon.sync": "Mailstone: synchronisieren",
  "status.sync.running": "Mailstone: synchronisiert…",
  "status.sync.idle": "Mailstone: {0} Notizen · zuletzt {1}",
  "notice.sync.done": "{0} neu, {1} wieder verbunden, {2} abgelöst ({3} Fehler)",
  "notice.sync.noAccounts": "Kein Konto mit aktivierter Synchronisierung.",
  "error.sync.no-secret": "Für dieses Konto ist kein Passwort hinterlegt. Bitte in den Einstellungen eines auswählen.",
  "error.sync.no-account": "Dieses Konto gibt es nicht mehr.",
  "error.sync.busy": "Es läuft bereits eine Synchronisierung.",
  "error.sync.auth": "Der Server hat die Anmeldung abgelehnt. Bitte Benutzername und App-Passwort prüfen.",
  "error.sync.folder-missing": "Den Allowlist-Ordner gibt es auf dem Server nicht.",
  "error.sync.tls-required": "Der Server verweigert die Anmeldung auf dieser Verbindung.",
  "error.sync.connect": "Der Server war nicht erreichbar.",
  "error.sync.tls": "Die verschlüsselte Verbindung kam nicht zustande.",
  "error.sync.timeout": "Der Server hat nicht rechtzeitig geantwortet.",
  "error.sync.closed": "Der Server hat die Verbindung geschlossen.",
  "error.sync.protocol": "Die Antwort des Servers war für Mailstone unverständlich.",
  "settings.account.noSecret": "Kein Passwort hinterlegt",
  "settings.debugLog": "Debug-Protokoll",
  "settings.debugLog.desc": "Schreibt den IMAP-/SMTP-Dialog in die Entwicklerkonsole. Passwörter werden maskiert. Standardmäßig aus.",
```

- [ ] **Step 2: Den Test für die Settings-Ergänzungen schreiben**

`tests/obsidian/settings-tab.test.ts`:

```ts
  it("zeigt in der Kontenzeile an, wenn kein Passwort hinterlegt ist", () => {
    const tab = renderTab({ accounts: [{ ...newAccount("acc"), label: "Privat" }], secrets: { has: () => false } });
    expect(tab.textContent).toContain("Kein Passwort hinterlegt");
  });

  it("zeigt den Hinweis nicht, wenn ein Passwort hinterlegt ist", () => {
    const tab = renderTab({ accounts: [{ ...newAccount("acc"), label: "Privat" }], secrets: { has: () => true } });
    expect(tab.textContent).not.toContain("Kein Passwort hinterlegt");
  });

  it("bietet einen Schalter fuer das Debug-Protokoll", () => {
    const tab = renderTab({ accounts: [] });
    expect(tab.textContent).toContain("Debug-Protokoll");
  });
```

(`renderTab` nach dem Muster der bestehenden Settings-Tests der Datei; existiert sie noch nicht, den Helfer analog `tests/obsidian/import-eml.test.ts` mit dem Obsidian-Mock aufbauen.)

- [ ] **Step 3: Tests laufen lassen, Fehlschlag sehen**

Run: `npx vitest run tests/obsidian/settings-tab.test.ts`
Expected: FAIL — Hinweis und Schalter fehlen.

- [ ] **Step 4: Settings-Tab ergänzen**

Im Kontenblock von `src/obsidian/settings-tab.ts` die Beschreibung der Kontenzeile um den fehlenden-Passwort-Hinweis erweitern (der bestehende Aufruf lautet `t("settings.accounts.desc", …)`):

```ts
    const missing = !this.deps.secrets.has(account.secretId);
    const desc = missing
      ? `${t("settings.accounts.desc", account.username, String(account.identities.length))} · ${t("settings.account.noSecret")}`
      : t("settings.accounts.desc", account.username, String(account.identities.length));
```

und am Ende des Tabs den Schalter:

```ts
    new Setting(containerEl)
      .setName(t("settings.debugLog"))
      .setDesc(t("settings.debugLog.desc"))
      .addToggle((tg) =>
        tg.setValue(this.deps.settings.debugLog).onChange(async (v) => {
          this.deps.settings.debugLog = v;
          await this.deps.saveSettings();
        }),
      );
```

- [ ] **Step 5: `main.ts` verdrahten**

`PersistedState` und `onload` ergänzen:

```ts
interface PersistedState { settings: MailstoneSettings; zoneHashes: Record<string, string>; uidCache: UidCacheData }
```

Neue Felder der Plugin-Klasse (neben den bestehenden `sendService`/`bridge`) — `busy` und
`syncEvents` werden sofort erzeugt, weil sie über die ganze Lebensdauer geteilt werden:

```ts
  syncService!: SyncService;
  uidCache!: UidCacheStore;
  status!: HTMLElement;
  readonly busy = createBusyGuard();
  readonly syncEvents: SyncEmitter = createEmitter();
```

Zusätzliche Importe in `src/main.ts`: `createSyncService`, `type SyncService`, `type SyncRunResult`
aus `./core/sync/service`; `createBusyGuard` aus `./core/sync/busy`; `createEmitter`, `type SyncEmitter`
aus `./core/sync/events`; `createUidCache`, `type UidCacheStore`, `type UidCacheData` aus
`./core/sync/uid-cache`; `mailIndex`, `vaultPlanExecutor` aus `./obsidian/vault-notes`;
`type Notifier` aus `./obsidian/notifier`.

In `onload()`, nach dem `SendService`-Block:

```ts
    this.uidCache = createUidCache(raw?.uidCache);
    const hashes = { get: (k: string) => this.zoneHashes[k] ?? null, set: (k: string, v: string) => { this.zoneHashes[k] = v; } };
    this.syncService = createSyncService({
      accounts: () => this.settings.accounts,
      profile: () => this.settings.profile,
      secret: (id) => secrets.get(id),
      transport: () => nodeSocketTransport(),
      index: () => mailIndex(this.app, this.settings.profile),
      takenPaths: () => new Set(this.app.vault.getFiles().map((f) => f.path)),
      executor: () => vaultPlanExecutor(this.app, hashes),
      uidCache: this.uidCache,
      busy: this.busy,
      events: this.syncEvents,
      // window statt nacktem setTimeout: `obsidianmd/prefer-window-timers` verlangt es, und
      // core/ darf `window` nicht selbst kennen (check:pure) — deshalb hier injiziert.
      timers: window,
      now: () => new Date(),
      ...(this.settings.debugLog ? { log: (l: string) => { console.debug("[mailstone imap]", l); } } : {}),
    });

    this.status = this.addStatusBarItem();
    this.syncEvents.on("synced", ({ counts }) => {
      this.status.setText(t("status.sync.idle", String(counts.created + counts.reattached), new Date().toLocaleTimeString()));
    });

    this.addCommand({ id: "sync-mailbox", name: t("cmd.sync.name"), callback: () => void this.runSync(notify) });
    this.addRibbonIcon("mail", t("ribbon.sync"), () => void this.runSync(notify));

    // registerInterval statt setInterval: Obsidian raeumt den Timer beim Entladen selbst ab.
    const everyMs = Math.max(1, Math.min(...this.settings.accounts.map((a) => a.sync.intervalMin), 60)) * 60_000;
    this.registerInterval(window.setInterval(() => { void this.runSync(notify, true); }, everyMs));
```

`runSync` als Methode:

```ts
  /** `silent` = Intervall-Lauf: kein Notice bei Erfolg, nur bei Fehlern — sonst poppt alle
   *  fuenf Minuten eine Meldung auf. Der Nutzer sieht das Ergebnis in der Statusleiste. */
  private async runSync(notify: Notifier, silent = false): Promise<void> {
    const enabled = this.settings.accounts.filter((a) => a.sync.enabled);
    if (enabled.length === 0) { if (!silent) notify.info("notice.sync.noAccounts"); return; }
    this.status.setText(t("status.sync.running"));
    try {
      const results = await this.syncService.syncAll();
      for (const r of results) if (!r.ok && !(silent && r.code === "busy")) notify.error(`error.sync.${r.code}`);
      const ok = results.filter((r): r is Extract<SyncRunResult, { ok: true }> => r.ok);
      if (!silent && ok.length > 0) {
        const sum = ok.reduce((acc, r) => ({
          created: acc.created + r.counts.created,
          reattached: acc.reattached + r.counts.reattached,
          detached: acc.detached + r.counts.detached,
          errors: acc.errors + r.counts.errors,
        }), { created: 0, reattached: 0, detached: 0, errors: 0 });
        notify.info("notice.sync.done", sum.created, sum.reattached, sum.detached, sum.errors);
      }
    } finally {
      // Zone-Hashes und UID-Cache muessen auch nach einem Abbruch persistiert sein — sonst
      // gilt jede geschriebene Notiz beim naechsten Lauf als fremd editiert (dieselbe
      // Begruendung wie beim Import-Kommando aus M1).
      await this.saveSettings();
    }
  }
```

`saveSettings` schreibt zusätzlich `uidCache: this.uidCache.data()`.

- [ ] **Step 6: Tests, Typecheck und Bundle-Guard laufen lassen**

Run: `npm run typecheck && npm run typecheck:test && npx vitest run tests/obsidian && npm run build && npx vitest run tests/bundle.test.ts`
Expected: alles PASS — `main.js` enthält weiterhin kein `import("node:`.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/obsidian/settings-tab.ts src/i18n/strings.ts tests/obsidian/settings-tab.test.ts
git commit -m "feat(sync): Kommando, Ribbon, Intervall und Statusleiste; Passwort-fehlt-Hinweis und Debug-Schalter"
```

---

### Task 9: Fake-IMAP-Server, Integrationstest und Live-Probe

Der letzte Schritt schließt dieselbe Lücke, die M2 mit `scripts/fake-smtp.mjs` geschlossen hat: alle Tests bis hier fahren gegen `FakeSocketTransport` — der echte Socket ist ungeprüft. Dazu kommt die Probe gegen ein echtes Postfach, die den Meilenstein erst abschließt.

**Files:**
- Create: `scripts/fake-imap.mjs`, `tests/integration/fake-imap.test.ts`
- Modify: `docs/SMOKE.md`, `CHANGELOG.md`, `README.md` (Statuszeile)

**Interfaces:**
- Consumes: `createSyncService` (Task 7), `nodeSocketTransport` (M2), `newAccount` (M2).

- [ ] **Step 1: Den Fake-Server schreiben**

`scripts/fake-imap.mjs` — nach dem Vorbild von `scripts/fake-smtp.mjs`: `node:net`-Server auf `127.0.0.1`, kein TLS, liefert einen festen Ordner mit zwei Mails. Er beherrscht genau das Subset des Clients:

```js
// Fake-IMAP-Server fuer tests/integration — spricht nur das Subset, das core/imap/client.ts
// benutzt: CAPABILITY, AUTHENTICATE PLAIN, EXAMINE, UID SEARCH ALL, UID FETCH (Header/Body),
// LOGOUT. Kein TLS, bindet ausschliesslich an 127.0.0.1. Nie fuer echte Postfaecher gedacht.
import net from "node:net";

const PORT = Number(process.env.PORT ?? 11143);
const MAILS = [
  { uid: 7, id: "<eins@example.net>", raw: "From: a@example.net\r\nTo: b@example.net\r\nSubject: Erste Testmail\r\nMessage-ID: <eins@example.net>\r\nDate: Sat, 29 Aug 2026 08:00:00 +0000\r\n\r\nHallo eins\r\n" },
  { uid: 9, id: "<zwei@example.net>", raw: "From: a@example.net\r\nTo: b@example.net\r\nSubject: Zweite Testmail\r\nMessage-ID: <zwei@example.net>\r\nDate: Sat, 29 Aug 2026 09:00:00 +0000\r\n\r\nHallo zwei\r\n" },
];

net.createServer((socket) => {
  socket.write("* OK fake-imap ready\r\n");
  let buf = "";
  socket.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    for (let nl = buf.indexOf("\r\n"); nl !== -1; nl = buf.indexOf("\r\n")) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const [tag, ...rest] = line.split(" ");
      const cmd = rest.join(" ").toUpperCase();
      if (cmd === "CAPABILITY") {
        socket.write("* CAPABILITY IMAP4rev1 AUTH=PLAIN UIDPLUS\r\n");
        socket.write(`${tag} OK done\r\n`);
      } else if (cmd.startsWith("AUTHENTICATE PLAIN")) {
        socket.write(`${tag} OK authenticated\r\n`);
      } else if (cmd.startsWith("EXAMINE")) {
        socket.write(`* ${String(MAILS.length)} EXISTS\r\n* OK [UIDVALIDITY 4242] UIDs valid\r\n${tag} OK [READ-ONLY] done\r\n`);
      } else if (cmd === "UID SEARCH ALL") {
        socket.write(`* SEARCH ${MAILS.map((m) => m.uid).join(" ")}\r\n${tag} OK done\r\n`);
      } else if (cmd.startsWith("UID FETCH")) {
        const wantsBody = cmd.includes("BODY.PEEK[]");
        for (const m of MAILS) {
          if (!new RegExp(`\\b${String(m.uid)}\\b`).test(rest.join(" "))) continue;
          const payload = wantsBody ? m.raw : `Message-ID: ${m.id}\r\n\r\n`;
          const bytes = Buffer.from(payload, "utf8");
          const label = wantsBody ? "BODY[]" : "BODY[HEADER.FIELDS (MESSAGE-ID)]";
          socket.write(`* ${String(m.uid)} FETCH (UID ${String(m.uid)} ${label} {${String(bytes.length)}}\r\n`);
          socket.write(bytes);
          socket.write(")\r\n");
        }
        socket.write(`${tag} OK done\r\n`);
      } else if (cmd === "LOGOUT") {
        socket.write(`* BYE\r\n${tag} OK done\r\n`);
        socket.end();
      } else {
        socket.write(`${tag} BAD unbekanntes Kommando\r\n`);
      }
    }
  });
}).listen(PORT, "127.0.0.1", () => { console.log(`fake-imap listening on 127.0.0.1:${String(PORT)}`); });
```

- [ ] **Step 2: Den Integrationstest schreiben**

`tests/integration/fake-imap.test.ts` — Aufbau exakt wie `tests/integration/fake-smtp.test.ts` (Kindprozess starten, auf `listening on` warten, in `afterEach` killen), mit denselben Node-Importen plus:

```ts
import { createSyncService } from "../../src/core/sync/service";
import { createBusyGuard } from "../../src/core/sync/busy";
import { createEmitter } from "../../src/core/sync/events";
import { createUidCache } from "../../src/core/sync/uid-cache";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { nodeSocketTransport } from "../../src/obsidian/tls-transport";
import { newAccount } from "../../src/core/settings";
import { testTimers } from "../helpers/timers";
import type { NotePlan } from "../../src/core/mirror/plan";
```

Der Kern:

```ts
  it("legt ueber den echten Socket zwei Notizen an und meldet sie als created", async () => {
    child = spawn(process.execPath, [join(process.cwd(), "scripts/fake-imap.mjs")], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
    await waitForReady(child);

    const account = newAccount("acc");
    account.imap = { host: "127.0.0.1", port: PORT, tls: "none" as never };
    account.username = "u@example.net";
    const seen: NotePlan[] = [];
    const svc = createSyncService({
      accounts: () => [account], profile: () => defaultMailProfile(), secret: () => "geheim",
      transport: () => nodeSocketTransport(), index: () => new Map(), takenPaths: () => new Set<string>(),
      executor: () => ({ execute: (plans) => { seen.push(...plans); return Promise.resolve({ created: plans.length, updated: 0, stateChanged: 0, skipped: [], errors: [] }); } }),
      uidCache: createUidCache(undefined), busy: createBusyGuard(), events: createEmitter(), timers: testTimers, now: () => new Date(),
    });

    const r = await svc.syncAccount("acc");
    expect(r).toMatchObject({ ok: true, counts: { created: 2 } });
    expect(seen.map((p) => p.mailId).sort()).toEqual(["eins@example.net", "zwei@example.net"]);
  });
```

**Wichtig:** `ImapConnectOptions.tls` ist `TlsMode` und kennt `"none"`; `Account["imap"]["tls"]` bleibt bewusst auf `"implicit" | "starttls"` beschränkt, damit die Settings-UI den unverschlüsselten Fall nie anbieten kann. Der Integrationstest erzeugt sein Konto deshalb mit einem Cast im **Testcode** — nicht durch Aufweichen des Settings-Typs. Das ist dieselbe Konstruktion wie bei `smtp.tls === "none"` in M2, und der Grund, warum der Fake-Server ausschließlich an `127.0.0.1` bindet.

- [ ] **Step 3: Integrationstest laufen lassen**

Run: `npm run test:integration`
Expected: PASS — beide Integrationsdateien (SMTP aus M2, IMAP neu) grün.

- [ ] **Step 4: Das volle Gate fahren**

Run: `npm run gate`
Expected: PASS — Lint 0 Warnungen, Typecheck (3×), Unit-Tests, `check:pure`, Build, Bundle-Guard.

- [ ] **Step 5: Live-Probe gegen das echte Postfach und Protokoll**

Am echten mailbox.org-Konto (App-Passwort liegt seit dem 2026-08-25 in `app.secretStorage`):

1. Auf dem Server im Postfach den Ordner `Vault` anlegen, falls er fehlt, und **zwei** Mails hineinverschieben.
2. In Obsidian das Kommando „Postfach-Ordner synchronisieren" auslösen.
3. Prüfen: zwei Notizen unter `Mail/2026/` mit `.eml` daneben, `mail_state: live`, `mail_source: <konto>/Vault`.
4. Eine der beiden Mails auf dem Server aus `Vault` herausziehen, erneut synchronisieren → deren `mail_state` steht auf `detached`, die Notiz bleibt bestehen, der Text ist unverändert.
5. Dieselbe Mail zurück in `Vault` schieben, erneut synchronisieren → `mail_state` steht wieder auf `live`, es entsteht **keine zweite** Notiz.
6. Im Mailclient prüfen, dass beide Mails **ungelesen** geblieben sind (der Beleg für `EXAMINE`/`BODY.PEEK`).

Ergebnis in `docs/SMOKE.md` unter einer neuen Überschrift `## M3-Live-Probe (2026-08-…)` protokollieren — mit Datum, Kontoanbieter, den beobachteten `mail_state`-Übergängen und dem Ungelesen-Befund. Ein Fehlschlag wird dort ebenso protokolliert wie ein Erfolg.

- [ ] **Step 6: Changelog, README, Commit**

`CHANGELOG.md` bekommt einen M3-Block (Format wie der M2-Block), `README.md` die aktualisierte Statuszeile.

```bash
git add scripts/fake-imap.mjs tests/integration/fake-imap.test.ts docs/SMOKE.md CHANGELOG.md README.md
git commit -m "test(imap): Fake-IMAP-Server und Integrationstest ueber echten Socket; M3-Live-Probe protokolliert"
```

---

## Selbstprüfung gegen die Spec

**§ 3.1 Allowlist-Sync, Punkt für Punkt:**

| Spec-Schritt | Task |
|---|---|
| connect → Greeting → CAPABILITY (MOVE/UIDPLUS/… merken) → AUTHENTICATE PLAIN, Fallback LOGIN | Task 4 (`capabilities` liegt auf der Session, M4 liest `MOVE`/`UIDPLUS` daraus) |
| `EXAMINE` (read-only) → `UID SEARCH ALL` | Task 4, plus Test „benutzt EXAMINE, nie SELECT" |
| Message-ID-Abgleich statt ENVELOPE | Task 4 — **bewusste Abweichung von der Spec**, siehe unten |
| UID→Message-ID-Cache pro `<konto>/<ordner>/<UIDVALIDITY>`, bei Wechsel verworfen | Task 5 |
| Neu: `UID FETCH BODY.PEEK[]` → `mime/parse` → `render` → `NotePlan create` | Task 4 + Task 6 + Task 7 |
| `detached` + wieder da → `reattach`; `live` + weg → `detach` | Task 6 (`planSync`), Tests je Richtung |
| `LOGOUT`; Ausführung nur über `vaultPlanExecutor` | Task 7 (`finally`-Logout), Task 8 (Executor kommt aus `main.ts`) |
| Trigger Intervall + Kommando/Ribbon | Task 8 |
| Busy-Guard geteilt, Emitter `synced`/`changed` | Task 7 |
| Fehler als Werte mit `SyncErrorCode`, Übersetzung erst in `src/obsidian` | Task 7 (`errors.ts`) + Task 8 (i18n) |
| Jeder Netz-Schritt unter `withTimeout` | Task 4 (`Connection.command`) |
| `IDLE` | **nicht in V1** (Spec: „`IDLE` ist V1.1") |

**Eine bewusste Abweichung von der Spec, die der Ausführende kennen muss:** § 3.1 schreibt `UID FETCH (ENVELOPE BODYSTRUCTURE)` für den Message-ID-Abgleich vor. Dieser Plan holt stattdessen `BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]`. Grund: `ENVELOPE` verlangt einen vollständigen Parser für verschachtelte Adresslisten, dessen einziger Ertrag hier ein einzelner Header wäre — und die Normalisierung dieses Headers existiert bereits (`normalizeMessageId` aus M1). `BODYSTRUCTURE` wird gar nicht gebraucht, weil der Anlagen-Bestand ohnehin erst aus der geparsten `.eml` kommt. Beide Kommandos sind read-only und `PEEK`-sicher; die Abweichung ändert nichts am Verhalten gegenüber dem Nutzer. Sie gehört beim Abschluss von M3 in die Spec nachgetragen (§ 3.1, Schritt 2).

**Carry-over aus dem M2-Final-Review:**

| Punkt | Task |
|---|---|
| `withTimeout` um jeden Netz-Schritt | Task 4 |
| `FakeSocketTransport.closed` startet false statt true | Task 1 |
| Fake wirft bei `readBytes` — IMAP-Literale brauchen es | Task 1 |
| Fake modelliert keine Teilzeilen | Task 1 (Byte-Puffer) |
| Test für `protocol`-Fehler mid-dialog | Task 4 (BAD-Fall), Task 7 (Abbruch mit Guard-Freigabe) |
| password-missing-Status in der Konto-Zeile (`SecretStore.has` ungenutzt) | Task 8 |
| `debugLog` hat kein UI-Control | Task 8 |
| multiline `220-`-Greeting, Orphan-Secret bei Add→Cancel, `unregister()` mit alter id | **offen** — reine M2-Punkte ohne Bezug zum Sync; sie bleiben in der Task „M1-Nachlese / Deferred-Punkte" und gehören in den Kommando-Plan oder M4, nicht hierher |

**Nicht abgedeckt und bewusst verschoben:** `mail.rerender`/`mail.relink`/`mail.extractAttachment` samt Kommando-Rahmen (eigener Plan, siehe Kopf), Server-Kommandos und View (M4), `IDLE` (V1.1), das Pallas-Rollout aus der Cockpit-Vormerkung (`_types/mail.md`-Profil, Linter-`foldersToIgnore`, `.eml` aus dem Vault-Git) — das ist Vault-Arbeit und gehört in die Session, die M3 ausrollt, nicht in diesen Repo-Plan.
