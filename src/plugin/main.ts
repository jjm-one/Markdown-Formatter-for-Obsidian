// SPDX-FileCopyrightText: 2026 jjm.one
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
import { VaultConfig } from "./vault-config";
import {
  DEFAULT_SETTINGS,
  effectiveSettingsFromProject,
  errorMessage,
  formatMarkdown,
  projectConfigFromSettings,
  setFrontmatterProperty,
  validateProjectSetting,
  type EffectiveSettings,
  type MarkdownlintConfig,
  type ProjectConfig,
} from "../core";

/**
 * Obsidian desktop plugin. Owns the trigger wiring (command, ribbon, and the
 * modify/open/close events); configuration files live in {@link VaultConfig};
 * the actual formatting is delegated to `formatMarkdown` in the shared core.
 */
export default class MarkdownFormatterPlugin extends Plugin {
  settings: FormatterSettings = cloneDefaultSettings();
  readonly vaultConfig = new VaultConfig(this);
  private settingTab: FormatterSettingTab | null = null;
  /** Pending debounced format runs, keyed by file path. */
  private timers = new Map<string, number>();
  /** Files currently being formatted, to block re-entrancy. */
  private formatting = new Set<string>();
  /** Content this plugin last wrote per file, used to ignore the resulting modify event. */
  private selfWrites = new Map<string, string>();
  private openMarkdownFiles = new Set<string>();
  private ribbonButton: HTMLElement | null = null;
  private markdownlintCache: { json: string; config: MarkdownlintConfig } | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadProjectConfig(false); // also loads the ignore file and sets up the ribbon
    this.openMarkdownFiles = this.getOpenMarkdownFilePaths();

