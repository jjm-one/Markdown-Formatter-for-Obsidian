// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

/** Shared data shapes of the standalone CLI: options in, per-file results and run summary out. */

import type { FormattingChange, FormattingDiagnostic } from "./changes";

export type { FormattingChange, FormattingDiagnostic };

export type CliMode = "check" | "format";

export const VERBOSITIES = ["quiet", "normal", "verbose", "debug"] as const;
export type CliVerbosity = (typeof VERBOSITIES)[number];

export const REPORT_FORMATS = ["text", "json", "gitlab", "sarif"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export interface CliOptions {
  mode: CliMode;
  root: string;
  configPath?: string;
  ignoreFilePath?: string;
  extraExcludes: string[];
  verbosity: CliVerbosity;
  showErrors: boolean;
  maxDiagnostics: number;
  showChanges: boolean;
  reportFile?: string;
  reportFormat: ReportFormat;
  /** Allow Prettier configuration that can run code (JS/TS configs, shared configs, plugins). */
  trustPrettierConfig?: boolean;
}

export type CliFileStatus = "unchanged" | "needs-formatting" | "formatted" | "failed";

export interface CliFileResult {
  file: string;
  status: CliFileStatus;
  diagnostics: FormattingDiagnostic[];
  /** Every required change, described and with exact lines; populated when `--show-changes`, `--show-errors`, or `--report-file` is set. */
  changes?: FormattingChange[];
}

export interface CliFailure {
  file?: string;
  stage: "read" | "format" | "write";
  message: string;
}

export interface CliResult {
  scanned: number;
  /** Files that need (`check`) or received (`format`) formatting changes, including failed writes. */
  changed: number;
  formatted: number;
  unchanged: number;
  failed: number;
  entries: CliFileResult[];
  failures: CliFailure[];
  configFile: string;
  ignoreFile: string;
}
