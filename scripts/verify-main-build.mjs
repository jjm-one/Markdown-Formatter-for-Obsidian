// SPDX-License-Identifier: LGPL-3.0-only
// Check the main-branch development snapshot's contents and version stamp.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const outputDir = path.resolve("main-build");
const manifestPath = path.join(outputDir, "manifest.json");
const buildInfoPath = path.join(outputDir, "build-info.json");
const zipPath = path.join(outputDir, "markdown-formatter-main.zip");

for (const file of [
  "main.js",
  "markdown-formatter-cli.cjs",
  "manifest.json",
  "styles.css",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "build-info.json",
  "markdown-formatter-main.zip",
]) {
  if (!fs.existsSync(path.join(outputDir, file))) {
    throw new Error(`Main development build is missing '${file}'.`);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const info = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));

if (
  !/^[0-9]+\.[0-9]+\.[0-9]+-(?:[0-9A-Za-z-]+\.)*main\.[0-9]+\.[0-9a-f]{7,40}$/i.test(
    manifest.version,
  )
) {
  throw new Error(`Main development manifest has an invalid version: ${manifest.version}`);
}
if (info.channel !== "main" || info.version !== manifest.version) {
  throw new Error("Main development build metadata does not match the manifest version/channel.");
}
if (!/^[0-9a-f]{7,40}$/i.test(info.commit ?? "")) {
  throw new Error("Main development build metadata is missing a valid source commit.");
}

if (process.platform !== "win32") {
  const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    const expected = `${manifest.id}/${file}`;
    if (!entries.includes(expected))
      throw new Error(`Main development ZIP is missing ${expected}.`);
  }
}

console.log(`Main development build verified: ${manifest.version} (${info.commit})`);
