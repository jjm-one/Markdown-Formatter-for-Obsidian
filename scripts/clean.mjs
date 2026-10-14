// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only
// Remove build and packaging output.
import fs from "node:fs/promises";

for (const target of [
  "main.js",
  "markdown-formatter-cli.cjs",
  "THIRD_PARTY_LICENSES.txt",
  "fuzz/core.cjs",
  "fuzz/.corpus-local",
  "coverage",
  "release",
  "main-build",
]) {
  await fs.rm(target, { recursive: true, force: true });
}
