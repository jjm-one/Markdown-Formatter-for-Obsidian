// SPDX-License-Identifier: LGPL-3.0-only
// Exercise the bundled CLI end to end: help, version, diagnostics, verbosity, check, format, bad args.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const cli = path.resolve("markdown-formatter-cli.cjs");
if (!fs.existsSync(cli)) throw new Error(`Bundled CLI not found: ${cli}`);

// The `import.meta.url` shim prepended to every bundle must resolve to a real
// absolute file even when the host exposes no `__filename` (Obsidian's loader
// does not on every platform). Emulate that host and check both bundles.
for (const bundle of ["main.js", cli]) {
  if (!fs.existsSync(bundle)) continue;
  const shimLine = fs
    .readFileSync(bundle, "utf8")
    .split("\n")
    .find((line) => line.startsWith("var import_meta_url = "));
  if (!shimLine) throw new Error(`${bundle}: import.meta.url shim line not found.`);
  const evalShim = new Function("require", "process", `${shimLine}\nreturn import_meta_url;`);
  const shimUrl = evalShim(createRequire(import.meta.url), process);
  const resolved =
    typeof shimUrl === "string" && shimUrl.startsWith("file://") ? fileURLToPath(shimUrl) : "";
  if (!resolved || !path.isAbsolute(resolved) || resolved === path.parse(resolved).root) {
    throw new Error(
      `${bundle}: import.meta.url shim does not resolve to a file: ${String(shimUrl)}`,
    );
  }
  createRequire(shimUrl); // must also be a valid createRequire() base
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

const help = run(["--help"]);
if (
  help.status !== 0 ||
  !help.stdout.includes("--show-errors") ||
  !help.stdout.includes("--verbosity")
) {
  throw new Error(`CLI help smoke test failed.\n${help.stdout}\n${help.stderr}`);
}

const version = run(["--version"]);
if (version.status !== 0 || !/Markdown Formatter for Obsidian \d+\.\d+\.\d+/.test(version.stdout)) {
  throw new Error(`CLI version smoke test failed.\n${version.stdout}\n${version.stderr}`);
}

const badArgs = run(["check", ".", "--not-a-real-option"]);
if (badArgs.status !== 2 || !badArgs.stderr.includes("Unknown option")) {
  throw new Error(`CLI invalid-argument smoke test failed.\n${badArgs.stdout}\n${badArgs.stderr}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdf-cli-smoke-"));
try {
  fs.writeFileSync(path.join(root, "note.md"), "#Bad\n\n|A|B|\n|-|-|\n|1|2|\n", "utf8");

  const diagnosticCheck = run(["check", root, "--show-errors"]);
  if (
    diagnosticCheck.status !== 1 ||
    !diagnosticCheck.stdout.includes("actual:") ||
    !diagnosticCheck.stdout.includes("expected:")
  ) {
    throw new Error(
      `Expected detailed check diagnostics.\n${diagnosticCheck.stdout}\n${diagnosticCheck.stderr}`,
    );
  }

  const verboseCheck = run(["check", root, "--verbose"]);
  if (verboseCheck.status !== 1 || !verboseCheck.stdout.includes("CHANGE")) {
    throw new Error(
      `Expected verbose per-file output.\n${verboseCheck.stdout}\n${verboseCheck.stderr}`,
    );
  }

  const format = run(["format", root, "--quiet"]);
  if (format.status !== 0) {
    throw new Error(
      `Expected format exit 0, got ${format.status}.\n${format.stdout}\n${format.stderr}`,
    );
  }

  const checkAfter = run(["check", root, "--quiet"]);
  if (checkAfter.status !== 0) {
    throw new Error(
      `Expected final check exit 0, got ${checkAfter.status}.\n${checkAfter.stdout}\n${checkAfter.stderr}`,
    );
  }

  console.log(
    "Bundled standalone CLI smoke test passed (help, version, diagnostics, verbosity, check, format, and invalid arguments).",
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
