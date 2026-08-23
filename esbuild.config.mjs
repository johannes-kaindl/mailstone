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
