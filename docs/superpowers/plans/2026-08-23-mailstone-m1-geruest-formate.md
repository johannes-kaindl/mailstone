# mailstone M1 — Gerüst + Formate · Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Repo-Gerüst (aus `calendar-notes` übernommen) plus die komplette, offline testbare Formatschicht: `.eml` → `ParsedMail` → Markdown/Frontmatter/Dateiname, Merge-Regeln für Re-Render, MIME-Builder für den Versand, Settings-Typen — abgeschlossen mit einem Kommando, das `.eml`-Dateien aus einem Vault-Ordner als Mail-Notizen anlegt.

**Architecture:** `src/core/**` ist obsidian-/node-/DOM-frei (erzwungen durch `scripts/check-pure.mjs`); Bibliotheken dort nur `postal-mime` (MIME-Parsing) und `turndown` (HTML→Markdown). `src/obsidian/**` enthält Vault-Schreiber (`PlanExecutor`), Settings-Tab und Kommando-Verdrahtung. Kein Netz in M1.

**Tech Stack:** TypeScript 5.5, esbuild, vitest 2, eslint 9 + `eslint-plugin-obsidianmd`, `postal-mime@3.0.0`, `turndown@7.2.4`, vendored Kit (`code-kit`: `i18n`, `sha256`, `filename-template`, `settings`, `timeout`; `obsidian-kit`: `frontmatter`, `vault-path`, `obsidian-mock`, `settings_walker`, `folder-suggest`, `confirm`).

**Spec:** `docs/superpowers/specs/2026-08-23-mailstone-design.md` (§ 1 Architektur, § 2 Datenmodell, § 3.3 MIME-Builder, § 6 Tests/M1)

## Global Constraints

- `manifest.json`: `id: "mailstone"`, `name: "Mailstone"`, `isDesktopOnly: true`, `minAppVersion: "1.11.4"`, `authorUrl: "https://github.com/johannes-kaindl"`.
- `src/core/**` importiert weder `obsidian` noch `electron` noch Node-Builtins noch DOM-Globals (`scripts/check-pure.mjs` ist Teil von `npm run gate`).
- Kein `child_process`, kein statischer Node-Import irgendwo; Node-Builtins nur als `Platform.isDesktop`-guarded `await import("node:…")` in `src/obsidian/**` (in M1 noch nicht nötig).
- Kein `eslint-disable` inline (`scripts/check-no-inline-disables.mjs`); Repo-Overrides nur in `eslint.overrides.mjs`.
- Keine echte Mail im Repo: alle `.eml` unter `tests/fixtures/eml/` sind synthetisch, Adressen nur `example.org`/`example.net`/`example.com`, `Message-ID`s frei erfunden, keine `Received:`-Header.
- Übernommene Dateien tragen in Zeile 1 den Herkunftsstempel `// uebernommen aus <repo>/<pfad>, 2026-08-23` (bzw. den `// vendored from …`-Stempel aus `tools/sync-kit.sh`).
- Commits: Conventional Commits auf Deutsch, Umlaute im Betreff transliteriert (`ae/oe/ue/ss`), by-name-Staging. Commits erst möglich, sobald das Repo (von der Repo-Session) gegründet ist — bis dahin die Commit-Schritte notieren und nachholen.
- Sprache in Code-Kommentaren und Doku: Deutsch; Nutzertexte EN kanonisch + DE in `src/i18n/strings.ts`; `src/core/**` bleibt i18n-frei (Keys + englischer Fallbacktext).
- Vitest läuft mit `TZ=Europe/Berlin` (in `vitest.config.ts` gesetzt), damit Lokalzeit-Tests deterministisch sind.

---

## Dateistruktur (M1)

```
mailstone/
├── manifest.json, package.json, tsconfig.json, tsconfig.test.json, tsconfig.scripts.json
├── vitest.config.ts, esbuild.config.mjs, eslint.config.mjs, eslint.overrides.mjs
├── LICENSE (AGPL-3.0-or-later), LICENSING.md, THIRD-PARTY.md, README.md, CHANGELOG.md, versions.json, styles.css
├── scripts/check-pure.mjs, scripts/check-no-inline-disables.mjs
├── tools/sync-kit.sh
├── src/
│   ├── main.ts
│   ├── vendor/{code-kit,kit,kit-obsidian}/…  (per tools/sync-kit.sh)
│   ├── i18n/strings.ts
│   ├── core/
│   │   ├── settings.ts
│   │   ├── mime/headers.ts · mime/parse.ts · mime/build.ts · mime/types.ts
│   │   ├── render/body.ts · render/filename.ts · render/frontmatter.ts
│   │   ├── mirror/profile.ts · mirror/plan.ts
│   │   └── merge/fences.ts · merge/merge.ts
│   └── obsidian/
│       ├── vault-notes.ts   (PlanExecutor)
│       ├── settings-tab.ts  (M1: Ordner, Dateiname-Template, Sprache)
│       ├── notifier.ts
│       └── import-eml.ts    (Kommando „.eml aus Ordner importieren")
└── tests/
    ├── setup.ts, __mocks__/obsidian.ts, vendor/kit/obsidian-mock.ts
    ├── fixtures/eml/*.eml
    ├── core/mime/*.test.ts · core/render/*.test.ts · core/merge/*.test.ts · core/mirror/*.test.ts · core/settings.test.ts
    ├── obsidian/vault-notes.test.ts
    └── smoke.test.ts, bundle.test.ts
```

---

### Task 1: Repo-Gerüst aus calendar-notes übernehmen

**Files:**
- Create: `package.json`, `manifest.json`, `versions.json`, `tsconfig.json`, `tsconfig.test.json`, `tsconfig.scripts.json`, `vitest.config.ts`, `esbuild.config.mjs`, `eslint.config.mjs`, `eslint.overrides.mjs`, `scripts/check-pure.mjs`, `scripts/check-no-inline-disables.mjs`, `tools/sync-kit.sh`, `tests/setup.ts`, `tests/__mocks__/obsidian.ts`, `tests/smoke.test.ts`, `tests/bundle.test.ts`, `src/main.ts`, `styles.css`, `LICENSE`, `LICENSING.md`, `THIRD-PARTY.md`, `README.md`, `CHANGELOG.md`
- Modify: `.gitignore` (Fixture-Negation ergänzen)
- Via `tools/sync-kit.sh`: `src/vendor/**`, `tests/vendor/kit/obsidian-mock.ts`

**Interfaces:**
- Produces: lauffähiges `npm run gate`; vendored Kit-Module `src/vendor/code-kit/{i18n,sha256,filename-template,settings,timeout}.ts`, `src/vendor/kit/{frontmatter,vault-path}.ts`, `src/vendor/kit-obsidian/{settings_walker,folder-suggest,confirm}.ts`.

- [ ] **Step 1: Dateien aus calendar-notes kopieren** (CWD = `mailstone/`)

```bash
CN=../calendar-notes
cp $CN/tsconfig.json $CN/tsconfig.test.json $CN/tsconfig.scripts.json $CN/vitest.config.ts \
   $CN/eslint.config.mjs $CN/eslint.overrides.mjs $CN/LICENSE .
mkdir -p scripts tools tests/__mocks__ src/i18n src/core src/obsidian
cp $CN/scripts/check-pure.mjs $CN/scripts/check-no-inline-disables.mjs scripts/
cp $CN/tools/sync-kit.sh tools/
cp $CN/tests/setup.ts tests/
cp $CN/tests/__mocks__/obsidian.ts tests/__mocks__/
# Herkunftsstempel in Zeile 1 der übernommenen TS/MJS-Dateien (eslint.config.mjs NICHT — das ist Template-Vendoring, byte-identisch zu tools/release-template/):
for f in scripts/check-pure.mjs tests/setup.ts tests/__mocks__/obsidian.ts tools/sync-kit.sh; do
  printf '%s\n' "// uebernommen aus calendar-notes/$f, 2026-08-23" | cat - "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
# sync-kit.sh ist ein Shell-Skript: Stempel als '#'-Kommentar NACH der Shebang-Zeile setzen:
sed -i '' '1d' tools/sync-kit.sh && sed -i '' '1a\
# uebernommen aus calendar-notes/tools/sync-kit.sh, 2026-08-23
' tools/sync-kit.sh
sh tools/sync-kit.sh
```
Erwartung: `vendored: code-kit(…): timeout sha256 filename-template settings i18n | obsidian-kit(…): …`. Prüfen: `head -3 tools/sync-kit.sh` zeigt `#!/bin/sh` in Zeile 1.

- [ ] **Step 2: `vitest.config.ts` um TZ ergänzen**

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

process.env.TZ = "Europe/Berlin"; // Lokalzeit-Tests (render/frontmatter) deterministisch

export default defineConfig({
  test: { environment: "node", globals: true, setupFiles: ["./tests/setup.ts"] },
  resolve: {
    alias: {
      // Mock-Alias gehoert in vitest, NIE in tsconfig.json (PROF-OBS-08):
      obsidian: fileURLToPath(new URL("./tests/__mocks__/obsidian.ts", import.meta.url)),
    },
  },
});
```

- [ ] **Step 3: `package.json` schreiben**

```json
{
  "name": "mailstone",
  "version": "0.0.1",
  "description": "Mail as vault notes: a server-side folder decides what becomes a note; sends iMIP invitations for calendar-notes.",
  "type": "module",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc --noEmit && node esbuild.config.mjs --production",
    "typecheck": "tsc --noEmit",
    "typecheck:test": "tsc -p tsconfig.test.json --noEmit",
    "typecheck:scripts": "if test -d ../tools/obsidian-cdp; then tsc -p tsconfig.scripts.json --noEmit; else echo 'typecheck:scripts uebersprungen: ../tools/obsidian-cdp fehlt'; fi",
    "test": "vitest run --passWithNoTests --exclude tests/integration/**",
    "test:integration": "vitest run tests/integration --testTimeout 60000",
    "lint": "node scripts/check-no-inline-disables.mjs && eslint src --max-warnings 0",
    "check:pure": "node scripts/check-pure.mjs",
    "gate": "npm run lint && npm run typecheck && npm run typecheck:test && npm run typecheck:scripts && npm test && npm run check:pure && npm run build",
    "deploy": "npm run build && cp main.js manifest.json styles.css \"${OBSIDIAN_PLUGIN_DIR:?set OBSIDIAN_PLUGIN_DIR}\"/",
    "release": "test -f ../tools/release/release.mjs || { echo \"FEHLER: ../tools/release/ fehlt. Dieses Repo muss im Dach-Verzeichnis obsidian-plugins/ neben tools/ liegen.\" >&2; exit 1; }; node ../tools/release/release.mjs",
    "version-bump": "test -f ../tools/release/version-bump.mjs || { echo \"FEHLER: ../tools/release/ fehlt.\" >&2; exit 1; }; node ../tools/release/version-bump.mjs",
    "preflight": "test -f ../tools/release/preflight.mjs || { echo \"FEHLER: ../tools/release/ fehlt.\" >&2; exit 1; }; node ../tools/release/preflight.mjs",
    "kit:sync": "sh tools/sync-kit.sh"
  },
  "keywords": ["obsidian-plugin", "email", "imap", "smtp", "imip"],
  "author": "Johannes Kaindl",
  "license": "AGPL-3.0-or-later",
  "dependencies": {
    "postal-mime": "^3.0.0",
    "turndown": "^7.2.4"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/turndown": "^5.0.5",
    "esbuild": "^0.23",
    "eslint": "^9",
    "eslint-plugin-obsidianmd": "^0.4.1",
    "obsidian": "latest",
    "typescript": "^5.5",
    "typescript-eslint": "^8",
    "vitest": "^2"
  }
}
```
Dann `npm install`. Falls `../tools/obsidian-cdp` existiert, `tsconfig.scripts.json` braucht einen `scripts/`-Ordner mit `.ts`-Dateien — für M1 gibt es keine; `include` dort auf `["scripts/**/*.ts"]` lassen (tsc ohne Treffer meldet `error TS18003`). Deshalb in `tsconfig.scripts.json` ergänzen: `"files": []` bleibt nicht — stattdessen eine leere `scripts/.keep-ts.ts` mit Inhalt `export {};` anlegen.

- [ ] **Step 4: `esbuild.config.mjs` mit Builtin-Plugin und domino-Stub**

```js
// uebernommen aus calendar-notes/esbuild.config.mjs, 2026-08-23 — ergaenzt um:
// (a) node-builtin-require aus vault-rag/esbuild.config.mjs (Registry § Node-Builtin desktop-only),
// (b) Stub fuer @mixmark-io/domino: turndown nutzt domino nur, wenn kein `document` existiert —
//     im Obsidian-Renderer gibt es eines; in vitest (node) wird domino aus node_modules geladen.
import esbuild from "esbuild";

const prod = process.argv.includes("--production");

/** Schreibt `import("node:x")` auf ein CJS-Shim um (esbuild laesst dynamische Imports externer
 *  Builtins bei format:'cjs' untransformiert stehen → Electron versucht ESM/Netz-Fetch). */
const nodeBuiltinRequire = {
  name: "node-builtin-require",
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => {
      if (args.kind !== "dynamic-import") return undefined; // statische Imports + require im Shim bleiben external
      return { path: args.path, namespace: "node-builtin-shim" };
    });
    build.onLoad({ filter: /.*/, namespace: "node-builtin-shim" }, (args) => ({
      contents: `module.exports = require(${JSON.stringify(args.path)});`,
      loader: "js",
    }));
  },
};

