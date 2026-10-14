// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

// Build the CJS bundles. Modes (argv[2]):
//   production  build `main.js` and the CLI once, minified, with license notices
//   fuzz        build `fuzz/core.cjs` for jazzer.js
//   (none)      watch both bundles for `npm run dev`

import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { bundledPackages, legalComment, renderLicenses } from "./scripts/third-party-licenses.mjs";

const PRODUCT = "Markdown Formatter for Obsidian";
const THIRD_PARTY_LICENSES = "THIRD_PARTY_LICENSES.txt";
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const packageVersion = process.env.BUILD_VERSION?.trim() || packageJson.version;
const mode = process.argv[2];
const production = mode === "production";

/** Output of a git command, or null outside a repository. */
function git(...args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// Shown by the CLI's `--version` and the plugin's settings tab. CI sets
// BUILD_CHANNEL/BUILD_SHA for rolling builds and RELEASE_TAG for releases.
const commit = process.env.BUILD_SHA?.trim() || git("rev-parse", "HEAD");
const dirty = !process.env.BUILD_SHA && commit !== null && git("status", "--porcelain") !== "";
const buildInfo = {
  version: packageVersion,
  channel:
    process.env.BUILD_CHANNEL?.trim() ||
    (process.env.RELEASE_TAG ? "release" : process.env.CI ? "ci" : "local"),
  commit: commit ? `${commit.slice(0, 12)}${dirty ? "-dirty" : ""}` : null,
  date: commit ? git("show", "-s", "--format=%cI", commit) : null,
};
const buildDefine = { __BUILD_INFO__: JSON.stringify(buildInfo) };

const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

// Bundled Prettier calls `createRequire(import.meta.url)` at module scope, which
// is undefined in a CJS bundle. Point it at the host module, or the running
// executable when the loader does not expose `__filename`.
const IMPORT_META_URL_SHIM =
  "var import_meta_url = require('node:url').pathToFileURL(" +
  "typeof __filename !== 'undefined' && __filename ? __filename : process.execPath" +
  ").href;";
const importMetaDefine = { "import.meta.url": "import_meta_url" };

// Every distributed bundle names its license; production bundles also end with
// the licenses of the third-party code compiled into them.
const LICENSE_HEADER = legalComment(
  `${PRODUCT} ${packageVersion}\n` +
    `Copyright (C) 2026 ${packageJson.author}\n` +
    "SPDX-License-Identifier: LGPL-3.0-only\n" +
    `Source and license texts: ${packageJson.homepage.replace(/#.*$/, "")}\n` +
    "Third-party licenses: at the end of this file and in THIRD_PARTY_LICENSES.txt\n",
);

if (mode === "fuzz") {
  await esbuild.build({
    entryPoints: ["src/core/index.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    logLevel: "info",
    banner: { js: IMPORT_META_URL_SHIM },
    define: { ...importMetaDefine },
    outfile: "fuzz/core.cjs",
  });
  process.exit(0);
}

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  metafile: production,
  treeShaking: true,
  banner: { js: `${LICENSE_HEADER}${IMPORT_META_URL_SHIM}` },
};

const pluginContext = await esbuild.context({
  ...shared,
  entryPoints: ["src/plugin/main.ts"],
  external: ["obsidian", "electron", ...nodeBuiltins],
  target: "es2022",
  define: { ...importMetaDefine, ...buildDefine },
  outfile: "main.js",
});

const cliContext = await esbuild.context({
  ...shared,
  entryPoints: ["src/cli/cli.ts"],
  target: "node24",
  define: { ...importMetaDefine, ...buildDefine },
  outfile: "markdown-formatter-cli.cjs",
});

if (production) {
  const results = await Promise.all([pluginContext.rebuild(), cliContext.rebuild()]);
  await Promise.all([pluginContext.dispose(), cliContext.dispose()]);

  // Ship the third-party licenses inside each bundle (it is often downloaded on
  // its own) and as a separate file for the release assets and plugin ZIP.
  const licenses = renderLicenses(
    bundledPackages(results.map((result) => result.metafile)),
    PRODUCT,
  );
  fs.writeFileSync(THIRD_PARTY_LICENSES, licenses);
  for (const bundle of ["main.js", "markdown-formatter-cli.cjs"]) {
    fs.appendFileSync(bundle, legalComment(licenses));
  }
  console.log(`Wrote ${THIRD_PARTY_LICENSES} and appended it to both bundles.`);
} else {
  await Promise.all([pluginContext.watch(), cliContext.watch()]);
}
