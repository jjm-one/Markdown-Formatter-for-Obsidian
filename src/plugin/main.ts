// SPDX-License-Identifier: LGPL-3.0-only
import {
  FileSystemAdapter,
  Notice,
  Plugin,
  MarkdownView,
  TAbstractFile,
  TFile,
  moment,
} from "obsidian";
import path from "node:path";
import { FormatterSettingTab } from "./settings-tab";
import { cloneDefaultSettings, normalizePluginSettings, type FormatterSettings } from "./settings";
import {
  DEFAULT_IGNORE_SETTINGS,
  DEFAULT_LINK_SETTINGS,
  DEFAULT_MARKDOWNLINT_CONFIG,
  DEFAULT_MARKDOWN_STRUCTURES,
  DEFAULT_OBSIDIAN_SYNTAX,
  PROJECT_CONFIG_SCHEMA_URL,
  errorMessage,
  formatMarkdown,
  isPathIgnored,
  isSafeVaultRelativePath,
  parseIgnorePatterns,
  safeProjectPrettierOptions,
  setFrontmatterProperty,
  validateProjectConfig,
  type EffectiveSettings,
  type MarkdownlintConfig,
  type ProjectConfig,
} from "../core";

/**
 * Obsidian desktop plugin. Owns the trigger wiring (command, ribbon, and the
 * modify/open/close events) and configuration loading; the actual formatting is
 * delegated to `formatMarkdown` in the shared core.
 */
export default class MarkdownFormatterPlugin extends Plugin {
  settings: FormatterSettings = cloneDefaultSettings();
  private projectConfig: ProjectConfig | null = null;
  private projectConfigError: string | null = null;
  /** Exact text this plugin last wrote to the project-config file, to ignore the echo event. */
  private lastWrittenProjectConfig: string | null = null;
  private settingTab: FormatterSettingTab | null = null;
  private ignoreFilePatterns: string[] = [];
  private ignoreFileError: string | null = null;
  /** Pending debounced format runs, keyed by file path. */
  private timers = new Map<string, number>();
  /** Files currently being formatted, to block re-entrancy. */
  private formatting = new Set<string>();
  /** Content this plugin last wrote per file, used to ignore the resulting modify event. */
  private selfWrites = new Map<string, string>();
  private openMarkdownFiles = new Set<string>();
  private ribbonButton: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadProjectConfig(false); // also loads the ignore file and sets up the ribbon
    this.openMarkdownFiles = this.getOpenMarkdownFilePaths();