const dominoStub = {
  name: "domino-stub",
  setup(build) {
    build.onResolve({ filter: /^@mixmark-io\/domino$/ }, () => ({ path: "domino-stub", namespace: "domino-stub" }));
    build.onLoad({ filter: /.*/, namespace: "domino-stub" }, () => ({ contents: "module.exports = {};", loader: "js" }));
  },
};

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "node:*"],
  format: "cjs",
  target: "es2022",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  outfile: "main.js",
  plugins: [nodeBuiltinRequire, dominoStub],
});
if (prod) { await ctx.rebuild(); await ctx.dispose(); } else { await ctx.watch(); console.log("esbuild: watching…"); }
```

- [ ] **Step 5: `manifest.json`, `versions.json`, `styles.css`, `.gitignore`-Ergänzung**

```json
{
  "id": "mailstone",
  "name": "Mailstone",
  "version": "0.0.1",
  "minAppVersion": "1.11.4",
  "description": "Mail as vault notes: a server-side folder decides what becomes a note. Sends iMIP invitations for calendar-notes.",
  "author": "Johannes Kaindl",
  "authorUrl": "https://github.com/johannes-kaindl",
  "isDesktopOnly": true
}
```
`versions.json`: `{ "0.0.1": "1.11.4" }`. `styles.css`: leer mit Kommentar `/* mailstone — nur Theme-Variablen, keine Farben (UI-STANDARD) */`.
`.gitignore` ergänzen (unter dem bestehenden `*.eml`-Block, die Negation muss NACH `*.eml` stehen):
```
# Ausnahme: synthetische Test-Fixtures (tests/fixtures/eml/README.md erklaert die Regel)
!tests/fixtures/
!tests/fixtures/eml/
!tests/fixtures/eml/*.eml
# Build/Werkzeug-Reste
node_modules/
main.js
data.json
.claude/
.superpowers/
.remember/
.gui-smoke.mjs
.shots.mjs
.DS_Store
```

- [ ] **Step 6: Minimaler `src/main.ts`, Smoke- und Bundle-Test**

```ts
// src/main.ts
import { Plugin } from "obsidian";

export default class MailstonePlugin extends Plugin {
  async onload(): Promise<void> {
    // M1: Verdrahtung folgt in Task 10.
  }
}
```
```ts
// tests/smoke.test.ts
import { describe, it, expect } from "vitest";
import MailstonePlugin from "../src/main";
describe("plugin class", () => {
  it("exportiert eine Plugin-Klasse", () => { expect(typeof MailstonePlugin).toBe("function"); });
});
```
```ts
// tests/bundle.test.ts
// uebernommen (Muster) aus finance-ledger/tests/bundle.test.ts, 2026-08-23:
// Guard gegen untransformierte dynamische Builtin-Imports im Bundle (Registry § Node-Builtin desktop-only).
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
describe("main.js bundle", () => {
  it("enthaelt kein untransformiertes import(\"node:…\")", () => {
    if (!existsSync("main.js")) return; // vor dem ersten Build: nichts zu pruefen (gate baut zuletzt, der Test laeuft im naechsten gate gegen das Bundle)
    const js = readFileSync("main.js", "utf8");
    expect(/import\(\s*["']node:/.test(js)).toBe(false);
  });
});
```
`LICENSING.md`/`THIRD-PARTY.md`/`README.md`/`CHANGELOG.md`: `LICENSING.md` aus calendar-notes kopieren und „Calendar and Contact Notes" → „Mailstone" ersetzen; `THIRD-PARTY.md` listet `postal-mime` (MIT-0), `turndown` (MIT), `@mixmark-io/domino` (BSD-2-Clause, nur Test/Node) plus die vendored Kit-Module; `README.md` zwei Absätze (Zweck, Status „pre-release, M1"); `CHANGELOG.md` mit `## Unreleased`.

- [ ] **Step 7: Gate laufen lassen**

Run: `npm run gate`
Expected: lint 0 warnings, typecheck ×3 ok (scripts ggf. übersprungen), 2 Tests grün, `check:pure: src/core ist frei von obsidian/node/DOM`, `main.js` gebaut. Danach `npm test` erneut → `bundle.test.ts` prüft jetzt das Bundle.

- [ ] **Step 8: Commit** (sobald Repo existiert)

```bash
git add package.json package-lock.json manifest.json versions.json tsconfig*.json vitest.config.ts esbuild.config.mjs eslint.config.mjs eslint.overrides.mjs scripts tools tests src styles.css LICENSE LICENSING.md THIRD-PARTY.md README.md CHANGELOG.md .gitignore
git commit -m "chore: Repo-Geruest aus calendar-notes (Gate, Vendor-Kit, esbuild-Builtin-Plugin, Lint, Tests)"
```

---

### Task 2: `core/mime/headers.ts` — Message-ID-Normalisierung, Adressen, RFC 2047

**Files:**
- Create: `src/core/mime/headers.ts`, `src/core/mime/types.ts`
- Test: `tests/core/mime/headers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export interface MailAddress { name: string; address: string }
  export interface MailAttachmentMeta { name: string; type: string; size: number; contentId?: string; inline: boolean }
  export interface ParsedMail {
    id: string;                 // normalisierte Message-ID oder "noid-<sha256[:32]>"
    messageIdRaw: string | null;
    inReplyTo: string | null;   // normalisiert
    references: string[];       // normalisiert
    from: MailAddress | null; to: MailAddress[]; cc: MailAddress[];
    subject: string;
    date: Date | null;          // aus dem Date-Header; null wenn unparsbar
    text: string | null; html: string | null;
    attachments: MailAttachmentMeta[];
    attachmentData: Map<string, Uint8Array>;   // key = contentId oder name, fuer Extraktion/Inline
    rawSize: number;
  }
  // headers.ts
  export function normalizeMessageId(raw: string | null | undefined): string | null;  // "<a@b>" → "a@b"; leer → null
  export function splitReferences(raw: string | null | undefined): string[];           // alle "<…>" extrahieren, normalisiert, Reihenfolge erhalten, Duplikate raus
  export function formatAddress(a: MailAddress): string;                               // "Name <addr>" | "addr"
  export function encodeHeaderWord(value: string): string;                             // RFC 2047 "=?UTF-8?B?…?=" nur wenn nicht-ASCII, sonst unverändert
  export function foldHeader(name: string, value: string): string;                     // "Name: value" mit Zeilenfaltung bei 76 Zeichen (CRLF + Leerzeichen)
  export function fallbackId(date: string, from: string, subject: string): string;     // "noid-" + sha256HexUtf8(`${date}|${from}|${subject}`).slice(0,32)
  ```

- [ ] **Step 1: Failing Tests**

```ts
// tests/core/mime/headers.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMessageId, splitReferences, formatAddress, encodeHeaderWord, foldHeader, fallbackId } from "../../../src/core/mime/headers";

describe("normalizeMessageId", () => {
  it("entfernt spitze Klammern und Whitespace", () => {
    expect(normalizeMessageId(" <abc@example.org> ")).toBe("abc@example.org");
  });
  it("liefert null fuer leer/undefined", () => {
    expect(normalizeMessageId("")).toBeNull();
    expect(normalizeMessageId(undefined)).toBeNull();
    expect(normalizeMessageId("<>")).toBeNull();
  });
});
describe("splitReferences", () => {
  it("extrahiert alle IDs in Reihenfolge ohne Duplikate", () => {
    expect(splitReferences("<a@x> <b@x>\r\n <a@x>")).toEqual(["a@x", "b@x"]);
  });
  it("leer → []", () => { expect(splitReferences(null)).toEqual([]); });
});
describe("formatAddress", () => {
  it("mit Name", () => { expect(formatAddress({ name: "Erika Beispiel", address: "e@example.org" })).toBe("Erika Beispiel <e@example.org>"); });
  it("ohne Name", () => { expect(formatAddress({ name: "", address: "e@example.org" })).toBe("e@example.org"); });
});
describe("encodeHeaderWord", () => {
  it("ASCII bleibt", () => { expect(encodeHeaderWord("Hello")).toBe("Hello"); });
  it("Nicht-ASCII wird B-kodiert (UTF-8)", () => { expect(encodeHeaderWord("Grüße")).toBe("=?UTF-8?B?R3LDvMOfZQ==?="); });
});
describe("foldHeader", () => {
  it("kurz: eine Zeile", () => { expect(foldHeader("Subject", "Hi")).toBe("Subject: Hi"); });
  it("lang: faltet an Leerzeichen mit CRLF+SP, keine Zeile > 78", () => {
    const v = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    const out = foldHeader("Subject", v);
    for (const line of out.split("\r\n")) expect(line.length).toBeLessThanOrEqual(78);
    expect(out.replace(/\r\n /g, " ")).toBe(`Subject: ${v}`);
  });
});
describe("fallbackId", () => {
  it("ist deterministisch und hat das noid-Praefix", () => {
    const a = fallbackId("2026-08-19T12:32:00Z", "e@example.org", "Hi");
    expect(a).toMatch(/^noid-[0-9a-f]{32}$/);
    expect(fallbackId("2026-08-19T12:32:00Z", "e@example.org", "Hi")).toBe(a);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/mime/headers.test.ts` → FAIL (Modul fehlt).

- [ ] **Step 3: Implementierung**

```ts
// src/core/mime/types.ts  (Inhalt: die Interfaces aus dem Interfaces-Block oben, 1:1)
```
```ts
// src/core/mime/headers.ts
import { sha256HexUtf8 } from "../../vendor/code-kit/sha256";
import type { MailAddress } from "./types";

export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /<([^<>\s]+)>/.exec(raw);
  const v = (m ? m[1] : raw).trim();
  return v.length > 0 ? v : null;
}

export function splitReferences(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const m of raw.matchAll(/<([^<>\s]+)>/g)) {
    const id = m[1];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function formatAddress(a: MailAddress): string {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex -- NICHT verwenden: stattdessen Zeichen >0x7F pruefen
  let ascii = true;
  for (const ch of value) if (ch.charCodeAt(0) > 0x7e || ch.charCodeAt(0) < 0x20) { ascii = false; break; }
  return ascii ? value : `=?UTF-8?B?${utf8ToBase64(value)}?=`;
}

export function foldHeader(name: string, value: string): string {
  const words = value.split(" ");
  const lines: string[] = [];
  let cur = `${name}:`;
  for (const w of words) {
    if ((cur + " " + w).length > 76 && cur !== `${name}:`) { lines.push(cur); cur = ` ${w}`; }
    else cur += ` ${w}`;
  }
  lines.push(cur);
  return lines.join("\r\n");
}

export function fallbackId(date: string, from: string, subject: string): string {
  return `noid-${sha256HexUtf8(`${date}|${from}|${subject}`).slice(0, 32)}`;
}
```
(Den Kommentar mit `eslint-disable-next-line` im Codeblock NICHT übernehmen — er dient nur als Hinweis, dass keine Control-Char-Regex verwendet wird; Inline-disables sind verboten.)

- [ ] **Step 4: Run** → PASS. `npm run check:pure` → grün.
- [ ] **Step 5: Commit** `git add src/core/mime tests/core/mime && git commit -m "feat(mime): Header-Hilfen — Message-ID-Normalisierung, References, RFC-2047, Faltung, Fallback-ID"`

---

### Task 3: Fixture-Korpus (synthetisch) + `core/mime/parse.ts`

**Files:**
- Create: `tests/fixtures/eml/README.md`, `tests/fixtures/eml/{utf8-plain,iso8859-1-qp,windows-1252-base64-subject,multipart-alternative,multipart-alternative-stub-plain,multipart-mixed-attachments,multipart-related-inline,no-message-id,broken-boundary,date-negative-offset,thread-reply,winmail-dat}.eml`, `src/core/mime/parse.ts`
- Test: `tests/core/mime/parse.test.ts`

**Interfaces:**
- Consumes: `normalizeMessageId`, `splitReferences`, `fallbackId` (Task 2), `ParsedMail` (Task 2).
- Produces: `export async function parseEml(bytes: Uint8Array): Promise<ParsedMail>` und `export function loadFixture(name: string): Uint8Array` (nur Test-Helper in `tests/helpers/fixtures.ts`).

- [ ] **Step 1: Fixtures anlegen** (alle Zeilenenden CRLF — beim Schreiben `printf` mit `\r\n` benutzen oder nach dem Anlegen `perl -pi -e 's/\r?\n/\r\n/' datei`)

`tests/fixtures/eml/README.md`:
```
Ausschließlich SYNTHETISCHE Mails. Keine echte Mail, kein echter Header (Message-ID, Received), keine reale Adresse — nur example.org/.net/.com. Fehlerfälle aus dem Betrieb werden NACHGEBAUT, nie kopiert. Diese Datei ist die einzige .eml-Ausnahme der .gitignore.
```
`utf8-plain.eml`:
```
From: Erika Beispiel <erika@example.org>
To: Max Muster <max@example.net>
Cc: team@example.com
Subject: Hallo Welt
Date: Tue, 19 Aug 2026 14:32:00 +0200
Message-ID: <utf8-plain-001@mail.example.org>
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit

Schöne Grüße aus München — ß und €.
```
`iso8859-1-qp.eml`:
```
From: =?ISO-8859-1?Q?J=FCrgen_M=FCller?= <juergen@example.org>
To: max@example.net
Subject: =?ISO-8859-1?Q?Gr=FC=DFe_aus_K=F6ln?=
Date: Tue, 19 Aug 2026 09:15:00 +0200
Message-ID: <iso-qp-001@mail.example.org>
MIME-Version: 1.0
Content-Type: text/plain; charset=ISO-8859-1
Content-Transfer-Encoding: quoted-printable

Sch=F6ne Gr=FC=DFe, Stra=DFe.
```
`windows-1252-base64-subject.eml` (Subject „Angebot „Premium"" mit typografischen Anführungszeichen 0x93/0x94; Body base64 von `Angebot “Premium”` in cp1252 = `QW5nZWJvdCCTUHJlbWl1bZQ=`):
```
From: vertrieb@example.com
To: max@example.net
Subject: =?windows-1252?B?QW5nZWJvdCCTUHJlbWl1bZQ=?=
Date: Wed, 20 Aug 2026 08:00:00 +0200
Message-ID: <cp1252-001@mail.example.com>
MIME-Version: 1.0
Content-Type: text/plain; charset=windows-1252
Content-Transfer-Encoding: base64

QW5nZWJvdCCTUHJlbWl1bZQ=
```
`multipart-alternative.eml`:
```
From: erika@example.org
To: max@example.net
Subject: Termin
Date: Tue, 19 Aug 2026 10:00:00 +0200
Message-ID: <alt-001@mail.example.org>
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain; charset=UTF-8

Hallo,
der Termin verschiebt sich auf Donnerstag.

> Zitat der Vorgängermail
--alt
Content-Type: text/html; charset=UTF-8

<html><body><p>Hallo,<br>der Termin verschiebt sich auf <b>Donnerstag</b>.</p><blockquote>Zitat der Vorgängermail</blockquote></body></html>
--alt--
```
`multipart-alternative-stub-plain.eml` (Plain ist nur ein Stub → HTML muss gewinnen):
```
From: newsletter@example.com
To: max@example.net
Subject: Newsletter
Date: Tue, 19 Aug 2026 11:00:00 +0200
Message-ID: <stub-001@mail.example.com>
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain; charset=UTF-8

Diese Nachricht enthält HTML.
--alt
Content-Type: text/html; charset=UTF-8

<html><body><h1>Neuigkeiten</h1><p>Erster Absatz mit <a href="https://example.com/a">Link</a>.</p><p>Zweiter Absatz, deutlich länger als der Plain-Stub, damit die Heuristik greift und HTML gewinnt.</p><table><tr><td>Layout</td></tr></table><img src="https://example.com/pixel.gif" width="1" height="1"></body></html>
--alt--
```
`multipart-mixed-attachments.eml` (zwei Anhänge; PDF-Bytes `%PDF-` = `JVBERi0=`, Text-Anhang base64 von `hallo`):
```
From: erika@example.org
To: max@example.net
Subject: Unterlagen
Date: Tue, 19 Aug 2026 12:00:00 +0200
Message-ID: <mixed-001@mail.example.org>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="mix"

--mix
Content-Type: text/plain; charset=UTF-8

Anbei die Unterlagen.
--mix
Content-Type: application/pdf; name="bericht.pdf"
Content-Disposition: attachment; filename="bericht.pdf"
Content-Transfer-Encoding: base64

JVBERi0=
--mix
Content-Type: text/plain; name="notiz.txt"
Content-Disposition: attachment; filename="notiz.txt"
Content-Transfer-Encoding: base64

aGFsbG8=
--mix--
```
`multipart-related-inline.eml` (Inline-GIF 1×1, base64 `R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==`):
```
From: erika@example.org
To: max@example.net
Subject: Mit Bild
Date: Tue, 19 Aug 2026 13:00:00 +0200
Message-ID: <related-001@mail.example.org>
MIME-Version: 1.0
Content-Type: multipart/related; boundary="rel"

--rel
Content-Type: text/html; charset=UTF-8

<html><body><p>Siehe Bild:</p><img src="cid:logo@example.org" alt="Logo"></body></html>
--rel
Content-Type: image/gif; name="logo.gif"
Content-ID: <logo@example.org>
Content-Disposition: inline; filename="logo.gif"
Content-Transfer-Encoding: base64

R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
--rel--
```
`no-message-id.eml`:
```
From: anon@example.org
To: max@example.net
Subject: Ohne ID
Date: Tue, 19 Aug 2026 14:00:00 +0200
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8

Kein Message-ID-Header.
```
`broken-boundary.eml` (schließende Boundary fehlt — darf nicht werfen):
```
From: erika@example.org
To: max@example.net
Subject: Kaputt
Date: Tue, 19 Aug 2026 15:00:00 +0200
Message-ID: <broken-001@mail.example.org>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="b"

--b
Content-Type: text/plain; charset=UTF-8

Text ohne schließende Boundary
```
`date-negative-offset.eml`:
```
From: west@example.com
To: max@example.net
Subject: Aus New York
Date: Tue, 19 Aug 2026 18:30:00 -0400
Message-ID: <neg-001@mail.example.com>
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8

Abends in New York, nachts in Berlin.
```
`thread-reply.eml`:
```
From: max@example.net
To: erika@example.org
Subject: Re: Termin
Date: Tue, 19 Aug 2026 16:00:00 +0200
Message-ID: <reply-001@mail.example.net>
In-Reply-To: <alt-001@mail.example.org>
References: <root-000@mail.example.org> <alt-001@mail.example.org>
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8

Passt.
```
`winmail-dat.eml` (TNEF-Anhang aus Exchange-Gegenstellen; Bytes `eJ8+Ig==` sind nur die TNEF-Signatur — erkannt, nicht ausgepackt):
```
From: exchange@example.com
To: max@example.net
Subject: Mit TNEF
Date: Tue, 19 Aug 2026 17:00:00 +0200
Message-ID: <tnef-001@mail.example.com>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="t"

--t
Content-Type: text/plain; charset=UTF-8

Siehe Anhang.
--t
Content-Type: application/ms-tnef; name="winmail.dat"
Content-Disposition: attachment; filename="winmail.dat"
Content-Transfer-Encoding: base64

eJ8+Ig==
--t--
```

- [ ] **Step 2: Failing Tests**

```ts
// tests/helpers/fixtures.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/eml/${name}.eml`, import.meta.url))));
}
```
```ts
// tests/core/mime/parse.test.ts
import { describe, it, expect } from "vitest";
import { parseEml } from "../../../src/core/mime/parse";
import { loadFixture } from "../../helpers/fixtures";

describe("parseEml", () => {
  it("utf8-plain: Adressen, Betreff, Datum, ID", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    expect(m.id).toBe("utf8-plain-001@mail.example.org");
    expect(m.from).toEqual({ name: "Erika Beispiel", address: "erika@example.org" });
    expect(m.to).toEqual([{ name: "Max Muster", address: "max@example.net" }]);
    expect(m.cc).toEqual([{ name: "", address: "team@example.com" }]);
    expect(m.subject).toBe("Hallo Welt");
    expect(m.date?.toISOString()).toBe("2026-08-19T12:32:00.000Z");
    expect(m.text).toContain("Schöne Grüße aus München — ß und €.");
    expect(m.html).toBeNull();
  });
  it("iso8859-1-qp: Umlaute in Name, Betreff, Body", async () => {
    const m = await parseEml(loadFixture("iso8859-1-qp"));
    expect(m.from?.name).toBe("Jürgen Müller");
    expect(m.subject).toBe("Grüße aus Köln");
    expect(m.text).toContain("Schöne Grüße, Straße.");
  });
  it("windows-1252: typografische Anfuehrungszeichen", async () => {
    const m = await parseEml(loadFixture("windows-1252-base64-subject"));
    expect(m.subject).toBe("Angebot “Premium”");
    expect(m.text).toContain("Angebot “Premium”");
  });
  it("multipart/alternative: text und html beide vorhanden", async () => {
    const m = await parseEml(loadFixture("multipart-alternative"));
    expect(m.text).toContain("Donnerstag");
    expect(m.html).toContain("<b>Donnerstag</b>");
  });
  it("mixed: Anhaenge mit Name/Typ/Groesse, Bytes abrufbar", async () => {
    const m = await parseEml(loadFixture("multipart-mixed-attachments"));
    expect(m.attachments).toEqual([
      { name: "bericht.pdf", type: "application/pdf", size: 5, inline: false },
      { name: "notiz.txt", type: "text/plain", size: 5, inline: false },
    ]);
    expect(new TextDecoder().decode(m.attachmentData.get("notiz.txt"))).toBe("hallo");
  });
  it("related: Inline-Bild mit contentId, inline=true", async () => {
    const m = await parseEml(loadFixture("multipart-related-inline"));
    expect(m.attachments[0]).toMatchObject({ name: "logo.gif", type: "image/gif", contentId: "logo@example.org", inline: true });
    expect(m.attachmentData.has("logo@example.org")).toBe(true);
  });
  it("no-message-id: deterministische Fallback-ID", async () => {
    const m = await parseEml(loadFixture("no-message-id"));
    expect(m.messageIdRaw).toBeNull();
    expect(m.id).toMatch(/^noid-[0-9a-f]{32}$/);
  });
  it("broken-boundary: wirft nicht, liefert Text", async () => {
    const m = await parseEml(loadFixture("broken-boundary"));
    expect(m.text ?? "").toContain("Text ohne schließende Boundary");
  });
  it("date-negative-offset: UTC korrekt", async () => {
    const m = await parseEml(loadFixture("date-negative-offset"));
    expect(m.date?.toISOString()).toBe("2026-08-19T22:30:00.000Z");
  });
  it("winmail-dat: TNEF wird als Anhang application/ms-tnef gefuehrt, nicht ausgepackt", async () => {
    const m = await parseEml(loadFixture("winmail-dat"));
    expect(m.attachments).toEqual([{ name: "winmail.dat", type: "application/ms-tnef", size: 4, inline: false }]);
  });
  it("thread-reply: inReplyTo und references normalisiert", async () => {
    const m = await parseEml(loadFixture("thread-reply"));
    expect(m.inReplyTo).toBe("alt-001@mail.example.org");
    expect(m.references).toEqual(["root-000@mail.example.org", "alt-001@mail.example.org"]);
  });
});
```

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implementierung**

```ts
// src/core/mime/parse.ts
import PostalMime, { type Address, type Attachment } from "postal-mime";
import { fallbackId, normalizeMessageId, splitReferences } from "./headers";
import type { MailAddress, MailAttachmentMeta, ParsedMail } from "./types";

function flat(list: Address[] | undefined): MailAddress[] {
  const out: MailAddress[] = [];
  for (const a of list ?? []) {
    if (a.group) for (const g of a.group) out.push({ name: g.name ?? "", address: g.address });
    else if (a.address) out.push({ name: a.name ?? "", address: a.address });
  }
  return out;
}

function bytesOf(a: Attachment): Uint8Array {
  const c = a.content;
  if (c instanceof Uint8Array) return c;
  if (c instanceof ArrayBuffer) return new Uint8Array(c);
  return new TextEncoder().encode(String(c));
}

export async function parseEml(bytes: Uint8Array): Promise<ParsedMail> {
  const e = await PostalMime.parse(bytes, { attachmentEncoding: "arraybuffer" });
  const from = flat(e.from ? [e.from] : [])[0] ?? null;
  const messageIdRaw = e.messageId ?? null;
  const dateIso = e.date ?? "";
  const date = dateIso ? new Date(dateIso) : null;
  const id = normalizeMessageId(messageIdRaw) ?? fallbackId(dateIso, from?.address ?? "", e.subject ?? "");
  const attachments: MailAttachmentMeta[] = [];
  const attachmentData = new Map<string, Uint8Array>();
  for (const a of e.attachments) {
    const data = bytesOf(a);
    const contentId = a.contentId ? normalizeMessageId(a.contentId) ?? undefined : undefined;
    const inline = a.disposition === "inline" || a.related === true || !!contentId;
    const name = a.filename ?? (contentId ? `inline-${contentId}` : `attachment-${attachments.length + 1}`);
    // TNEF (Exchange): Typ vereinheitlichen, damit Renderer/UI ihn erkennen; nie auspacken (Spec § 2.2)
    const type = a.mimeType === "application/ms-tnef" || name.toLowerCase() === "winmail.dat" ? "application/ms-tnef" : a.mimeType;
    const meta: MailAttachmentMeta = { name, type, size: data.byteLength, inline };
    if (contentId) meta.contentId = contentId;
    attachments.push(meta);
    attachmentData.set(contentId ?? name, data);
  }
  return {
    id, messageIdRaw,
    inReplyTo: normalizeMessageId(e.inReplyTo), references: splitReferences(e.references),
    from, to: flat(e.to), cc: flat(e.cc),
    subject: e.subject ?? "",
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    text: e.text ?? null, html: e.html ?? null,
    attachments, attachmentData, rawSize: bytes.byteLength,
  };
}
```
Hinweis: `toEqual` in „mixed" vergleicht ohne `contentId` — da `contentId` dort nicht gesetzt wird, fehlt der Key; `toEqual` ignoriert `undefined`-Properties nicht bei fehlendem Key → deshalb wird `contentId` nur gesetzt, wenn vorhanden (siehe Code).

- [ ] **Step 5: Run** → PASS. `npm run check:pure` → grün (postal-mime ist kein verbotener Import).
- [ ] **Step 6: Commit** `git add tests/fixtures tests/helpers src/core/mime/parse.ts tests/core/mime/parse.test.ts .gitignore && git commit -m "feat(mime): parseEml ueber postal-mime + synthetischer Fixture-Korpus"`

---

### Task 4: `core/render/body.ts` — Mail → Markdown-Zone

**Files:**
- Create: `src/core/render/body.ts`
- Test: `tests/core/render/body.test.ts` (+ Snapshots unter `tests/core/render/__snapshots__/`)

**Interfaces:**
- Consumes: `ParsedMail` (Task 2).
- Produces:
  ```ts
  export interface RenderBodyOptions { plainMinRatio?: number }        // Default 0.1
  export function chooseSource(m: Pick<ParsedMail,"text"|"html">, opts?: RenderBodyOptions): "text" | "html" | "none";
  export function htmlToMarkdown(html: string): string;                 // turndown mit mailstone-Regeln
  export function renderMessageBlock(m: ParsedMail, opts?: RenderBodyOptions): string;  // "## Nachricht\n\n<body>" — OHNE Fences
  ```

- [ ] **Step 1: Failing Tests**

```ts
// tests/core/render/body.test.ts
import { describe, it, expect } from "vitest";
import { chooseSource, htmlToMarkdown, renderMessageBlock } from "../../../src/core/render/body";
import { parseEml } from "../../../src/core/mime/parse";
import { loadFixture } from "../../helpers/fixtures";

describe("chooseSource", () => {
  it("text gewinnt, wenn substanziell", () => {
    expect(chooseSource({ text: "a".repeat(50), html: "<p>" + "b".repeat(100) + "</p>" })).toBe("text");
  });
  it("html gewinnt bei leerem/Stub-Plain", () => {
    expect(chooseSource({ text: "Diese Nachricht enthält HTML.", html: "<p>" + "x".repeat(1000) + "</p>" })).toBe("html");
    expect(chooseSource({ text: "", html: "<p>x</p>" })).toBe("html");
  });
  it("none wenn beides fehlt", () => { expect(chooseSource({ text: null, html: null })).toBe("none"); });
});
describe("htmlToMarkdown", () => {
  it("Blockquote bleibt >, cid-Bild wird Platzhalter, Trackingpixel faellt weg", () => {
    const md = htmlToMarkdown('<p>Hi</p><blockquote><p>Zitat</p></blockquote><img src="cid:logo@example.org" alt="Logo"><img src="https://example.com/p.gif" width="1" height="1">');
    expect(md).toContain("> Zitat");
    expect(md).toContain("(Inline-Bild: Logo)");
    expect(md).not.toContain("p.gif");
  });
  it("Layout-Tabellen werden zu Text, Links bleiben", () => {
    const md = htmlToMarkdown('<table><tr><td><a href="https://example.com/a">Link</a></td></tr></table>');
    expect(md).toContain("[Link](https://example.com/a)");
    expect(md).not.toContain("<table");
  });
});
describe("renderMessageBlock", () => {
  it("beginnt mit ## Nachricht und rendert Fixtures stabil (Snapshot)", async () => {
    for (const f of ["utf8-plain", "multipart-alternative", "multipart-alternative-stub-plain", "multipart-related-inline"]) {
      const block = renderMessageBlock(await parseEml(loadFixture(f)));
      expect(block.startsWith("## Nachricht\n\n")).toBe(true);
      expect(block).toMatchSnapshot(f);
    }
  });
  it("ohne Body: Hinweiszeile", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    expect(renderMessageBlock({ ...m, text: null, html: null })).toBe("## Nachricht\n\n*(kein Textinhalt)*");
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implementierung**

```ts
// src/core/render/body.ts
import TurndownService from "turndown";
import type { ParsedMail } from "../mime/types";

export interface RenderBodyOptions { plainMinRatio?: number }

function textLenOfHtml(html: string): number {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

export function chooseSource(m: Pick<ParsedMail, "text" | "html">, opts: RenderBodyOptions = {}): "text" | "html" | "none" {
  const ratio = opts.plainMinRatio ?? 0.1;
  const text = (m.text ?? "").trim();
  const html = (m.html ?? "").trim();
  if (!text && !html) return "none";
  if (!html) return "text";
  if (!text) return "html";
  return text.length >= ratio * textLenOfHtml(html) ? "text" : "html";
}

let td: TurndownService | null = null;
function turndown(): TurndownService {
  if (td) return td;
  td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  td.remove(["style", "script", "head", "title"]);
  // Trackingpixel + sonstige 1x1-Bilder verwerfen
  td.addRule("tracking-pixel", {
    filter: (node) => node.nodeName === "IMG" && ((node.getAttribute("width") === "1" && node.getAttribute("height") === "1")),
    replacement: () => "",
  });
  // cid:-Bilder → Platzhalter (nie data-URI, nie extrahiert; Anzeige in der .eml-View)
  td.addRule("cid-image", {
    filter: (node) => node.nodeName === "IMG" && (node.getAttribute("src") ?? "").startsWith("cid:"),
    replacement: (_c, node) => {
      const el = node as HTMLElement;
      const label = el.getAttribute("alt") || el.getAttribute("title") || (el.getAttribute("src") ?? "").slice(4);
      return `(Inline-Bild: ${label})`;
    },
  });
  // Tabellen: Zellen als Text mit Leerzeichen, Zeilen als Absaetze (Layout-Tabellen in Mails sind kein Tabellendaten)
  td.addRule("table-cell", { filter: ["td", "th"], replacement: (content) => `${content.trim()} ` });
  td.addRule("table-row", { filter: "tr", replacement: (content) => `${content.trim()}\n\n` });
  td.addRule("table", { filter: ["table", "thead", "tbody", "tfoot"], replacement: (content) => content });
  return td;
}

export function htmlToMarkdown(html: string): string {
  return turndown().turndown(html).replace(/\n{3,}/g, "\n\n").trim();
}

export function renderMessageBlock(m: ParsedMail, opts: RenderBodyOptions = {}): string {
  const src = chooseSource(m, opts);
  let body: string;
  if (src === "text") body = (m.text ?? "").replace(/\r\n/g, "\n").trim();
  else if (src === "html") body = htmlToMarkdown(m.html ?? "");
  else body = "*(kein Textinhalt)*";
  return `## Nachricht\n\n${body}`;
}
```
Hinweis für den Typ: `@types/turndown` liefert `TurndownService.Node`; falls `node.getAttribute` im Filter typisiert fehlschlägt, auf `(node as HTMLElement)` casten (turndown reicht DOM-Nodes durch; in Node stammen sie von domino). `src/core` nutzt damit keine DOM-*Globals*, nur Typen — `check-pure` scannt Bezeichner wie `document`/`window`, nicht `HTMLElement`.

- [ ] **Step 4: Run** → PASS; Snapshots werden beim ersten Lauf geschrieben, prüfen: Snapshot für `multipart-alternative-stub-plain` enthält `# Neuigkeiten`, keinen `pixel.gif`; Snapshot für `multipart-related-inline` enthält `(Inline-Bild: Logo)`. Danach `npm run check:pure` → grün.
- [ ] **Step 5: Commit** `git add src/core/render/body.ts tests/core/render && git commit -m "feat(render): Mail-Body → Markdown (turndown-Regeln, Quellwahl text/html, cid-Platzhalter)"`

---

### Task 5: `core/mirror/profile.ts`, `core/render/frontmatter.ts`, `core/render/filename.ts`

**Files:**
- Create: `src/core/mirror/profile.ts`, `src/core/render/frontmatter.ts`, `src/core/render/filename.ts`
- Test: `tests/core/mirror/profile.test.ts`, `tests/core/render/frontmatter.test.ts`, `tests/core/render/filename.test.ts`

**Interfaces:**
- Consumes: `ParsedMail`, `formatAddress` (Task 2), `buildFilename`/`sanitizeFilename` (`src/vendor/code-kit/filename-template.ts`), `FmValue` (`src/vendor/kit/frontmatter.ts`).
- Produces:
  ```ts
  // mirror/profile.ts
  export type FmVal = string | number | boolean | string[];
  export const MAIL_SERVER_FIELDS = ["title","date","time","from","to","cc","subject","in_reply_to","references","attachments"] as const;
  export type MailServerField = typeof MAIL_SERVER_FIELDS[number];
  export interface MailProfile {
    id: string; name: string;
    folder: string;            // Default "Mail"; Jahr wird als Unterordner angehaengt (yearSubfolder)
    yearSubfolder: boolean;    // Default true
    emlSubfolder: string;      // Default "_eml"
    filename: string;          // Default "{date}-{time}-{slug}"
    idField: string; sourceField: string; stateField: string; syncedField: string;  // "mail_id","mail_source","mail_state","mail_synced"
    fields: Record<MailServerField, string | null>;
    onCreate: Record<string, FmVal>;                                                // Default { type: "mail" }
  }
  export function defaultMailProfile(): MailProfile;
  export function identityKeys(p: MailProfile): string[];
  export function managedKeys(p: MailProfile): string[];     // identity + alle gemappten fmKeys
  export function fmKeyFor(p: MailProfile, f: MailServerField): string | null;
  // render/frontmatter.ts
  export interface MailFrontmatterInput { mail: ParsedMail; source: string; state: "live"|"detached"; syncedAt: Date; linkFor?: (id: string) => string | null /* Wikilink-Ziel oder null */ }
  export function buildDerivedFrontmatter(p: MailProfile, input: MailFrontmatterInput): Record<string, FmVal>;  // NUR abgeleitete Keys (ohne onCreate)
  export function localDateParts(d: Date): { date: string; time: string };   // "YYYY-MM-DD", "HH:mm" in Systemzeitzone
  // render/filename.ts
  export function subjectSlug(subject: string, max?: number): string;        // max Default 60
  export function mailFilename(p: MailProfile, mail: ParsedMail): string;    // ohne ".md"; Fallback bei leerem Slug: "mail"
  export function mailFolder(p: MailProfile, mail: ParsedMail): string;      // "Mail/2026" bzw. "Mail"
  export function emlFolder(p: MailProfile, mail: ParsedMail): string;       // "Mail/2026/_eml"
  ```

- [ ] **Step 1: Failing Tests**

```ts
// tests/core/mirror/profile.test.ts
import { describe, it, expect } from "vitest";
import { defaultMailProfile, identityKeys, managedKeys, fmKeyFor } from "../../../src/core/mirror/profile";
describe("MailProfile", () => {
  it("Default-Profil hat Identitaetsfelder und Mapping", () => {
    const p = defaultMailProfile();
    expect(identityKeys(p)).toEqual(["mail_id", "mail_source", "mail_state", "mail_synced"]);
    expect(fmKeyFor(p, "from")).toBe("from");
    expect(managedKeys(p)).toContain("subject");
    expect(managedKeys(p)).not.toContain("type"); // onCreate ist nicht managed
  });
  it("null-Mapping schaltet ein Feld ab", () => {
    const p = { ...defaultMailProfile(), fields: { ...defaultMailProfile().fields, cc: null } };
    expect(fmKeyFor(p, "cc")).toBeNull();
    expect(managedKeys(p)).not.toContain("cc");
  });
});
```
```ts
// tests/core/render/frontmatter.test.ts
import { describe, it, expect } from "vitest";
import { buildDerivedFrontmatter, localDateParts } from "../../../src/core/render/frontmatter";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import { parseEml } from "../../../src/core/mime/parse";
import { loadFixture } from "../../helpers/fixtures";

