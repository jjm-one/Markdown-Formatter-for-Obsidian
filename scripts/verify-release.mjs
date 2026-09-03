// SPDX-License-Identifier: LGPL-3.0-only
// Check that the release ZIP contains exactly the expected plugin files.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const zipPath = path.resolve("release", `${manifest.id}-${manifest.version}.zip`);

if (!fs.existsSync(zipPath)) {
  throw new Error(`Release archive does not exist: ${zipPath}`);
}

if (process.platform === "win32") {
  console.log(`Release archive exists: ${zipPath}`);
  process.exit(0);
}

const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  const expected = `${manifest.id}/${file}`;
  if (!entries.includes(expected)) {
    throw new Error(`Release archive is missing ${expected}.`);
  }
}

const unexpectedRootFiles = entries.filter((entry) => !entry.startsWith(`${manifest.id}/`));
if (unexpectedRootFiles.length > 0) {
  throw new Error(
    `Release archive contains files outside ${manifest.id}/: ${unexpectedRootFiles.join(", ")}`,
  );
}

console.log(`Release archive verified: ${path.basename(zipPath)}`);
