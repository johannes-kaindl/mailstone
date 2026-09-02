# M4 Posteingang — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Posteingang-Tab in der bestehenden Mailstone-Ansicht, der die Mails aus `folders.inbox` auflistet und zwei Aktionen anbietet — Übernehmen (`MOVE` in den Allowlist-Ordner) und Archivieren.

**Architecture:** Der IMAP-Client bekommt eine zweite, **schreibfähige** Session-Fabrik; der lesende Pfad bleibt typisiert unverändert, sodass ein `SELECT` im Sync-Pfad ein Typfehler ist. Die beiden Server-Aktionen leben in einem eigenen puren Dienst (`core/inbox/actions.ts`) neben dem notiz-zentrierten Deskriptor-Rahmen, nicht darin. Die Ansicht wird zur Hub-Tab-Leiste aus dem Kit; Urteil und Zeichnen sind wie beim Cockpit in ein pures ViewModel und ein Panel getrennt.

**Tech Stack:** TypeScript · Obsidian Plugin API 1.13 · vitest · postal-mime (über `core/mime/parse`) · obsidian-kit 0.28.0 (vendored) · esbuild

**Spec:** `docs/superpowers/specs/2026-09-02-m4-posteingang-design.md` (Ergänzung zu `docs/superpowers/specs/2026-08-23-mailstone-design.md` § 3.2 / § 4.1). **Beide lesen** — die Abweichungsliste in § 7 der M4-Spec sagt, welche Stellen der Haupt-Spec nicht mehr gelten.

## Global Constraints

- **`src/core/**` ist obsidian-, DOM- und node-frei.** `npm run check:pure` verbietet dort zusätzlich `process` und `window`. Sockets, Dateisystem und Secrets werden aus `src/obsidian/**` hineingereicht.
- **Volles Gate ist `npm run gate`** — Lint, drei Typprüfungen, Unit, **Integration**, `check:pure`, Build und Bundle-Test. `npm test` allein sieht die Integrationstests nicht.
- **Kit-Module nur über `npm run kit:sync`** (Herkunfts-Header + `VENDOR.json`), nie von Hand editieren. Vendor-Stand ist obsidian-kit `0.28.0`.
- **Lesen setzt nie `\Seen`:** `EXAMINE` + `BODY.PEEK` auf allen lesenden Pfaden. Schreibend ist genau ein Pfad (Task 4).
- **Alle sichtbaren Texte** kommen aus `src/i18n/strings.ts` (englischer Wert + Key), nie als Literal in der UI.
- **Kommentare und Bezeichner in `.ts`-Dateien schreiben Umlaute als `ae`/`oe`/`ue`** — so hält es das ganze Repo (`uebernommen`, `Rueckkanal`, `gehoert`). In `.md` stehen echte Umlaute.
- **Ein einziger `registerView`-Typ** (`mailstone-cockpit`, UI-STANDARD § 1). Der Posteingang ist ein Tab, keine zweite View.
- **`git push github main` gehört nach jedem Push auf `origin`** — der Mirror trägt für dieses Repo nicht.
- Commits sind einzeilig oder per `-F`/Heredoc; der CDP-Guard zerlegt mehrzeilige Kommandos an `; \n | && ||` ohne Quoting zu kennen.

---

### Task 1: Capabilities auch nach der Anmeldung lesen

Der erste Schritt, weil alles Weitere auf vollständigen Capabilities steht: `MOVE` und `UIDPLUS` kündigen viele Server erst **nach** `AUTHENTICATE` an. Für den Sync ist die Änderung folgenlos (er fragt keine Capability ab).

**Files:**
- Modify: `src/core/imap/client.ts` (Funktion `runConnect`, Zeile ~264–270; Helfer `capabilitiesFrom`, Zeile 169)
- Test: `tests/core/imap/client.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces: `imapConnect(...)` liefert in `session.capabilities` die **Vereinigung** aus Prä-Auth-`CAPABILITY`, untagged `* CAPABILITY` der Auth-Antwort und deren `[CAPABILITY …]`-Response-Code. Alle Werte in Großschreibung, ohne Duplikate.

- [ ] **Step 1: Write the failing test**

In `tests/core/imap/client.test.ts`, in den `describe("imapConnect", …)`-Block:

```ts
  it("nimmt Capabilities aus dem Response-Code der Auth-Antwort dazu", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", "a001 OK done"] },
      { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK [CAPABILITY IMAP4rev1 MOVE UIDPLUS] authenticated"] },
    ]);
    const r = await imapConnect(fake, base);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.session.capabilities).toContain("MOVE");
    expect(r.session.capabilities).toContain("UIDPLUS");
    expect(r.session.capabilities).toContain("AUTH=PLAIN");
  });

  it("nimmt Capabilities aus einer untagged Zeile nach der Anmeldung dazu", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", "a001 OK done"] },
      { expect: /^a002 AUTHENTICATE PLAIN /, send: ["* CAPABILITY IMAP4rev1 MOVE", "a002 OK authenticated"] },
    ]);
    const r = await imapConnect(fake, base);
    if (!r.ok) throw new Error("unreachable");
    expect(r.session.capabilities).toContain("MOVE");
  });

  it("fuehrt keine Capability doppelt", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR MOVE", "a001 OK done"] },
      { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK [CAPABILITY IMAP4rev1 MOVE] authenticated"] },
    ]);
    const r = await imapConnect(fake, base);
    if (!r.ok) throw new Error("unreachable");
    expect(r.session.capabilities.filter((c) => c === "MOVE")).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/imap/client.test.ts -t "Capabilities"`
Expected: FAIL — die ersten beiden Tests melden, dass `MOVE` nicht in `capabilities` enthalten ist.

- [ ] **Step 3: Write minimal implementation**

In `src/core/imap/client.ts`, direkt unter `capabilitiesFrom` (Zeile ~169) einen zweiten Helfer ergänzen:

```ts
/** Capabilities aus einem Response-Code `[CAPABILITY a b c]` einer Tagged-Antwort. Viele Server
 *  kuendigen MOVE/UIDPLUS erst NACH der Anmeldung an — wer nur die Prae-Auth-Liste liest, haelt
 *  einen faehigen Server fuer unfaehig. */
function capabilitiesFromCode(text: string): string[] {
  const m = /\[CAPABILITY\s+([^\]]+)\]/i.exec(text);
  if (!m || m[1] === undefined) return [];
  return m[1].split(/\s+/).filter((v) => v.length > 0).map((v) => v.toUpperCase());
}
```

In `runConnect` die Zeile `return { ok: true, session: makeSession(conn, capabilities) };` ersetzen durch:

```ts
    // Vereinigung aus drei Quellen: Prae-Auth-CAPABILITY, untagged `* CAPABILITY` der
    // Auth-Antwort und deren Response-Code. Set statt Array-Suche, damit die Reihenfolge
    // der Quellen keine Duplikate erzeugt.
    const alle = new Set([...capabilities, ...capabilitiesFrom(auth.untagged), ...capabilitiesFromCode(auth.text)]);
    return { ok: true, session: makeSession(conn, [...alle]) };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/imap/client.test.ts`
Expected: PASS, alle bisherigen Tests der Datei ebenfalls grün.

- [ ] **Step 5: Commit**

```bash
git add src/core/imap/client.ts tests/core/imap/client.test.ts
git commit -F - <<'EOF'
feat(imap): Capabilities auch nach der Anmeldung lesen

MOVE und UIDPLUS kuendigen viele Server erst nach AUTHENTICATE an, oft
nur im Response-Code der OK-Zeile. Wer die Prae-Auth-Liste als
vollstaendig nimmt, haelt einen faehigen Server fuer unfaehig.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Lese- und Schreib-Session typisiert trennen

Der Nur-Lese-Vertrag geht auf, aber an einer benannten Stelle: der Sync bekommt einen Typ ohne `select`/`uidMove`.

**Files:**
- Modify: `src/core/imap/client.ts` — hier liegt die Deklaration von `ImapSession` (Zeile 34), **nicht** in `types.ts`; dazu `imapConnect`, `runConnect`, `makeSession`
- Modify: `src/core/sync/service.ts:13,88` (Import und Typannotation)
- Test: `tests/core/imap/client.test.ts`

**Interfaces:**
- Consumes: `imapConnect` aus Task 1 (vollständige Capabilities)
- Produces:
  ```ts
  export interface ImapReadSession { /* die heutige ImapSession-Flaeche, unveraendert */ }
  export interface ImapWriteSession extends ImapReadSession {
    select(mailbox: string): Promise<{ ok: true; uidValidity: number; exists: number } | { ok: false; code: ImapErrorCode; detail: string }>;
    uidMove(uid: number, target: string): Promise<UidMoveResult>;
  }
  export type UidMoveResult = { ok: true } | { ok: false; code: ImapErrorCode | "unsupported" | "gone"; detail: string };
  export type ImapConnectResult = { ok: true; session: ImapReadSession } | { ok: false; code: ImapErrorCode; detail: string };
  export type ImapConnectWritableResult = { ok: true; session: ImapWriteSession } | { ok: false; code: ImapErrorCode; detail: string };
  export function imapConnect(transport: SocketTransport, opts: ImapConnectOptions): Promise<ImapConnectResult>;
  export function imapConnectWritable(transport: SocketTransport, opts: ImapConnectOptions): Promise<ImapConnectWritableResult>;
  ```
  `ImapSession` wird zu `ImapReadSession` **umbenannt** — kein Alias, sonst bleibt der alte Name als stiller Nebeneingang bestehen.

- [ ] **Step 1: Write the failing test**

In `tests/core/imap/client.test.ts` einen neuen `describe`-Block ans Ende:

```ts
const authWithMove: DialogStep[] = [
  { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR UIDPLUS MOVE", "a001 OK done"] },
  { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
];

describe("imapConnectWritable", () => {
  it("oeffnet einen Ordner mit SELECT (nicht EXAMINE) und liefert UIDVALIDITY", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      ...authWithMove,
      { expect: /^a003 SELECT "INBOX"$/, send: ["* 4 EXISTS", "* OK [UIDVALIDITY 99] .", "a003 OK [READ-WRITE] selected"] },
    ]);
    const r = await imapConnectWritable(fake, base);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    const sel = await r.session.select("INBOX");
    expect(sel).toMatchObject({ ok: true, uidValidity: 99, exists: 4 });
    expect(fake.written.some((l) => /^a003 SELECT /.test(l))).toBe(true);
    expect(fake.written.some((l) => /EXAMINE/.test(l))).toBe(false);
  });

  it("meldet folder-missing, wenn SELECT mit NO beantwortet wird", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      ...authWithMove,
      { expect: /^a003 SELECT "Fehlt"$/, send: ["a003 NO Mailbox does not exist"] },
    ]);
    const r = await imapConnectWritable(fake, base);
    if (!r.ok) throw new Error("unreachable");
    expect(await r.session.select("Fehlt")).toMatchObject({ ok: false, code: "folder-missing" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/imap/client.test.ts -t "imapConnectWritable"`