describe("localDateParts (TZ=Europe/Berlin)", () => {
  it("rechnet UTC in Lokalzeit", () => {
    expect(localDateParts(new Date("2026-08-19T22:30:00.000Z"))).toEqual({ date: "2026-08-20", time: "00:30" });
  });
});
describe("buildDerivedFrontmatter", () => {
  it("utf8-plain: alle Felder nach Default-Profil", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    const fm = buildDerivedFrontmatter(defaultMailProfile(), { mail: m, source: "privat/Vault", state: "live", syncedAt: new Date("2026-08-23T13:00:00.000Z") });
    expect(fm).toEqual({
      mail_id: "utf8-plain-001@mail.example.org", mail_source: "privat/Vault", mail_state: "live", mail_synced: "2026-08-23T15:00:00+02:00",
      title: "Hallo Welt", date: "2026-08-19", time: "14:32",
      from: "Erika Beispiel <erika@example.org>", to: ["Max Muster <max@example.net>"], cc: ["team@example.com"],
      subject: "Hallo Welt", in_reply_to: "", references: [], attachments: [],
    });
  });
  it("thread-reply: Wikilink nur wenn linkFor ein Ziel liefert", async () => {
    const m = await parseEml(loadFixture("thread-reply"));
    const p = defaultMailProfile();
    const noLink = buildDerivedFrontmatter(p, { mail: m, source: "s", state: "live", syncedAt: new Date(0) });
    expect(noLink["in_reply_to"]).toBe("alt-001@mail.example.org");
    const withLink = buildDerivedFrontmatter(p, { mail: m, source: "s", state: "live", syncedAt: new Date(0), linkFor: (id) => id === "alt-001@mail.example.org" ? "Mail/2026/2026-08-19-1000-termin" : null });
    expect(withLink["in_reply_to"]).toBe("[[Mail/2026/2026-08-19-1000-termin]]");
    expect(withLink["references"]).toEqual(["root-000@mail.example.org", "[[Mail/2026/2026-08-19-1000-termin]]"]);
  });
  it("attachments als 'name (type, size)'-Strings", async () => {
    const m = await parseEml(loadFixture("multipart-mixed-attachments"));
    const fm = buildDerivedFrontmatter(defaultMailProfile(), { mail: m, source: "s", state: "live", syncedAt: new Date(0) });
    expect(fm["attachments"]).toEqual(["bericht.pdf (application/pdf, 5 B)", "notiz.txt (text/plain, 5 B)"]);
  });
});
```
```ts
// tests/core/render/filename.test.ts
import { describe, it, expect } from "vitest";
import { subjectSlug, mailFilename, mailFolder, emlFolder } from "../../../src/core/render/filename";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import { parseEml } from "../../../src/core/mime/parse";
import { loadFixture } from "../../helpers/fixtures";

