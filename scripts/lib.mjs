// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only
// Shared helpers for the packaging scripts.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Files Obsidian loads from the plugin folder; every plugin ZIP contains exactly these plus notices. */
export const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];
/**
 * License files shipped next to the plugin files: this project's LGPL (LICENSE),
 * the GPL it incorporates, and the third-party licenses the production build
 * generates (THIRD_PARTY_LICENSES.txt).
 */
export const NOTICE_FILES = [
  "LICENSE",
  "LICENSES/GPL-3.0-only.txt",
  "LICENSES/LGPL-3.0-only.txt",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_LICENSES.txt",
];

/** Output folders: a versioned `release`, or a rolling `snapshot` development build. */
export const OUTPUT_DIRS = { release: "release", snapshot: "main-build" };

export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** `process.argv[2]`, which must be `release` or `snapshot`. */
export function packageKind(script) {
  const kind = process.argv[2];
  if (kind !== "release" && kind !== "snapshot") {
    throw new Error(`Usage: node scripts/${script} <release|snapshot>`);
  }
  return kind;
}

/** The development-build channel from BUILD_CHANNEL (`main` or `develop`, default `main`). */
export function snapshotChannel() {
  const channel = process.env.BUILD_CHANNEL?.trim() || "main";
  if (channel !== "main" && channel !== "develop") {
    throw new Error(`BUILD_CHANNEL must be 'main' or 'develop', got '${channel}'.`);
  }
  return channel;
}

/** Zip `entryName` (a folder directly under `archiveRoot`) into `zipPath`. */
export function zipDir(archiveRoot, entryName, zipPath) {
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${path.join(archiveRoot, entryName, "*")}' -DestinationPath '${zipPath}' -Force`,
      ],
      { stdio: "inherit" },
    );
  } else {
    execFileSync("zip", ["-q", "-r", zipPath, entryName], { cwd: archiveRoot, stdio: "inherit" });
  }
}

/** Entry names in a ZIP, or `null` on Windows (no `unzip` there). */
export function zipEntries(zipPath) {
  if (process.platform === "win32") return null;
  return execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
}
