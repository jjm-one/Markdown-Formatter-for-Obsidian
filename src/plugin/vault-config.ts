// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * The vault-side configuration files — `.markdown-formatter.json` and the ignore
 * file: loading, validating, writing, and creating them through the vault
 * adapter. An unreadable or invalid file blocks formatting until it is fixed.
 */

import { Notice } from "obsidian";
import {
  createIgnoreMatcher,
  DEFAULT_SETTINGS,
  errorMessage,
  isSafeVaultRelativePath,
  parseIgnorePatterns,
  PROJECT_CONFIG_SCHEMA_URL,
  validateProjectConfig,
  type IgnoreMatcher,
  type ProjectConfig,
} from "../core";
import type MarkdownFormatterPlugin from "./main";

const IGNORE_FILE_TEMPLATE = `# Markdown Formatter ignore patterns
# One vault-relative glob per line. Prefix with ! to re-include.
# Examples:
# Templates/**
# Archive/**/*.md
# *.generated.md
# !important.generated.md
`;

export class VaultConfig {
  /** The parsed project file; `null` when absent or disabled. */
  project: ProjectConfig | null = null;
  /** Why the project file could not be used; formatting is blocked while set. */
  projectError: string | null = null;
  ignorePatterns: string[] = [];
  /** Why the ignore file could not be loaded; formatting is blocked while set. */
  ignoreError: string | null = null;
  /** Exact text last written to the project file, to ignore the resulting modify event. */
  private lastWritten: string | null = null;
  private matcherCache: {
    inline: readonly string[];
    fromFile: readonly string[];
    matcher: IgnoreMatcher;
  } | null = null;

  constructor(private readonly plugin: MarkdownFormatterPlugin) {}

  private get adapter() {
    return this.plugin.app.vault.adapter;
  }

  /** The project config when it is the active settings store, else `null` (use plugin settings). */
  get active(): ProjectConfig | null {
    return this.plugin.settings.useProjectConfig && this.projectError === null
      ? this.project
      : null;
  }

  get projectPath(): string {
    return this.plugin.settings.projectConfigPath.trim();
  }

  get ignorePath(): string {
    return this.active?.ignore?.file?.trim() || DEFAULT_SETTINGS.ignore.file;
  }

  /** Fingerprint of the resolved project-config state, to detect real changes. */
  signature(): string {
    return JSON.stringify([this.project, this.projectError]);
  }

  /** Whether `path` is excluded by `inlinePatterns` (from the config) plus the ignore file. */
  isIgnored(path: string, inlinePatterns: readonly string[]): boolean {
    // Recompile only when either pattern list was replaced (on a config or ignore-file reload).
    let cache = this.matcherCache;
    if (cache?.inline !== inlinePatterns || cache.fromFile !== this.ignorePatterns) {
      cache = {
        inline: inlinePatterns,
        fromFile: this.ignorePatterns,
        matcher: createIgnoreMatcher([...inlinePatterns, ...this.ignorePatterns]),
      };
      this.matcherCache = cache;
    }
    return cache.matcher.matches(path);
  }

  /** Load the project file, then the ignore file it may point to. */
  async loadProject(showNotice: boolean): Promise<void> {
    const previousError = this.projectError;
    const fail = (message: string, error?: unknown) => {
      this.projectError = message;
      // Constant format string: `message` may contain text from the config file.
      console.error("Markdown Formatter: %s", message, ...(error === undefined ? [] : [error]));
      if (showNotice || previousError !== message)
        new Notice(`Formatting disabled until project configuration is fixed. ${message}`);
    };

    if (!this.plugin.settings.useProjectConfig) {
      this.project = null;
      this.projectError = null;
      if (showNotice) new Notice("Project configuration is disabled.");
      await this.loadIgnore(false);
      return;
    }

    const configPath = this.projectPath;
    if (!isSafeVaultRelativePath(configPath)) {
      fail(
        "Project configuration path must be a non-empty vault-relative path without parent-directory traversal.",
      );
      return;
    }

    try {
      if (!(await this.adapter.exists(configPath))) {
        this.project = null;
        this.projectError = null;
        if (showNotice)
          new Notice(
            `No project configuration found at ${configPath}; plugin settings are active.`,
          );
        await this.loadIgnore(false);
        return;
      }

      const raw = await this.adapter.read(configPath);
      if (raw === this.lastWritten) {
        this.lastWritten = null; // the echo of our own write
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new Error(`Invalid JSON in ${configPath}: ${errorMessage(error)}`);
      }
      validateProjectConfig(parsed);
      this.project = parsed;
      this.projectError = null;
      await this.loadIgnore(false);
      if (showNotice) new Notice(`Loaded project configuration from ${configPath}.`);
    } catch (error) {
      fail(errorMessage(error), error);
    }
  }

