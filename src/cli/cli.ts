#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-only

/** Process entrypoint for the standalone CLI: parse argv, run, print, set the exit code. */

import { promises as fs } from "node:fs";
import process from "node:process";
import { cliExitCode, errorMessage, parseCliArgs, renderResult, runStandalone } from "./cli-lib";
import { printChanges, renderReport, REPORT_FORMATS } from "./report";

/** Injected by esbuild at build time from `package.json`. */
declare const __PACKAGE_VERSION__: string;
const VERSION = __PACKAGE_VERSION__;
const NAME = "Markdown Formatter for Obsidian";
const TOOL_ID = "markdown-formatter";
const INFORMATION_URI = "https://github.com/jjm-one/Markdown-Formatter-for-Obsidian";

function printHelp(): void {
  console.log(`${NAME} ${VERSION}

Usage:
  markdown-formatter <check|format> [workspace] [options]
  markdown-formatter --help
  markdown-formatter --version

Modes:
  check    Validate Markdown without modifying files.
           Exit 1 when formatting changes are required.
  format   Format Markdown files in place using atomic replacement.

Options:
  --config <path>          Project config relative to workspace
                           (default: .markdown-formatter.json)
  --ignore-file <path>     Ignore file relative to workspace
  --exclude <pattern>      Add an ignore pattern; repeatable
  --show-errors, --errors  In check mode, show line-level differences
  --max-errors <n>         Maximum differences shown per file (1-1000; default: 20)
  --show-changes, --changes
                           Show a descriptive list of required changes
                           (e.g. "line 12: Remove trailing whitespace.")
  --report-file <path>     Write a change report to this file
  --report-format <fmt>    Report format: ${REPORT_FORMATS.join(" | ")} (default: text)
                           gitlab = Code Quality report; sarif = GitHub code scanning
  -q, --quiet              Only print final status and failures
  --verbose                Print every processed file
  --debug                  Print resolved paths/options plus verbose output
  --verbosity <level>      quiet | normal | verbose | debug
  -h, --help               Show this help
  -V, --version            Show version information

Examples:
  markdown-formatter check .
  markdown-formatter check ./vault --show-errors
  markdown-formatter check . --show-changes
  markdown-formatter check . --report-file gl-code-quality-report.json --report-format gitlab
  markdown-formatter check . --report-file formatter.sarif --report-format sarif
  markdown-formatter check . --verbosity verbose
  markdown-formatter format . --exclude "Archive/**"

Exit codes:
  0  Success; check mode found no formatting changes
  1  Check mode found files that need formatting
  2  Invalid input, configuration, filesystem, or formatter error

Configuration:
  The CLI uses the same .markdown-formatter.json, ignore file,
  .editorconfig, Prettier configuration, and Obsidian-preservation rules
  as the desktop plugin.`);
}

function printVersion(): void {
  console.log(`${NAME} ${VERSION}`);
  console.log(`Node ${process.versions.node}`);
}

async function main(): Promise<void> {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (!Number.isSafeInteger(nodeMajor) || nodeMajor < 24) {
    console.error(
      `${NAME} ${VERSION} requires Node.js 24 or newer; current runtime is ${process.versions.node}.`,
    );
    process.exitCode = 2;
    return;
  }

  const args = process.argv.slice(2);
  if (args.length === 0) {
    printHelp();
    process.exitCode = 2;
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args.includes("--version") || args.includes("-V")) {
    printVersion();
    return;
  }

  try {
    const options = parseCliArgs(args);
    if (options.verbosity === "debug") {
      console.log(`[debug] mode: ${options.mode}`);
      console.log(`[debug] workspace: ${options.root}`);
      console.log(`[debug] config override: ${options.configPath ?? "(default)"}`);
      console.log(`[debug] ignore override: ${options.ignoreFilePath ?? "(config/default)"}`);
      console.log(
        `[debug] extra excludes: ${options.extraExcludes.length ? options.extraExcludes.join(", ") : "(none)"}`,
      );
      console.log(
        `[debug] report file: ${options.reportFile ?? "(none)"} (format: ${options.reportFormat})`,
      );
    }
    const result = await runStandalone(options);
    renderResult(result, options.mode, options.verbosity, options.showErrors);
    if (options.showChanges) printChanges(result, options.verbosity);

    let exitCode = cliExitCode(options.mode, result);
    if (options.reportFile !== undefined) {
      try {
        const report = renderReport(result, options.mode, options.reportFormat, {
          toolName: TOOL_ID,
          toolVersion: VERSION,
          informationUri: INFORMATION_URI,
        });
        await fs.writeFile(options.reportFile, report, "utf8");
        if (options.verbosity !== "quiet") {
          console.log(`Report written to ${options.reportFile} (${options.reportFormat}).`);
        }
      } catch (error) {
        console.error(`${NAME}: could not write report file: ${errorMessage(error)}`);
        exitCode = Math.max(exitCode, 2);
      }
    }
    process.exitCode = exitCode;
  } catch (error) {
    console.error(`${NAME}: ${errorMessage(error)}`);
    console.error("Run with --help for usage information.");
    process.exitCode = 2;
  }
}

void main().catch((error: unknown) => {
  console.error(`${NAME}: unexpected fatal error: ${errorMessage(error)}`);
  process.exitCode = 2;
});
