// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

/** Console output of a standalone run: per-file lines, diagnostics, change lists, failures, summary. */

import { CHANGE_LEGEND, fileHeading, formatChangeDetail, summarizeCounts } from "./report";
import type { CliFileStatus, CliMode, CliResult, CliVerbosity } from "./types";

const VERBOSE_STATUS_MARKERS: Record<CliFileStatus, string> = {
  unchanged: "OK",
  failed: "ERROR",
  formatted: "FORMATTED",
  "needs-formatting": "CHANGE",
};

/** Print the per-file lines, `--show-errors` diagnostics, `--show-changes` list, failures, and the run summary. */
export function renderResult(
  result: CliResult,
  mode: CliMode,
  verbosity: CliVerbosity,
  showErrors: boolean,
  showChanges = false,
): void {
  const verbose = verbosity === "verbose" || verbosity === "debug";
  const normal = verbosity !== "quiet";

  if (verbosity === "debug") {
    console.log(`[debug] workspace config: ${result.configFile}`);
    console.log(`[debug] ignore file: ${result.ignoreFile}`);
  }

  if (verbose) {
    for (const entry of result.entries) {
      console.log(`${VERBOSE_STATUS_MARKERS[entry.status].padEnd(9)} ${entry.file}`);
    }
  } else if (normal) {
    for (const entry of result.entries) {
      if (entry.status === "needs-formatting") console.log(`needs formatting  ${entry.file}`);
      if (entry.status === "formatted") console.log(`formatted         ${entry.file}`);
    }
  }

  if (showErrors && mode === "check" && normal) printDiagnostics(result);
  if (showChanges && normal && printChanges(result, mode)) console.log("");

  for (const failure of result.failures) {
    const location = failure.file ? ` ${failure.file}` : "";
    console.error(`ERROR [${failure.stage}]${location}: ${failure.message}`);
  }

  const status =
    result.failed > 0
      ? "FAILED"
      : mode === "check" && result.changed > 0
        ? "CHANGES REQUIRED"
        : "OK";
  console.log(`${status}: ${summarizeCounts(result, mode)}`);
}

/** The compact `--show-errors` listing: location, description, and the current/expected text. */
function printDiagnostics(result: CliResult): void {
  for (const entry of result.entries) {
    if (entry.status !== "needs-formatting" || entry.diagnostics.length === 0) continue;
    console.log(`\n${entry.file}`);
    for (const diagnostic of entry.diagnostics) {
      if (diagnostic.location === "") {
        console.log(`  … ${diagnostic.message}`);
        continue;
      }
      console.log(`  ${diagnostic.location}: ${diagnostic.message}`);
      if (diagnostic.actual !== undefined)
        console.log(`    actual:   ${JSON.stringify(diagnostic.actual)}`);
      if (diagnostic.expected !== undefined)
        console.log(`    expected: ${JSON.stringify(diagnostic.expected)}`);
    }
  }
}

/** The full `--show-changes` list; returns whether anything was printed. */
function printChanges(result: CliResult, mode: CliMode): boolean {
  const withChanges = result.entries.filter((entry) => (entry.changes?.length ?? 0) > 0);
  if (withChanges.length === 0) return false;
  console.log(`\n${CHANGE_LEGEND}`);
  for (const entry of withChanges) {
    console.log(`\n${fileHeading(entry, mode)}`);
    for (const change of entry.changes ?? []) {
      for (const line of formatChangeDetail(change)) console.log(line);
    }
  }
  return true;
}
