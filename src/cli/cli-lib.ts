// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Standalone CLI core: argument parsing, Markdown discovery, and the check/format
 * run loop. The host entrypoint is `cli.ts`; the formatting itself is `../core`.
 */

import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import {
  createIgnoreMatcher,
  DEFAULT_IGNORE_SETTINGS,
  DEFAULT_PROJECT_CONFIG,
  effectiveSettingsFromProject,
  errorMessage,
  formatMarkdown,
  parseIgnorePatterns,
  type ProjectConfig,
  validateProjectConfig,
} from "../core";

export { errorMessage } from "../core";

export type CliMode = "check" | "format";
export type CliVerbosity = "quiet" | "normal" | "verbose" | "debug";

/** Paths the scan always skips, regardless of user configuration. */
export const DEFAULT_CLI_EXCLUDES = [
  ".git/**",
  ".obsidian/**",
  ".trash/**",
  "node_modules/**",
] as const;

export type CliFileStatus = "unchanged" | "needs-formatting" | "formatted" | "failed";

export interface CliOptions {
  mode: CliMode;
  root: string;
  configPath?: string;
  ignoreFilePath?: string;
  extraExcludes: string[];
  verbosity: CliVerbosity;
  showErrors: boolean;
  maxDiagnostics: number;
}

export interface FormattingDiagnostic {
  line: number;
  message: string;
  actual?: string;
  expected?: string;
}

export interface CliFileResult {
  file: string;
  status: CliFileStatus;
  diagnostics: FormattingDiagnostic[];
}

export interface CliFailure {
  file?: string;
  stage: "read" | "format" | "write";
  message: string;
}

export interface CliResult {
  scanned: number;
  changed: number;
  formatted: number;
  unchanged: number;
  failed: number;
  files: string[];
  entries: CliFileResult[];
  failures: CliFailure[];
  configFile: string;
  ignoreFile: string;
}

/** Parse `argv` (without `node` and script) into {@link CliOptions}; throws on unknown or malformed options. */
export function parseCliArgs(argv: string[], cwd = process.cwd()): CliOptions {
  const [modeArg, ...rest] = argv;
  if (modeArg !== "check" && modeArg !== "format") {
    throw new Error('First argument must be "check" or "format". Run with --help for usage.');
  }

  let root = cwd;
  let rootSet = false;
  let configPath: string | undefined;
  let ignoreFilePath: string | undefined;
  const extraExcludes: string[] = [];
  let verbosity: CliVerbosity = "normal";
  let showErrors = false;
  let maxDiagnostics = 20;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? "";
    if (arg === "--quiet" || arg === "-q") {
      verbosity = "quiet";
      continue;
    }
    if (arg === "--verbose") {
      verbosity = "verbose";
      continue;
    }
    if (arg === "--debug") {
      verbosity = "debug";
      continue;
    }
    if (arg === "--verbosity") {
      const value = requireOptionValue(rest, i, "--verbosity");
      if (!isVerbosity(value))
        throw new Error(
          `Invalid --verbosity value: ${value}. Expected quiet, normal, verbose, or debug.`,
        );
      verbosity = value;
      i += 1;
      continue;
    }
    if (arg === "--show-errors" || arg === "--errors") {
      showErrors = true;
      continue;
    }
    if (arg === "--max-errors") {
      const value = requireOptionValue(rest, i, "--max-errors");
      const parsed = Number.parseInt(value, 10);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1000) {
        throw new Error("--max-errors must be an integer between 1 and 1000.");
      }
      maxDiagnostics = parsed;
      i += 1;
      continue;
    }
    if (arg === "--config") {
      configPath = requireOptionValue(rest, i, "--config");
      i += 1;
      continue;
    }
    if (arg === "--ignore-file") {
      ignoreFilePath = requireOptionValue(rest, i, "--ignore-file");
      i += 1;
      continue;
    }
    if (arg === "--exclude") {
      extraExcludes.push(requireOptionValue(rest, i, "--exclude"));
      i += 1;
      continue;
    }
    if (arg.startsWith("-"))
      throw new Error(`Unknown option: ${arg}. Run with --help for supported options.`);
    if (rootSet)
      throw new Error(`Unexpected argument: ${arg}. Only one workspace path may be specified.`);
    if (arg.includes("\0")) throw new Error("Workspace path contains an invalid NUL character.");
    root = path.resolve(cwd, arg);
    rootSet = true;
  }

  return {
    mode: modeArg,
    root: path.resolve(root),
    configPath,
    ignoreFilePath,
    extraExcludes,
    verbosity,
    showErrors,
    maxDiagnostics,
  };
}