    this.addCommand({
      id: "format-current-markdown-file",
      name: "Format current Markdown file",
      callback: () => this.formatActiveFile(),
    });
    this.addCommand({
      id: "reload-project-configuration",
      name: "Reload project configuration",
      callback: () => this.loadProjectConfig(true),
    });
    this.addCommand({
      id: "reload-plugin-settings",
      name: "Reload plugin settings",
      callback: () => this.reloadSettingsIfChanged(true),
    });
    this.addCommand({
      id: "create-project-configuration",
      name: "Create project configuration file",
      callback: () => this.createProjectConfig(),
    });
    this.addCommand({
      id: "create-ignore-file",
      name: "Create formatting ignore file",
      callback: () => this.vaultConfig.createIgnore(),
    });
    this.addCommand({
      id: "reload-ignore-file",
      name: "Reload formatting ignore file",
      callback: () => this.vaultConfig.loadIgnore(true),
    });

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === this.vaultConfig.projectPath) {
          void this.loadProjectConfig(false);
          return;
        }
        if (file.path === this.vaultConfig.ignorePath) {
          void this.vaultConfig.loadIgnore(false);
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
        const id = window.setTimeout(() => {
          this.timers.delete(file.path);
          void this.handleModifiedNote(file);
        }, effective.debounceMs);
        this.timers.set(file.path, id);
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || file.extension !== "md") return;
        this.openMarkdownFiles.add(file.path);
        if (this.getEffectiveSettings().formatOnOpen) void this.formatFile(file, false);
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

  /**
   * Load the vault project config (and the ignore file it may point to), then
   * refresh the ribbon and, if the resolved config changed, the settings tab.
   * Invalid JSON or an unknown option blocks all formatting until fixed.
   */
  async loadProjectConfig(showNotice: boolean): Promise<void> {
    const before = this.vaultConfig.signature();
    await this.vaultConfig.loadProject(showNotice);
    this.updateRibbonButton();
    if (this.vaultConfig.signature() !== before) this.settingTab?.update();
  }

  /** Apply `mutate` to the vault project config file (see {@link VaultConfig.updateProject}). */
  async updateProjectConfig(mutate: (config: ProjectConfig) => void): Promise<void> {
    if (!(await this.vaultConfig.updateProject(mutate))) return;
    this.updateRibbonButton();
    this.settingTab?.update();
  }

  /** Create `.markdown-formatter.json`, seeded with the current effective settings. */
  async createProjectConfig(): Promise<void> {
    const seed = projectConfigFromSettings(this.getEffectiveSettings());
    if (await this.vaultConfig.createProject(seed)) await this.loadProjectConfig(false);
  }

  /**
   * Re-read the persisted plugin settings; if they changed, reload the project
   * file, ignore file, and ribbon that depend on them. Returns whether they changed.
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
   * Re-read the persisted settings, project file, and ignore file — on window
   * focus and when the settings tab opens — so external edits and syncs apply
   * even without a vault event. Returns whether the plugin settings changed.
   */
  async refreshConfigFromDisk(): Promise<boolean> {
    const settingsChanged = await this.reloadSettingsIfChanged(false);
    if (!settingsChanged) await this.loadProjectConfig(false);
    return settingsChanged;
  }

  /** Resolve settings with precedence: built-in defaults, then plugin settings, then vault project config. */
  getEffectiveSettings(): EffectiveSettings {
    const {
      useProjectConfig: _useProjectConfig,
      projectConfigPath: _projectConfigPath,
      markdownlintConfigJson,
      trustPrettierConfig: _trustPrettierConfig,
      ...shared
    } = this.settings;
    const base: EffectiveSettings = {
      ...DEFAULT_SETTINGS,
      ...shared,
      markdownlint: this.parseUiMarkdownlintConfig(markdownlintConfigJson),
    };
    return effectiveSettingsFromProject(this.vaultConfig.active, base);
  }

  updateRibbonButton(): void {
    if (!this.getEffectiveSettings().showRibbonButton) {
      this.ribbonButton?.remove();
      this.ribbonButton = null;
      return;
    }
    this.ribbonButton ??= this.addRibbonIcon(
      "wand-sparkles",
      "Format current Markdown file",
      () => {
        void this.formatActiveFile();
      },
    );
  }

  /**
   * Format one note and write it back only if the result differs. Every trigger
   * (command, ribbon, modify, open, close) funnels through here. `showNotice`
   * distinguishes a user action (report the outcome) from an automatic one.
   */
  async formatFile(file: TFile, showNotice: boolean): Promise<void> {
    if (file.extension !== "md") {
      if (showNotice) new Notice("Only Markdown files can be formatted.");
      return;
    }
    const { projectError, ignoreError } = this.vaultConfig;
    if (projectError) {
      if (showNotice)
        new Notice(
          `Formatting is disabled because the project configuration is invalid: ${projectError}`,
        );
      return;
    }
    if (ignoreError) {
      if (showNotice)
        new Notice(
          `Formatting is disabled because the ignore file could not be loaded: ${ignoreError}`,
        );
      return;
    }
    if (this.formatting.has(file.path)) return;

    const effective = this.getEffectiveSettings();
    if (this.vaultConfig.isIgnored(file.path, effective.ignore.patterns)) {
      if (showNotice) new Notice(`${file.name} is excluded from formatting.`);
      return;
    }
    this.formatting.add(file.path);

    try {
      const original = await this.app.vault.read(file);

      // Skip if an automatic trigger is only reacting to our own last write.
      const selfWrite = this.selfWrites.get(file.path);
      if (selfWrite !== undefined) {
        this.selfWrites.delete(file.path);
        if (!showNotice && selfWrite === original) return;
      }

      // `cacheConfig: false`: re-read `.editorconfig` / Prettier config each format
      // so edits to them take effect without restarting Obsidian.
      let formatted = await formatMarkdown(original, this.getAbsolutePath(file), effective, {
        cacheConfig: false,
        trustPrettierConfig: this.settings.trustPrettierConfig,
      });

      // Refresh the "updated" property only when formatting actually changed the
      // note, and only if that property already exists in its frontmatter.
      if (effective.stampUpdatedProperty && formatted !== original) {
        formatted =
          setFrontmatterProperty(formatted, effective.updatedProperty, this.formattedToday()) ??
          formatted;
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

  private async formatActiveFile(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("No Markdown file is active.");
      return;
    }
    await this.formatFile(file, true);
  }

  /** The plugin's markdownlint JSON, parsed once per edit; invalid JSON falls back to the defaults. */
  private parseUiMarkdownlintConfig(
    json = this.settings.markdownlintConfigJson,
  ): MarkdownlintConfig {
    if (this.markdownlintCache?.json !== json) {
      let config: MarkdownlintConfig;
      try {
        const parsed: unknown = JSON.parse(json);
        validateProjectSetting("markdownlint", parsed);
        config = parsed as MarkdownlintConfig;
      } catch (error) {
        console.error("Markdown Formatter: invalid markdownlint JSON; using safe defaults", error);
        config = DEFAULT_SETTINGS.markdownlint;
      }
      this.markdownlintCache = { json, config };
    }
    return this.markdownlintCache.config;
  }

  /**
   * Reload the project config and/or ignore file when the file at either path is
   * created, deleted, or renamed. `oldPath` is the pre-rename path, if any.
   */
  private reloadConfigOrIgnoreFor(file: TAbstractFile, oldPath?: string): void {
    const paths = oldPath === undefined ? [file.path] : [file.path, oldPath];
    if (paths.includes(this.vaultConfig.projectPath)) void this.loadProjectConfig(false);
    if (paths.includes(this.vaultConfig.ignorePath)) void this.vaultConfig.loadIgnore(false);
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
    if (this.getEffectiveSettings().formatOnClose) {
      for (const path of this.openMarkdownFiles) {
        if (current.has(path)) continue;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile && file.extension === "md") await this.formatFile(file, false);
      }
    }
    this.openMarkdownFiles = current;
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

  /** Absolute path to `file`, needed for `.editorconfig`/Prettier config discovery; vault-relative off desktop. */
  private getAbsolutePath(file: TFile): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return file.path;
    return path.join(adapter.getBasePath(), file.path);
  }

  /**
   * React to an edit in an open note: format it when format-on-modify is on and,
   * independently, refresh the updated-date property when that feature is on —
   * even if the note was already clean and nothing was formatted.
   */
  private async handleModifiedNote(file: TFile): Promise<void> {
    const effective = this.getEffectiveSettings();
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
    if (this.vaultConfig.projectError !== null || this.vaultConfig.ignoreError !== null) return;
    if (this.formatting.has(file.path)) return;
    if (this.vaultConfig.isIgnored(file.path, effective.ignore.patterns)) return;

    this.formatting.add(file.path);
    try {
      const original = await this.app.vault.read(file);
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
}
