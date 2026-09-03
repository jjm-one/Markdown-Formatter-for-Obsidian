// SPDX-License-Identifier: LGPL-3.0-only
// Assemble the installable Obsidian plugin ZIP under release/.
import fs from "node:fs";
import path from "node:path";
import { zipDir } from "./lib.mjs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const releaseDir = path.resolve("release");
const pluginDir = path.join(releaseDir, manifest.id);
const requiredFiles = ["main.js", "manifest.json", "styles.css"];
const documentationFiles = ["LICENSE", "THIRD_PARTY_NOTICES.md"];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    throw new Error(`Cannot package release: required file '${file}' does not exist.`);
  }
}

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(pluginDir, { recursive: true });

for (const file of [...requiredFiles, ...documentationFiles]) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(pluginDir, path.basename(file)));
  }
}

const zipPath = path.join(releaseDir, `${manifest.id}-${manifest.version}.zip`);
zipDir(releaseDir, manifest.id, zipPath);

console.log(zipPath);