Expected: FAIL — `imapConnectWritable is not defined` (der Import in der Testdatei muss ergänzt werden, dann schlägt der Aufruf fehl).

- [ ] **Step 3: Write minimal implementation**

In `src/core/imap/client.ts`:

**3a.** Das Interface `ImapSession` in `ImapReadSession` umbenennen und die beiden neuen Typen darunter ergänzen:

```ts
export interface ImapWriteSession extends ImapReadSession {
  /** Oeffnet den Ordner SCHREIBBAR. Der einzige Weg zu einem SELECT in diesem Plugin —
   *  der Sync bekommt eine ImapReadSession und kann diese Methode nicht sehen. */
  select(mailbox: string): Promise<{ ok: true; uidValidity: number; exists: number } | { ok: false; code: ImapErrorCode; detail: string }>;
  uidMove(uid: number, target: string): Promise<UidMoveResult>;
}

export type UidMoveResult = { ok: true } | { ok: false; code: ImapErrorCode | "unsupported" | "gone"; detail: string };
export type ImapConnectWritableResult = { ok: true; session: ImapWriteSession } | { ok: false; code: ImapErrorCode; detail: string };
```

**3b.** `runConnect` so umbauen, dass es die Verbindung liefert statt die Session zu bauen. Rückgabetyp ändern auf:

```ts
type ConnectedRaw = { ok: true; conn: Connection; capabilities: string[] } | { ok: false; code: ImapErrorCode; detail: string };
```
Der letzte `return` von `runConnect` wird zu `return { ok: true, conn, capabilities: [...alle] };` — alle übrigen `return { ok: false, … }` bleiben unverändert.

**3c.** Zwei Exporte darüber:

```ts
export async function imapConnect(transport: SocketTransport, opts: ImapConnectOptions): Promise<ImapConnectResult> {
  const r = await connectRaw(transport, opts);
  return r.ok ? { ok: true, session: makeReadSession(r.conn, r.capabilities) } : r;
}

/** Der EINZIGE Weg zu einer schreibfaehigen Sitzung (Spec 2026-09-02 § 2). Wer ihn nimmt,
 *  oeffnet den Nur-Lese-Vertrag bewusst — der Sync nimmt imapConnect und kann es nicht. */
export async function imapConnectWritable(transport: SocketTransport, opts: ImapConnectOptions): Promise<ImapConnectWritableResult> {
  const r = await connectRaw(transport, opts);
  return r.ok ? { ok: true, session: makeWriteSession(r.conn, r.capabilities) } : r;
}
```
`connectRaw` ist der bisherige Rumpf von `imapConnect` (mit dem `finally`-Block, der den Transport bei Fehlschlag schließt), nur mit `ConnectedRaw` als Typ.

**3d.** `makeSession` in `makeReadSession` umbenennen (Rückgabetyp `ImapReadSession`), darunter:

```ts
function makeWriteSession(conn: Connection, capabilities: string[]): ImapWriteSession {
  const lesend = makeReadSession(conn, capabilities);
  return {
    ...lesend,

    async select(mailbox) {
      const tag = conn.nextTag();
      const r = await conn.command(tag, `SELECT ${quoteArg(encodeMailbox(mailbox))}`);
      if (r.status === "NO") return { ok: false, code: "folder-missing", detail: r.text };
      if (r.status !== "OK") return { ok: false, code: "protocol", detail: r.text };
      const uidValidity = bracketNumber(r.untagged, "UIDVALIDITY");
      if (uidValidity === null) return { ok: false, code: "protocol", detail: "keine UIDVALIDITY in der SELECT-Antwort" };
      return { ok: true, uidValidity, exists: existsFrom(r.untagged) };
    },

    async uidMove(_uid, _target) {
      return { ok: false, code: "unsupported", detail: "noch nicht implementiert" };
    },
  };
}
```
(`uidMove` bekommt seinen Rumpf in Task 3 — dieser Task liefert `select` und die Typen.)

**3e.** In `src/core/sync/service.ts` Zeile 13 und 88 `ImapSession` → `ImapReadSession` umbenennen.

- [ ] **Step 4: Run the full type check and tests**

Run: `npm run typecheck && npm run typecheck:test && npx vitest run tests/core`
Expected: PASS. Schlägt der Typecheck an einer Stelle fehl, die noch `ImapSession` nennt, dort ebenfalls umbenennen — es darf danach **keinen** Treffer mehr geben: `grep -rn "ImapSession" src tests` liefert nur `ImapReadSession`/`ImapWriteSession`.

- [ ] **Step 5: Commit**

