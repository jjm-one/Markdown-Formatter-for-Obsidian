// SPDX-FileCopyrightText: 2026 jjm.one
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
// absolute file even when the host exposes no `__filename`. Check both bundles.
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

// Each distributed bundle carries its own license and the third-party licenses.
for (const bundle of ["main.js", cli]) {
  if (!fs.existsSync(bundle)) continue;
  const text = fs.readFileSync(bundle, "utf8");
  if (!text.slice(0, 500).includes("SPDX-License-Identifier: LGPL-3.0-only")) {
    throw new Error(`${bundle}: license header missing.`);
  }
  if (!text.includes("Third-party software in ") || !text.includes("prettier@")) {
    throw new Error(`${bundle}: third-party licenses are not embedded.`);
  }
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

for (const args of [["--version"], ["version"]]) {
  const version = run(args);
  if (
    version.status !== 0 ||
    !/Markdown Formatter for Obsidian \d+\.\d+\.\d+/.test(version.stdout) ||
    !/^Build: {3}\w+ build/m.test(version.stdout) ||
    !version.stdout.includes("LGPL-3.0-only")
  ) {
    throw new Error(`CLI ${args[0]} smoke test failed.\n${version.stdout}\n${version.stderr}`);
  }
}

const badArgs = run(["check", ".", "--not-a-real-option"]);
if (badArgs.status !== 2 || !badArgs.stderr.includes("Unknown option")) {
  throw new Error(`CLI invalid-argument smoke test failed.\n${badArgs.stdout}\n${badArgs.stderr}`);
}

const badReportCombo = run(["check", ".", "--report-format", "gitlab"]);
if (badReportCombo.status !== 2 || !badReportCombo.stderr.includes("--report-format requires")) {
  throw new Error(
    `CLI --report-format-without-file smoke test failed.\n${badReportCombo.stdout}\n${badReportCombo.stderr}`,
  );
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

  const changesCheck = run(["check", root, "--show-changes"]);
  if (changesCheck.status !== 1 || !/\n {2}line \d+.*: .+/.test(changesCheck.stdout)) {
    throw new Error(
      `Expected a descriptive change list.\n${changesCheck.stdout}\n${changesCheck.stderr}`,
    );
  }

  for (const format of ["text", "json", "gitlab", "sarif"]) {
    const reportPath = path.join(root, `report.${format}`);
    const reportRun = run([
      "check",
      root,
      "--quiet",
      "--report-file",
      reportPath,
      "--report-format",
      format,
    ]);
    if (reportRun.status !== 1 || !fs.existsSync(reportPath)) {
      throw new Error(
        `Expected a ${format} report to be written.\n${reportRun.stdout}\n${reportRun.stderr}`,
      );
    }
    const contents = fs.readFileSync(reportPath, "utf8");
    if (format !== "text") JSON.parse(contents); // throws if malformed
    if (format === "gitlab" && !Array.isArray(JSON.parse(contents))) {
      throw new Error("Expected the gitlab report to be a bare JSON array.");
    }
    if (format === "sarif" && !contents.includes('"version": "2.1.0"')) {
      throw new Error("Expected the sarif report to declare version 2.1.0.");
    }
  }

  // Prettier configuration that can run code is refused unless trusted. Checked on
  // the minified bundle, since the check relies on Prettier's bundled YAML parser.
  const evil =
    'require("node:fs").writeFileSync(__dirname + "/PWNED", "ran"); module.exports = {};';
  for (const [configName, configText] of [
    ["prettier.config.cjs", evil],
    [".prettierrc", "./evil.cjs\n"],
  ]) {
    const trustRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdf-cli-trust-"));
    try {
      fs.writeFileSync(path.join(trustRoot, "note.md"), "# Hi\n", "utf8");
      fs.writeFileSync(path.join(trustRoot, "evil.cjs"), evil, "utf8");
      fs.writeFileSync(path.join(trustRoot, configName), configText, "utf8");
      const refused = run(["check", trustRoot]);
      if (
        refused.status !== 2 ||
        !refused.stderr.includes("can run code") ||
        fs.existsSync(path.join(trustRoot, "PWNED"))
      ) {
        throw new Error(
          `Expected ${configName} to be refused without running.\n${refused.stdout}\n${refused.stderr}`,
        );
      }
      const trusted = run(["check", trustRoot, "--trust-prettier-config"]);
      if (trusted.status !== 0 || !fs.existsSync(path.join(trustRoot, "PWNED"))) {
        throw new Error(
          `Expected a trusted ${configName} to load.\n${trusted.stdout}\n${trusted.stderr}`,
        );
      }
    } finally {
      fs.rmSync(trustRoot, { recursive: true, force: true });
    }
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
    "Bundled standalone CLI smoke test passed (license notices, help, version, diagnostics, change reports, Prettier trust, verbosity, check, format, and invalid arguments).",
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
