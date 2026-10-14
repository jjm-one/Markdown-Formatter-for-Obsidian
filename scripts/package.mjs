// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only
// Assemble the installable Obsidian plugin ZIP.
//   release   release/<id>-<version>.zip
//   snapshot  a rolling development build (BUILD_CHANNEL main|develop) under main-build/,
//             stamped with BUILD_VERSION / BUILD_SHA, plus the loose files and build-info.json.
import fs from "node:fs";
import path from "node:path";
import {
  NOTICE_FILES,
  OUTPUT_DIRS,
  packageKind,
  readJson,
  snapshotChannel,
  zipDir,
} from "./lib.mjs";

const kind = packageKind("package.mjs");
const snapshot = kind === "snapshot";
const manifest = readJson("manifest.json");
const outputDir = path.resolve(OUTPUT_DIRS[kind]);
const pluginDir = path.join(outputDir, manifest.id);
const CLI = "markdown-formatter-cli.cjs";

let channel;
let pluginManifest = manifest;
let buildInfo;
if (snapshot) {
  channel = snapshotChannel();
  const buildVersion = process.env.BUILD_VERSION?.trim();
  const buildSha = process.env.BUILD_SHA?.trim();
  if (!buildVersion) {
    throw new Error("BUILD_VERSION is required when packaging a development build.");
  }
  if (!buildSha || !/^[0-9a-f]{7,40}$/i.test(buildSha)) {
    throw new Error("BUILD_SHA must be a Git commit SHA when packaging a development build.");
  }
  pluginManifest = { ...manifest, version: buildVersion };
  buildInfo = {
    channel,
    version: buildVersion,
    baseVersion: manifest.version,
    commit: buildSha,
    run: process.env.BUILD_RUN?.trim() || null,
    repository: "https://github.com/jjm-one/Markdown-Formatter-for-Obsidian",
  };
}

for (const file of [
  "main.js",
  "manifest.json",
  "styles.css",
  ...NOTICE_FILES,
  ...(snapshot ? [CLI] : []),
]) {
  if (!fs.existsSync(file)) {
    throw new Error(`Cannot package the ${kind}: required file '${file}' does not exist.`);
  }
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(pluginDir, { recursive: true });

const manifestText = `${JSON.stringify(pluginManifest, null, 2)}\n`;
// The plugin folder Obsidian loads: main.js, manifest.json, styles.css, and the license files.
for (const target of snapshot ? [pluginDir, outputDir] : [pluginDir]) {
  for (const file of ["main.js", "styles.css", ...NOTICE_FILES]) {
    fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    fs.copyFileSync(file, path.join(target, file));
  }
  fs.writeFileSync(path.join(target, "manifest.json"), manifestText);
}
if (snapshot) {
  fs.copyFileSync(CLI, path.join(outputDir, CLI));
  fs.writeFileSync(
    path.join(outputDir, "build-info.json"),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
  );
}

const zipName = snapshot
  ? `markdown-formatter-${channel}.zip`
  : `${manifest.id}-${manifest.version}.zip`;
const zipPath = path.join(outputDir, zipName);
zipDir(outputDir, manifest.id, zipPath);

console.log(zipPath);
if (snapshot) {
  console.log(`${channel} development build: ${buildInfo.version} (${buildInfo.commit})`);
}