    this.addCommand({
      id: "format-current-markdown-file",
      name: "Format current Markdown file",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice("No Markdown file is active.");
          return;
        }
        await this.formatFile(file, true);
      },
    });

    this.addCommand({
      id: "reload-project-configuration",
      name: "Reload project configuration",
      callback: async () => {
        await this.loadProjectConfig(true);
      },
    });

    this.addCommand({
      id: "reload-plugin-settings",
      name: "Reload plugin settings",
      callback: async () => {
        await this.reloadSettingsIfChanged(true);
      },
    });

    this.addCommand({
      id: "create-project-configuration",
      name: "Create project configuration file",
      callback: async () => {
        await this.createProjectConfig();
      },
    });

    this.addCommand({
      id: "create-ignore-file",
      name: "Create formatting ignore file",
      callback: async () => {
        await this.createIgnoreFile();
      },
    });

    this.addCommand({
      id: "reload-ignore-file",
      name: "Reload formatting ignore file",
      callback: async () => {
        await this.loadIgnoreFile(true);
      },
    });

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.isProjectConfigFile(file)) {
          void this.loadProjectConfig(false);
          return;
        }
        if (this.isIgnoreFile(file)) {
          void this.loadIgnoreFile(false);
          return;
        }

        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (this.formatting.has(file.path)) return;
        // Swallow the single modify event produced by our own write.
        if (this.selfWrites.delete(file.path)) return;

        const effective = this.getEffectiveSettings();
        const stampOnEdit = effective.stampUpdatedProperty && this.openMarkdownFiles.has(file.path);
        if (!effective.formatOnModify && !stampOnEdit) return;

        const previous = this.timers.get(file.path);
        if (previous !== undefined) window.clearTimeout(previous);

        const id = window.setTimeout(
          () => {
            this.timers.delete(file.path);
            void this.handleModifiedNote(file);
          },
          Math.max(250, effective.debounceMs),
        );
        this.timers.set(file.path, id);
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || file.extension !== "md") return;
        this.openMarkdownFiles.add(file.path);

        const effective = this.getEffectiveSettings();
        if (effective.formatOnOpen) void this.formatFile(file, false);
      }),
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        void this.handleWorkspaceLayoutChange();
      }),
    );

    this.registerEvent(this.app.vault.on("create", (file) => this.reloadConfigOrIgnoreFor(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.reloadConfigOrIgnoreFor(file)));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => this.reloadConfigOrIgnoreFor(file, oldPath)),
    );

    // Pick up config edited on disk or synced from another device once Obsidian
    // regains focus; the settings tab refreshes on open too.
    this.registerDomEvent(window, "focus", () => {
      void this.refreshConfigFromDisk();
    });

    this.settingTab = new FormatterSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
  }

  onunload(): void {
    for (const id of this.timers.values()) window.clearTimeout(id);
    this.timers.clear();
    this.formatting.clear();
    this.selfWrites.clear();
    this.ribbonButton?.remove();
    this.ribbonButton = null;
  }

  async loadSettings(): Promise<void> {
    try {
      const loaded: unknown = await this.loadData();
      this.settings = normalizePluginSettings(loaded);
    } catch (error) {
      this.settings = cloneDefaultSettings();
      console.error(
        "Markdown Formatter: could not load plugin settings; using safe defaults",
        error,
      );
      new Notice(
        `Markdown Formatter settings could not be loaded. Safe defaults are active. ${errorMessage(error)}`,
      );
    }
  }

  async saveSettings(): Promise<void> {
    try {
      await this.saveData(this.settings);
    } catch (error) {
      console.error("Markdown Formatter: could not save plugin settings", error);
      new Notice(`Markdown Formatter settings could not be saved: ${errorMessage(error)}`);
    }
  }

  private parseUiMarkdownlintConfig(): MarkdownlintConfig {
    try {
      const parsed: unknown = JSON.parse(this.settings.markdownlintConfigJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        throw new Error("markdownlint configuration must be a JSON object.");
      return parsed as MarkdownlintConfig;
    } catch (error) {
      console.error("Markdown Formatter: invalid markdownlint JSON; using safe defaults", error);
      return { ...DEFAULT_MARKDOWNLINT_CONFIG };
    }
  }

  private isProjectConfigFile(file: TAbstractFile): boolean {
    return file.path === this.settings.projectConfigPath;
  }

  getIgnoreFilePath(): string {
    return this.getActiveProjectConfig()?.ignore?.file?.trim() || DEFAULT_IGNORE_SETTINGS.file;
  }

  /** True when a valid `.markdown-formatter.json` is present and enabled. */
  isProjectConfigActive(): boolean {
    return (
      this.settings.useProjectConfig &&
      this.projectConfig !== null &&
      this.projectConfigError === null
    );
  }

  /** The project config when it is the active settings store, else `null` (use plugin settings). */
  getActiveProjectConfig(): ProjectConfig | null {
    return this.isProjectConfigActive() ? this.projectConfig : null;
  }

  /**
   * Apply `mutate` to the project-config file and persist it. Used by the settings
   * tab so a UI edit lands in the same file the CLI and other devices read. The
   * caller is responsible for having checked {@link isProjectConfigActive}.
   */
  async updateProjectConfig(mutate: (config: ProjectConfig) => void): Promise<void> {
    const configPath = this.settings.projectConfigPath.trim();
    const next: ProjectConfig = {
      $schema: PROJECT_CONFIG_SCHEMA_URL,
      ...structuredClone(this.projectConfig ?? {}),
    };
    mutate(next);
    validateProjectConfig(next);
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    try {
      this.lastWrittenProjectConfig = serialized;
      await this.app.vault.adapter.write(configPath, serialized);
    } catch (error) {
      this.lastWrittenProjectConfig = null;
      console.error("Markdown Formatter: could not write project configuration", error);
      new Notice(`Could not save to ${configPath}: ${errorMessage(error)}`);
      return;
    }
    this.projectConfig = next;
    this.projectConfigError = null;
    await this.loadIgnoreFile(false); // `ignore.file` may have changed
    this.updateRibbonButton();
    this.settingTab?.update();
  }

  private isIgnoreFile(file: TAbstractFile): boolean {
    return file.path === this.getIgnoreFilePath();
  }

  /**
   * Reload the project config and/or ignore file when the file at either path is
   * created, deleted, or renamed. `oldPath` is the pre-rename path, if any.
   */
  private reloadConfigOrIgnoreFor(file: TAbstractFile, oldPath?: string): void {
    const paths = oldPath === undefined ? [file.path] : [file.path, oldPath];
    if (paths.includes(this.settings.projectConfigPath)) void this.loadProjectConfig(false);
    if (paths.includes(this.getIgnoreFilePath())) void this.loadIgnoreFile(false);
  }

  /**
   * Re-read the persisted plugin settings (e.g. after an external edit or a sync
   * from another device). If they changed, apply them and re-run the dependent
   * project-config, ignore-file, and ribbon loading. Returns whether anything changed.
   */
  async reloadSettingsIfChanged(showNotice: boolean): Promise<boolean> {
    const before = JSON.stringify(this.settings);
    await this.loadSettings();
    if (JSON.stringify(this.settings) === before) {
      if (showNotice) new Notice("Plugin settings are already up to date.");
      return false;
    }
    await this.loadProjectConfig(false);
    this.settingTab?.update();
    if (showNotice) new Notice("Reloaded plugin settings from disk.");
    return true;
  }

  /**
   * Re-read every on-disk configuration source (persisted settings, vault project
   * config, ignore file). Runs on window focus and when the settings tab opens,
   * so external edits and cross-device syncs are picked up even if no vault event
   * fired. `.editorconfig` / Prettier config are re-read on every format, so they
   * are always current and need no reload here. Returns whether settings changed.
   */
  async refreshConfigFromDisk(): Promise<boolean> {
    const settingsChanged = await this.reloadSettingsIfChanged(false);
    if (!settingsChanged) await this.loadProjectConfig(false);
    return settingsChanged;
  }

  /** Load the ignore file. A file that exists but cannot be parsed blocks all formatting until fixed. */
  async loadIgnoreFile(showNotice: boolean): Promise<void> {
    const ignorePath = this.getIgnoreFilePath();
    const previousError = this.ignoreFileError;
    try {
      if (!(await this.app.vault.adapter.exists(ignorePath))) {
        this.ignoreFilePatterns = [];
        this.ignoreFileError = null;
        if (showNotice) new Notice(`No formatting ignore file found at ${ignorePath}.`);
        return;
      }
      const patterns = parseIgnorePatterns(await this.app.vault.adapter.read(ignorePath));
      this.ignoreFilePatterns = patterns;
      this.ignoreFileError = null;
      if (showNotice) new Notice(`Loaded ${patterns.length} ignore pattern(s) from ${ignorePath}.`);
    } catch (error) {
      this.ignoreFileError = `Could not load ${ignorePath}: ${errorMessage(error)}`;
      console.error("Markdown Formatter: could not load ignore file", error);
      if (showNotice || previousError !== this.ignoreFileError)
        new Notice(
          `Formatting disabled until the ignore file is fixed or reloads successfully. ${this.ignoreFileError}`,
        );
    }
  }

  /** Load the vault project config. Invalid JSON or an unknown option blocks all formatting until fixed. */
  async loadProjectConfig(showNotice: boolean): Promise<void> {
    const previousError = this.projectConfigError;
    const signatureBefore = this.configSignature();
    const done = () => {
      if (this.configSignature() !== signatureBefore) this.settingTab?.update();
    };

    if (!this.settings.useProjectConfig) {
      this.projectConfig = null;
      this.projectConfigError = null;
      if (showNotice) new Notice("Project configuration is disabled.");
      await this.loadIgnoreFile(false);
      this.updateRibbonButton();
      return done();
    }

    const configPath = this.settings.projectConfigPath.trim();
    if (!isSafeVaultRelativePath(configPath)) {
      this.projectConfigError =
        "Project configuration path must be a non-empty vault-relative path without parent-directory traversal.";
      console.error(`Markdown Formatter: ${this.projectConfigError}`);
      if (showNotice || previousError !== this.projectConfigError)
        new Notice(`Formatting disabled: ${this.projectConfigError}`);
      this.updateRibbonButton();
      return done();
    }

    try {
      if (!(await this.app.vault.adapter.exists(configPath))) {
        this.projectConfig = null;
        this.projectConfigError = null;
        if (showNotice)
          new Notice(
            `No project configuration found at ${configPath}; plugin settings are active.`,
          );
        await this.loadIgnoreFile(false);
        this.updateRibbonButton();
        return done();
      }

      const raw = await this.app.vault.adapter.read(configPath);
      if (raw === this.lastWrittenProjectConfig) {
        this.lastWrittenProjectConfig = null; // this is the echo of our own write
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new Error(`Invalid JSON in ${configPath}: ${errorMessage(error)}`);
      }
      validateProjectConfig(parsed);
      this.projectConfig = parsed;
      this.projectConfigError = null;
      await this.loadIgnoreFile(false);
      this.updateRibbonButton();
      if (showNotice) new Notice(`Loaded project configuration from ${configPath}.`);
    } catch (error) {
      this.projectConfigError = errorMessage(error);
      console.error("Markdown Formatter: invalid project configuration", error);
      this.updateRibbonButton();
      if (showNotice || previousError !== this.projectConfigError)
        new Notice(
          `Formatting disabled until project configuration is fixed. ${this.projectConfigError}`,
        );
    }
    return done();
  }

  /** Fingerprint of the resolved project-config state, to detect real changes. */
  private configSignature(): string {
    return JSON.stringify([this.projectConfig, this.projectConfigError]);
  }

  /** Resolve settings with precedence: built-in defaults, then plugin settings, then vault project config. */
  private getEffectiveSettings(): EffectiveSettings {
    const project = this.getActiveProjectConfig();

    return {
      formatOnModify: project?.formatOnModify ?? this.settings.formatOnModify,
      formatOnOpen: project?.formatOnOpen ?? this.settings.formatOnOpen,
      formatOnClose: project?.formatOnClose ?? this.settings.formatOnClose,
      showRibbonButton: project?.showRibbonButton ?? this.settings.showRibbonButton,
      debounceMs: project?.debounceMs ?? this.settings.debounceMs,
      runMarkdownlintFixes: project?.runMarkdownlintFixes ?? this.settings.runMarkdownlintFixes,
      usePrettierConfig: project?.usePrettierConfig ?? this.settings.usePrettierConfig,
      proseWrap: project?.proseWrap ?? this.settings.proseWrap,
      markdownStructures: {
        ...DEFAULT_MARKDOWN_STRUCTURES,
        ...this.settings.markdownStructures,
        ...(project?.markdownStructures ?? {}),
      },
      links: {
        ...DEFAULT_LINK_SETTINGS,
        ...this.settings.links,
        ...(project?.links ?? {}),
      },
      obsidianSyntax: {
        ...DEFAULT_OBSIDIAN_SYNTAX,
        ...this.settings.obsidianSyntax,
        ...(project?.obsidianSyntax ?? {}),
      },
      prettier: safeProjectPrettierOptions(project?.prettier ?? {}),
      markdownlint: {
        ...this.parseUiMarkdownlintConfig(),
        ...(project?.markdownlint ?? {}),
      },
      ignore: {
        ...DEFAULT_IGNORE_SETTINGS,
        ...(project?.ignore ?? {}),
      },
      stampUpdatedProperty: project?.stampUpdatedProperty ?? this.settings.stampUpdatedProperty,
      updatedProperty: project?.updatedProperty?.trim() || this.settings.updatedProperty,
    };
  }

  private getOpenMarkdownFilePaths(): Set<string> {
    const paths = new Set<string>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.extension === "md") {
        paths.add(view.file.path);
      }
    }
    return paths;
  }

  /** Format-on-close: Obsidian has no "file closed" event, so diff the open-file set on every layout change. */
  private async handleWorkspaceLayoutChange(): Promise<void> {
    const current = this.getOpenMarkdownFilePaths();
    const effective = this.getEffectiveSettings();

    if (effective.formatOnClose) {
      for (const path of this.openMarkdownFiles) {
        if (current.has(path)) continue;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile && file.extension === "md") {
          await this.formatFile(file, false);
        }
      }
    }

    this.openMarkdownFiles = current;
  }

  updateRibbonButton(): void {
    const shouldShow = this.getEffectiveSettings().showRibbonButton;

    if (!shouldShow) {
      this.ribbonButton?.remove();
      this.ribbonButton = null;
      return;
    }

    if (this.ribbonButton) return;
    this.ribbonButton = this.addRibbonIcon("wand-sparkles", "Format current Markdown file", () => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== "md") {
        new Notice("No Markdown file is active.");
        return;
      }
      void this.formatFile(file, true);
    });
  }

  /** Create `filePath` in the vault (making parent folders); `false` if it already exists. */
  private async createVaultFile(filePath: string, content: string): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    if (await adapter.exists(filePath)) return false;
    const slash = filePath.lastIndexOf("/");
    if (slash > 0) {
      const dir = filePath.slice(0, slash);
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    }
    await adapter.write(filePath, content);
    return true;
  }

  async createProjectConfig(): Promise<void> {
    const configPath = this.settings.projectConfigPath.trim();
    if (!isSafeVaultRelativePath(configPath)) {
      new Notice("Project configuration path must be a valid vault-relative path.");
      return;
    }

    try {
      // Seed the file with the current effective settings so it is complete from the start.
      const body = `${JSON.stringify(this.projectConfigSnapshot(), null, 2)}\n`;
      if (!(await this.createVaultFile(configPath, body))) {
        new Notice(`${configPath} already exists.`);
        return;
      }
      await this.loadProjectConfig(false);
      this.settingTab?.update();
      new Notice(`Created ${configPath}.`);
    } catch (error) {
      console.error("Markdown Formatter: failed to create project configuration", error);
      new Notice(`Could not create project configuration: ${errorMessage(error)}`);
    }
  }

  /** A full {@link ProjectConfig} matching the current effective settings. */
  private projectConfigSnapshot(): ProjectConfig {
    const e = this.getEffectiveSettings();
    return {
      $schema: PROJECT_CONFIG_SCHEMA_URL,
      formatOnModify: e.formatOnModify,
      formatOnOpen: e.formatOnOpen,
      formatOnClose: e.formatOnClose,
      showRibbonButton: e.showRibbonButton,
      debounceMs: e.debounceMs,
      runMarkdownlintFixes: e.runMarkdownlintFixes,
      usePrettierConfig: e.usePrettierConfig,
      stampUpdatedProperty: e.stampUpdatedProperty,
      updatedProperty: e.updatedProperty,
      proseWrap: e.proseWrap,
      markdownStructures: { ...e.markdownStructures },
      links: { ...e.links },
      obsidianSyntax: { ...e.obsidianSyntax },
      prettier: { ...e.prettier },
      markdownlint: { ...e.markdownlint },
      ignore: { file: e.ignore.file, patterns: [...e.ignore.patterns] },
    };
  }

  async createIgnoreFile(): Promise<void> {
    const ignorePath = this.getIgnoreFilePath();
    if (!isSafeVaultRelativePath(ignorePath)) {
      new Notice("Formatting ignore path must be a valid vault-relative path.");
      return;
    }

    const template = `# Markdown Formatter ignore patterns
# One vault-relative glob per line. Prefix with ! to re-include.
# Examples:
# Templates/**
# Archive/**/*.md
# *.generated.md
# !important.generated.md
`;
    try {
      if (!(await this.createVaultFile(ignorePath, template))) {
        new Notice(`${ignorePath} already exists.`);
        return;
      }
      await this.loadIgnoreFile(false);
      new Notice(`Created ${ignorePath}.`);
    } catch (error) {
      console.error("Markdown Formatter: failed to create ignore file", error);
      new Notice(`Could not create formatting ignore file: ${errorMessage(error)}`);
    }
  }

  private isFormattingIgnored(filePath: string, effective: EffectiveSettings): boolean {
    return isPathIgnored(filePath, [...effective.ignore.patterns, ...this.ignoreFilePatterns]);
  }

  /** Today, formatted with Obsidian's own date format (Settings → General → Date format). */
  private formattedToday(): string {
    const configured = (
      this.app.vault as unknown as { getConfig?: (key: string) => unknown }
    ).getConfig?.("dateFormat");
    const format =
      typeof configured === "string" && configured.trim().length > 0 ? configured : "YYYY-MM-DD";
    // `moment` is typed as a namespace by Obsidian but is callable at runtime.
    const now = (moment as unknown as () => { format: (token: string) => string })();
    return now.format(format);
  }

  /** Absolute path to `file`, needed for `.editorconfig`/Prettier config discovery; null off desktop. */
  private getAbsolutePath(file: TFile): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return null;
    return path.join(adapter.getBasePath(), file.path);
  }

  /**
   * React to an edit in an open note: format it when format-on-modify is on and,
   * independently, refresh the updated-date property when that feature is on —
   * even if the note was already clean and nothing was formatted.
   */
  private async handleModifiedNote(file: TFile): Promise<void> {
    let effective: EffectiveSettings;
    try {
      effective = this.getEffectiveSettings();
    } catch (error) {
      console.error("Markdown Formatter: could not resolve settings", error);
      return;
    }
    if (effective.formatOnModify) await this.formatFile(file, false);
    if (effective.stampUpdatedProperty && this.openMarkdownFiles.has(file.path)) {
      await this.stampUpdatedDate(file, effective);
    }
  }

  /**
   * Set the configured updated-date property to today's date, but only if the
   * note already contains that property. Called on any edit to an open note so
   * the date tracks edits, not just formatting changes.
   */
  private async stampUpdatedDate(file: TFile, effective: EffectiveSettings): Promise<void> {
    if (this.projectConfigError !== null || this.ignoreFileError !== null) return;
    if (this.formatting.has(file.path)) return;
    if (this.isFormattingIgnored(file.path, effective)) return;

    this.formatting.add(file.path);
    try {
      const original = await this.app.vault.read(file);
      if (typeof original !== "string") return;
      const stamped = setFrontmatterProperty(
        original,
        effective.updatedProperty,
        this.formattedToday(),
      );
      if (stamped === null || stamped === original) return;
      this.selfWrites.set(file.path, stamped);
      await this.app.vault.modify(file, stamped);
    } catch (error) {
      console.error(
        "Markdown Formatter: could not refresh the updated-date property for",
        file.path,
        error,
      );
    } finally {
      this.formatting.delete(file.path);
    }
  }

  /**
   * Format one note and write it back only if the result differs. Every trigger
   * (command, ribbon, modify, open, close) funnels through here. `showNotice`
   * distinguishes a user action (report the outcome) from an automatic one.
   */
  async formatFile(file: TFile, showNotice: boolean): Promise<void> {
    if (!(file instanceof TFile) || file.extension !== "md") {
      if (showNotice) new Notice("Only Markdown files can be formatted.");
      return;
    }
    if (this.projectConfigError) {
      if (showNotice)
        new Notice(
          `Formatting is disabled because the project configuration is invalid: ${this.projectConfigError}`,
        );
      return;
    }
    if (this.ignoreFileError) {
      if (showNotice)
        new Notice(
          `Formatting is disabled because the ignore file could not be loaded: ${this.ignoreFileError}`,
        );
      return;
    }
    if (this.formatting.has(file.path)) return;

    let effective: EffectiveSettings;
    try {
      effective = this.getEffectiveSettings();
    } catch (error) {
      console.error("Markdown Formatter: could not resolve settings", error);
      if (showNotice)
        new Notice(`Formatting failed while resolving settings: ${errorMessage(error)}`);
      return;
    }
    if (this.isFormattingIgnored(file.path, effective)) {
      if (showNotice) new Notice(`${file.name} is excluded from formatting.`);
      return;
    }
    this.formatting.add(file.path);

    try {
      const original = await this.app.vault.read(file);
      if (typeof original !== "string")
        throw new Error("Obsidian returned non-text content for this Markdown file.");

      // Skip if an automatic trigger is only reacting to our own last write.
      const selfWrite = this.selfWrites.get(file.path);
      if (selfWrite !== undefined) {
        this.selfWrites.delete(file.path);
        if (!showNotice && selfWrite === original) return;
      }

      const absolutePath = this.getAbsolutePath(file) ?? file.path;
      // `cacheConfig: false`: re-read `.editorconfig` / Prettier config each format
      // so edits to them take effect without restarting Obsidian.
      let formatted = await formatMarkdown(original, absolutePath, effective, {
        cacheConfig: false,
      });

      // Refresh the "updated" property only when formatting actually changed the
      // note, and only if that property already exists in its frontmatter.
      if (effective.stampUpdatedProperty && formatted !== original) {
        const stamped = setFrontmatterProperty(
          formatted,
          effective.updatedProperty,
          this.formattedToday(),
        );
        if (stamped !== null) formatted = stamped;
      }

      if (formatted !== original) {
        this.selfWrites.set(file.path, formatted);
        await this.app.vault.modify(file, formatted);
        if (showNotice) new Notice(`Formatted ${file.name}.`);
      } else if (showNotice) {
        new Notice(`${file.name} is already formatted.`);
      }
    } catch (error) {
      console.error("Markdown Formatter failed for", file.path, error);
      if (showNotice) new Notice(`Could not format ${file.name}: ${errorMessage(error)}`);
    } finally {
      this.formatting.delete(file.path);
    }
  }
}
