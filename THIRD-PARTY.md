# Third-Party Notices

This file lists code bundled into `main.js` (or used at test/build time) that is not written
for this repository, and the licenses that apply to it.

## Runtime dependencies (bundled)

### postal-mime — MIT-0

- Package: [`postal-mime`](https://www.npmjs.com/package/postal-mime), currently `^3.0.0`
  (installed: 3.0.0).
- Upstream: <https://github.com/postalsys/postal-mime>
- License: [MIT No Attribution (MIT-0)](https://opensource.org/license/mit-0).
- Used to parse RFC 822/MIME messages into a structured object (headers, body, attachments).

### turndown — MIT

- Package: [`turndown`](https://www.npmjs.com/package/turndown), currently `^7.2.4`
  (installed: 7.2.4).
- Upstream: <https://github.com/mixmark-io/turndown>
- License: MIT.
- Used to convert HTML mail bodies to Markdown for note content.

### @mixmark-io/domino — BSD-2-Clause (test/Node only, not bundled)

- Package: [`@mixmark-io/domino`](https://www.npmjs.com/package/@mixmark-io/domino), pulled in
  transitively by `turndown` (installed: 2.2.0).
- Upstream: <https://github.com/mixmark-io/domino>
- License: BSD-2-Clause.
- `turndown` only reaches for `domino` when no global `document` exists — that is the case
  under Vitest (Node), never inside Obsidian's renderer (which always has a `document`).
  `esbuild.config.mjs` stubs `@mixmark-io/domino` out of the bundle (`dominoStub` plugin), so
  it never ships in `main.js`; it is only ever loaded from `node_modules` during `npm test`.

## Vendored source (copied into the tree, not an npm dependency)

`src/vendor/kit/` and `src/vendor/kit-obsidian/` contain modules copied from
[`obsidian-kit`](https://github.com/johannes-kaindl) — the maintainer's own shared library for
Obsidian plugins in this workspace (`obsidian-kit@0.28.0`, see `VENDOR.json` next to each
file for the exact commit and vendoring date; `tools/sync-kit.sh` re-vendors them). Both the
source library and this plugin are authored by Johannes Kaindl and licensed
AGPL-3.0-or-later, so no separate license section applies — see [`LICENSE`](LICENSE).

Files: `src/vendor/kit/vault-path.ts`, `src/vendor/kit/frontmatter.ts`,
`src/vendor/kit-obsidian/confirm.ts`, `src/vendor/kit-obsidian/settings_walker.ts`,
`src/vendor/kit-obsidian/folder-suggest.ts`, `tests/vendor/kit/obsidian-mock.ts`.

`src/vendor/code-kit/` contains modules copied from `code-kit` (`code-kit@0.1.0`, see
`src/vendor/code-kit/VENDOR.json` for the exact commit and vendoring date) — the maintainer's
shared, platform-neutral module library for the whole `code/` workspace (source at
`/Users/Shared/code/code-kit`, not published to a public remote at time of writing). Like
`obsidian-kit`, it is authored by Johannes Kaindl and licensed AGPL-3.0-or-later (see its
`package.json`/`LICENSE`), so no separate license section applies here either — see
[`LICENSE`](LICENSE).

Files: `src/vendor/code-kit/filename-template.ts`, `src/vendor/code-kit/i18n.ts`,
`src/vendor/code-kit/settings.ts`, `src/vendor/code-kit/sha256.ts`,
`src/vendor/code-kit/timeout.ts`.

## Build/test tooling (not bundled)

Development dependencies (esbuild, TypeScript, ESLint, Vitest, and their transitive
dependencies) are not part of the distributed `main.js`/`manifest.json`/`styles.css` and are
not listed here individually; see `package.json` and `package-lock.json` for the full tree.
