// SPDX-License-Identifier: LGPL-3.0-only
// Shared helpers for the packaging scripts.
import path from "node:path";
import { execFileSync } from "node:child_process";

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