```bash
git add src/core/imap/client.ts src/core/sync/service.ts tests/core/imap/client.test.ts
git commit -F - <<'EOF'
feat(imap): Lese- und Schreib-Session typisiert trennen

imapConnect liefert weiterhin eine ImapReadSession ohne select/uidMove;
schreibfaehig wird die Verbindung nur ueber imapConnectWritable. Ein
SELECT im Sync-Pfad ist damit ein Typfehler statt eines Review-Befunds
- AGENTS.md fuehrt den Nur-Lese-Vertrag als Zusage ans Postfach.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: `uidMove` — mit Beleg statt mit Statuszeile

**Files:**
- Modify: `src/core/imap/client.ts` (`makeWriteSession.uidMove`)
- Test: `tests/core/imap/client.test.ts`

**Interfaces:**
- Consumes: `ImapWriteSession`, `UidMoveResult` aus Task 2
- Produces: `uidMove(uid, target)` mit den Codes `unsupported` (keine `MOVE`-Capability), `gone` (OK ohne Beleg), `protocol` (`NO`/`BAD`)

**Der Kern dieser Task, aus Spec § 3d:** `UID MOVE` auf eine UID, die keine Nachricht trifft, antwortet nach RFC 6851 § 3.3 mit **`OK`**. Wer nur den Status prüft, meldet „übernommen", stößt einen Sync an, der nichts findet, und die Mail bleibt liegen. Der Erfolg wird deshalb an einem Beleg festgemacht: `[COPYUID …]` im Response-Code oder eine untagged `* <n> EXPUNGE`-Zeile.

- [ ] **Step 1: Write the failing test**

```ts
describe("uidMove", () => {
  async function writable(steps: DialogStep[]) {
    const fake = new FakeSocketTransport(["* OK ready"], [...authWithMove, ...steps]);
    const r = await imapConnectWritable(fake, base);
    if (!r.ok) throw new Error("unreachable");
    return { fake, session: r.session };
  }

  it("verschiebt und meldet Erfolg, wenn COPYUID belegt ist", async () => {
    const { session, fake } = await writable([
      { expect: /^a003 UID MOVE 7 "Vault"$/, send: ["a003 OK [COPYUID 99 7 12] Move completed"] },
    ]);
    expect(await session.uidMove(7, "Vault")).toEqual({ ok: true });
    expect(fake.written.some((l) => /^a003 UID MOVE 7 "Vault"$/.test(l))).toBe(true);
  });

  it("akzeptiert eine untagged EXPUNGE-Zeile als Beleg", async () => {
    const { session } = await writable([
      { expect: /^a003 UID MOVE 7 "Vault"$/, send: ["* 3 EXPUNGE", "a003 OK Move completed"] },
    ]);
    expect(await session.uidMove(7, "Vault")).toEqual({ ok: true });
  });

  it("meldet 'gone' bei OK OHNE Beleg — RFC 6851: eine UID ohne Treffer ergibt OK", async () => {
    const { session } = await writable([
      { expect: /^a003 UID MOVE 7 "Vault"$/, send: ["a003 OK Move completed"] },
    ]);
    expect(await session.uidMove(7, "Vault")).toMatchObject({ ok: false, code: "gone" });
  });

  it("meldet 'protocol' bei NO", async () => {
    const { session } = await writable([
      { expect: /^a003 UID MOVE 7 "Fehlt"$/, send: ["a003 NO [TRYCREATE] Mailbox does not exist"] },
    ]);
    expect(await session.uidMove(7, "Fehlt")).toMatchObject({ ok: false, code: "protocol" });
  });

  it("meldet 'unsupported' ohne MOVE-Capability und sendet NICHTS", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      { expect: /^a001 CAPABILITY$/, send: ["* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR", "a001 OK done"] },
      { expect: /^a002 AUTHENTICATE PLAIN /, send: ["a002 OK authenticated"] },
    ]);
    const r = await imapConnectWritable(fake, base);
    if (!r.ok) throw new Error("unreachable");
    expect(await r.session.uidMove(7, "Vault")).toMatchObject({ ok: false, code: "unsupported" });
    expect(fake.written.some((l) => /UID MOVE/.test(l))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/imap/client.test.ts -t "uidMove"`
Expected: FAIL — alle Fälle melden `unsupported` (der Platzhalter aus Task 2).

- [ ] **Step 3: Write minimal implementation**

`uidMove` in `makeWriteSession` ersetzen:

```ts
    async uidMove(uid, target) {
      // Vorher pruefen und NICHTS senden: ohne MOVE gibt es keinen sicheren Weg. Der
      // Fallback COPY+STORE+EXPUNGE ist bewusst nicht gebaut (Spec 2026-09-02 § 3d) — ein
      // UID-loses EXPUNGE entfernt auch fremd markierte Nachrichten.
      if (!capabilities.includes("MOVE")) {
        return { ok: false, code: "unsupported", detail: "Server kuendigt MOVE nicht an" };
      }
      const tag = conn.nextTag();
      const r = await conn.command(tag, `UID MOVE ${String(uid)} ${quoteArg(encodeMailbox(target))}`);
      if (r.status !== "OK") return { ok: false, code: "protocol", detail: r.text };

      // RFC 6851 § 3.3: eine UID, die keine Nachricht trifft, ergibt OK. Der Status allein
      // belegt also nichts — erst COPYUID oder eine EXPUNGE-Zeile tun es.
      const copyUid = /\[COPYUID\s/i.test(r.text);
      const expunged = r.untagged.some((u) => /^\d+\s+EXPUNGE\b/i.test(u.text));
      if (!copyUid && !expunged) {
        return { ok: false, code: "gone", detail: "UID nicht mehr vorhanden — erneut synchronisieren" };
      }
      return { ok: true };
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/imap/client.test.ts`
Expected: PASS, alle fünf `uidMove`-Fälle grün.

- [ ] **Step 5: Commit**

```bash
git add src/core/imap/client.ts tests/core/imap/client.test.ts
git commit -F - <<'EOF'
feat(imap): uidMove mit Erfolgsbeleg statt Statuszeile

RFC 6851 laesst UID MOVE auf eine nicht vorhandene UID mit OK antworten
- ein Erfolg, bei dem nichts bewegt wurde. Ohne COPYUID-Code oder
untagged EXPUNGE ist das Ergebnis deshalb 'gone', nicht 'ok'. Ohne
MOVE-Capability wird gar nichts gesendet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Listen-Fetch `uidFetchHeaders`

**Files:**
- Modify: `src/core/imap/client.ts` (`ImapReadSession`, `makeReadSession`)
- Test: `tests/core/imap/client.test.ts`

**Interfaces:**
- Consumes: `ImapReadSession` aus Task 2
- Produces:
  ```ts
  export interface ImapHeaderRow { uid: number; flags: string[]; header: Uint8Array }
  // auf ImapReadSession:
  uidFetchHeaders(uids: readonly number[]): Promise<Map<number, ImapHeaderRow>>;
  ```

Kommando: `UID FETCH <set> (FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])`. Die Bytes werden **hier nicht** geparst — das tut Task 6 mit `parseEml`. Diese Schicht liefert Rohmaterial. Vorbild für Batching und Literal-Behandlung ist das vorhandene `uidFetchMessageIds` (`client.ts` ~305–325); `chunk()` aus `core/imap/commands.ts` verwenden.

- [ ] **Step 1: Write the failing test**

```ts
describe("uidFetchHeaders", () => {
  it("liefert Flags und Header-Bytes je UID", async () => {
    const header = "From: a@example.invalid\r\nSubject: Hallo\r\n\r\n";
    const fake = new FakeSocketTransport(["* OK ready"], [
      ...greetingAndAuth,
      {
        expect: /^a003 UID FETCH 5,6 \(FLAGS BODY\.PEEK\[HEADER\.FIELDS \(FROM SUBJECT DATE MESSAGE-ID\)\]\)$/,
        send: [
          `* 1 FETCH (UID 5 FLAGS (\\Seen) BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] {${header.length}}`,
          new TextEncoder().encode(header),
          ")",
          `* 2 FETCH (UID 6 FLAGS () BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] {${header.length}}`,
          new TextEncoder().encode(header),
          ")",
          "a003 OK done",
        ],
      },
    ]);
    const r = await imapConnect(fake, base);
    if (!r.ok) throw new Error("unreachable");
    const rows = await r.session.uidFetchHeaders([5, 6]);
    expect(rows.size).toBe(2);
    expect(rows.get(5)?.flags).toEqual(["\\Seen"]);
    expect(rows.get(6)?.flags).toEqual([]);
    expect(new TextDecoder().decode(rows.get(5)!.header)).toContain("Subject: Hallo");
  });

  it("nutzt PEEK und setzt damit kein \\Seen", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [
      ...greetingAndAuth,
      { expect: /^a003 UID FETCH 5 /, send: ["a003 OK done"] },
    ]);
    const r = await imapConnect(fake, base);
    if (!r.ok) throw new Error("unreachable");
    await r.session.uidFetchHeaders([5]);
    expect(fake.written.some((l) => /BODY\.PEEK\[HEADER\.FIELDS/.test(l))).toBe(true);
    expect(fake.written.some((l) => /BODY\[HEADER/.test(l))).toBe(false);
  });

  it("liefert eine leere Map fuer eine leere UID-Liste, ohne zu senden", async () => {
    const fake = new FakeSocketTransport(["* OK ready"], [...greetingAndAuth]);
    const r = await imapConnect(fake, base);
    if (!r.ok) throw new Error("unreachable");
    expect((await r.session.uidFetchHeaders([])).size).toBe(0);
    expect(fake.written.some((l) => /UID FETCH/.test(l))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/imap/client.test.ts -t "uidFetchHeaders"`
Expected: FAIL — `uidFetchHeaders is not a function`.

- [ ] **Step 3: Write minimal implementation**

Typ zu `ImapReadSession` ergänzen (mit `ImapHeaderRow` daneben exportiert), dann in `makeReadSession` — die Struktur von `uidFetchMessageIds` spiegeln, aber Flags und Rohbytes behalten statt die Message-ID zu extrahieren:

```ts
    async uidFetchHeaders(uids) {
      const out = new Map<number, ImapHeaderRow>();
      if (uids.length === 0) return out;
      for (const batch of chunk([...uids], UID_FETCH_BATCH)) {
        const tag = conn.nextTag();
        const r = await conn.command(tag, `UID FETCH ${buildUidSet(batch)} (FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])`);
        if (r.status !== "OK") throw new NetError("protocol", `UID FETCH abgelehnt: ${r.text}`);
        for (const resp of r.untagged) {
          if (!/FETCH\b/i.test(resp.text)) continue;
          const uid = Number(findAtomValue(resp.items, "UID"));
          if (!Number.isSafeInteger(uid) || uid <= 0) continue;
          const header = firstLiteral(resp.items);
          if (header === null) continue;
          out.set(uid, { uid, flags: flagsFrom(resp.items), header });
        }
      }
      return out;
    },
```

Dazu der Helfer neben `capabilitiesFrom`:

```ts
/** Die FLAGS-Liste eines FETCH-Items. Fehlt sie, ist das kein Fehler — eine Mail ohne
 *  gesetzte Flags ist der Normalfall im Posteingang. */
function flagsFrom(items: ImapItem[]): string[] {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it?.kind !== "atom" || it.value.toUpperCase() !== "FLAGS") continue;
    const list = items[i + 1];
    if (list?.kind !== "list") return [];
    return list.items.filter((v): v is { kind: "atom"; value: string } => v.kind === "atom").map((v) => v.value);
  }
  return [];
}
```

**Achtung:** `UID_FETCH_BATCH` ist die Konstante, die `uidFetchMessageIds` bereits verwendet — dort nachsehen und dieselbe nehmen, keine zweite einführen. `ImapItem` aus `./types` importieren, falls noch nicht geschehen.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/imap/client.test.ts && npm run check:pure`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/imap/client.ts tests/core/imap/client.test.ts
git commit -F - <<'EOF'
feat(imap): uidFetchHeaders fuer die Posteingangs-Liste

FLAGS plus BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)]
statt ENVELOPE: kein Adresslisten-Parser noetig, und die Message-ID
laeuft durch dieselbe Normalisierung wie im Sync-Pfad.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: `core/inbox/actions.ts` — die beiden Server-Aktionen

**Files:**
- Create: `src/core/inbox/actions.ts`
- Test: `tests/core/inbox/actions.test.ts`

**Interfaces:**
- Consumes: `imapConnectWritable`, `ImapWriteSession`, `UidMoveResult` (Tasks 2–3); `BusyGuard` aus `src/core/sync/busy.ts`
- Produces:
  ```ts
  export type InboxActionCode = "busy" | "unsupported" | "gone" | "folder-missing" | "no-target-folder" | "connect" | "tls" | "auth" | "protocol" | "timeout" | "tls-required" | "no-secret";
  export type InboxActionResult = { ok: true } | { ok: false; code: InboxActionCode; detail: string };
  export interface InboxActionDeps {
    connect(): Promise<ImapConnectWritableResult>;
    busy: BusyGuard;
  }
  export function adoptMessage(deps: InboxActionDeps, req: InboxActionRequest): Promise<InboxActionResult>;
  export function archiveMessage(deps: InboxActionDeps, req: InboxActionRequest): Promise<InboxActionResult>;
  export interface InboxActionRequest { uid: number; sourceFolder: string; targetFolder: string }
  ```

Beide Funktionen sind derselbe Ablauf mit anderem Ziel: Busy nehmen → verbinden → `select(sourceFolder)` → `uidMove(uid, targetFolder)` → `logout` → Busy freigeben. `adoptMessage`/`archiveMessage` sind dünne Aufrufe eines gemeinsamen `moveMessage`; der Aufrufer bestimmt `targetFolder` (Allowlist bzw. Archiv). Ein leerer `targetFolder` ergibt `no-target-folder`, **ohne** zu verbinden.

- [ ] **Step 1: Write the failing test**

Neue Datei `tests/core/inbox/actions.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { adoptMessage, archiveMessage, type InboxActionDeps } from "../../../src/core/inbox/actions";
import { createBusyGuard } from "../../../src/core/sync/busy";
import type { ImapWriteSession } from "../../../src/core/imap/client";

function fakeSession(over: Partial<ImapWriteSession> = {}): ImapWriteSession {
  return {
    capabilities: ["MOVE", "UIDPLUS"],
    select: vi.fn(async () => ({ ok: true as const, uidValidity: 1, exists: 1 })),
    uidMove: vi.fn(async () => ({ ok: true as const })),
    logout: vi.fn(async () => undefined),
    examine: vi.fn(), uidSearchAll: vi.fn(), uidFetchMessageIds: vi.fn(),
    uidFetchHeaders: vi.fn(), uidFetchBody: vi.fn(), append: vi.fn(),
    ...over,
  } as unknown as ImapWriteSession;
}

function deps(session: ImapWriteSession, busy = createBusyGuard()): InboxActionDeps {
  return { connect: async () => ({ ok: true, session }), busy };
}

const req = { uid: 7, sourceFolder: "INBOX", targetFolder: "Vault" };

describe("adoptMessage", () => {
  it("selektiert die Quelle, verschiebt ins Ziel und meldet Erfolg", async () => {
    const s = fakeSession();
    expect(await adoptMessage(deps(s), req)).toEqual({ ok: true });
    expect(s.select).toHaveBeenCalledWith("INBOX");
    expect(s.uidMove).toHaveBeenCalledWith(7, "Vault");
    expect(s.logout).toHaveBeenCalled();
  });

  it("gibt den Busy-Guard auch bei Erfolg wieder frei", async () => {
    const busy = createBusyGuard();
    await adoptMessage(deps(fakeSession(), busy), req);
    expect(busy.isBusy()).toBe(false);
  });

  it("gibt den Busy-Guard auch frei, wenn uidMove scheitert", async () => {
    const busy = createBusyGuard();
    const s = fakeSession({ uidMove: vi.fn(async () => ({ ok: false as const, code: "gone" as const, detail: "weg" })) });
    expect(await adoptMessage(deps(s, busy), req)).toMatchObject({ ok: false, code: "gone" });
    expect(busy.isBusy()).toBe(false);
  });

  it("bricht mit 'busy' ab, wenn der Guard belegt ist — ohne zu verbinden", async () => {
    const busy = createBusyGuard();
    busy.tryAcquire();
    const connect = vi.fn();
    expect(await adoptMessage({ connect, busy }, req)).toMatchObject({ ok: false, code: "busy" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("bricht mit 'no-target-folder' ab, wenn kein Ziel gesetzt ist — ohne zu verbinden", async () => {
    const connect = vi.fn();
    const r = await adoptMessage({ connect, busy: createBusyGuard() }, { ...req, targetFolder: "" });
    expect(r).toMatchObject({ ok: false, code: "no-target-folder" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("reicht einen SELECT-Fehler durch und verschiebt nicht", async () => {
    const s = fakeSession({ select: vi.fn(async () => ({ ok: false as const, code: "folder-missing" as const, detail: "weg" })) });
    expect(await adoptMessage(deps(s), req)).toMatchObject({ ok: false, code: "folder-missing" });
    expect(s.uidMove).not.toHaveBeenCalled();
    expect(s.logout).toHaveBeenCalled();
  });

  it("reicht einen Verbindungsfehler durch", async () => {
    const r = await adoptMessage({ connect: async () => ({ ok: false, code: "auth", detail: "535" }), busy: createBusyGuard() }, req);
    expect(r).toMatchObject({ ok: false, code: "auth" });
  });
});

describe("archiveMessage", () => {
  it("verschiebt in den uebergebenen Archivordner", async () => {
    const s = fakeSession();
    expect(await archiveMessage(deps(s), { ...req, targetFolder: "Archive" })).toEqual({ ok: true });
    expect(s.uidMove).toHaveBeenCalledWith(7, "Archive");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/inbox/actions.test.ts`
Expected: FAIL — Modul `src/core/inbox/actions` existiert nicht.

- [ ] **Step 3: Write minimal implementation**

Neue Datei `src/core/inbox/actions.ts`:

```ts
import type { ImapConnectWritableResult } from "../imap/client";
import type { BusyGuard } from "../sync/busy";

/**
 * Die beiden Posteingangs-Aktionen. Sie stehen bewusst NEBEN dem Deskriptor-Rahmen aus
 * core/commands: der ist notiz-zentriert (MailTarget ist immer eine Notiz, MailCommandPlan
 * traegt Vault-Schreibvorgaenge) und existiert fuer Formular, Diff-Vorschau und Merge-Risiko.
 * Eine Server-Aktion hat davon nichts — keine Eingabe, kein Diff, kein Vault-Schreiben; die
 * Notiz entsteht anschliessend durch den Sync. Spec 2026-09-02 § 4.
 */
export type InboxActionCode =
  | "busy"              // Sync oder eine andere Aktion haelt den Guard
  | "no-target-folder"  // Zielordner nicht konfiguriert — es gibt nichts anzusteuern
  | "unsupported"       // Server kann kein sicheres Verschieben (kein MOVE)
  | "gone"              // Quell-UID trifft nichts mehr — erneut synchronisieren
  | "folder-missing" | "connect" | "tls" | "tls-required" | "auth" | "no-secret" | "protocol" | "timeout";

export type InboxActionResult = { ok: true } | { ok: false; code: InboxActionCode; detail: string };

export interface InboxActionRequest {
  uid: number;
  sourceFolder: string;
  targetFolder: string;
}

export interface InboxActionDeps {
  /** Baut eine EIGENE kurze Verbindung (connect -> Aktion -> logout), nicht die des Syncs. */
  connect(): Promise<ImapConnectWritableResult>;
  busy: BusyGuard;
}

async function moveMessage(deps: InboxActionDeps, req: InboxActionRequest): Promise<InboxActionResult> {
  // Vor dem Guard pruefen: ein fehlendes Ziel ist eine Konfigurationsfrage, kein Netzvorgang.
  if (req.targetFolder.length === 0) {
    return { ok: false, code: "no-target-folder", detail: "kein Zielordner konfiguriert" };
  }
  if (!deps.busy.tryAcquire()) return { ok: false, code: "busy", detail: "ein anderer Vorgang laeuft" };
  try {
    const verbunden = await deps.connect();
    if (!verbunden.ok) return { ok: false, code: verbunden.code, detail: verbunden.detail };
    const session = verbunden.session;
    try {
      const gewaehlt = await session.select(req.sourceFolder);
      if (!gewaehlt.ok) return { ok: false, code: gewaehlt.code, detail: gewaehlt.detail };
      const verschoben = await session.uidMove(req.uid, req.targetFolder);
      return verschoben.ok ? { ok: true } : { ok: false, code: verschoben.code, detail: verschoben.detail };
    } finally {
      // Der Logout gehoert in den finally-Zweig: eine offene Verbindung nach einem
      // Fehlschlag haelt die Sitzung am Server, bis er sie von sich aus abraeumt.
      await session.logout().catch(() => undefined);
    }
  } finally {
    deps.busy.release();
  }
}

/** Posteingang -> Allowlist-Ordner. Die Notiz entsteht danach durch den Sync, nicht hier. */
export function adoptMessage(deps: InboxActionDeps, req: InboxActionRequest): Promise<InboxActionResult> {
  return moveMessage(deps, req);
}

/** Posteingang -> Archivordner. */
export function archiveMessage(deps: InboxActionDeps, req: InboxActionRequest): Promise<InboxActionResult> {
  return moveMessage(deps, req);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/inbox && npm run check:pure`
Expected: PASS — alle acht Fälle grün, `check:pure` meldet keinen Verstoß (die Datei importiert nur Typen und den Busy-Guard).

- [ ] **Step 5: Commit**

```bash
git add src/core/inbox/actions.ts tests/core/inbox/actions.test.ts
git commit -F - <<'EOF'
feat(inbox): Server-Aktionen adopt und archive

Eigener reiner Dienst neben dem Deskriptor-Rahmen: der ist
notiz-zentriert und existiert fuer Formular, Diff und Merge-Risiko,
wovon ein MOVE nichts hat. Kurze eigene Verbindung, geteilt wird nur
der Busy-Guard; Logout und Guard-Freigabe stehen in finally.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: `core/view/inbox-vm.ts` — das pure ViewModel

**Files:**
- Create: `src/core/view/inbox-vm.ts`
- Test: `tests/core/view/inbox-vm.test.ts`

**Interfaces:**
- Consumes: `ImapHeaderRow` (Task 4), `parseEml` aus `src/core/mime/parse`, `normalizeMessageId` aus `src/core/mime/headers`
- Produces:
  ```ts
  export type InboxState = "leer" | "laedt" | "fehler" | "gefuellt";
  export interface InboxRow { uid: number; from: string; subject: string; date: string; imVault: boolean; ungelesen: boolean }
  export interface InboxInput {
    zustand: "laedt" | "fehler" | "bereit";
    rows: readonly InboxRow[];
    fehlerCode: string | null;
    kannVerschieben: boolean;   // MOVE-Capability vorhanden
    busy: boolean;
  }
  export interface InboxViewModel { state: InboxState; rows: readonly InboxRow[]; fehlerCode: string | null; aktionenAktiv: boolean }
  export function buildInboxViewModel(input: InboxInput): InboxViewModel;
  export async function toInboxRow(row: ImapHeaderRow, bekannteIds: ReadonlySet<string>): Promise<InboxRow>;
  ```

`toInboxRow` ist die Stelle, an der der Header zu einer Zeile wird — `parseEml` auf `row.header` (gemessen: verarbeitet einen Header-Block ohne Body vollständig), Absender als `name` oder ersatzweise Adresse, Betreff, Datum als ISO-String, `imVault` durch Abgleich der **normalisierten** Message-ID gegen `bekannteIds`. `ungelesen` = `!row.flags.includes("\\Seen")`.

Vorbild für Aufbau und Testform ist `src/core/view/cockpit-vm.ts` mit `tests/core/view/cockpit-vm.test.ts` — dort nachsehen, bevor etwas erfunden wird.

- [ ] **Step 1: Write the failing test**

Neue Datei `tests/core/view/inbox-vm.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildInboxViewModel, toInboxRow, type InboxRow } from "../../../src/core/view/inbox-vm";

function header(felder: string): Uint8Array {
  return new TextEncoder().encode(`${felder}\r\n\r\n`);
}

const zeile: InboxRow = { uid: 1, from: "A", subject: "S", date: "2026-09-02T07:15:00.000Z", imVault: false, ungelesen: true };

describe("toInboxRow", () => {
  it("dekodiert RFC-2047-Betreff und zerlegt den Absender", async () => {
    const r = await toInboxRow({
      uid: 5,
      flags: [],
      header: header([
        "From: =?UTF-8?Q?J=C3=BCrgen_M=C3=BCller?= <j@example.invalid>",
        "Subject: =?UTF-8?Q?Rechnung_f=C3=BCr_M=C3=A4rz?=",
        "Date: Tue, 02 Sep 2026 09:15:00 +0200",
        "Message-ID: <abc@example.invalid>",
      ].join("\r\n")),
    }, new Set());
    expect(r.from).toBe("Jürgen Müller");
    expect(r.subject).toBe("Rechnung für März");
    expect(r.date).toBe("2026-09-02T07:15:00.000Z");
    expect(r.uid).toBe(5);
  });

  it("setzt imVault, wenn die normalisierte Message-ID bekannt ist", async () => {
    const h = header("Message-ID: <abc@example.invalid>\r\nSubject: X");
    expect((await toInboxRow({ uid: 1, flags: [], header: h }, new Set(["abc@example.invalid"]))).imVault).toBe(true);
    expect((await toInboxRow({ uid: 1, flags: [], header: h }, new Set(["anders@example.invalid"]))).imVault).toBe(false);
  });

  it("erkennt dieselbe Mail trotz spitzer Klammern und Grossschreibung im Index", async () => {
    // Der Abgleich laeuft ueber normalizeMessageId auf BEIDEN Seiten — sonst waere der
    // Badge eine Heuristik statt eines exakten Treffers.
    const h = header("Message-ID:  <ABC@Example.Invalid>  \r\nSubject: X");
    const r = await toInboxRow({ uid: 1, flags: [], header: h }, new Set(["ABC@Example.Invalid"]));
    expect(r.imVault).toBe(true);
  });

  it("faellt auf die Adresse zurueck, wenn der Absender keinen Namen hat", async () => {
    const r = await toInboxRow({ uid: 1, flags: [], header: header("From: j@example.invalid\r\nSubject: X") }, new Set());
    expect(r.from).toBe("j@example.invalid");
  });

  it("markiert ungelesen anhand von \\Seen", async () => {
    const h = header("Subject: X");
    expect((await toInboxRow({ uid: 1, flags: [], header: h }, new Set())).ungelesen).toBe(true);
    expect((await toInboxRow({ uid: 1, flags: ["\\Seen"], header: h }, new Set())).ungelesen).toBe(false);
  });
});

describe("buildInboxViewModel", () => {
  it("meldet 'laedt' waehrend des Abrufs", () => {
    const vm = buildInboxViewModel({ zustand: "laedt", rows: [], fehlerCode: null, kannVerschieben: true, busy: false });
    expect(vm.state).toBe("laedt");
  });

  it("meldet 'fehler' mit Code", () => {
    const vm = buildInboxViewModel({ zustand: "fehler", rows: [], fehlerCode: "auth", kannVerschieben: true, busy: false });
    expect(vm).toMatchObject({ state: "fehler", fehlerCode: "auth" });
  });

  it("meldet 'leer' bei bereit ohne Zeilen", () => {
    expect(buildInboxViewModel({ zustand: "bereit", rows: [], fehlerCode: null, kannVerschieben: true, busy: false }).state).toBe("leer");
  });

  it("schaltet Aktionen ab, solange ein anderer Vorgang laeuft", () => {
    const vm = buildInboxViewModel({ zustand: "bereit", rows: [zeile], fehlerCode: null, kannVerschieben: true, busy: true });
    expect(vm).toMatchObject({ state: "gefuellt", aktionenAktiv: false });
  });

  it("schaltet Aktionen ab, wenn der Server kein MOVE kann", () => {
    const vm = buildInboxViewModel({ zustand: "bereit", rows: [zeile], fehlerCode: null, kannVerschieben: false, busy: false });
    expect(vm.aktionenAktiv).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/view/inbox-vm.test.ts`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 3: Write minimal implementation**

Neue Datei `src/core/view/inbox-vm.ts`:

```ts
import type { ImapHeaderRow } from "../imap/client";
import { normalizeMessageId } from "../mime/headers";
import { parseEml } from "../mime/parse";

export type InboxState = "leer" | "laedt" | "fehler" | "gefuellt";

export interface InboxRow {
  uid: number;
  /** Anzeigename des Absenders, ersatzweise seine Adresse. */
  from: string;
  subject: string;
  /** ISO-Zeitstempel; leer, wenn die Mail kein lesbares Datum traegt. */
  date: string;
  /** Die Mail liegt bereits als Notiz im Vault (exakter Message-ID-Treffer). */
  imVault: boolean;
  ungelesen: boolean;
}

export interface InboxInput {
  zustand: "laedt" | "fehler" | "bereit";
  rows: readonly InboxRow[];
  fehlerCode: string | null;
  /** Server kuendigt MOVE an — ohne das gibt es keinen sicheren Weg (Spec § 3d). */
  kannVerschieben: boolean;
  busy: boolean;
}

export interface InboxViewModel {
  state: InboxState;
  rows: readonly InboxRow[];
  fehlerCode: string | null;
  aktionenAktiv: boolean;
}

/**
 * Ein FETCH-Ergebnis wird zur Anzeigezeile. Der Header-Block geht durch denselben Parser
 * wie eine vollstaendige .eml — postal-mime kommt mit einem Block ohne Body zurecht, und
 * damit gilt fuer Betreff, Absender und Message-ID exakt dieselbe Auslegung wie im
 * Sync-Pfad. Ein zweiter, eigener Header-Parser waere eine zweite Wahrheit.
 */
export async function toInboxRow(row: ImapHeaderRow, bekannteIds: ReadonlySet<string>): Promise<InboxRow> {
  const mail = await parseEml(row.header);
  const id = mail.id;
  // Beide Seiten normalisieren: der Index kann Rohformen aus aelteren Staenden tragen.
  const bekannt = new Set([...bekannteIds].map((v) => normalizeMessageId(v)).filter((v): v is string => v !== null));
  return {
    uid: row.uid,
    from: mail.from?.name !== undefined && mail.from.name.length > 0 ? mail.from.name : (mail.from?.address ?? ""),
    subject: mail.subject ?? "",
    date: mail.date ?? "",
    imVault: id !== null && bekannt.has(id),
    ungelesen: !row.flags.includes("\\Seen"),
  };
}

export function buildInboxViewModel(input: InboxInput): InboxViewModel {
  const state: InboxState =
    input.zustand === "laedt" ? "laedt"
    : input.zustand === "fehler" ? "fehler"
    : input.rows.length === 0 ? "leer"
    : "gefuellt";
  return {
    state,
    rows: input.rows,
    fehlerCode: input.zustand === "fehler" ? input.fehlerCode : null,
    aktionenAktiv: state === "gefuellt" && input.kannVerschieben && !input.busy,
  };
}
```

**Hinweis für die Umsetzung:** `mail.from` und `mail.date` sind laut der Messung vom 2026-09-02 vorhanden (`from` als `{name, address}`, `date` als ISO-String). Stimmen die Feldnamen nicht mit `src/core/mime/types.ts` überein, gilt **die Typdatei**, nicht dieser Plan — dann die Zugriffe anpassen, nicht die Typen.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/view && npm run check:pure && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/view/inbox-vm.ts tests/core/view/inbox-vm.test.ts
git commit -F - <<'EOF'
feat(inbox): pures ViewModel fuer die Posteingangs-Liste

Header-Block durch parseEml statt durch einen zweiten Header-Parser -
damit gilt fuer Betreff, Absender und Message-ID dieselbe Auslegung wie
im Sync-Pfad, und der Badge 'liegt im Vault' ist ein exakter Treffer
statt einer Heuristik.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: `core/inbox/fetch.ts` — den Ordner abrufen

Der Ablauf, der aus einem Ordnernamen eine Zeilenliste macht. Rein, Session-Fabrik injiziert; er ist der einzige lesende Netzpfad des Posteingangs und nimmt deshalb `imapConnect` (nicht die schreibfähige Fassung).

**Files:**
- Create: `src/core/inbox/fetch.ts`
- Test: `tests/core/inbox/fetch.test.ts`

**Interfaces:**
- Consumes: `imapConnect`, `ImapConnectResult`, `ImapHeaderRow` (Tasks 2/4); `toInboxRow`, `InboxRow` (Task 6); `BusyGuard`
- Produces:
  ```ts
  export const INBOX_LIMIT = 100;
  export interface InboxFetchDeps { connect(): Promise<ImapConnectResult>; busy: BusyGuard; bekannteIds(): ReadonlySet<string> }
  export interface InboxFetchRequest { folder: string; limit?: number }
  export type InboxFetchResult =
    | { ok: true; rows: InboxRow[]; kannVerschieben: boolean }
    | { ok: false; code: InboxActionCode; detail: string };
  export function fetchInbox(deps: InboxFetchDeps, req: InboxFetchRequest): Promise<InboxFetchResult>;
  ```
  `InboxActionCode` wird aus `./actions` importiert und wiederverwendet — zwei Fehlercode-Vokabeln für dieselbe Oberfläche wären eine Fehlerquelle ohne Ertrag.

- [ ] **Step 1: Write the failing test**

Neue Datei `tests/core/inbox/fetch.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchInbox, INBOX_LIMIT, type InboxFetchDeps } from "../../../src/core/inbox/fetch";
import { createBusyGuard } from "../../../src/core/sync/busy";
import type { ImapReadSession } from "../../../src/core/imap/client";

function header(felder: string): Uint8Array {
  return new TextEncoder().encode(`${felder}\r\n\r\n`);
}

function fakeSession(over: Partial<ImapReadSession> = {}, caps: string[] = ["MOVE"]): ImapReadSession {
  return {
    capabilities: caps,
    examine: vi.fn(async () => ({ ok: true as const, uidValidity: 1, exists: 2 })),
    uidSearchAll: vi.fn(async () => [1, 2]),
    uidFetchHeaders: vi.fn(async (uids: readonly number[]) =>
      new Map(uids.map((u) => [u, { uid: u, flags: [], header: header(`Subject: Nr ${u}\r\nMessage-ID: <m${u}@x.invalid>`) }])),
    ),
    uidFetchMessageIds: vi.fn(), uidFetchBody: vi.fn(), append: vi.fn(),
    logout: vi.fn(async () => undefined),
    ...over,
  } as unknown as ImapReadSession;
}

function deps(session: ImapReadSession, bekannt = new Set<string>()): InboxFetchDeps {
  return { connect: async () => ({ ok: true, session }), busy: createBusyGuard(), bekannteIds: () => bekannt };
}

describe("fetchInbox", () => {
  it("oeffnet mit EXAMINE, liest UIDs und liefert Zeilen", async () => {
    const s = fakeSession();
    const r = await fetchInbox(deps(s), { folder: "INBOX" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]?.subject).toBe("Nr 2");
    expect(s.examine).toHaveBeenCalledWith("INBOX");
    expect(s.logout).toHaveBeenCalled();
  });

  it("sortiert absteigend — die neueste UID steht oben", async () => {
    const s = fakeSession({ uidSearchAll: vi.fn(async () => [3, 1, 2]) });
    const r = await fetchInbox(deps(s), { folder: "INBOX" });
    if (!r.ok) throw new Error("unreachable");
    expect(r.rows.map((z) => z.uid)).toEqual([3, 2, 1]);
  });

  it("holt hoechstens die letzten INBOX_LIMIT UIDs", async () => {
    const viele = Array.from({ length: 250 }, (_, i) => i + 1);
    const s = fakeSession({ uidSearchAll: vi.fn(async () => viele) });
    const r = await fetchInbox(deps(s), { folder: "INBOX" });
    if (!r.ok) throw new Error("unreachable");
    expect(r.rows).toHaveLength(INBOX_LIMIT);
    expect(r.rows[0]?.uid).toBe(250);
    const geholt = (s.uidFetchHeaders as unknown as { mock: { calls: number[][][] } }).mock.calls[0]?.[0];
    expect(geholt).toHaveLength(INBOX_LIMIT);
  });

  it("meldet kannVerschieben anhand der MOVE-Capability", async () => {
    const mit = await fetchInbox(deps(fakeSession({}, ["MOVE"])), { folder: "INBOX" });
    const ohne = await fetchInbox(deps(fakeSession({}, ["IMAP4rev1"])), { folder: "INBOX" });
    expect(mit).toMatchObject({ ok: true, kannVerschieben: true });
    expect(ohne).toMatchObject({ ok: true, kannVerschieben: false });
  });

  it("setzt imVault fuer bekannte Message-IDs", async () => {
    const r = await fetchInbox(deps(fakeSession(), new Set(["m2@x.invalid"])), { folder: "INBOX" });
    if (!r.ok) throw new Error("unreachable");
    expect(r.rows.find((z) => z.uid === 2)?.imVault).toBe(true);
    expect(r.rows.find((z) => z.uid === 1)?.imVault).toBe(false);
  });

  it("liefert eine leere Liste statt eines Fehlers, wenn der Ordner leer ist", async () => {
    const s = fakeSession({ uidSearchAll: vi.fn(async () => []) });
    const r = await fetchInbox(deps(s), { folder: "INBOX" });
    expect(r).toMatchObject({ ok: true, rows: [] });
    expect(s.uidFetchHeaders).not.toHaveBeenCalled();
  });

  it("reicht einen EXAMINE-Fehler durch", async () => {
    const s = fakeSession({ examine: vi.fn(async () => ({ ok: false as const, code: "folder-missing" as const, detail: "weg" })) });
    expect(await fetchInbox(deps(s), { folder: "Fehlt" })).toMatchObject({ ok: false, code: "folder-missing" });
  });

  it("bricht mit 'busy' ab, ohne zu verbinden", async () => {
    const busy = createBusyGuard();
    busy.tryAcquire();
    const connect = vi.fn();
    const r = await fetchInbox({ connect, busy, bekannteIds: () => new Set() }, { folder: "INBOX" });
    expect(r).toMatchObject({ ok: false, code: "busy" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("gibt den Busy-Guard auch im Fehlerfall frei", async () => {
    const busy = createBusyGuard();
    const s = fakeSession({ examine: vi.fn(async () => ({ ok: false as const, code: "protocol" as const, detail: "x" })) });
    await fetchInbox({ connect: async () => ({ ok: true, session: s }), busy, bekannteIds: () => new Set() }, { folder: "INBOX" });
    expect(busy.isBusy()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/inbox/fetch.test.ts`
Expected: FAIL — Modul `src/core/inbox/fetch` existiert nicht.

- [ ] **Step 3: Write minimal implementation**

Neue Datei `src/core/inbox/fetch.ts`:

```ts
import type { ImapConnectResult } from "../imap/client";
import type { BusyGuard } from "../sync/busy";
import { toInboxRow, type InboxRow } from "../view/inbox-vm";
import type { InboxActionCode } from "./actions";

/** Wie viele Nachrichten die Liste hoechstens zeigt. Die neuesten, nicht die ersten —
 *  ein Posteingang waechst hinten. „Mehr laden" ist V1.1 (Spec § 1). */
export const INBOX_LIMIT = 100;

export interface InboxFetchDeps {
  /** Lesende Verbindung — der Posteingang wird mit EXAMINE geoeffnet, nie mit SELECT. */
  connect(): Promise<ImapConnectResult>;
  busy: BusyGuard;
  /** Message-IDs, die bereits als Notiz im Vault liegen. */
  bekannteIds(): ReadonlySet<string>;
}

export interface InboxFetchRequest {
  folder: string;
  limit?: number;
}

export type InboxFetchResult =
  | { ok: true; rows: InboxRow[]; kannVerschieben: boolean }
  | { ok: false; code: InboxActionCode; detail: string };

export async function fetchInbox(deps: InboxFetchDeps, req: InboxFetchRequest): Promise<InboxFetchResult> {
  if (!deps.busy.tryAcquire()) return { ok: false, code: "busy", detail: "ein anderer Vorgang laeuft" };
  try {
    const verbunden = await deps.connect();
    if (!verbunden.ok) return { ok: false, code: verbunden.code, detail: verbunden.detail };
    const session = verbunden.session;
    try {
      const geoeffnet = await session.examine(req.folder);
      if (!geoeffnet.ok) return { ok: false, code: geoeffnet.code, detail: geoeffnet.detail };

      const kannVerschieben = session.capabilities.includes("MOVE");
      const alle = await session.uidSearchAll();
      // Absteigend: die neueste Mail gehoert oben hin. Erst danach kappen — anders herum
      // zeigte die Liste die AELTESTEN 100.
      const neueste = [...alle].sort((a, b) => b - a).slice(0, req.limit ?? INBOX_LIMIT);
      if (neueste.length === 0) return { ok: true, rows: [], kannVerschieben };

      const bekannt = deps.bekannteIds();
      const roh = await session.uidFetchHeaders(neueste);
      const rows: InboxRow[] = [];
      // Reihenfolge kommt aus `neueste`, nicht aus der Map: die Map traegt die
      // Server-Reihenfolge, und die ist nicht zugesichert.
      for (const uid of neueste) {
        const eintrag = roh.get(uid);
        if (eintrag === undefined) continue;
        rows.push(await toInboxRow(eintrag, bekannt));
      }
      return { ok: true, rows, kannVerschieben };
    } finally {
      await session.logout().catch(() => undefined);
    }
  } catch {
    return { ok: false, code: "protocol", detail: "Abruf abgebrochen" };
  } finally {
    deps.busy.release();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/inbox && npm run check:pure && npm run typecheck`
Expected: PASS — alle neun Fälle grün.

- [ ] **Step 5: Commit**

```bash
git add src/core/inbox/fetch.ts tests/core/inbox/fetch.test.ts
git commit -F - <<'EOF'
feat(inbox): Ordner-Abruf fuer die Posteingangs-Liste

EXAMINE statt SELECT - der Abruf ist ein lesender Pfad und bekommt
deshalb die Lese-Session. Absteigend sortiert und DANN gekappt, sonst
zeigte die Liste die aeltesten hundert statt der neuesten.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: `InboxPanel` — das Zeichnen

**Files:**
- Create: `src/obsidian/views/inbox-panel.ts`
- Create: `src/obsidian/views/inbox-host.ts`
- Modify: `src/i18n/strings.ts`
- Modify: `styles.css`
- Test: `tests/obsidian/inbox-panel.test.ts`

**Interfaces:**
- Consumes: `buildInboxViewModel`, `InboxRow`, `InboxViewModel` (Task 6); `InboxActionResult` (Task 5)
- Produces:
  ```ts
  export interface InboxHost {
    accounts(): readonly Account[];
    selectedAccountId(): string;
    selectAccount(id: string): void;
    viewModel(): InboxViewModel;
    refresh(): void;
    adopt(uid: number): void;
    archive(uid: number): void;
    openSettings(): void;
    onChange(cb: () => void): Unsubscribe;
  }
  export class InboxPanel { readonly id = "inbox"; readonly icon = "inbox"; get label(): string; mount(c: HTMLElement): void; onShow(): void; destroy(): void }
  ```
  `InboxPanel` erfüllt damit den `HubPanel`-Vertrag aus dem Kit (`id`, `label`, `icon`, `mount`, `onShow`, `destroy`).

**Vorbild ist `src/obsidian/views/cockpit-panel.ts`** — dieselbe Aufteilung (schmaler Host-Vertrag, lesend oder `void`, kein Rückkanal), dieselbe `statusSpan`-Vokabel für den Indikator, derselbe Empty-State-Aufbau. Nichts davon neu erfinden.

**UI-STANDARD-Pflichten für diese Task:**
- Empty-State mit Aussage **und** Handlungsangebot (Muster: `.mailstone-cockpit-empty` im Cockpit).
- Metazeilen (Datum, Absender) bekommen **explizit** `--font-ui-small` bzw. `--font-ui-smaller`. Der `ui_adoption_check` prüft Typografie nicht; an genau dieser Lücke ist am 2026-09-02 ein Nachbar-Repo mit zu großer Sidebar-Schrift aufgefallen.
- Nur Theme-CSS-Variablen, keine festen Farben.
- Vor dem Verschieben ein Confirm-Modal aus `src/vendor/kit-obsidian/confirm.ts` (bereits vendort) — die Aktion ist am Server nicht rückgängig zu machen.

- [ ] **Step 1: i18n-Schlüssel ergänzen**

In `src/i18n/strings.ts` neben den `cockpit.*`-Einträgen:

```ts
  "inbox.title": "Inbox",
  "inbox.refresh": "Refresh",
  "inbox.empty": "No messages in this folder.",
  "inbox.empty.cta": "Open settings",
  "inbox.loading": "Loading messages…",
  "inbox.adopt": "Move to vault",
  "inbox.archive": "Archive",
  "inbox.inVault": "Already in the vault",
  "inbox.account": "Account",
  "inbox.confirm.adopt": "Move this message to the folder “{0}” on the server?",
  "inbox.confirm.archive": "Move this message to the folder “{0}” on the server?",
  "inbox.error.unsupported": "This server cannot move messages safely (no MOVE support).",
  "inbox.error.gone": "That message is no longer there — synchronise and try again.",
  "inbox.error.busy": "Another operation is running.",
  "inbox.error.no-target-folder": "No target folder configured.",
```

- [ ] **Step 2: Write the failing test**

Neue Datei `tests/obsidian/inbox-panel.test.ts`, gebaut nach dem Muster von `tests/obsidian/cockpit-panel.test.ts` (**diese Datei zuerst lesen** — sie zeigt, wie der Obsidian-Mock und der Host-Doppelgänger hier aufgebaut werden):

```ts
import { describe, it, expect, vi } from "vitest";
import { InboxPanel, type InboxHost } from "../../src/obsidian/views/inbox-panel";
import type { InboxViewModel } from "../../src/core/view/inbox-vm";

const zeile = { uid: 7, from: "Jürgen", subject: "Rechnung", date: "2026-09-02T07:15:00.000Z", imVault: false, ungelesen: true };

function host(vm: Partial<InboxViewModel>, over: Partial<InboxHost> = {}): InboxHost {
  return {
    accounts: () => [{ id: "a1", label: "Konto" }] as never,
    selectedAccountId: () => "a1",
    selectAccount: vi.fn(),
    viewModel: () => ({ state: "gefuellt", rows: [zeile], fehlerCode: null, aktionenAktiv: true, ...vm }),
    refresh: vi.fn(),
    adopt: vi.fn(),
    archive: vi.fn(),
    openSettings: vi.fn(),
    onChange: () => () => undefined,
    ...over,
  };
}

describe("InboxPanel", () => {
  it("erfuellt den HubPanel-Vertrag", () => {
    const p = new InboxPanel(host({}));
    expect(p.id).toBe("inbox");
    expect(typeof p.label).toBe("string");
    expect(typeof p.icon).toBe("string");
  });

  it("zeichnet je Mail eine Zeile mit Absender und Betreff", () => {
    const el = document.createElement("div");
    new InboxPanel(host({})).mount(el);
    expect(el.textContent).toContain("Jürgen");
    expect(el.textContent).toContain("Rechnung");
  });

  it("zeigt den Empty-State samt Handlungsangebot, wenn nichts da ist", () => {
    const el = document.createElement("div");
    new InboxPanel(host({ state: "leer", rows: [] })).mount(el);
    expect(el.querySelector(".mailstone-inbox-empty")).not.toBeNull();
  });

  it("zeichnet keine Aktionsknoepfe, solange aktionenAktiv false ist", () => {
    const el = document.createElement("div");
    new InboxPanel(host({ aktionenAktiv: false })).mount(el);
    expect(el.querySelectorAll("button.mailstone-inbox-action")).toHaveLength(0);
  });

  it("meldet einen Fehlerzustand sichtbar", () => {
    const el = document.createElement("div");
    new InboxPanel(host({ state: "fehler", rows: [], fehlerCode: "auth" })).mount(el);
    expect(el.querySelector(".mailstone-inbox-status.is-error")).not.toBeNull();
  });

  it("raeumt beim destroy auf", () => {
    const el = document.createElement("div");
    const unsub = vi.fn();
    const p = new InboxPanel(host({}, { onChange: () => unsub }));
    p.mount(el);
    p.destroy();
    expect(unsub).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/inbox-panel.test.ts`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 4: Write `src/obsidian/views/inbox-panel.ts`**

```ts
import { setIcon } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import type { Account } from "../../core/settings";
import type { Unsubscribe } from "../../core/sync/events";
import type { InboxRow, InboxViewModel } from "../../core/view/inbox-vm";

/** Schmaler Vertrag zum Plugin (UI-STANDARD §4): lesend oder `void`, kein Rueckkanal —
 *  wie `CockpitHost`. Die Aktionen melden ihr Ergebnis ueber `onChange`, nicht als Rueckgabe. */
export interface InboxHost {
  accounts(): readonly Account[];
  selectedAccountId(): string;
  selectAccount(id: string): void;
  viewModel(): InboxViewModel;
  refresh(): void;
  adopt(uid: number): void;
  archive(uid: number): void;
  openSettings(): void;
  onChange(cb: () => void): Unsubscribe;
}

/** Fehlercode -> i18n-Key. Geschlossen gehalten, damit kein Code stumm durchfaellt:
 *  ein unbekannter landet auf einer allgemeinen Zeile statt auf einer leeren. */
const FEHLER_KEYS: Record<string, string> = {
  unsupported: "inbox.error.unsupported",
  gone: "inbox.error.gone",
  busy: "inbox.error.busy",
  "no-target-folder": "inbox.error.no-target-folder",
};

function datum(iso: string): string {
  if (iso.length === 0) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

export class InboxPanel {
  readonly id = "inbox";
  readonly icon = "inbox";
  private root: HTMLElement | null = null;
  private unsub: Unsubscribe | null = null;

  constructor(private readonly host: InboxHost) {}

  get label(): string {
    return t("inbox.title");
  }

  mount(container: HTMLElement): void {
    this.root = container;
    this.unsub = this.host.onChange(() => this.render());
    this.render();
  }

  onShow(): void {
    this.render();
  }

  destroy(): void {
    this.unsub?.();
    this.unsub = null;
    this.root = null;
  }

  /** Voll-Neuaufbau aus dem ViewModel (UI-STANDARD §4, Muster ViewModel-Re-Render). */
  private render(): void {
    const root = this.root;
    if (!root) return;
    root.empty();
    root.addClass("mailstone-inbox");

    const vm = this.host.viewModel();

    // Kopfzeile im INHALT, nicht per addAction(): Obsidian blendet den View-Kopf in jeder
    // Seitenleiste aus, eine Kopf-Aktion waere dort null Pixel hoch (REGISTRY §UI).
    const kopf = root.createDiv({ cls: "mailstone-inbox-head" });
    if (vm.state === "laedt") {
      const el = kopf.createSpan({ cls: "mailstone-inbox-status is-checking", attr: { "aria-label": t("inbox.loading") } });
      setIcon(el, "loader");
    }
    kopf.createEl("h3", { text: t("inbox.title") });

    const konten = this.host.accounts();
    // Ein Auswahlfeld mit genau einer Wahl ist keine Wahl — dann gehoert es weg.
    if (konten.length > 1) {
      const wahl = kopf.createEl("select", { cls: "mailstone-inbox-account" });
      wahl.setAttribute("aria-label", t("inbox.account"));
      for (const k of konten) {
        const opt = wahl.createEl("option", { text: k.label, value: k.id });
        if (k.id === this.host.selectedAccountId()) opt.selected = true;
      }
      wahl.addEventListener("change", () => this.host.selectAccount(wahl.value));
    }

    const laden = kopf.createEl("button", { cls: "mailstone-inbox-refresh", text: t("inbox.refresh") });
    laden.disabled = vm.state === "laedt";
    laden.addEventListener("click", () => this.host.refresh());

    if (vm.state === "fehler") {
      const zeile = root.createDiv({ cls: "mailstone-inbox-error" });
      const el = zeile.createSpan({ cls: "mailstone-inbox-status is-error", attr: { "aria-label": t("inbox.title") } });
      setIcon(el, "circle-x");
      zeile.createSpan({ text: t(FEHLER_KEYS[vm.fehlerCode ?? ""] ?? "inbox.error.busy") });
      return;
    }

    if (vm.state === "leer") {
      const leer = root.createDiv({ cls: "mailstone-inbox-empty" });
      leer.createEl("p", { text: t("inbox.empty") });
      const cta = leer.createEl("button", { cls: "mod-cta", text: t("inbox.empty.cta") });
      cta.addEventListener("click", () => this.host.openSettings());
      return;
    }

    for (const row of vm.rows) this.renderRow(root, row, vm.aktionenAktiv);
  }

  private renderRow(root: HTMLElement, row: InboxRow, aktionenAktiv: boolean): void {
    const zeile = root.createDiv({ cls: `mailstone-inbox-row${row.ungelesen ? " is-unread" : ""}` });

    const kopf = zeile.createDiv({ cls: "mailstone-inbox-row-head" });
    kopf.createSpan({ cls: "mailstone-inbox-subject", text: row.subject });
    if (row.imVault) {
      const badge = kopf.createSpan({ cls: "mailstone-inbox-badge", attr: { "aria-label": t("inbox.inVault") } });
      setIcon(badge, "circle-check");
    }

    const meta = zeile.createDiv({ cls: "mailstone-inbox-meta" });
    meta.createSpan({ text: row.from });
    meta.createSpan({ text: datum(row.date) });

    if (!aktionenAktiv) return;
    const knoepfe = zeile.createDiv({ cls: "mailstone-inbox-actions" });
    const uebernehmen = knoepfe.createEl("button", { cls: "mailstone-inbox-action", text: t("inbox.adopt") });
    uebernehmen.addEventListener("click", () => this.host.adopt(row.uid));
    const archivieren = knoepfe.createEl("button", { cls: "mailstone-inbox-action", text: t("inbox.archive") });
    archivieren.addEventListener("click", () => this.host.archive(row.uid));
  }
}
```

**Das Confirm-Modal steht bewusst NICHT hier**, sondern im Host (Step 5): das Panel ist die zeichnende Schicht, ein Modal zu öffnen ist eine Handlung. `CockpitPanel` hält dieselbe Grenze ein.

- [ ] **Step 5: Write `src/obsidian/views/inbox-host.ts`**

```ts
import type { Account } from "../../core/settings";
import type { Unsubscribe } from "../../core/sync/events";
import { buildInboxViewModel, type InboxRow, type InboxViewModel } from "../../core/view/inbox-vm";
import type { InboxActionResult } from "../../core/inbox/actions";
import type { InboxFetchResult } from "../../core/inbox/fetch";
import type { InboxHost } from "./inbox-panel";

export interface InboxHostDeps {
  accounts: () => readonly Account[];
  isBusy: () => boolean;
  fetchInbox: (accountId: string) => Promise<InboxFetchResult>;
  adopt: (accountId: string, uid: number) => Promise<InboxActionResult>;
  archive: (accountId: string, uid: number) => Promise<InboxActionResult>;
  /** Bestaetigung vor einem Server-Verschieben — am Server nicht rueckgaengig zu machen. */
  confirmMove: (kind: "adopt" | "archive", zielordner: string) => Promise<boolean>;
  targetFolder: (accountId: string, kind: "adopt" | "archive") => string;
  /** Nach erfolgreichem Uebernehmen: die Notiz entsteht im Sync, nicht in der Aktion. */
  syncNow: (accountId: string) => void;
  notifyError: (code: string) => void;
  openSettings: () => void;
  /** Haengt an den Emittern `synced`/`changed` — die Liste ist eine Momentaufnahme und
   *  soll sich erneuern, wenn der Sync etwas veraendert hat (Spec § 8). */
  onChange: (cb: () => void) => Unsubscribe;
}

/**
 * Haelt den Zustand, den das Panel nur liest: gewaehltes Konto, zuletzt geholte Zeilen,
 * Lade- und Fehlerlage. Das Panel bleibt damit zustandslos und ist eine reine Funktion
 * dieses Zustands — dieselbe Aufteilung wie beim Cockpit.
 */
export function createInboxHost(deps: InboxHostDeps): InboxHost {
  let kontoId = deps.accounts()[0]?.id ?? "";
  let zustand: "laedt" | "fehler" | "bereit" = "bereit";
  let rows: readonly InboxRow[] = [];
  let fehlerCode: string | null = null;
  let kannVerschieben = false;
  const horcher = new Set<() => void>();

  function melde(): void {
    for (const cb of horcher) cb();
  }

  async function laden(): Promise<void> {
    if (kontoId.length === 0) { zustand = "bereit"; rows = []; melde(); return; }
    zustand = "laedt";
    melde();
    const r = await deps.fetchInbox(kontoId);
    if (r.ok) {
      rows = r.rows;
      kannVerschieben = r.kannVerschieben;
      zustand = "bereit";
      fehlerCode = null;
    } else {
      zustand = "fehler";
      fehlerCode = r.code;
    }
    melde();
  }

  async function verschieben(kind: "adopt" | "archive", uid: number): Promise<void> {
    const ziel = deps.targetFolder(kontoId, kind);
    if (!(await deps.confirmMove(kind, ziel))) return;
    const r = kind === "adopt" ? await deps.adopt(kontoId, uid) : await deps.archive(kontoId, uid);
    if (!r.ok) {
      deps.notifyError(r.code);
      // Bei `gone` ist die Liste nachweislich veraltet — dann neu laden statt sie stehen
      // zu lassen, sonst klickt der Nutzer denselben Fehler ein zweites Mal.
      if (r.code === "gone") void laden();
      return;
    }
    if (kind === "adopt") deps.syncNow(kontoId);
    void laden();
  }

  return {
    accounts: () => deps.accounts(),
    selectedAccountId: () => kontoId,
    selectAccount: (id) => { kontoId = id; void laden(); },
    viewModel: (): InboxViewModel => buildInboxViewModel({ zustand, rows, fehlerCode, kannVerschieben, busy: deps.isBusy() }),
    refresh: () => { void laden(); },
    adopt: (uid) => { void verschieben("adopt", uid); },
    archive: (uid) => { void verschieben("archive", uid); },
    openSettings: () => deps.openSettings(),
    onChange: (cb) => {
      horcher.add(cb);
      const ab = deps.onChange(cb);
      return () => { horcher.delete(cb); ab(); };
    },
  };
}
```

**Zum `horcher`-Set:** der Host meldet aus zwei Quellen — von außen (`synced`/`changed` des Syncs) und von innen (eigener Ladevorgang, Aktionsergebnis). Beide müssen dieselben Empfänger erreichen, deshalb hält der Host sie selbst und reicht die äußere Quelle zusätzlich durch. Ein Panel, das nur an `deps.onChange` hinge, sähe seinen eigenen Ladezustand nie.

- [ ] **Step 6: CSS in `styles.css`**

An die vorhandenen `.mailstone-cockpit-*`-Regeln anschließen, gleiche Reihenfolge und gleicher Aufbau:

```css
.mailstone-inbox-head { display: flex; align-items: center; gap: var(--size-4-2); flex-wrap: wrap; }
.mailstone-inbox-head h3 { margin: 0; flex: 1; font-size: var(--font-ui-medium); }
.mailstone-inbox-row { padding: var(--size-4-2) 0; border-bottom: 1px solid var(--background-modifier-border); }
.mailstone-inbox-row.is-unread .mailstone-inbox-subject { font-weight: var(--font-semibold); }
.mailstone-inbox-row-head { display: flex; align-items: center; gap: var(--size-4-1); }
.mailstone-inbox-subject { flex: 1; font-size: var(--font-ui-small); overflow-wrap: anywhere; }
.mailstone-inbox-meta { display: flex; justify-content: space-between; gap: var(--size-4-2);
  color: var(--text-muted); font-size: var(--font-ui-smaller); }
.mailstone-inbox-actions { display: flex; gap: var(--size-4-1); margin-top: var(--size-4-1); }
.mailstone-inbox-empty { text-align: center; color: var(--text-muted); padding: var(--size-4-4) 0; }
.mailstone-inbox-error { display: flex; align-items: center; gap: var(--size-4-1);
  color: var(--text-error); font-size: var(--font-ui-small); }
.mailstone-inbox-badge { color: var(--text-success); display: inline-flex; }
```

Jede Schriftgröße ist **explizit** gesetzt: `ui_adoption_check` prüft Typografie nicht, und genau daran ist am 2026-09-02 ein Nachbar-Repo mit zu großer Sidebar-Schrift aufgefallen. Keine festen Farben, nur Theme-Variablen.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/obsidian/inbox-panel.test.ts && npm run lint`
Expected: PASS, Lint ohne Warnung.

- [ ] **Step 8: Commit**

```bash
git add src/obsidian/views/inbox-panel.ts src/obsidian/views/inbox-host.ts src/i18n/strings.ts styles.css tests/obsidian/inbox-panel.test.ts
git commit -F - <<'EOF'
feat(inbox): Panel und Host fuer die Posteingangs-Liste

Aufteilung wie beim Cockpit: Urteil im puren ViewModel, Zeichnen im
Panel, schmaler Host-Vertrag ohne Rueckkanal. Empty-State und
Status-Indikator sind uebernommene §8-Bausteine; Metazeilen tragen
explizit --font-ui-smaller, weil der ui_adoption_check Typografie nicht
sieht.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 9: Hub-Tab-Leiste vendoren und den Posteingang anschliessen

Der erste sichtbare Schritt — und der einzige, der bestehende Bedienung verändert.

**Files:**
- Create: `src/vendor/kit-obsidian/hub.ts` (über `npm run kit:sync`, **nicht** von Hand)
- Modify: `src/vendor/kit-obsidian/VENDOR.json` (schreibt `kit:sync`)
- Modify: `styles.css` (Hub-CSS aus dem Kit-Vertrag)
- Modify: `src/obsidian/views/mailstone-view.ts:19–31`
- Modify: `src/main.ts:303,417` (Host-Aufbau und `registerView`)
- Test: `tests/obsidian/mailstone-view.test.ts`

**Interfaces:**
- Consumes: `InboxPanel`, `createInboxHost` (Task 8); `CockpitPanel` (vorhanden)
- Produces: `MailstoneView` mountet beide Panels über `buildHubInto(this.contentEl, [cockpit, inbox], "cockpit")`

- [ ] **Step 1: GUI-Smoke-Baseline festhalten — VOR jeder Änderung**

```bash
python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label mailstone --intent "M4 Baseline vor Hub-Umbau" --exclusive focus --ttl 2400
npm run smoke:gui 2>&1 | tee /tmp/m4-baseline.txt
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
```
Erwartet: 12/12. **Ohne diese Baseline ist ein grüner Lauf danach nicht von „anders grün" zu unterscheiden** — der Treiber ist beim Umbau selbst der Prüfling. Zahl und Datum in `docs/SMOKE.md` notieren. Läuft kein Obsidian mit offenem Vault: `open "obsidian://open?vault=mailstone"` — **kein Neustart**, es hängen regelmäßig fremde Vaults an der Instanz.

- [ ] **Step 2: Hub aus dem Kit vendoren**

```bash
npm run kit:sync
git diff --stat src/vendor/
```
Erwartet: `src/vendor/kit-obsidian/hub.ts` neu, mit Herkunfts-Header in Zeile 1. Kommt die Datei nicht mit, in `tools/sync-kit.sh` nachsehen, welche Module gelistet sind, und `hub.ts` dort ergänzen — die Liste ist die Konfiguration, nicht der Aufruf.

Anschließend das Hub-CSS in `styles.css` übernehmen (Kit-Vertrag: die Darstellung ist eine Kopie beim Consumer). Die vier Zutaten des Umbruch-Rezepts stehen im Kopfkommentar von `hub.ts` — alle vier übernehmen, jede einzelne ist wirkungslos.

- [ ] **Step 3: Write the failing test**

In `tests/obsidian/mailstone-view.test.ts`:

```ts
  it("mountet beide Panels als Tabs", async () => {
    const view = new MailstoneView(leafDoppel(), cockpitHostDoppel(), inboxHostDoppel());
    await view.onOpen();
    const tabs = view.contentEl.querySelectorAll("[data-tab]");
    const ids = [...tabs].map((el) => el.getAttribute("data-tab"));
    expect(ids).toContain("cockpit");
    expect(ids).toContain("inbox");
  });

  it("bleibt bei EINEM registerView-Typ", () => {
    expect(VIEW_TYPE_MAILSTONE).toBe("mailstone-cockpit");
  });
```
(`leafDoppel`/`cockpitHostDoppel` gibt es in der Datei bereits — `inboxHostDoppel` nach demselben Muster ergänzen.)

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/mailstone-view.test.ts`
Expected: FAIL — der Konstruktor nimmt noch kein zweites Host-Argument.

- [ ] **Step 5: Implement**

In `src/obsidian/views/mailstone-view.ts` den Konstruktor um `inboxHost` erweitern und `onOpen` ersetzen:

```ts
  async onOpen(): Promise<void> {
    this.cockpit = new CockpitPanel(this.host);
    this.inbox = new InboxPanel(this.inboxHost);
    // Zwei Tabs, also traegt die Leiste jetzt eine Wahl — der Grund, aus dem sie beim
    // einzelnen Panel bewusst fehlte.
    buildHubInto(this.contentEl, [this.cockpit, this.inbox], "cockpit");
  }
```
`onClose` beide Panels zerstören. Den erklärenden Kommentar in Zeile 21–23 durch eine Fassung ersetzen, die den jetzigen Zustand beschreibt statt den geplanten — ein Kommentar, der eine Zukunft beschreibt, die eingetreten ist, wird beim nächsten Lesen zur Falschaussage.

In `src/main.ts:303` den zweiten Host mitgeben und neben `cockpitHost(notify)` eine `inboxHost(notify)`-Methode nach demselben Muster ergänzen (Zeile ~417). Sie reicht `adopt`/`archive` an `adoptMessage`/`archiveMessage` aus Task 5 durch — mit einer `connect`-Funktion, die `imapConnectWritable` mit dem Transport und den Zugangsdaten des gewählten Kontos aufruft, und dem **geteilten** Busy-Guard des Syncs. Nach erfolgreichem `adopt` einen Sync anstoßen; die Notiz entsteht dort, nicht in der Aktion.

- [ ] **Step 6: Run the full gate**

Run: `npm run gate`
Expected: alles grün. Der Bundle-Test und `check:pure` fangen hier zwei typische Fehlgriffe: ein `node:`-Import in der neuen Kette und ein DOM-Zugriff, der aus Versehen in `src/core/` gelandet ist.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -F - <<'EOF'
feat(view): Posteingang als zweiter Tab der Mailstone-Ansicht

Hub-Tab-Leiste aus dem Kit vendort und beide Panels darin gemountet -
weiterhin genau ein registerView-Typ (UI-STANDARD §1). Der Kommentar in
mailstone-view.ts beschreibt jetzt den Zustand statt den Plan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 10: Fake-Server und GUI-Smoke-Pruefpunkte

**Files:**
- Modify: `scripts/fake-imap.mjs`
- Modify: `scripts/gui-smoke.ts`
- Modify: `docs/SMOKE.md`

**Interfaces:**
- Consumes: alles Vorherige
- Produces: `npm run smoke:gui` deckt den Posteingang mit ab

- [ ] **Step 1: `SELECT` und `UID MOVE` im Fake-IMAP**

In `scripts/fake-imap.mjs` die beiden Kommandos ergänzen: `SELECT` antwortet wie das vorhandene `EXAMINE`, aber mit `[READ-WRITE]`; `UID MOVE` antwortet `OK [COPYUID 1 <uid> 1] Move completed` und entfernt die UID aus der Liste des Ordners. **Ohne diesen Schritt ist der GUI-Smoke für die neuen Punkte blind** — er könnte grün melden, ohne dass je ein MOVE stattgefunden hat.

- [ ] **Step 2: Prüfpunkte ergänzen**

In `scripts/gui-smoke.ts` drei Punkte nach dem vorhandenen Muster (Abschnittsform und `requireVisible`-Aufrufe dort abschauen):
- Der Inbox-Tab existiert, ist klickbar und zeigt nach dem Klick seinen Inhalt (`data-tab="inbox"` sichtbar, Cockpit versteckt).
- Bei leerem Ordner erscheint der Empty-State mit Handlungsangebot.
- Die Tab-Wahl überlebt einen Wechsel hin und zurück (das ist die Zusage des „mount-once"-Musters — Panel-Zustand bleibt).

**`requireVisible` nach jedem Neustart aufrufen:** ein unfokussiertes Fenster drosselt Chromium-Timer auf ~1/s, und eine 300-px-Sidebar meldet dann 24 px — **grün und falsch**.

- [ ] **Step 3: Lauf und Gegenprobe**

```bash
python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label mailstone --intent "M4 Smoke + Gegenprobe" --exclusive focus --ttl 2400
npm run smoke:gui
# Gegenprobe: EINEN Prüfpunkt gezielt brechen (z. B. den Inbox-Tab aus der Panel-Liste nehmen),
# erneut fahren, genau diesen Punkt rot sehen und KEINEN weiteren, dann zurückbauen.
npm run smoke:gui
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
```
Erwartet: 15/15 grün, in der Gegenprobe 14/15 mit genau dem gebrochenen Punkt rot. Eine Gegenprobe, die den Defekt nicht einbaut, beweist nichts.

- [ ] **Step 4: Protokoll und Commit**

Ergebnis in `docs/SMOKE.md` festhalten: Datum, Zahl, Baseline aus Task 9 Step 1, was die Gegenprobe zeigte.

```bash
git add scripts/fake-imap.mjs scripts/gui-smoke.ts docs/SMOKE.md
git commit -F - <<'EOF'
test(smoke): Posteingang im GUI-Smoke, Fake-IMAP kann SELECT und MOVE

Ohne die beiden Kommandos im Fake waere der Smoke fuer die neuen Punkte
blind - er koennte gruen melden, ohne dass je ein MOVE stattfand.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
git push origin main && git push github main
```
(Der zweite Push ist Pflicht — der Mirror trägt für dieses Repo nicht.)

---

## Abschluss

- [ ] `npm run gate` grün
- [ ] `npm run smoke:gui` grün, Gegenprobe sauber, Ergebnis in `docs/SMOKE.md`
- [ ] `AGENTS.md`: den Abschnitt „Ein Sync-Lauf darf `\Seen` nie setzen" um die Vertragsfassung aus Spec § 2 ergänzen — welcher Pfad ab jetzt schreibend ist, steht dort, nicht nur in der Spec
- [ ] `git push origin main && git push github main`
- [ ] Cockpit-Task „M4 — View, Server-Kommandos, GUI-Smoke-Treiber" auf erledigt setzen
- [ ] Registry-Eintrag im Dach prüfen: der Erfolgsbeleg bei `UID MOVE` (Task 3) ist wiederverwendbares Wissen für jedes Plugin, das IMAP schreibt
