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

`src/vendor/kit/`, `src/vendor/kit-obsidian/`, `src/vendor/code-kit/`, `tests/vendor/kit/` and `scripts/vendor/` contain files copied from two of the maintainer's own shared libraries: [`obsidian-kit`](https://git.jkaindl.de/jkaindl/obsidian-kit) (for Obsidian plugins) and `code-kit` (a platform-neutral module library for the whole workspace, kept locally, not published to a public remote at time of writing). Both libraries and this plugin are authored by Johannes Kaindl and licensed AGPL-3.0-or-later (see their `package.json`/`LICENSE`), so no separate license section applies here — see [`LICENSE`](LICENSE).

What was copied, from which library version and commit, and when is written down next to the files, not here: every one of these folders carries a `VENDOR.json` with the library, its version, the commit and the list of copied files. `tools/kit-sync.json` says which modules come from which library at which tag, and `tools/sync-kit.sh` re-vendors them (a second run changes nothing). `scripts/vendor/` holds a build helper (an esbuild plugin) that is never part of the bundle.

## Build/test tooling (not bundled)

Development dependencies (esbuild, TypeScript, ESLint, Vitest, and their transitive
dependencies) are not part of the distributed `main.js`/`manifest.json`/`styles.css` and are
not listed here individually; see `package.json` and `package-lock.json` for the full tree.