describe("subjectSlug", () => {
  it("transliteriert, entfernt Re:/AW:/Fwd:/WG:, kuerzt auf 60", () => {
    expect(subjectSlug("Re: AW: Größe/Maß: Übersicht")).toBe("groesse-mass-uebersicht");
    expect(subjectSlug("x".repeat(100)).length).toBe(60);
    expect(subjectSlug("  ")).toBe("");
  });
});
describe("mailFilename/Folder", () => {
  it("Default-Template {date}-{time}-{slug}", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    const p = defaultMailProfile();
    expect(mailFilename(p, m)).toBe("2026-08-19-1432-hallo-welt");
    expect(mailFolder(p, m)).toBe("Mail/2026");
    expect(emlFolder(p, m)).toBe("Mail/2026/_eml");
  });
  it("leerer Betreff → Fallback 'mail'", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    expect(mailFilename(defaultMailProfile(), { ...m, subject: "" })).toBe("2026-08-19-1432-mail");
  });
  it("ohne Datum: Jahr-Unterordner entfaellt, Datum = 'undated'", async () => {
    const m = await parseEml(loadFixture("utf8-plain"));
    expect(mailFolder(defaultMailProfile(), { ...m, date: null })).toBe("Mail");
    expect(mailFilename(defaultMailProfile(), { ...m, date: null })).toBe("undated-hallo-welt");
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implementierung**

```ts
// src/core/mirror/profile.ts
export type FmVal = string | number | boolean | string[];
export const MAIL_SERVER_FIELDS = ["title", "date", "time", "from", "to", "cc", "subject", "in_reply_to", "references", "attachments"] as const;
export type MailServerField = (typeof MAIL_SERVER_FIELDS)[number];

export interface MailProfile {
  id: string; name: string;
  folder: string; yearSubfolder: boolean; emlSubfolder: string; filename: string;
  idField: string; sourceField: string; stateField: string; syncedField: string;
  fields: Record<MailServerField, string | null>;
  onCreate: Record<string, FmVal>;
}

export function defaultMailProfile(): MailProfile {
  return {
    id: "default-mail", name: "Mail (default)",
    folder: "Mail", yearSubfolder: true, emlSubfolder: "_eml", filename: "{date}-{time}-{slug}",
    idField: "mail_id", sourceField: "mail_source", stateField: "mail_state", syncedField: "mail_synced",
    fields: { title: "title", date: "date", time: "time", from: "from", to: "to", cc: "cc", subject: "subject", in_reply_to: "in_reply_to", references: "references", attachments: "attachments" },
    onCreate: { type: "mail" },
  };
}
export function identityKeys(p: MailProfile): string[] { return [p.idField, p.sourceField, p.stateField, p.syncedField]; }
export function fmKeyFor(p: MailProfile, f: MailServerField): string | null {
  const v = p.fields[f];
  return typeof v === "string" && v.length > 0 ? v : null;
}
export function managedKeys(p: MailProfile): string[] {
  const out = identityKeys(p);
  for (const f of MAIL_SERVER_FIELDS) { const k = fmKeyFor(p, f); if (k && !out.includes(k)) out.push(k); }
  return out;
}
```
```ts
// src/core/render/frontmatter.ts
import type { ParsedMail } from "../mime/types";
import { formatAddress } from "../mime/headers";
import { fmKeyFor, identityKeys, type FmVal, type MailProfile } from "../mirror/profile";

export interface MailFrontmatterInput { mail: ParsedMail; source: string; state: "live" | "detached"; syncedAt: Date; linkFor?: (id: string) => string | null }

const pad = (n: number): string => String(n).padStart(2, "0");
export function localDateParts(d: Date): { date: string; time: string } {
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
/** ISO-8601 mit lokalem Offset, z. B. 2026-08-23T15:00:00+02:00 */
export function localIso(d: Date): string {
  const { date, time } = localDateParts(d);
  const off = -d.getTimezoneOffset(); const sign = off >= 0 ? "+" : "-"; const a = Math.abs(off);
  return `${date}T${time}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export function buildDerivedFrontmatter(p: MailProfile, input: MailFrontmatterInput): Record<string, FmVal> {
  const { mail, linkFor } = input;
  const link = (id: string): string => { const t = linkFor?.(id) ?? null; return t ? `[[${t}]]` : id; };
  const parts = mail.date ? localDateParts(mail.date) : { date: "", time: "" };
  const values: Record<string, FmVal> = {
    title: mail.subject, date: parts.date, time: parts.time,
    from: mail.from ? formatAddress(mail.from) : "", to: mail.to.map(formatAddress), cc: mail.cc.map(formatAddress),
    subject: mail.subject, in_reply_to: mail.inReplyTo ? link(mail.inReplyTo) : "", references: mail.references.map(link),
    attachments: mail.attachments.filter((a) => !a.inline).map((a) => `${a.name} (${a.type}, ${humanSize(a.size)})`),
  };
  const [idK, srcK, stK, syK] = identityKeys(p) as [string, string, string, string];
  const out: Record<string, FmVal> = { [idK]: mail.id, [srcK]: input.source, [stK]: input.state, [syK]: localIso(input.syncedAt) };
  for (const f of Object.keys(values) as (keyof typeof values)[]) {
    const k = fmKeyFor(p, f as Parameters<typeof fmKeyFor>[1]);
    if (k) out[k] = values[f] as FmVal;
  }
  return out;
}
```
```ts
// src/core/render/filename.ts
import { buildFilename } from "../../vendor/code-kit/filename-template";
import type { ParsedMail } from "../mime/types";
import type { MailProfile } from "../mirror/profile";
import { localDateParts } from "./frontmatter";

const TRANSLIT: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "ae", Ö: "oe", Ü: "ue" };
export function subjectSlug(subject: string, max = 60): string {
  let s = subject.trim();
  for (;;) { const n = s.replace(/^(re|aw|fwd?|wg|sv|vs)\s*:\s*/i, ""); if (n === s) break; s = n; }
  s = s.replace(/[äöüßÄÖÜ]/g, (c) => TRANSLIT[c] ?? c).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length > max) s = s.slice(0, max).replace(/-+$/, "");
  return s;
}
function vars(mail: ParsedMail): Record<string, string> {
  const parts = mail.date ? localDateParts(mail.date) : null;
  return { date: parts ? parts.date : "undated", time: parts ? parts.time.replace(":", "") : "", slug: subjectSlug(mail.subject) || "mail", year: parts ? parts.date.slice(0, 4) : "" };
}
export function mailFilename(p: MailProfile, mail: ParsedMail): string {
  const v = vars(mail);
  const tpl = v.time ? p.filename : p.filename.replace(/\{time\}[-_ ]?/g, "");
  return buildFilename(tpl, v, { fallback: `${v.date}-mail` });
}
export function mailFolder(p: MailProfile, mail: ParsedMail): string {
  const y = vars(mail).year;
  return p.yearSubfolder && y ? `${p.folder}/${y}` : p.folder;
}
export function emlFolder(p: MailProfile, mail: ParsedMail): string { return `${mailFolder(p, mail)}/${p.emlSubfolder}`; }
```
`buildFilename`-Signatur vor dem Schreiben in `src/vendor/code-kit/filename-template.ts:137` nachlesen (Template, Variablen, Optionen mit `fallback`); falls die Optionen anders heißen, anpassen — der Test „leerer Betreff → `2026-08-19-1432-mail`" ist der Vertrag.

- [ ] **Step 4: Run** → PASS. `check:pure` → grün.
- [ ] **Step 5: Commit** `git add src/core/mirror/profile.ts src/core/render tests/core && git commit -m "feat(render): Mapping-Profil, abgeleitetes Frontmatter, Dateiname/Ablage"`

---

### Task 6: `core/merge/` — Fences, abgeleitete Keys, Hash, Merge-Regeln

**Files:**
- Create: `src/core/merge/fences.ts`, `src/core/merge/merge.ts`
- Test: `tests/core/merge/fences.test.ts`, `tests/core/merge/merge.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter`/`serializeFrontmatter` (`src/vendor/kit/frontmatter.ts`), `sha256HexUtf8`, `FmVal`, `managedKeys`.
- Produces:
  ```ts
  // fences.ts
  export const BLOCK_BEGIN = "%% mailstone:begin %%"; export const BLOCK_END = "%% mailstone:end %%";
  export function splitBody(body: string): { before: string; block: string | null; after: string };
  export function wrapBlock(block: string): string;               // BEGIN\nblock\nEND
  export function zoneHash(block: string): string;               // sha256HexUtf8(block.trim())
  // merge.ts
  export type MergeErrorCode = "fences-missing" | "zone-edited" | "frontmatter-unparseable";
  export interface MergeInput { existing: string; derived: Record<string, FmVal>; managed: string[]; block: string; expectedZoneHash: string | null /* null = noch kein Hash bekannt (Erstanlage via Import) */ }
  export type MergeResult = { ok: true; content: string; changed: boolean; zoneHash: string } | { ok: false; code: MergeErrorCode };
  export function mergeNote(input: MergeInput): MergeResult;
  export function newNote(derived: Record<string, FmVal>, onCreate: Record<string, FmVal>, block: string, userHead?: string): { content: string; zoneHash: string };  // userHead Default "## Notizen\n\n"
  ```

- [ ] **Step 1: Failing Tests**

```ts
// tests/core/merge/fences.test.ts
import { describe, it, expect } from "vitest";
import { splitBody, wrapBlock, zoneHash, BLOCK_BEGIN, BLOCK_END } from "../../../src/core/merge/fences";
describe("fences", () => {
  it("split findet Block und Aussenbereiche", () => {
    const body = `vorher\n${BLOCK_BEGIN}\n## Nachricht\n\nx\n${BLOCK_END}\nnachher`;
    expect(splitBody(body)).toEqual({ before: "vorher\n", block: "## Nachricht\n\nx", after: "\nnachher" });
  });
  it("ohne Fences: block null", () => { expect(splitBody("nur text").block).toBeNull(); });
  it("wrapBlock + zoneHash deterministisch", () => {
    expect(wrapBlock("a")).toBe(`${BLOCK_BEGIN}\na\n${BLOCK_END}`);
    expect(zoneHash("a\n")).toBe(zoneHash("a"));
  });
});
```
```ts
// tests/core/merge/merge.test.ts
import { describe, it, expect } from "vitest";
import { mergeNote, newNote } from "../../../src/core/merge/merge";
import { zoneHash } from "../../../src/core/merge/fences";