  async loadIgnore(showNotice: boolean): Promise<void> {
    const ignorePath = this.ignorePath;
    const previousError = this.ignoreError;
    try {
      if (!(await this.adapter.exists(ignorePath))) {
        this.ignorePatterns = [];
        this.ignoreError = null;
        if (showNotice) new Notice(`No formatting ignore file found at ${ignorePath}.`);
        return;
      }
      const patterns = parseIgnorePatterns(await this.adapter.read(ignorePath));
      this.ignorePatterns = patterns;
      this.ignoreError = null;
      if (showNotice) new Notice(`Loaded ${patterns.length} ignore pattern(s) from ${ignorePath}.`);
    } catch (error) {
      this.ignoreError = `Could not load ${ignorePath}: ${errorMessage(error)}`;
      console.error("Markdown Formatter: could not load ignore file", error);
      if (showNotice || previousError !== this.ignoreError)
        new Notice(
          `Formatting disabled until the ignore file is fixed or reloads successfully. ${this.ignoreError}`,
        );
    }
  }

  /**
   * Apply `mutate` to the project file and persist it, so a settings-tab edit
   * lands in the same file the CLI and other devices read. Returns whether the
   * file was written. The caller checks that the project file is {@link active}.
   */
  async updateProject(mutate: (config: ProjectConfig) => void): Promise<boolean> {
    const next: ProjectConfig = {
      $schema: PROJECT_CONFIG_SCHEMA_URL,
      ...structuredClone(this.project ?? {}),
    };
    mutate(next);
    validateProjectConfig(next);
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    try {
      this.lastWritten = serialized;
      await this.adapter.write(this.projectPath, serialized);
    } catch (error) {
      this.lastWritten = null;
      console.error("Markdown Formatter: could not write project configuration", error);
      new Notice(`Could not save to ${this.projectPath}: ${errorMessage(error)}`);
      return false;
    }
    this.project = next;
    this.projectError = null;
    await this.loadIgnore(false); // `ignore.file` may have changed
    return true;
  }

  /** Create the project file from `seed`; returns whether it was created. */
  async createProject(seed: ProjectConfig): Promise<boolean> {
    return await this.createFile(
      this.projectPath,
      `${JSON.stringify(seed, null, 2)}\n`,
      "project configuration",
    );
  }

  /** Create the ignore file from a commented template, then load it. */
  async createIgnore(): Promise<void> {
    if (await this.createFile(this.ignorePath, IGNORE_FILE_TEMPLATE, "formatting ignore file"))
      await this.loadIgnore(false);
  }

  /** Create `filePath` (making its folder); notices report the outcome. */
  private async createFile(filePath: string, content: string, label: string): Promise<boolean> {
    if (!isSafeVaultRelativePath(filePath)) {
      new Notice(`The ${label} path must be a valid vault-relative path.`);
      return false;
    }
    try {
      if (await this.adapter.exists(filePath)) {
        new Notice(`${filePath} already exists.`);
        return false;
      }
      const slash = filePath.lastIndexOf("/");
      if (slash > 0) {
        const dir = filePath.slice(0, slash);
        if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
      }
      await this.adapter.write(filePath, content);
      new Notice(`Created ${filePath}.`);
      return true;
    } catch (error) {
      console.error("Markdown Formatter: failed to create the %s", label, error);
      new Notice(`Could not create the ${label}: ${errorMessage(error)}`);
      return false;
    }
  }
}
