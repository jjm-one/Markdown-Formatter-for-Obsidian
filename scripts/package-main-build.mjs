// SPDX-License-Identifier: LGPL-3.0-only
// Assemble a rolling development snapshot (channel `main` or `develop`) under main-build/.
import fs from "node:fs";
import path from "node:path";
import { zipDir } from "./lib.mjs";

const baseManifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const buildVersion = process.env.BUILD_VERSION?.trim();
const buildSha = process.env.BUILD_SHA?.trim();
const buildRun = process.env.BUILD_RUN?.trim() || null;
const channel = process.env.BUILD_CHANNEL?.trim() || "main";

if (channel !== "main" && channel !== "develop") {
  throw new Error(`BUILD_CHANNEL must be 'main' or 'develop', got '${channel}'.`);
}
if (!buildVersion) {
  throw new Error("BUILD_VERSION is required when packaging a development build.");
}
if (!buildSha || !/^[0-9a-f]{7,40}$/i.test(buildSha)) {
  throw new Error("BUILD_SHA must be a Git commit SHA when packaging a development build.");
}

const outputDir = path.resolve("main-build");
const pluginDir = path.join(outputDir, baseManifest.id);
const requiredFiles = ["main.js", "markdown-formatter-cli.cjs", "styles.css"];
const documentationFiles = ["LICENSE", "THIRD_PARTY_NOTICES.md"];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    throw new Error(`Cannot package the ${channel} build: required file '${file}' does not exist.`);
  }
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(pluginDir, { recursive: true });

const snapshotManifest = {
  ...baseManifest,
  version: buildVersion,
};

fs.copyFileSync("main.js", path.join(outputDir, "main.js"));
fs.copyFileSync("markdown-formatter-cli.cjs", path.join(outputDir, "markdown-formatter-cli.cjs"));
fs.copyFileSync("styles.css", path.join(outputDir, "styles.css"));
fs.writeFileSync(
  path.join(outputDir, "manifest.json"),
  `${JSON.stringify(snapshotManifest, null, 2)}\n`,
);

for (const file of documentationFiles) {
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(outputDir, path.basename(file)));
}

for (const file of ["main.js", "styles.css", ...documentationFiles]) {
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(pluginDir, path.basename(file)));
}
fs.writeFileSync(
  path.join(pluginDir, "manifest.json"),
  `${JSON.stringify(snapshotManifest, null, 2)}\n`,
);

const buildInfo = {
  channel,
  version: buildVersion,
  baseVersion: baseManifest.version,
  commit: buildSha,
  run: buildRun,
  repository: "https://github.com/jjm-one/Markdown-Formatter-for-Obsidian",
};
fs.writeFileSync(
  path.join(outputDir, "build-info.json"),
  `${JSON.stringify(buildInfo, null, 2)}\n`,
);

const zipPath = path.join(outputDir, `markdown-formatter-${channel}.zip`);
zipDir(outputDir, baseManifest.id, zipPath);

console.log(`${channel} development build packaged: ${zipPath}`);
console.log(`Development version: ${buildVersion}`);
console.log(`Source commit: ${buildSha}`);
