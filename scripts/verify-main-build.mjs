// SPDX-License-Identifier: LGPL-3.0-only
// Check a rolling development snapshot's contents and version stamp (channel `main` or `develop`).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const channel = process.env.BUILD_CHANNEL?.trim() || "main";
if (channel !== "main" && channel !== "develop") {
  throw new Error(`BUILD_CHANNEL must be 'main' or 'develop', got '${channel}'.`);
}

const outputDir = path.resolve("main-build");
const manifestPath = path.join(outputDir, "manifest.json");
const buildInfoPath = path.join(outputDir, "build-info.json");
const zipName = `markdown-formatter-${channel}.zip`;
const zipPath = path.join(outputDir, zipName);

for (const file of [
  "main.js",
  "markdown-formatter-cli.cjs",
  "manifest.json",
  "styles.css",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "build-info.json",
  zipName,
]) {
  if (!fs.existsSync(path.join(outputDir, file))) {
    throw new Error(`The ${channel} development build is missing '${file}'.`);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const info = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));

// Two fixed patterns rather than one built from `channel` (no dynamic RegExp).
const versionPattern =
  channel === "develop"
    ? /^[0-9]+\.[0-9]+\.[0-9]+-(?:[0-9A-Za-z-]+\.)*develop\.[0-9]+\.[0-9a-f]{7,40}$/i
    : /^[0-9]+\.[0-9]+\.[0-9]+-(?:[0-9A-Za-z-]+\.)*main\.[0-9]+\.[0-9a-f]{7,40}$/i;
if (!versionPattern.test(manifest.version)) {
  throw new Error(
    `The ${channel} development manifest has an invalid version: ${manifest.version}`,
  );
}
if (info.channel !== channel || info.version !== manifest.version) {
  throw new Error(
    `The ${channel} development build metadata does not match the manifest version/channel.`,
  );
}
if (!/^[0-9a-f]{7,40}$/i.test(info.commit ?? "")) {
  throw new Error(`The ${channel} development build metadata is missing a valid source commit.`);
}

if (process.platform !== "win32") {
  const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    const expected = `${manifest.id}/${file}`;
    if (!entries.includes(expected))
      throw new Error(`The ${channel} development ZIP is missing ${expected}.`);
  }
}

console.log(`${channel} development build verified: ${manifest.version} (${info.commit})`);