const derived = { mail_id: "a@x", mail_source: "s", mail_state: "live", mail_synced: "2026-08-23T15:00:00+02:00", title: "Hi", from: "a@x" };
const managed = Object.keys(derived);

describe("newNote", () => {
  it("Frontmatter (onCreate + derived), Notizen-Kopf, Block", () => {
    const { content, zoneHash: h } = newNote(derived, { type: "mail" }, "## Nachricht\n\nText");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("type: mail");
    expect(content).toContain("mail_id: a@x");
    expect(content).toContain("## Notizen\n\n%% mailstone:begin %%\n## Nachricht\n\nText\n%% mailstone:end %%");
    expect(h).toBe(zoneHash("## Nachricht\n\nText"));
  });
});
describe("mergeNote", () => {
  const base = newNote(derived, { type: "mail" }, "## Nachricht\n\nalt");
  it("ersetzt nur die Zone, Aussenbereich byte-identisch, unbekannte Keys bleiben", () => {
    const existing = base.content.replace("## Notizen\n\n", "## Notizen\n\nMein Gedanke.\n\n").replace("type: mail\n", "type: mail\nup: \"[[Projekt]]\"\n");
    const r = mergeNote({ existing, derived: { ...derived, title: "Neu" }, managed, block: "## Nachricht\n\nneu", expectedZoneHash: base.zoneHash });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("Mein Gedanke.");
    expect(r.content).toContain('up: "[[Projekt]]"');
    expect(r.content).toContain("title: Neu");
    expect(r.content).toContain("## Nachricht\n\nneu");
    expect(r.content).not.toContain("alt");
    expect(r.changed).toBe(true);
  });
  it("umsortiertes Frontmatter ist keine Manipulation", () => {
    const lines = base.content.split("\n"); // Frontmatter-Zeilen 1..n rotieren
    const end = lines.indexOf("---", 1);
    const fm = lines.slice(1, end); fm.push(fm.shift() as string);
    const existing = ["---", ...fm, ...lines.slice(end)].join("\n");
    const r = mergeNote({ existing, derived, managed, block: "## Nachricht\n\nalt", expectedZoneHash: base.zoneHash });
    expect(r.ok).toBe(true);
  });
  it("fehlende Fences → fences-missing, kein Inhalt", () => {
    const r = mergeNote({ existing: "---\nmail_id: a@x\n---\n\nfrei", derived, managed, block: "x", expectedZoneHash: null });
    expect(r).toEqual({ ok: false, code: "fences-missing" });
  });
  it("editierte Zone (Hash weicht ab) → zone-edited", () => {
    const existing = base.content.replace("## Nachricht\n\nalt", "## Nachricht\n\nalt (von Hand geaendert)");
    const r = mergeNote({ existing, derived, managed, block: "## Nachricht\n\nneu", expectedZoneHash: base.zoneHash });
    expect(r).toEqual({ ok: false, code: "zone-edited" });
  });
  it("expectedZoneHash null: Zone wird ohne Hash-Pruefung uebernommen (Adoption)", () => {
    const existing = base.content.replace("## Nachricht\n\nalt", "## Nachricht\n\nfremd");
    const r = mergeNote({ existing, derived, managed, block: "## Nachricht\n\nneu", expectedZoneHash: null });
    expect(r.ok).toBe(true);
  });
  it("idempotent: gleicher Input → changed=false, Inhalt identisch", () => {
    const r = mergeNote({ existing: base.content, derived, managed, block: "## Nachricht\n\nalt", expectedZoneHash: base.zoneHash });
    expect(r.ok && !r.changed && r.content === base.content).toBe(true);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implementierung**

```ts
// src/core/merge/fences.ts
// uebernommen (Muster) aus calendar-notes/src/core/mirror/body.ts (splitBody/mergeBody), 2026-08-23
import { sha256HexUtf8 } from "../../vendor/code-kit/sha256";
export const BLOCK_BEGIN = "%% mailstone:begin %%";
export const BLOCK_END = "%% mailstone:end %%";
export function splitBody(body: string): { before: string; block: string | null; after: string } {
  const i = body.indexOf(BLOCK_BEGIN);
  if (i < 0) return { before: body, block: null, after: "" };
  const j = body.indexOf(BLOCK_END, i + BLOCK_BEGIN.length);
  if (j < 0) return { before: body, block: null, after: "" };
  const inner = body.slice(i + BLOCK_BEGIN.length, j).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return { before: body.slice(0, i), block: inner, after: body.slice(j + BLOCK_END.length) };
}
export function wrapBlock(block: string): string { return `${BLOCK_BEGIN}\n${block}\n${BLOCK_END}`; }
export function zoneHash(block: string): string { return sha256HexUtf8(block.trim()); }
```
```ts
// src/core/merge/merge.ts
import { parseFrontmatter, serializeFrontmatter, type FmValue } from "../../vendor/kit/frontmatter";
import type { FmVal } from "../mirror/profile";
import { splitBody, wrapBlock, zoneHash } from "./fences";

export type MergeErrorCode = "fences-missing" | "zone-edited" | "frontmatter-unparseable";
export interface MergeInput { existing: string; derived: Record<string, FmVal>; managed: string[]; block: string; expectedZoneHash: string | null }
export type MergeResult = { ok: true; content: string; changed: boolean; zoneHash: string } | { ok: false; code: MergeErrorCode };

const toFm = (v: FmVal): FmValue => (typeof v === "boolean" ? String(v) : v);

function fmBlock(data: Record<string, FmValue>, order: string[]): string { return `---\n${serializeFrontmatter(data, order)}\n---\n`; }

export function newNote(derived: Record<string, FmVal>, onCreate: Record<string, FmVal>, block: string, userHead = "## Notizen\n\n"): { content: string; zoneHash: string } {
  const data: Record<string, FmValue> = {}; const order: string[] = [];
  for (const [k, v] of Object.entries({ ...onCreate, ...derived })) { data[k] = toFm(v); order.push(k); }
  return { content: `${fmBlock(data, order)}\n${userHead}${wrapBlock(block)}\n`, zoneHash: zoneHash(block) };
}

export function mergeNote(input: MergeInput): MergeResult {
  const parsed = parseFrontmatter(input.existing);
  // parseFrontmatter liefert { data, order, body } — Signatur in src/vendor/kit/frontmatter.ts:96 pruefen
  if (!parsed) return { ok: false, code: "frontmatter-unparseable" };
  const { before, block, after } = splitBody(parsed.body);
  if (block === null) return { ok: false, code: "fences-missing" };
  if (input.expectedZoneHash !== null && zoneHash(block) !== input.expectedZoneHash) return { ok: false, code: "zone-edited" };
  const data: Record<string, FmValue> = { ...parsed.data }; const order = [...parsed.order];
  for (const k of input.managed) {
    if (Object.hasOwn(input.derived, k)) { data[k] = toFm(input.derived[k] as FmVal); if (!order.includes(k)) order.push(k); }
  }
  const content = `${fmBlock(data, order)}${before}${wrapBlock(input.block)}${after}`;
  return { ok: true, content, changed: content !== input.existing, zoneHash: zoneHash(input.block) };
}
```
`parseFrontmatter`-Rückgabeform in `src/vendor/kit/frontmatter.ts:16` (`ParsedFrontmatter`) nachlesen und die Feldnamen (`data`, `order`, `body`/`content`) exakt übernehmen; der Idempotenz-Test erzwingt, dass `serializeFrontmatter(parse(x))` für die eigene Ausgabe stabil ist — falls das Kit beim Serialisieren anders quotet als `newNote`, `newNote` auf denselben Serialisierer umstellen (tut es bereits über `fmBlock`).

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add src/core/merge tests/core/merge && git commit -m "feat(merge): Fences, Zone-Hash, Merge-Regeln (melden statt ueberschreiben)"`

---

### Task 7: `core/mime/build.ts` — MIME-Builder für den Versand

**Files:**
- Create: `src/core/mime/build.ts`, `src/core/send/outgoing.ts` (nur Typen + Validierungsfunktion)
- Test: `tests/core/mime/build.test.ts`, `tests/fixtures/golden/imip-request.eml` (wird beim ersten Lauf als Golden-File geschrieben und committet)

**Interfaces:**
- Consumes: `encodeHeaderWord`, `foldHeader` (Task 2).
- Produces:
  ```ts
  // send/outgoing.ts
  export interface OutgoingMessage { from: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html?: string;
    calendar?: { method: "REQUEST" | "CANCEL" | "REPLY"; ics: string }; attachments?: { name: string; type: string; data: Uint8Array }[];
    inReplyTo?: string; references?: string[] }
  export interface Sender { address: string; name: string }
  export type OutgoingValidation = { ok: true } | { ok: false; code: "no-recipients" | "empty-subject" | "invalid-address" };
  export function validateOutgoing(msg: OutgoingMessage): OutgoingValidation;
  // mime/build.ts
  export interface BuildOptions { sender: Sender; messageId: string; date: Date; boundarySeed?: string /* Tests: deterministisch */ }
  export function buildMime(msg: OutgoingMessage, opts: BuildOptions): { bytes: Uint8Array; envelopeRecipients: string[] };  // RFC 5322, CRLF, 7-bit-sicher
  export function encodeQuotedPrintable(text: string): string;  // Zeilen ≤ 76, CRLF, „=“ escaped, Leerzeichen am Zeilenende escaped
  ```

- [ ] **Step 1: Failing Tests**

```ts
// tests/core/mime/build.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { buildMime, encodeQuotedPrintable } from "../../../src/core/mime/build";
import { validateOutgoing } from "../../../src/core/send/outgoing";
import { parseEml } from "../../../src/core/mime/parse";

const base = { from: "privat/mail", to: ["gast@example.org"], subject: "Einladung: Planung, 2026-09-01", text: "Du bist eingeladen.\nOrt: Büro." };
const opts = { sender: { address: "mail@example.net", name: "Max Muster" }, messageId: "test-0001@example.net", date: new Date("2026-08-23T13:00:00.000Z"), boundarySeed: "fixed" };

describe("encodeQuotedPrintable", () => {
  it("kodiert Umlaute und =, bricht bei 76", () => {
    expect(encodeQuotedPrintable("Grüße=")).toBe("Gr=C3=BC=C3=9Fe=3D");
    const long = encodeQuotedPrintable("a".repeat(100));
    for (const l of long.split("\r\n")) expect(l.length).toBeLessThanOrEqual(76);
  });
});
describe("buildMime", () => {
  it("Plain-Text-Mail: Header, QP-Body, Umlaut-Betreff RFC 2047", async () => {
    const { bytes, envelopeRecipients } = buildMime({ ...base, subject: "Grüße" }, opts);
    const s = new TextDecoder().decode(bytes);
    expect(s).toContain("From: Max Muster <mail@example.net>\r\n");
    expect(s).toContain("Subject: =?UTF-8?B?R3LDvMOfZQ==?=\r\n");
    expect(s).toContain("Message-ID: <test-0001@example.net>\r\n");
    expect(s).toContain("Date: Sun, 23 Aug 2026 15:00:00 +0200\r\n");
    expect(s).toContain("Content-Type: text/plain; charset=utf-8\r\n");
    expect(envelopeRecipients).toEqual(["gast@example.org"]);
    const back = await parseEml(bytes);
    expect(back.subject).toBe("Grüße"); expect(back.text?.trim()).toBe("Du bist eingeladen.\nOrt: Büro.");
  });
  it("iMIP: multipart/alternative mit text/calendar; method=REQUEST + invite.ics-Anhang", async () => {
    const ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:ev-1\r\nSUMMARY:Planung\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    const { bytes } = buildMime({ ...base, calendar: { method: "REQUEST", ics } }, opts);
    const s = new TextDecoder().decode(bytes);
    expect(s).toMatch(/Content-Type: multipart\/mixed; boundary="[^"]+"\r\n/);
    expect(s).toMatch(/Content-Type: multipart\/alternative; boundary="[^"]+"\r\n/);
    expect(s).toContain('Content-Type: text/calendar; method=REQUEST; charset=utf-8\r\n');
    expect(s).toContain('Content-Disposition: attachment; filename="invite.ics"\r\n');
    const back = await parseEml(bytes);
    expect(back.text?.trim()).toBe("Du bist eingeladen.\nOrt: Büro.");
    expect(back.attachments.map((a) => a.name)).toContain("invite.ics");
    // Golden-File: beim ersten Lauf schreiben, danach vergleichen (Review sieht Aenderungen am Format)
    const golden = "tests/fixtures/golden/imip-request.eml";
    if (!existsSync(golden)) { mkdirSync("tests/fixtures/golden", { recursive: true }); writeFileSync(golden, bytes); }
    expect(s).toBe(readFileSync(golden, "utf8"));
  });
  it("Threading-Header und bcc nur im Envelope", () => {
    const { bytes, envelopeRecipients } = buildMime({ ...base, bcc: ["hidden@example.org"], inReplyTo: "x@example.org", references: ["r@example.org", "x@example.org"] }, opts);
    const s = new TextDecoder().decode(bytes);
    expect(s).toContain("In-Reply-To: <x@example.org>\r\n");
    expect(s).toContain("References: <r@example.org> <x@example.org>\r\n");
    expect(s).not.toContain("hidden@example.org");
    expect(envelopeRecipients).toEqual(["gast@example.org", "hidden@example.org"]);
  });
});
describe("validateOutgoing", () => {
  it("ohne Empfaenger / leerer Betreff / ungueltige Adresse", () => {
    expect(validateOutgoing({ ...base, to: [] })).toEqual({ ok: false, code: "no-recipients" });
    expect(validateOutgoing({ ...base, subject: " " })).toEqual({ ok: false, code: "empty-subject" });
    expect(validateOutgoing({ ...base, to: ["kein-at"] })).toEqual({ ok: false, code: "invalid-address" });
    expect(validateOutgoing(base)).toEqual({ ok: true });
  });
});
```
`.gitignore`: `!tests/fixtures/golden/` und `!tests/fixtures/golden/*.eml` ergänzen (synthetisch erzeugt, Teil der Tests).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implementierung**

```ts
// src/core/send/outgoing.ts
export interface OutgoingMessage { from: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html?: string;
  calendar?: { method: "REQUEST" | "CANCEL" | "REPLY"; ics: string }; attachments?: { name: string; type: string; data: Uint8Array }[];
  inReplyTo?: string; references?: string[] }
export interface Sender { address: string; name: string }
export type OutgoingValidation = { ok: true } | { ok: false; code: "no-recipients" | "empty-subject" | "invalid-address" };
const ADDR = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function validateOutgoing(msg: OutgoingMessage): OutgoingValidation {
  const all = [...msg.to, ...(msg.cc ?? []), ...(msg.bcc ?? [])];
  if (all.length === 0) return { ok: false, code: "no-recipients" };
  if (!msg.subject.trim()) return { ok: false, code: "empty-subject" };
  if (all.some((a) => !ADDR.test(a))) return { ok: false, code: "invalid-address" };
  return { ok: true };
}
```
```ts
// src/core/mime/build.ts
import { encodeHeaderWord, foldHeader } from "./headers";
import type { OutgoingMessage, Sender } from "../send/outgoing";
import { sha256HexUtf8 } from "../../vendor/code-kit/sha256";

export interface BuildOptions { sender: Sender; messageId: string; date: Date; boundarySeed?: string }
const CRLF = "\r\n";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number): string => String(n).padStart(2, "0");
export function rfc5322Date(d: Date): string {
  const off = -d.getTimezoneOffset(); const sign = off >= 0 ? "+" : "-"; const a = Math.abs(off);
  return `${DAYS[d.getDay()]}, ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${sign}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
}
export function encodeQuotedPrintable(text: string): string {
  const bytes = new TextEncoder().encode(text.replace(/\r?\n/g, CRLF));
  let out = ""; let line = "";
  const flush = (soft: boolean): void => { out += line + (soft ? "=" : "") + CRLF; line = ""; };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    if (b === 13 && bytes[i + 1] === 10) { // CRLF: Leerzeichen am Zeilenende schuetzen
      if (line.endsWith(" ")) line = line.slice(0, -1) + "=20";
      flush(false); i++; continue;
    }
    const enc = (b === 61 || b < 32 || b > 126) && b !== 9 ? `=${b.toString(16).toUpperCase().padStart(2, "0")}` : String.fromCharCode(b);
    if (line.length + enc.length > 75) flush(true);
    line += enc;
  }
  if (line) out += line;
  return out;
}
function base64Lines(data: Uint8Array): string {
  let bin = ""; for (const b of data) bin += String.fromCharCode(b);
  const b64 = btoa(bin); const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join(CRLF);
}
function boundary(seed: string, n: number): string { return `=_mailstone_${sha256HexUtf8(`${seed}:${n}`).slice(0, 24)}`; }

export function buildMime(msg: OutgoingMessage, opts: BuildOptions): { bytes: Uint8Array; envelopeRecipients: string[] } {
  const seed = opts.boundarySeed ?? `${opts.messageId}:${opts.date.getTime()}`;
  const h: string[] = [];
  const fromHdr = opts.sender.name ? `${encodeHeaderWord(opts.sender.name)} <${opts.sender.address}>` : opts.sender.address;
  h.push(foldHeader("From", fromHdr), foldHeader("To", msg.to.join(", ")));
  if (msg.cc?.length) h.push(foldHeader("Cc", msg.cc.join(", ")));
  h.push(foldHeader("Subject", encodeHeaderWord(msg.subject)), `Date: ${rfc5322Date(opts.date)}`, `Message-ID: <${opts.messageId}>`);
  if (msg.inReplyTo) h.push(`In-Reply-To: <${msg.inReplyTo}>`);
  if (msg.references?.length) h.push(foldHeader("References", msg.references.map((r) => `<${r}>`).join(" ")));
  h.push("MIME-Version: 1.0", "X-Mailer: mailstone (Obsidian)");

  const textPart = `Content-Type: text/plain; charset=utf-8${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}${encodeQuotedPrintable(msg.text)}`;
  const parts: string[] = [];
  let altBody: string;
  if (msg.calendar) {
    const b1 = boundary(seed, 1);
    const cal = `Content-Type: text/calendar; method=${msg.calendar.method}; charset=utf-8${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}${encodeQuotedPrintable(msg.calendar.ics)}`;
    const htmlPart = msg.html ? `Content-Type: text/html; charset=utf-8${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}${encodeQuotedPrintable(msg.html)}` : null;
    altBody = `Content-Type: multipart/alternative; boundary="${b1}"${CRLF}${CRLF}--${b1}${CRLF}${textPart}${CRLF}${htmlPart ? `--${b1}${CRLF}${htmlPart}${CRLF}` : ""}--${b1}${CRLF}${cal}${CRLF}--${b1}--`;
    parts.push(altBody);
    parts.push(`Content-Type: application/ics; name="invite.ics"${CRLF}Content-Disposition: attachment; filename="invite.ics"${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${base64Lines(new TextEncoder().encode(msg.calendar.ics))}`);
  } else if (msg.html) {
    const b1 = boundary(seed, 1);
    const htmlPart = `Content-Type: text/html; charset=utf-8${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}${encodeQuotedPrintable(msg.html)}`;
    parts.push(`Content-Type: multipart/alternative; boundary="${b1}"${CRLF}${CRLF}--${b1}${CRLF}${textPart}${CRLF}--${b1}${CRLF}${htmlPart}${CRLF}--${b1}--`);
  } else {
    parts.push(textPart);
  }
  for (const a of msg.attachments ?? []) parts.push(`Content-Type: ${a.type}; name="${a.name}"${CRLF}Content-Disposition: attachment; filename="${a.name}"${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${base64Lines(a.data)}`);

  let body: string;
  if (parts.length === 1) body = parts[0] as string;
  else { const b0 = boundary(seed, 0); body = `Content-Type: multipart/mixed; boundary="${b0}"${CRLF}${CRLF}` + parts.map((p) => `--${b0}${CRLF}${p}${CRLF}`).join("") + `--${b0}--`; }

  const raw = `${h.join(CRLF)}${CRLF}${body}${CRLF}`;
  return { bytes: new TextEncoder().encode(raw), envelopeRecipients: [...msg.to, ...(msg.cc ?? []), ...(msg.bcc ?? [])] };
}
```
Achtung: der erste Part-Header (`Content-Type` des Bodys) steht direkt hinter den Nachrichten-Headern — genau so, wie der Code es zusammensetzt (`h.join(CRLF) + CRLF + body`), weil `body` mit seiner eigenen `Content-Type:`-Zeile beginnt.

- [ ] **Step 4: Run** → PASS (Golden-File wird angelegt; Inhalt kurz ansehen: drei Boundaries, `method=REQUEST`). Golden-File committen.
- [ ] **Step 5: Commit** `git add src/core/mime/build.ts src/core/send tests/core/mime/build.test.ts tests/fixtures/golden .gitignore && git commit -m "feat(mime): MIME-Builder fuer Versand (QP, RFC 2047, multipart/alternative mit text/calendar)"`

---

### Task 8: `core/settings.ts` — Settings-Typen, Defaults, Migration

**Files:**
- Create: `src/core/settings.ts`
- Test: `tests/core/settings.test.ts`

**Interfaces:**
- Consumes: `mergeSettings` (`src/vendor/code-kit/settings.ts`), `MailProfile`/`defaultMailProfile`.
- Produces:
  ```ts
  export interface Identity { id: string; address: string; name: string }
  export interface Account { id: string; label: string; imap: { host: string; port: number; tls: "implicit"|"starttls" }; smtp: { host: string; port: number; tls: "implicit"|"starttls" };
    username: string; secretId: string; identities: Identity[]; defaultIdentityId: string;
    folders: { inbox: string; allowlist: string; archive: string; sent?: string }; sync: { enabled: boolean; intervalMin: number } }
  export interface MailstoneSettings { schemaVersion: 1; language: "auto"|"en"|"de"; accounts: Account[]; profile: MailProfile; taskPreset: Record<string, string|number|boolean>; debugLog: boolean }
  export const DEFAULT_SETTINGS: MailstoneSettings;
  export function loadSettings(raw: unknown): MailstoneSettings;           // mergeSettings + Profil-Reparatur (fehlende Felder → Default)
  export function newAccount(id: string): Account;                         // Defaults: 993/implicit, 465/implicit, folders INBOX/Vault/Archive, sync 5 min, identities []
  export function secretIdFor(accountId: string): string;                  // "mailstone-<id>"
  ```

- [ ] **Step 1: Failing Tests**

```ts
// tests/core/settings.test.ts
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, newAccount, secretIdFor } from "../../src/core/settings";
describe("settings", () => {
  it("Defaults", () => {
    expect(DEFAULT_SETTINGS.accounts).toEqual([]);
    expect(DEFAULT_SETTINGS.profile.folder).toBe("Mail");
    expect(DEFAULT_SETTINGS.language).toBe("auto");
  });
  it("loadSettings merged unvollstaendige Daten und repariert das Profil", () => {
    const s = loadSettings({ accounts: [{ id: "a", label: "A" }], profile: { folder: "Post" } });
    expect(s.accounts[0]?.imap.port).toBe(993);
    expect(s.accounts[0]?.secretId).toBe("mailstone-a");
    expect(s.profile.folder).toBe("Post");
    expect(s.profile.fields.from).toBe("from");
  });
  it("newAccount + secretIdFor", () => {
    const a = newAccount("privat");
    expect(a.secretId).toBe(secretIdFor("privat"));
    expect(a.folders).toEqual({ inbox: "INBOX", allowlist: "Vault", archive: "Archive" });
    expect(a.smtp).toEqual({ host: "", port: 465, tls: "implicit" });
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementierung**

```ts
// src/core/settings.ts
import { mergeSettings } from "../vendor/code-kit/settings";
import { defaultMailProfile, type MailProfile } from "./mirror/profile";

export interface Identity { id: string; address: string; name: string }
export interface Account {
  id: string; label: string;
  imap: { host: string; port: number; tls: "implicit" | "starttls" }; smtp: { host: string; port: number; tls: "implicit" | "starttls" };
  username: string; secretId: string; identities: Identity[]; defaultIdentityId: string;
  folders: { inbox: string; allowlist: string; archive: string; sent?: string }; sync: { enabled: boolean; intervalMin: number };
}
export interface MailstoneSettings { schemaVersion: 1; language: "auto" | "en" | "de"; accounts: Account[]; profile: MailProfile; taskPreset: Record<string, string | number | boolean>; debugLog: boolean }

export function secretIdFor(accountId: string): string { return `mailstone-${accountId}`; }
export function newAccount(id: string): Account {
  return { id, label: id, imap: { host: "", port: 993, tls: "implicit" }, smtp: { host: "", port: 465, tls: "implicit" }, username: "", secretId: secretIdFor(id),
    identities: [], defaultIdentityId: "", folders: { inbox: "INBOX", allowlist: "Vault", archive: "Archive" }, sync: { enabled: true, intervalMin: 5 } };
}
export const DEFAULT_SETTINGS: MailstoneSettings = { schemaVersion: 1, language: "auto", accounts: [], profile: defaultMailProfile(), taskPreset: {}, debugLog: false };

export function loadSettings(raw: unknown): MailstoneSettings {
  const s = mergeSettings(DEFAULT_SETTINGS, raw);
  s.accounts = (Array.isArray(s.accounts) ? s.accounts : []).map((a) => {
    const base = newAccount(typeof (a as Partial<Account>).id === "string" ? (a as Account).id : "account");
    return mergeSettings(base, a);
  });
  s.profile = mergeSettings(defaultMailProfile(), s.profile);
  return s;
}
```
`mergeSettings`-Verhalten in `src/vendor/code-kit/settings.ts:9` prüfen (tiefes Mergen? Arrays?) — falls es Arrays ersetzt statt mergt, ist das hier gewollt (Accounts werden oben einzeln repariert).

- [ ] **Step 4: Run** → PASS. `check:pure` → grün.
- [ ] **Step 5: Commit** `git add src/core/settings.ts tests/core/settings.test.ts && git commit -m "feat(settings): Konten/Identitaeten/Profil-Typen, Defaults, Reparatur beim Laden"`

---

### Task 9: `core/mirror/plan.ts` + `obsidian/vault-notes.ts` — NotePlan und PlanExecutor

**Files:**
- Create: `src/core/mirror/plan.ts`, `src/obsidian/vault-notes.ts`
- Test: `tests/core/mirror/plan.test.ts`, `tests/obsidian/vault-notes.test.ts`

**Interfaces:**
- Consumes: `ParsedMail`, `MailProfile`, `buildDerivedFrontmatter`, `renderMessageBlock`, `mailFilename/mailFolder/emlFolder`, `newNote/mergeNote`, `zoneHash`.
- Produces:
  ```ts
  // mirror/plan.ts
  export type NotePlan =
    | { kind: "create"; path: string; emlPath: string; content: string; eml: Uint8Array; mailId: string; zoneHash: string }
    | { kind: "update"; path: string; content: string; mailId: string; zoneHash: string }
    | { kind: "skip"; path: string; mailId: string; reason: "unchanged" | "fences-missing" | "zone-edited" | "frontmatter-unparseable" }
    | { kind: "setState"; path: string; mailId: string; state: "live" | "detached" };
  export interface ExistingNote { path: string; content: string; zoneHash: string | null }
  export interface PlanInput { mail: ParsedMail; eml: Uint8Array; profile: MailProfile; source: string; syncedAt: Date; existing: ExistingNote | null; linkFor?: (id: string) => string | null; takenPaths: Set<string> /* Kollisionen → -2, -3 */ }
  export function planMailNote(input: PlanInput): NotePlan;
  // obsidian/vault-notes.ts
  export interface PlanExecutor { execute(plans: NotePlan[]): Promise<{ created: number; updated: number; skipped: NotePlan[]; stateChanged: number }> }
  export interface ZoneHashStore { get(mailId: string): string | null; set(mailId: string, hash: string): void }
  export function vaultPlanExecutor(app: App, hashes: ZoneHashStore): PlanExecutor;
  export function findMailNotes(app: App, idField: string): Map<string, TFile>;   // Index mail_id → TFile aus metadataCache
  ```

- [ ] **Step 1: Failing Tests**

```ts
// tests/core/mirror/plan.test.ts
import { describe, it, expect } from "vitest";
import { planMailNote } from "../../../src/core/mirror/plan";
import { defaultMailProfile } from "../../../src/core/mirror/profile";
import { parseEml } from "../../../src/core/mime/parse";
import { loadFixture } from "../../helpers/fixtures";

const common = async () => { const eml = loadFixture("utf8-plain"); return { mail: await parseEml(eml), eml, profile: defaultMailProfile(), source: "privat/Vault", syncedAt: new Date(0), takenPaths: new Set<string>() }; };

describe("planMailNote", () => {
  it("create: Pfade, Inhalt mit Fences, eml-Bytes", async () => {
    const p = planMailNote({ ...(await common()), existing: null });
    expect(p.kind).toBe("create");
    if (p.kind !== "create") return;
    expect(p.path).toBe("Mail/2026/2026-08-19-1432-hallo-welt.md");
    expect(p.emlPath).toBe("Mail/2026/_eml/2026-08-19-1432-hallo-welt.eml");
    expect(p.content).toContain("mail_id: utf8-plain-001@mail.example.org");
    expect(p.content).toContain("%% mailstone:begin %%\n## Nachricht");
    expect(p.eml.byteLength).toBeGreaterThan(0);
  });
  it("create: Kollision → -2", async () => {
    const c = await common(); c.takenPaths.add("Mail/2026/2026-08-19-1432-hallo-welt.md");
    const p = planMailNote({ ...c, existing: null });
    expect(p.kind === "create" && p.path).toBe("Mail/2026/2026-08-19-1432-hallo-welt-2.md");
  });
  it("update: bestehende Notiz mit bekanntem Hash → update/skip unchanged", async () => {
    const c = await common();
    const first = planMailNote({ ...c, existing: null });
    if (first.kind !== "create") throw new Error("expected create");
    const second = planMailNote({ ...c, existing: { path: first.path, content: first.content, zoneHash: first.zoneHash } });
    expect(second.kind).toBe("skip"); expect(second.kind === "skip" && second.reason).toBe("unchanged");
  });
  it("skip zone-edited, wenn Hash abweicht", async () => {
    const c = await common();
    const first = planMailNote({ ...c, existing: null });
    if (first.kind !== "create") throw new Error("expected create");
    const edited = first.content.replace("## Nachricht", "## Nachricht (editiert)");
    const p = planMailNote({ ...c, existing: { path: first.path, content: edited, zoneHash: first.zoneHash } });
    expect(p.kind === "skip" && p.reason).toBe("zone-edited");
  });
});
```
```ts
// tests/obsidian/vault-notes.test.ts
import { describe, it, expect } from "vitest";
import { vaultPlanExecutor, findMailNotes } from "../../src/obsidian/vault-notes";
// Den Obsidian-Mock aus tests/vendor/kit/obsidian-mock.ts nutzen: dort gibt es eine App-Fabrik (Name in der Datei nachlesen, z. B. `makeApp()`/`createMockApp()`) mit vault.create/createBinary/modify/read und metadataCache.getFileCache.
import { makeApp } from "../__mocks__/obsidian";

describe("vaultPlanExecutor", () => {
  it("create legt .md und .eml an und merkt den Zone-Hash", async () => {
    const app = makeApp();
    const hashes = new Map<string, string>();
    const ex = vaultPlanExecutor(app, { get: (k) => hashes.get(k) ?? null, set: (k, v) => { hashes.set(k, v); } });
    const r = await ex.execute([{ kind: "create", path: "Mail/2026/x.md", emlPath: "Mail/2026/_eml/x.eml", content: "---\nmail_id: a@x\n---\nbody", eml: new Uint8Array([1, 2]), mailId: "a@x", zoneHash: "h1" }]);
    expect(r.created).toBe(1);
    expect(await app.vault.adapter.exists("Mail/2026/x.md")).toBe(true);
    expect(await app.vault.adapter.exists("Mail/2026/_eml/x.eml")).toBe(true);
    expect(hashes.get("a@x")).toBe("h1");
  });
  it("setState aendert nur mail_state", async () => {
    const app = makeApp();
    await app.vault.create("Mail/y.md", "---\nmail_id: b@x\nmail_state: live\nup: \"[[P]]\"\n---\ntext");
    const ex = vaultPlanExecutor(app, { get: () => null, set: () => {} });
    await ex.execute([{ kind: "setState", path: "Mail/y.md", mailId: "b@x", state: "detached" }]);
    const c = await app.vault.adapter.read("Mail/y.md");
    expect(c).toContain("mail_state: detached"); expect(c).toContain('up: "[[P]]"');
  });
  it("findMailNotes indiziert ueber metadataCache", async () => {
    const app = makeApp();
    await app.vault.create("Mail/z.md", "---\nmail_id: c@x\n---\n");
    const idx = findMailNotes(app, "mail_id");
    expect(idx.get("c@x")?.path).toBe("Mail/z.md");
  });
});
```
Vor dem Schreiben `tests/vendor/kit/obsidian-mock.ts` lesen: Name der App-Fabrik, ob `vault.createBinary`, `vault.adapter.exists/read`, `fileManager.processFrontMatter` und ein aus dem Inhalt gefüllter `metadataCache.getFileCache(file).frontmatter` existieren. Fehlt `createBinary` oder `processFrontMatter`, in `tests/__mocks__/obsidian.ts` minimal ergänzen (Override-Muster wie bei `getFrontMatterInfo` dort) — **nicht** im vendorten Mock.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementierung**

```ts
// src/core/mirror/plan.ts
import type { ParsedMail } from "../mime/types";
import { buildDerivedFrontmatter } from "../render/frontmatter";
import { renderMessageBlock } from "../render/body";
import { mailFilename, mailFolder, emlFolder } from "../render/filename";
import { managedKeys, type MailProfile } from "./profile";
import { mergeNote, newNote } from "../merge/merge";

export type NotePlan =
  | { kind: "create"; path: string; emlPath: string; content: string; eml: Uint8Array; mailId: string; zoneHash: string }
  | { kind: "update"; path: string; content: string; mailId: string; zoneHash: string }
  | { kind: "skip"; path: string; mailId: string; reason: "unchanged" | "fences-missing" | "zone-edited" | "frontmatter-unparseable" }
  | { kind: "setState"; path: string; mailId: string; state: "live" | "detached" };
export interface ExistingNote { path: string; content: string; zoneHash: string | null }
export interface PlanInput { mail: ParsedMail; eml: Uint8Array; profile: MailProfile; source: string; syncedAt: Date; existing: ExistingNote | null; linkFor?: (id: string) => string | null; takenPaths: Set<string> }

function freePath(folder: string, base: string, ext: string, taken: Set<string>): string {
  let p = `${folder}/${base}.${ext}`; let n = 2;
  while (taken.has(p)) { p = `${folder}/${base}-${n}.${ext}`; n++; }
  return p;
}

export function planMailNote(input: PlanInput): NotePlan {
  const { mail, profile } = input;
  const derived = buildDerivedFrontmatter(profile, { mail, source: input.source, state: "live", syncedAt: input.syncedAt, linkFor: input.linkFor });
  const block = renderMessageBlock(mail);
  if (!input.existing) {
    const base = mailFilename(profile, mail);
    const path = freePath(mailFolder(profile, mail), base, "md", input.takenPaths);
    const emlBase = path.slice(path.lastIndexOf("/") + 1, -3);
    const emlPath = `${emlFolder(profile, mail)}/${emlBase}.eml`;
    const { content, zoneHash } = newNote(derived, profile.onCreate, block);
    return { kind: "create", path, emlPath, content, eml: input.eml, mailId: mail.id, zoneHash };
  }
  const r = mergeNote({ existing: input.existing.content, derived, managed: managedKeys(profile), block, expectedZoneHash: input.existing.zoneHash });
  if (!r.ok) return { kind: "skip", path: input.existing.path, mailId: mail.id, reason: r.code };
  if (!r.changed) return { kind: "skip", path: input.existing.path, mailId: mail.id, reason: "unchanged" };
  return { kind: "update", path: input.existing.path, content: r.content, mailId: mail.id, zoneHash: r.zoneHash };
}
```
Hinweis: `mail_synced` ändert sich mit `syncedAt` — der Test „skip unchanged" nutzt für beide Läufe dieselbe `syncedAt`, und die Spec sagt „Sync legt nur Neues an": der Aufrufer (M3) ruft `planMailNote` für bekannte Notizen **nicht** mit neuer `syncedAt` auf, sondern nur beim Re-Render-Kommando. In M1 wird `mergeNote` nur vom Import-Kommando (Re-Import derselben Datei) benutzt.

```ts
// src/obsidian/vault-notes.ts
import { normalizePath, TFile, type App } from "obsidian";
import type { NotePlan } from "../core/mirror/plan";

export interface PlanExecutor { execute(plans: NotePlan[]): Promise<{ created: number; updated: number; skipped: NotePlan[]; stateChanged: number }> }
export interface ZoneHashStore { get(mailId: string): string | null; set(mailId: string, hash: string): void }

async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = normalizePath(path).split("/"); let cur = "";
  for (const p of parts) { cur = cur ? `${cur}/${p}` : p; if (!(await app.vault.adapter.exists(cur))) await app.vault.createFolder(cur); }
}
const dirOf = (p: string): string => p.slice(0, p.lastIndexOf("/"));

export function vaultPlanExecutor(app: App, hashes: ZoneHashStore): PlanExecutor {
  return {
    async execute(plans) {
      let created = 0, updated = 0, stateChanged = 0; const skipped: NotePlan[] = [];
      for (const p of plans) {
        if (p.kind === "create") {
          await ensureFolder(app, dirOf(p.path)); await ensureFolder(app, dirOf(p.emlPath));
          await app.vault.createBinary(normalizePath(p.emlPath), p.eml.buffer.slice(p.eml.byteOffset, p.eml.byteOffset + p.eml.byteLength) as ArrayBuffer);
          await app.vault.create(normalizePath(p.path), p.content);
          hashes.set(p.mailId, p.zoneHash); created++;
        } else if (p.kind === "update") {
          const f = app.vault.getAbstractFileByPath(normalizePath(p.path));
          if (f instanceof TFile) { await app.vault.modify(f, p.content); hashes.set(p.mailId, p.zoneHash); updated++; }
        } else if (p.kind === "setState") {
          const f = app.vault.getAbstractFileByPath(normalizePath(p.path));
          if (f instanceof TFile) { await app.fileManager.processFrontMatter(f, (fm) => { fm["mail_state"] = p.state; }); stateChanged++; }
        } else skipped.push(p);
      }
      return { created, updated, skipped, stateChanged };
    },
  };
}

export function findMailNotes(app: App, idField: string): Map<string, TFile> {
  const out = new Map<string, TFile>();
  for (const f of app.vault.getMarkdownFiles()) {
    const id = app.metadataCache.getFileCache(f)?.frontmatter?.[idField];
    if (typeof id === "string" && id) out.set(id, f);
  }
  return out;
}
```
`setState` schreibt den State-Key fest als `mail_state` — in M3 wird `stateField` aus dem Profil durchgereicht (Plan-Typ bekommt dann `stateField`); für M1 genügt der Default, der Test deckt ihn.

- [ ] **Step 4: Run** → PASS. `npm run lint` → 0 Warnings (eslint-plugin-obsidianmd: `normalizePath` benutzt, `TFile`-instanceof statt Cast).
- [ ] **Step 5: Commit** `git add src/core/mirror/plan.ts src/obsidian/vault-notes.ts tests/core/mirror/plan.test.ts tests/obsidian && git commit -m "feat(mirror): NotePlan + Vault-Executor (create/update/setState, Zone-Hash-Store, Index ueber metadataCache)"`

---

### Task 10: Kommando „.eml aus Ordner importieren", Settings-Tab (M1-Teil), i18n, Verdrahtung

**Files:**
- Create: `src/obsidian/import-eml.ts`, `src/obsidian/settings-tab.ts`, `src/obsidian/notifier.ts`, `src/i18n/strings.ts`
- Modify: `src/main.ts`
- Test: `tests/obsidian/import-eml.test.ts`

**Interfaces:**
- Consumes: `parseEml`, `planMailNote`, `vaultPlanExecutor`, `findMailNotes`, `loadSettings`, `initI18n`-Muster aus calendar-notes (`src/vendor/code-kit/i18n.ts`: `defineStrings`, `setLang`, `pickLang`, `t`).
- Produces:
  ```ts
  // import-eml.ts
  export interface ImportDeps { app: App; profile: MailProfile; hashes: ZoneHashStore; now: () => Date }
  export async function importEmlFolder(deps: ImportDeps, folder: string): Promise<{ created: number; updated: number; skipped: NotePlan[]; errors: { path: string; message: string }[] }>;
  // notifier.ts
  export interface Notifier { info(key: string, ...args: (string|number)[]): void; error(key: string, ...args: (string|number)[]): void }
  export function noticeNotifier(): Notifier;   // new Notice(t(key, ...args))
  ```

- [ ] **Step 1: Failing Test**

```ts
// tests/obsidian/import-eml.test.ts
import { describe, it, expect } from "vitest";
import { importEmlFolder } from "../../src/obsidian/import-eml";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { makeApp } from "../__mocks__/obsidian";
import { loadFixture } from "../helpers/fixtures";

describe("importEmlFolder", () => {
  it("importiert alle .eml eines Vault-Ordners, zweiter Lauf ist idempotent", async () => {
    const app = makeApp();
    for (const f of ["utf8-plain", "thread-reply"]) await app.vault.createBinary(`Import/${f}.eml`, loadFixture(f).buffer);
    const hashes = new Map<string, string>();
    const deps = { app, profile: defaultMailProfile(), hashes: { get: (k: string) => hashes.get(k) ?? null, set: (k: string, v: string) => { hashes.set(k, v); } }, now: () => new Date("2026-08-23T13:00:00Z") };
    const r1 = await importEmlFolder(deps, "Import");
    expect(r1.created).toBe(2); expect(r1.errors).toEqual([]);
    expect(await app.vault.adapter.exists("Mail/2026/2026-08-19-1432-hallo-welt.md")).toBe(true);
    expect(await app.vault.adapter.exists("Mail/2026/_eml/2026-08-19-1432-hallo-welt.eml")).toBe(true);
    const r2 = await importEmlFolder(deps, "Import");
    expect(r2.created).toBe(0); expect(r2.skipped.every((p) => p.kind === "skip" && p.reason === "unchanged")).toBe(true);
  });
  it("kaputte Datei landet in errors, Rest wird importiert", async () => {
    const app = makeApp();
    await app.vault.createBinary("Import/ok.eml", loadFixture("utf8-plain").buffer);
    await app.vault.createBinary("Import/leer.eml", new ArrayBuffer(0));
    const r = await importEmlFolder({ app, profile: defaultMailProfile(), hashes: { get: () => null, set: () => {} }, now: () => new Date(0) }, "Import");
    expect(r.created).toBe(1);
    // leere Datei: parseEml liefert eine Mail ohne alles → wird als noid-Notiz angelegt ODER als Fehler gefuehrt; beides ok, aber kein Throw:
    expect(r.created + r.errors.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementierung**

```ts
// src/obsidian/import-eml.ts
import { normalizePath, TFile, type App } from "obsidian";
import { parseEml } from "../core/mime/parse";
import { planMailNote, type NotePlan } from "../core/mirror/plan";
import type { MailProfile } from "../core/mirror/profile";
import { findMailNotes, vaultPlanExecutor, type ZoneHashStore } from "./vault-notes";

export interface ImportDeps { app: App; profile: MailProfile; hashes: ZoneHashStore; now: () => Date }

export async function importEmlFolder(deps: ImportDeps, folder: string): Promise<{ created: number; updated: number; skipped: NotePlan[]; errors: { path: string; message: string }[] }> {
  const { app, profile } = deps;
  const root = normalizePath(folder);
  const files = app.vault.getFiles().filter((f) => f.extension === "eml" && (f.path === root || f.path.startsWith(`${root}/`)));
  const index = findMailNotes(app, profile.idField);
  const taken = new Set(app.vault.getFiles().map((f) => f.path));
  const plans: NotePlan[] = []; const errors: { path: string; message: string }[] = [];
  const syncedAt = deps.now();
  for (const f of files) {
    try {
      const eml = new Uint8Array(await app.vault.readBinary(f));
      const mail = await parseEml(eml);
      const ex = index.get(mail.id);
      const existing = ex instanceof TFile ? { path: ex.path, content: await app.vault.read(ex), zoneHash: deps.hashes.get(mail.id) } : null;
      const plan = planMailNote({ mail, eml, profile, source: `import/${root}`, syncedAt, existing, takenPaths: taken, linkFor: (id) => index.get(id)?.path.replace(/\.md$/, "") ?? null });
      if (plan.kind === "create") taken.add(plan.path);
      plans.push(plan);
    } catch (e) { errors.push({ path: f.path, message: e instanceof Error ? e.message : String(e) }); }
  }
  const r = await vaultPlanExecutor(app, deps.hashes).execute(plans);
  return { ...r, errors };
}
```
```ts
// src/obsidian/notifier.ts
import { Notice } from "obsidian";
import { t } from "../vendor/code-kit/i18n";
export interface Notifier { info(key: string, ...args: (string | number)[]): void; error(key: string, ...args: (string | number)[]): void }
export function noticeNotifier(): Notifier {
  return { info: (k, ...a) => { new Notice(t(k, ...a)); }, error: (k, ...a) => { new Notice(t(k, ...a), 8000); } };
}
```
```ts
// src/i18n/strings.ts  (Auszug; Keys alphabetisch je Bereich, EN kanonisch)
import { defineStrings, pickLang, setLang, type Lang } from "../vendor/code-kit/i18n";
const en = {
  "cmd.importEml.name": "Import .eml files from a vault folder",
  "import.done": "Imported {0} mails ({1} updated, {2} skipped, {3} errors)",
  "import.prompt.folder": "Vault folder containing .eml files",
  "settings.folder": "Notes folder", "settings.folder.desc": "Mail notes are created here, in a subfolder per year.",
  "settings.filename": "Filename template", "settings.filename.desc": "Placeholders: {date}, {time}, {slug}, {year}",
  "settings.language": "Language", "settings.language.auto": "Automatic",
  "settings.yearSubfolder": "Subfolder per year",
};
const de: typeof en = {
  "cmd.importEml.name": ".eml-Dateien aus einem Vault-Ordner importieren",
  "import.done": "{0} Mails importiert ({1} aktualisiert, {2} übersprungen, {3} Fehler)",
  "import.prompt.folder": "Vault-Ordner mit .eml-Dateien",
  "settings.folder": "Notiz-Ordner", "settings.folder.desc": "Mail-Notizen entstehen hier, je Jahr ein Unterordner.",
  "settings.filename": "Dateinamen-Vorlage", "settings.filename.desc": "Platzhalter: {date}, {time}, {slug}, {year}",
  "settings.language": "Sprache", "settings.language.auto": "Automatisch",
  "settings.yearSubfolder": "Unterordner je Jahr",
};
export function initI18n(raw: string): void { defineStrings({ en, de }); setLang(pickLang(raw) as Lang); }
```
```ts
// src/obsidian/settings-tab.ts (M1: Ordner, Jahr-Unterordner, Dateiname-Template, Sprache — Konten folgen in M2)
import { PluginSettingTab, Setting, type App } from "obsidian";
import { t } from "../vendor/code-kit/i18n";
import type MailstonePlugin from "../main";
import { FolderSuggest } from "../vendor/kit-obsidian/folder-suggest";   // Export-Name in der vendorten Datei pruefen

export class MailstoneSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MailstonePlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this; containerEl.empty();
    const s = this.plugin.settings;
    new Setting(containerEl).setName(t("settings.language")).addDropdown((d) => d
      .addOptions({ auto: t("settings.language.auto"), en: "English", de: "Deutsch" }).setValue(s.language)
      .onChange(async (v) => { s.language = v as typeof s.language; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(t("settings.folder")).setDesc(t("settings.folder.desc")).addText((tx) => {
      new FolderSuggest(this.app, tx.inputEl);
      tx.setValue(s.profile.folder).onChange(async (v) => { s.profile.folder = v.trim() || "Mail"; await this.plugin.saveSettings(); });
    });
    new Setting(containerEl).setName(t("settings.yearSubfolder")).addToggle((tg) => tg.setValue(s.profile.yearSubfolder).onChange(async (v) => { s.profile.yearSubfolder = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(t("settings.filename")).setDesc(t("settings.filename.desc")).addText((tx) => tx.setValue(s.profile.filename).onChange(async (v) => { s.profile.filename = v.trim() || "{date}-{time}-{slug}"; await this.plugin.saveSettings(); }));
  }
}
```
```ts
// src/main.ts
import { Plugin, getLanguage } from "obsidian";
import { loadSettings, type MailstoneSettings } from "./core/settings";
import { initI18n } from "./i18n/strings";
import { t } from "./vendor/code-kit/i18n";
import { MailstoneSettingTab } from "./obsidian/settings-tab";
import { importEmlFolder } from "./obsidian/import-eml";
import { noticeNotifier } from "./obsidian/notifier";
import { FolderPromptModal } from "./obsidian/modals/folder-prompt";   // kleines Modal: ein Textfeld mit FolderSuggest + OK → Promise<string|null>

interface PersistedState { settings: MailstoneSettings; zoneHashes: Record<string, string> }

export default class MailstonePlugin extends Plugin {
  settings!: MailstoneSettings;
  zoneHashes: Record<string, string> = {};

  async onload(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PersistedState> | null;
    this.settings = loadSettings(raw?.settings ?? raw);   // Altformat-tolerant
    this.zoneHashes = raw?.zoneHashes ?? {};
    initI18n(this.settings.language === "auto" ? getLanguage() : this.settings.language);
    this.addSettingTab(new MailstoneSettingTab(this.app, this));
    const notify = noticeNotifier();
    this.addCommand({ id: "import-eml-folder", name: t("cmd.importEml.name"), callback: async () => {
      const folder = await new FolderPromptModal(this.app, t("import.prompt.folder")).open();
      if (!folder) return;
      const r = await importEmlFolder({ app: this.app, profile: this.settings.profile, hashes: { get: (k) => this.zoneHashes[k] ?? null, set: (k, v) => { this.zoneHashes[k] = v; } }, now: () => new Date() }, folder);
      await this.saveSettings();
      notify.info("import.done", r.created, r.updated, r.skipped.length, r.errors.length);
    } });
  }
  async saveSettings(): Promise<void> { await this.saveData({ settings: this.settings, zoneHashes: this.zoneHashes } satisfies PersistedState); }
}
```
`src/obsidian/modals/folder-prompt.ts`: `Modal`-Unterklasse mit `Setting` + Textfeld (+ `FolderSuggest`), Buttons OK/Abbrechen, `open(): Promise<string | null>` (resolve bei OK mit getrimmtem Wert, bei Close mit null). Muster: `SchemaFormModal` in calendar-notes (`src/obsidian/modals/`) — nur Textfeld statt Schema-Formular.

- [ ] **Step 4: Run** `npm run gate` → alles grün; `npm test` zeigt ≥ 40 Tests. Lint-Falle: `eslint-plugin-obsidianmd` verlangt Sentence case für Kommando-/Setting-Namen (EN-Strings oben sind so gesetzt) und `getLanguage()` statt `moment.locale()`.
- [ ] **Step 5: Manuelle Probe im Vault** (`OBSIDIAN_PLUGIN_DIR=<vault>/.obsidian/plugins/mailstone npm run deploy`, Plugin aktivieren): zwei Fixture-`.eml` in einen Vault-Ordner `Import/` kopieren → Kommando ausführen → Notizen unter `Mail/2026/` mit `.eml` unter `_eml/`; Backlink-Test: `in_reply_to` der `thread-reply` zeigt als Wikilink auf die Termin-Notiz, wenn `multipart-alternative` zuerst importiert wurde (beim Re-Lauf `mail.relink` — M3 — oder zweiter Import derselben Dateien). Festhalten in `docs/SMOKE.md` (Checkliste, 5 Zeilen).
- [ ] **Step 6: Commit** `git add src/main.ts src/obsidian src/i18n tests/obsidian/import-eml.test.ts docs/SMOKE.md && git commit -m "feat: Kommando .eml-Import, Settings-Tab (Ordner/Vorlage/Sprache), i18n, Verdrahtung"`

---

## Self-Review (Plan gegen Spec)

- **Spec § 1 Architektur:** Schnitt (Task 1/alle), `check-pure` (1), Builtin-Plugin + Bundle-Guard (1), domino-Stub (1), Manifest (1), Kit-Übernahmen (1) ✔. `SocketTransport`-Interface kommt in M2 (erstes Netz).
- **Spec § 2.1 Konten:** Typen/Defaults (8); Settings-UI für Konten/Secrets kommt in M2 (Spec-Meilensteine) ✔.
- **Spec § 2.2 Mail-Notiz:** zwei Artefakte (9), Ablage/Dateiname (5), Identität + Fallback-ID (2/3), Profil/Frontmatter (5), Body/Fences/Hash (4/6), Merge-Regeln 1–5 (6), Wikilink nur bei Ziel (5), Anhänge nur Metadaten (3/5), `winmail.dat`-Erkennung (3, Fixture + Typ-Normalisierung) ✔.
- **Spec § 3.3 MIME-Builder:** QP/RFC 2047/`text/calendar; method=`/`invite.ics`/Message-ID/Date/Threading/bcc-Envelope (7) ✔; SMTP-Sitzung selbst = M2.
- **Spec § 6 Tests:** Fixture-Korpus (3, Teilmenge; Rest — `header-folding`, `8bit-no-declaration`, `nested-multipart`, `duplicate-message-id`, `weird-subject-chars`, `very-long-subject`, `date-malformed` — kommt in M3 mit dem Sync, wo Duplikat-/Slug-Fälle real werden), Snapshot-Rendering (4), Merge-Regeln einzeln (6), Bundle-Guard (1), Idempotenz (10) ✔.
- **Platzhalter-Scan:** Hinweise „Signatur in Vendor-Datei prüfen" sind Verifikationsschritte mit Vertrag durch Test, keine offenen Enden ✔.
- **Typ-Konsistenz:** `ParsedMail.id`/`attachments`/`attachmentData` (2/3/5/9), `FmVal` (5/6/8), `NotePlan`-Varianten (9/10), `ZoneHashStore` (9/10), `MailProfile.idField` (5/9/10) ✔.
