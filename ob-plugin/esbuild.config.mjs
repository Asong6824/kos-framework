import esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";
import { fileURLToPath } from "node:url";

const prod = !process.argv.includes("--watch");
const watch = process.argv.includes("--watch");
const liveSyncSource = fileURLToPath(new URL("./upstream/livesync/source/", import.meta.url));
const liveSyncLib = fileURLToPath(new URL("./upstream/livesync/source/lib/src/", import.meta.url));
const disabledLiveSyncWorkerPlugin = {
  name: "kos-disabled-livesync-worker",
  setup(build) {
    build.onResolve({ filter: /^@lib\/worker\/bgWorker\.ts$/ }, () => ({
      path: `${liveSyncLib}worker/bgWorker.mock.ts`,
    }));
  },
};

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  alias: {
    "@": liveSyncSource,
    "@lib": liveSyncLib,
  },
  plugins: [
    disabledLiveSyncWorkerPlugin,
  ],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    // PouchDB uses EventEmitter during module initialization. Bundle the
    // browser-compatible `events` package so Obsidian Mobile never has to
    // resolve Node's built-in module while loading the plugin.
    ...builtins.filter((name) => name !== "events"),
  ],
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("esbuild watching...");
} else {
  await esbuild.build(options);
}
