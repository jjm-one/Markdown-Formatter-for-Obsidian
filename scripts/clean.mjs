// SPDX-License-Identifier: LGPL-3.0-only
// Remove build and packaging output.
import fs from "node:fs/promises";

for (const target of [
  "main.js",
  "markdown-formatter-cli.cjs",
  "fuzz/core.cjs",
  "coverage",
  "release",
  "main-build",
]) {
  await fs.rm(target, { recursive: true, force: true });
}
