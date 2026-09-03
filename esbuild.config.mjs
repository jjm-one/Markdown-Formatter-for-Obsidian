// SPDX-License-Identifier: LGPL-3.0-only

// Build the CJS bundles. Modes (argv[2]): `production` builds `main.js` + the CLI
// once, `fuzz` builds `fuzz/core.cjs` for jazzer.js, no arg watches for `npm run dev`.

import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import fs from "node:fs";

const packageVersion =
  process.env.BUILD_VERSION?.trim() || JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const mode = process.argv[2];
const production = mode === "production";

const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

// Bundled Prettier calls `createRequire(import.meta.url)` at module scope, which
// is undefined in a CJS bundle. Define it from the host module's path, falling
// back to the running executable — Obsidian does not expose `__filename` on every
// platform, and `createRequire` rejects a bare "file:///".
const IMPORT_META_URL_SHIM =
  "var import_meta_url = require('node:url').pathToFileURL(" +
  "typeof __filename !== 'undefined' && __filename ? __filename : process.execPath" +
  ").href;";
const importMetaDefine = { "import.meta.url": "import_meta_url" };

if (mode === "fuzz") {
  await esbuild.build({
    entryPoints: ["src/core/index.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    logLevel: "info",
    banner: { js: IMPORT_META_URL_SHIM },
    define: { ...importMetaDefine },
    outfile: "fuzz/core.cjs",
  });
  process.exit(0);
}

const pluginContext = await esbuild.context({
  entryPoints: ["src/plugin/main.ts"],
  bundle: true,
  platform: "node",
  external: ["obsidian", "electron", ...nodeBuiltins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  banner: { js: IMPORT_META_URL_SHIM },
  define: { ...importMetaDefine },
  outfile: "main.js",
});

const cliContext = await esbuild.context({
  entryPoints: ["src/cli/cli.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  banner: { js: IMPORT_META_URL_SHIM },
  outfile: "markdown-formatter-cli.cjs",
  define: { ...importMetaDefine, __PACKAGE_VERSION__: JSON.stringify(packageVersion) },
});

if (production) {
  await Promise.all([pluginContext.rebuild(), cliContext.rebuild()]);
  await Promise.all([pluginContext.dispose(), cliContext.dispose()]);
} else {
  await Promise.all([pluginContext.watch(), cliContext.watch()]);
}
