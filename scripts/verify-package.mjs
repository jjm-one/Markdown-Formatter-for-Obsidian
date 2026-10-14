// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only
// Check a packaged plugin ZIP (`release` or `snapshot`): it holds exactly the plugin
// folder with the expected files, and a snapshot carries a consistent version stamp.
import fs from "node:fs";
import path from "node:path";
import {
  NOTICE_FILES,
  OUTPUT_DIRS,
  PLUGIN_FILES,
  packageKind,
  readJson,
  snapshotChannel,
  zipEntries,
} from "./lib.mjs";

const kind = packageKind("verify-package.mjs");
const outputDir = path.resolve(OUTPUT_DIRS[kind]);
const baseManifest = readJson("manifest.json");
let label = kind;
let zipPath = path.join(outputDir, `${baseManifest.id}-${baseManifest.version}.zip`);

if (kind === "snapshot") {
  const channel = snapshotChannel();
  label = `${channel} development build`;
  zipPath = path.join(outputDir, `markdown-formatter-${channel}.zip`);
  for (const file of [
    ...PLUGIN_FILES,
    ...NOTICE_FILES,
    "markdown-formatter-cli.cjs",
    "build-info.json",
  ]) {
    if (!fs.existsSync(path.join(outputDir, file))) {
      throw new Error(`The ${label} is missing '${file}'.`);
    }
  }
  const manifest = readJson(path.join(outputDir, "manifest.json"));
  const info = readJson(path.join(outputDir, "build-info.json"));
  // Two fixed patterns rather than one built from `channel` (no dynamic RegExp).
  const versionPattern =
    channel === "develop"
      ? /^[0-9]+\.[0-9]+\.[0-9]+-(?:[0-9A-Za-z-]+\.)*develop\.[0-9]+\.[0-9a-f]{7,40}$/i
      : /^[0-9]+\.[0-9]+\.[0-9]+-(?:[0-9A-Za-z-]+\.)*main\.[0-9]+\.[0-9a-f]{7,40}$/i;
  if (!versionPattern.test(manifest.version)) {
    throw new Error(`The ${label} manifest has an invalid version: ${manifest.version}`);
  }
  if (info.channel !== channel || info.version !== manifest.version) {
    throw new Error(`The ${label} metadata does not match the manifest version/channel.`);
  }
  if (!/^[0-9a-f]{7,40}$/i.test(info.commit ?? "")) {
    throw new Error(`The ${label} metadata is missing a valid source commit.`);
  }
}

if (!fs.existsSync(zipPath)) throw new Error(`The ${label} archive does not exist: ${zipPath}`);

const entries = zipEntries(zipPath);
if (entries !== null) {
  for (const file of [...PLUGIN_FILES, ...NOTICE_FILES]) {
    const expected = `${baseManifest.id}/${file}`;
    if (!entries.includes(expected)) throw new Error(`The ${label} ZIP is missing ${expected}.`);
  }
  const outside = entries.filter((entry) => !entry.startsWith(`${baseManifest.id}/`));
  if (outside.length > 0) {
    throw new Error(
      `The ${label} ZIP contains files outside ${baseManifest.id}/: ${outside.join(", ")}`,
    );
  }
}

console.log(`The ${label} archive is verified: ${path.basename(zipPath)}`);