/** Load the project config. Falls back to defaults only when the default file is simply absent. */
export async function loadStandaloneProjectConfig(
  root: string,
  configPath?: string,
): Promise<ProjectConfig> {
  const resolved = configPath
    ? resolveWithinRoot(root, configPath, "configuration")
    : path.join(root, ".markdown-formatter.json");

  try {
    const raw = await fs.readFile(resolved, "utf8");
    let config: unknown;
    try {
      config = JSON.parse(raw);
    } catch (error) {
      throw new Error(`invalid JSON: ${errorMessage(error)}`);
    }
    validateProjectConfig(config);
    return config;
  } catch (error) {
    if (isNotFound(error) && configPath === undefined)
      return structuredClone(DEFAULT_PROJECT_CONFIG);
    throw new Error(`Could not load configuration ${resolved}: ${errorMessage(error)}`);
  }
}

/** Recursively collect `.md` files under `root`, skipping symlinked directories and ignored paths. */
export async function findMarkdownFiles(
  root: string,
  ignorePatterns: string[],
  hardExcludePatterns: string[] = [],
): Promise<string[]> {
  const output: string[] = [];
  const hasNegatedPatterns = ignorePatterns.some((pattern) => pattern.trim().startsWith("!"));
  const userMatcher = createIgnoreMatcher(ignorePatterns);
  const hardExcludeMatcher = createIgnoreMatcher(hardExcludePatterns);

  async function walk(directory: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Could not read directory ${directory}: ${errorMessage(error)}`);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelative(path.relative(root, absolute));
      if (entry.isSymbolicLink()) continue;
      if (hardExcludeMatcher.matches(relative)) continue;
      if (entry.isDirectory()) {
        // Only prune an ignored directory when no `!` pattern could re-include a descendant.
        if (!hasNegatedPatterns && userMatcher.matches(relative)) continue;
        await walk(absolute);
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".md") &&
        !userMatcher.matches(relative)
      ) {
        output.push(absolute);
      }
    }
  }

  await walk(root);
  return output;
}

/** Read ignore patterns from a file inside `root`; a missing default file yields `[]`, a missing explicit one throws. */
export async function loadIgnoreFilePatterns(
  root: string,
  configuredPath = DEFAULT_IGNORE_SETTINGS.file,
  explicitPath = false,
): Promise<string[]> {
  const resolved = resolveWithinRoot(root, configuredPath, "ignore file");
  try {
    return parseIgnorePatterns(await fs.readFile(resolved, "utf8"));
  } catch (error) {
    if (isNotFound(error) && !explicitPath) return [];
    throw new Error(`Could not load ignore file ${resolved}: ${errorMessage(error)}`);
  }
}

/**
 * Run one `check` or `format` pass over `options.root`. Per-file read/format/write
 * failures are collected into `result.failures` rather than aborting the scan.
 */
export async function runStandalone(options: CliOptions): Promise<CliResult> {
  validateCliOptions(options);

  const stat = await fs.stat(options.root).catch((error: unknown) => {
    throw new Error(
      `Workspace does not exist or cannot be accessed: ${options.root} (${errorMessage(error)})`,
    );
  });
  if (!stat.isDirectory()) throw new Error(`Workspace is not a directory: ${options.root}`);

  const project = await loadStandaloneProjectConfig(options.root, options.configPath);
  const effective = effectiveSettingsFromProject(project);
  const ignoreFile = options.ignoreFilePath ?? effective.ignore.file;
  const ignoreFilePatterns = await loadIgnoreFilePatterns(
    options.root,
    ignoreFile,
    options.ignoreFilePath !== undefined,
  );
  const ignorePatterns = [
    ...effective.ignore.patterns,
    ...ignoreFilePatterns,
    ...options.extraExcludes,
  ];
  const files = await findMarkdownFiles(options.root, ignorePatterns, [...DEFAULT_CLI_EXCLUDES]);
  const entries: CliFileResult[] = [];
  const failures: CliFailure[] = [];
  const changedFiles: string[] = [];

  for (const file of files) {
    const relative = normalizeRelative(path.relative(options.root, file));
    let original: string;
    try {
      original = await fs.readFile(file, "utf8");
    } catch (error) {
      failures.push({ file: relative, stage: "read", message: errorMessage(error) });
      entries.push({ file: relative, status: "failed", diagnostics: [] });
      continue;
    }

    let formatted: string;
    try {
      formatted = await formatMarkdown(original, file, effective);
    } catch (error) {
      failures.push({ file: relative, stage: "format", message: errorMessage(error) });
      entries.push({ file: relative, status: "failed", diagnostics: [] });
      continue;
    }

    if (formatted === original) {
      entries.push({ file: relative, status: "unchanged", diagnostics: [] });
      continue;
    }

    changedFiles.push(relative);
    const diagnostics = options.showErrors
      ? createFormattingDiagnostics(original, formatted, options.maxDiagnostics)
      : [];
    if (options.mode === "check") {
      entries.push({ file: relative, status: "needs-formatting", diagnostics });
      continue;
    }

    try {
      await writeFileAtomically(file, formatted);
      entries.push({ file: relative, status: "formatted", diagnostics });
    } catch (error) {
      failures.push({ file: relative, stage: "write", message: errorMessage(error) });
      entries.push({ file: relative, status: "failed", diagnostics });
    }
  }

  const failed = failures.length;
  const formattedCount = entries.filter((entry) => entry.status === "formatted").length;
  const unchanged = entries.filter((entry) => entry.status === "unchanged").length;
  return {
    scanned: files.length,
    changed: changedFiles.length,
    formatted: formattedCount,
    unchanged,
    failed,
    files: changedFiles,
    entries,
    failures,
    configFile: path.resolve(options.root, options.configPath ?? ".markdown-formatter.json"),
    ignoreFile: path.resolve(options.root, ignoreFile),
  };
}

/** Map a {@link CliResult} to a process exit code: 2 on failure, 1 for `check` with pending changes, else 0. */
export function cliExitCode(mode: CliMode, result: CliResult): number {
  if (result.failed > 0) return 2;
  return mode === "check" && result.changed > 0 ? 1 : 0;
}

/** Bounded per-line diff between the current and formatted text, for `check --show-errors`. */
export function createFormattingDiagnostics(
  original: string,
  formatted: string,
  limit = 20,
): FormattingDiagnostic[] {
  const actual = original.replaceAll("\r\n", "\n").split("\n");
  const expected = formatted.replaceAll("\r\n", "\n").split("\n");
  const diagnostics: FormattingDiagnostic[] = [];
  const max = Math.max(actual.length, expected.length);

  for (let index = 0; index < max && diagnostics.length < limit; index += 1) {
    if (actual[index] === expected[index]) continue;
    diagnostics.push({
      line: index + 1,
      message: "Line differs from the formatter output.",
      actual: actual[index],
      expected: expected[index],
    });
  }
  if (diagnostics.length === limit && max > limit) {
    diagnostics.push({
      line: 0,
      message: `Further differences omitted after ${limit} diagnostic(s).`,
    });
  }
  return diagnostics;
}

const VERBOSE_STATUS_MARKERS: Record<CliFileStatus, string> = {
  unchanged: "OK",
  failed: "ERROR",
  formatted: "FORMATTED",
  "needs-formatting": "CHANGE",
};

/** Print the per-file lines, `--show-errors` diagnostics, failures, and the run summary to the console. */
export function renderResult(
  result: CliResult,
  mode: CliMode,
  verbosity: CliVerbosity,
  showErrors: boolean,
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

  if (showErrors && mode === "check" && normal) {
    for (const entry of result.entries) {
      if (entry.status !== "needs-formatting" || entry.diagnostics.length === 0) continue;
      console.log(`\n${entry.file}`);
      for (const diagnostic of entry.diagnostics) {
        if (diagnostic.line === 0) {
          console.log(`  … ${diagnostic.message}`);
          continue;
        }
        console.log(`  line ${diagnostic.line}: ${diagnostic.message}`);
        if (diagnostic.actual !== undefined)
          console.log(`    actual:   ${JSON.stringify(diagnostic.actual)}`);
        if (diagnostic.expected !== undefined)
          console.log(`    expected: ${JSON.stringify(diagnostic.expected)}`);
      }
    }
  }

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
  console.log(
    mode === "check"
      ? `${status}: ${result.scanned} file(s) checked; ${result.changed} need formatting, ${result.unchanged} clean, ${result.failed} failed.`
      : `${status}: ${result.scanned} file(s) processed; ${result.formatted} formatted, ${result.unchanged} unchanged, ${result.failed} failed.`,
  );
}

/** Replace `file` via a temp sibling + rename so an I/O failure cannot leave a half-written note. */
export async function writeFileAtomically(file: string, content: string): Promise<void> {
  const directory = path.dirname(file);
  const base = path.basename(file);
  const temporary = path.join(directory, `.${base}.mdf-${process.pid}-${Date.now()}.tmp`);
  let mode: number | undefined;
  try {
    mode = (await fs.stat(file)).mode;
  } catch {
    // Preserve the original mode when possible; the rename below still surfaces a real error.
  }

  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", mode });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw new Error(`Could not safely replace ${file}: ${errorMessage(error)}`);
  }
}

function validateCliOptions(options: CliOptions): void {
  if (!options || typeof options !== "object")
    throw new Error("CLI options are missing or invalid.");
  if (options.mode !== "check" && options.mode !== "format")
    throw new Error(`Unsupported mode: ${String(options.mode)}.`);
  if (typeof options.root !== "string" || options.root.trim().length === 0)
    throw new Error("Workspace path must be a non-empty string.");
  if (
    !Array.isArray(options.extraExcludes) ||
    options.extraExcludes.length > 10000 ||
    !options.extraExcludes.every(
      (value) =>
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 4096 &&
        !value.includes("\0"),
    )
  ) {
    throw new Error(
      "Exclude patterns must contain at most 10000 non-empty strings of at most 4096 characters without NUL characters.",
    );
  }
  if (!isVerbosity(options.verbosity))
    throw new Error(`Unsupported verbosity: ${String(options.verbosity)}.`);
  if (
    !Number.isSafeInteger(options.maxDiagnostics) ||
    options.maxDiagnostics < 1 ||
    options.maxDiagnostics > 1000
  ) {
    throw new Error("maxDiagnostics must be an integer between 1 and 1000.");
  }
}

function requireOptionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--") || value.includes("\0"))
    throw new Error(`${option} requires a valid value.`);
  return value;
}

function isVerbosity(value: unknown): value is CliVerbosity {
  return value === "quiet" || value === "normal" || value === "verbose" || value === "debug";
}

/** Resolve `value` against `root` and reject anything that escapes it (path traversal guard). */
function resolveWithinRoot(root: string, value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0"))
    throw new Error(`${label} path is invalid.`);
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} path must stay inside the workspace: ${value}`);
  }
  return resolved;
}

function normalizeRelative(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
