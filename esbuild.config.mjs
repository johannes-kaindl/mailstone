// uebernommen aus calendar-notes/esbuild.config.mjs, 2026-08-23 — ergaenzt um:
// (a) node-builtin-require kommt aus dem Kit (scripts/vendor/node-builtin-require.mjs, Registry § Node-Builtin desktop-only),
// (b) Stub fuer @mixmark-io/domino: turndown nutzt domino nur, wenn kein `document` existiert —
//     im Obsidian-Renderer gibt es eines; in vitest (node) wird domino aus node_modules geladen.
import esbuild from "esbuild";
import { nodeBuiltinRequire } from "./scripts/vendor/node-builtin-require.mjs";

const prod = process.argv.includes("--production");

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
