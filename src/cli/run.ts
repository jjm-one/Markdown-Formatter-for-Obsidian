// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * The standalone `check`/`format` run: load configuration, discover Markdown,
 * format each file through `../core`, and write results atomically.
 */

import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import {
  createIgnoreMatcher,
  effectiveSettingsFromProject,
  errorMessage,
  formatMarkdown,
  parseIgnorePatterns,
  validateProjectConfig,
  type EffectiveSettings,
  type ProjectConfig,
} from "../core";
import { createFormattingChanges, createFormattingDiagnostics } from "./changes";
import type { CliFailure, CliFileResult, CliMode, CliOptions, CliResult } from "./types";

const DEFAULT_CONFIG_FILE = ".markdown-formatter.json";

/** Paths the scan always skips, regardless of user configuration. */
const DEFAULT_CLI_EXCLUDES = [".git/**", ".obsidian/**", ".trash/**", "node_modules/**"];

/** Files formatted at once; enough to overlap file I/O with formatting. */
const FILE_CONCURRENCY = 8;

/**
 * Load the project config. A missing default file means "no overrides" (`{}`);
 * an explicitly requested file must exist.
 */
export async function loadStandaloneProjectConfig(
  root: string,
  configPath?: string,
): Promise<ProjectConfig> {
  const resolved = configPath
    ? resolveWithinRoot(root, configPath, "configuration")
    : path.join(root, DEFAULT_CONFIG_FILE);

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
    if (isNotFound(error) && configPath === undefined) return {};
    throw new Error(`Could not load configuration ${resolved}: ${errorMessage(error)}`);
  }
}

/** Recursively collect `.md` files under `root`, skipping symlinks and ignored paths. */
export async function findMarkdownFiles(
  root: string,
  ignorePatterns: readonly string[],
  hardExcludePatterns: readonly string[] = [],
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
    // Code-point order, so the scan (and every report) is identical on every machine and locale.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

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

/**
 * Run one `check` or `format` pass over `options.root`. Per-file read/format/write
 * failures are collected into `result.failures` rather than aborting the scan.
 */
export async function runStandalone(options: CliOptions): Promise<CliResult> {
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
  const files = await findMarkdownFiles(
    options.root,
    [...effective.ignore.patterns, ...ignoreFilePatterns, ...options.extraExcludes],
    DEFAULT_CLI_EXCLUDES,
  );

  const outcomes = await mapConcurrently(files, FILE_CONCURRENCY, (file) =>
    processFile(file, options, effective),
  );
  const entries = outcomes.map((outcome) => outcome.entry);
  const failures = outcomes.flatMap((outcome) => (outcome.failure ? [outcome.failure] : []));
  const count = (status: CliFileResult["status"]) =>
    entries.filter((entry) => entry.status === status).length;

  return {
    scanned: files.length,
    changed:
      count("needs-formatting") +
      count("formatted") +
      failures.filter((failure) => failure.stage === "write").length,
    formatted: count("formatted"),
    unchanged: count("unchanged"),
    failed: failures.length,
    entries,
    failures,
    configFile: path.resolve(options.root, options.configPath ?? DEFAULT_CONFIG_FILE),
    ignoreFile: path.resolve(options.root, ignoreFile),
  };
}

/** Map a {@link CliResult} to a process exit code: 2 on failure, 1 for `check` with pending changes, else 0. */
export function cliExitCode(mode: CliMode, result: CliResult): number {
  if (result.failed > 0) return 2;
  return mode === "check" && result.changed > 0 ? 1 : 0;
}

/**
 * Replace `file` via a fresh temp sibling + rename so an I/O failure cannot
 * leave a half-written note. The temp file is created exclusively (`wx`), so a
 * pre-existing file or symlink at that name is never written through.
 */
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
    await fs.writeFile(temporary, content, { encoding: "utf8", mode, flag: "wx" });
    await fs.rename(temporary, file);
  } catch (error) {
    // EEXIST means the exclusive create failed: that file is not ours to remove.
    if (errorCode(error) !== "EEXIST")
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw new Error(`Could not safely replace ${file}: ${errorMessage(error)}`);
  }
}

interface FileOutcome {
  entry: CliFileResult;
  failure?: CliFailure;
}

async function processFile(
  file: string,
  options: CliOptions,
  effective: EffectiveSettings,
): Promise<FileOutcome> {
  const relative = normalizeRelative(path.relative(options.root, file));
  const failed = (
    stage: CliFailure["stage"],
    error: unknown,
    details: Partial<CliFileResult> = {},
  ): FileOutcome => ({
    entry: { file: relative, status: "failed", diagnostics: [], ...details },
    failure: { file: relative, stage, message: errorMessage(error) },
  });

  let original: string;
  try {
    original = await fs.readFile(file, "utf8");
  } catch (error) {
    return failed("read", error);
  }

  let formatted: string;
  try {
    formatted = await formatMarkdown(original, file, effective, {
      trustPrettierConfig: options.trustPrettierConfig,
    });
  } catch (error) {
    return failed("format", error);
  }

  if (formatted === original) {
    return { entry: { file: relative, status: "unchanged", diagnostics: [] } };
  }

  const wantsChanges =
    options.showChanges || options.showErrors || options.reportFile !== undefined;
  const changes = wantsChanges ? createFormattingChanges(original, formatted) : [];
  const diagnostics = options.showErrors
    ? createFormattingDiagnostics(changes, options.maxDiagnostics)
    : [];
  if (options.mode === "check") {
    return { entry: { file: relative, status: "needs-formatting", diagnostics, changes } };
  }

  try {
    await writeFileAtomically(file, formatted);
    return { entry: { file: relative, status: "formatted", diagnostics, changes } };
  } catch (error) {
    return failed("write", error, { diagnostics, changes });
  }
}

/** Read ignore patterns from a file inside `root`; a missing default file yields `[]`, a missing explicit one throws. */
async function loadIgnoreFilePatterns(
  root: string,
  configuredPath: string,
  explicitPath: boolean,
): Promise<string[]> {
  const resolved = resolveWithinRoot(root, configuredPath, "ignore file");
  try {
    return parseIgnorePatterns(await fs.readFile(resolved, "utf8"));
  } catch (error) {
    if (isNotFound(error) && !explicitPath) return [];
    throw new Error(`Could not load ignore file ${resolved}: ${errorMessage(error)}`);
  }
}

/** `items.map(fn)` with at most `limit` calls in flight; results keep the input order. */
async function mapConcurrently<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Resolve `value` against `root` and reject anything that escapes it (path traversal guard). */
function resolveWithinRoot(root: string, value: string, label: string): string {
  if (value.trim().length === 0 || value.includes("\0"))
    throw new Error(`${label} path is invalid.`);
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} path must stay inside the workspace: ${value}`);
  }
  return resolved;
}

function normalizeRelative(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function isNotFound(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}
