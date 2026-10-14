// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

/** Command-line argument parsing for the standalone CLI. */

import path from "node:path";
import { parseArgs } from "node:util";
import { errorMessage } from "../core";
import {
  REPORT_FORMATS,
  VERBOSITIES,
  type CliOptions,
  type CliVerbosity,
  type ReportFormat,
} from "./types";

const OPTIONS = {
  config: { type: "string" },
  "ignore-file": { type: "string" },
  exclude: { type: "string", multiple: true },
  "show-errors": { type: "boolean" },
  errors: { type: "boolean" },
  "max-errors": { type: "string" },
  "show-changes": { type: "boolean" },
  changes: { type: "boolean" },
  "report-file": { type: "string" },
  "report-format": { type: "string" },
  "trust-prettier-config": { type: "boolean" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  debug: { type: "boolean" },
  verbosity: { type: "string" },
} as const;

/** Parse `argv` (without `node` and script) into {@link CliOptions}; throws on unknown or malformed options. */
export function parseCliArgs(argv: string[], cwd = process.cwd()): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
  } catch (error) {
    throw new Error(`${errorMessage(error)} Run with --help for supported options.`);
  }
  const { values, positionals, tokens } = parsed;

  const [mode, workspace, unexpected] = positionals;
  if (mode !== "check" && mode !== "format") {
    throw new Error('First argument must be "check" or "format". Run with --help for usage.');
  }
  if (unexpected !== undefined) {
    throw new Error(
      `Unexpected argument: ${unexpected}. Only one workspace path may be specified.`,
    );
  }
  for (const name of ["config", "ignore-file", "report-file"] as const) {
    if (values[name]?.trim() === "") throw new Error(`--${name} requires a non-empty value.`);
  }

  // The verbosity flags override each other; the last one given wins.
  let verbosity: CliVerbosity = "normal";
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (token.name === "quiet" || token.name === "verbose" || token.name === "debug") {
      verbosity = token.name;
    } else if (token.name === "verbosity") {
      const value = token.value ?? "";
      if (!isOneOf(value, VERBOSITIES))
        throw new Error(
          `Invalid --verbosity value: ${value}. Expected quiet, normal, verbose, or debug.`,
        );
      verbosity = value;
    }
  }

  let maxDiagnostics = 20;
  const maxErrors = values["max-errors"];
  if (maxErrors !== undefined) {
    maxDiagnostics = Number(maxErrors);
    if (!/^\d+$/.test(maxErrors) || maxDiagnostics < 1 || maxDiagnostics > 1000)
      throw new Error("--max-errors must be an integer between 1 and 1000.");
  }

  let reportFormat: ReportFormat = "text";
  const format = values["report-format"];
  if (format !== undefined) {
    if (!isOneOf(format, REPORT_FORMATS))
      throw new Error(
        `Invalid --report-format value: ${format}. Expected ${REPORT_FORMATS.join(", ")}.`,
      );
    if (values["report-file"] === undefined)
      throw new Error("--report-format requires --report-file.");
    reportFormat = format;
  }

  const reportFile = values["report-file"];
  return {
    mode,
    root: path.resolve(cwd, workspace ?? "."),
    configPath: values.config,
    ignoreFilePath: values["ignore-file"],
    extraExcludes: values.exclude ?? [],
    verbosity,
    showErrors: values["show-errors"] === true || values.errors === true,
    maxDiagnostics,
    showChanges: values["show-changes"] === true || values.changes === true,
    reportFile: reportFile === undefined ? undefined : path.resolve(cwd, reportFile),
    reportFormat,
    trustPrettierConfig: values["trust-prettier-config"] === true,
  };
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}
