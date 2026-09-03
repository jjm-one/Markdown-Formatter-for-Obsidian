// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Settings tab built with Obsidian 1.13+ declarative setting definitions, so the
 * settings stay searchable and presentation is separate from lifecycle code.
 *
 * `getControlValue`/`setControlValue` are overridden to (a) support dotted keys
 * such as `markdownStructures.tables` and (b) route reads and writes to whichever
 * store is active: the vault `.markdown-formatter.json` when one exists,
 * otherwise the plugin's own settings. Either way the tab shows the effective
 * value (project override, then plugin setting).
 */

import { App, Notice, PluginSettingTab, type Setting } from "obsidian";
import {
  DEBOUNCE_MAX_MS,
  DEBOUNCE_MIN_MS,
  isSafeVaultRelativePath,
  LINK_MODES,
  OBSIDIAN_SYNTAX_MODES,
  PROSE_WRAP_MODES,
  STRUCTURE_MODES,
  UPDATED_PROPERTY_PATTERN,
  type MarkdownLinkSettings,
  type MarkdownStructureSettings,
  type ObsidianSyntaxSettings,
  type ProjectConfig,
} from "../core";
import type MarkdownFormatterPlugin from "./main";

export class FormatterSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: MarkdownFormatterPlugin,
  ) {
    super(app, plugin);
  }

  /** The effective value of a control key: project-config override, then plugin setting. */
  getControlValue(key: string): unknown {
    const globalRoot = this.plugin.settings as unknown as Record<string, unknown>;
    // `useProjectConfig` / `projectConfigPath` decide *where* settings live —
    // they are always the plugin's own.
    if (key === "useProjectConfig" || key === "projectConfigPath") return getPath(globalRoot, key);

    const project = this.plugin.getActiveProjectConfig();
    const fromProject = project ? getPath(project, key) : undefined;
    return fromProject ?? getPath(globalRoot, key);
  }

  /** Validate and persist a setting, writing to the active store, then re-apply side effects. */
  async setControlValue(key: string, value: unknown): Promise<void> {
    const normalized = normalizeControlValue(key, value);

    if (key === "useProjectConfig" || key === "projectConfigPath") {
      setPath(this.plugin.settings as unknown as Record<string, unknown>, key, normalized);
      await this.plugin.saveSettings();
      await this.plugin.loadProjectConfig(false);
      return;
    }

    if (this.plugin.isProjectConfigActive()) {
      await this.plugin.updateProjectConfig((config) => {
        setPath(config, key, normalized);
      });
    } else {
      setPath(this.plugin.settings as unknown as Record<string, unknown>, key, normalized);
      await this.plugin.saveSettings();
    }

    if (key === "showRibbonButton") this.plugin.updateRibbonButton();
    if (key === "stampUpdatedProperty") this.refreshDomState();
  }

  /** The setting groups Obsidian renders. Called by Obsidian on every display and for search indexing. */
  getSettingDefinitions() {
    // Opening the tab is a good moment to pick up config changed on disk (a
    // manual edit, or a sync from another device); reloading re-renders the tab
    // itself when the effective values move.
    void this.plugin.refreshConfigFromDisk();
    return [
      {
        type: "group" as const,
        heading: "Project configuration",
        items: [
          {
            name: "Use vault project configuration",
            desc: "When on and a .markdown-formatter.json exists in the vault, settings are read from and written to that file (shared with the standalone CLI and synced devices). When off, or when no such file exists, the plugin's own settings are used. A file always overrides the plugin settings.",
            control: { type: "toggle" as const, key: "useProjectConfig" },
          },
          {
            name: "Project configuration file",
            desc: "Path relative to the vault root. Default: .markdown-formatter.json",
            control: {
              type: "text" as const,
              key: "projectConfigPath",
              placeholder: ".markdown-formatter.json",
              validate: (value: string) =>
                isSafeVaultRelativePath(value.trim())
                  ? undefined
                  : "Enter a safe vault-relative path without parent-directory traversal.",
            },
          },
          {
            name: "Project configuration actions",
            desc: "Create the default file if it does not exist, or reload it after editing outside Obsidian.",
            render: (setting: Setting) => {
              setting
                .addButton((button) =>
                  button.setButtonText("Create config").onClick(async () => {
                    await this.plugin.createProjectConfig();
                  }),
                )
                .addButton((button) =>
                  button.setButtonText("Reload config").onClick(async () => {
                    await this.plugin.loadProjectConfig(true);
                  }),
                );
            },
          },
          {
            name: "Formatting ignore file",
            desc: `Files matching ${this.plugin.getIgnoreFilePath()} are never formatted by automatic triggers, the ribbon, hotkeys, or the manual action. The project config can change the path and add inline patterns.`,
            render: (setting: Setting) => {
              setting
                .addButton((button) =>
                  button.setButtonText("Create ignore file").onClick(async () => {
                    await this.plugin.createIgnoreFile();
                  }),
                )
                .addButton((button) =>
                  button.setButtonText("Reload ignore file").onClick(async () => {
                    await this.plugin.loadIgnoreFile(true);
                  }),
                );
            },
          },
        ],
      },
      {
        type: "group" as const,
        heading: "Formatting triggers",
        items: [
          {
            name: "Continuous formatting",
            desc: "Format Markdown after Obsidian writes a vault change. Changes are debounced to avoid formatting on every keystroke.",
            control: { type: "toggle" as const, key: "formatOnModify" },
          },
          {
            name: "Format on file open",
            desc: "Format a Markdown note when Obsidian opens it.",
            control: { type: "toggle" as const, key: "formatOnOpen" },
          },
          {
            name: "Format on file close",
            desc: "Format a Markdown note when its last open Markdown view is closed.",
            control: { type: "toggle" as const, key: "formatOnClose" },
          },
          {
            name: "Show ribbon button",
            desc: "Show a wand button in the left ribbon for formatting the active Markdown note. The same action is available as a command and can be assigned a hotkey.",
            control: { type: "toggle" as const, key: "showRibbonButton" },
          },
          {
            name: "Debounce",
            desc: "Milliseconds after the last file modification before continuous formatting runs.",
            control: {
              type: "number" as const,
              key: "debounceMs",
              min: 250,
              max: 600000,
              step: 50,
            },
          },
        ],
      },
      {
        type: "group" as const,
        heading: "Formatter",
        items: [
          {
            name: "Use project Prettier and EditorConfig settings",
            desc: "Resolve Prettier configuration with EditorConfig enabled. A Prettier config, when present, can override .editorconfig values.",
            control: { type: "toggle" as const, key: "usePrettierConfig" },
          },
          {
            name: "Prose wrapping",
            desc: "Preserve is the safest option for existing Obsidian notes.",
            control: {
              type: "dropdown" as const,
              key: "proseWrap",
              defaultValue: "preserve",
              options: {
                preserve: "Preserve",
                always: "Always wrap",
                never: "Never wrap",
              },
            },
          },
        ],
      },
      {
        type: "group" as const,
        heading: "Note properties",
        items: [
          {
            name: "Refresh the updated-date property",
            desc: "Sets the property below to today's date whenever you edit an open note (using the date format from Obsidian's General settings). The property is only updated if it already exists in the note's frontmatter — it is never added.",
            control: { type: "toggle" as const, key: "stampUpdatedProperty" },
          },
          {
            name: "Updated-date property name",
            desc: "The frontmatter key to refresh, e.g. updated, modified, or Last Update.",
            control: {
              type: "text" as const,
              key: "updatedProperty",
              placeholder: "updated",
              disabled: () => this.getControlValue("stampUpdatedProperty") !== true,
              validate: (value: string) =>
                UPDATED_PROPERTY_PATTERN.test(value.trim())
                  ? undefined
                  : "Use 1–64 letters, digits, spaces, hyphens, or underscores.",
            },
          },
        ],
      },
      {
        type: "group" as const,
        heading: "Markdown structure formatting",
        items: [
          structureDefinition(
            "Tables",
            "Controls GFM table column and pipe reformatting.",
            "tables",
          ),
          structureDefinition(
            "Lists",
            "Controls list markers, numbering, and indentation normalization.",
            "lists",
          ),
          structureDefinition(
            "Fenced code blocks",
            "Controls fenced code blocks, including embedded-language formatting. Preserve is recommended for Mermaid and plugin-specific blocks.",
            "fencedCodeBlocks",
          ),
          structureDefinition(
            "Blockquotes",
            "Controls blockquote spacing and layout normalization.",
            "blockquotes",
          ),
          structureDefinition(
            "Horizontal rules",
            "Controls horizontal-rule style normalization.",
            "horizontalRules",
          ),
        ],
      },
      {
        type: "group" as const,
        heading: "Link formatting",
        items: [
          linkDefinition(
            "Markdown links",
            "Standard [text](https://example.com) links.",
            "markdownLinks",
          ),
          linkDefinition(
            "Reference definitions",
            "Definitions such as [docs]: https://example.com/docs.",
            "referenceDefinitions",
          ),
          linkDefinition(
            "Obsidian wikilinks and embeds",
            "Obsidian-only [[Note]], [[Note|Alias]], and ![[Embed]] syntax. Preserve is recommended.",
            "obsidianWikilinks",
          ),
          linkDefinition(
            "Autolinks",
            "Angle-bracket links such as <https://example.com> and <mailto:user@example.com>.",
            "autolinks",
          ),
        ],
      },
      {
        type: "group" as const,
        heading: "Obsidian compatibility",
        items: [
          obsidianDefinition(
            "Properties and frontmatter",
            "Preserve the complete YAML or JSON properties block at the beginning of the note.",
            "properties",
          ),
          obsidianDefinition(
            "Callouts",
            "Preserve [!type] callouts, fold state (+/-), nesting, and quoted contents.",
            "callouts",
          ),
          obsidianDefinition(
            "Block IDs",
            "Preserve ^block-id tokens used by Obsidian block references.",
            "blockIds",
          ),
          obsidianDefinition(
            "Comments",
            "Preserve Obsidian %% inline and block comments.",
            "comments",
          ),
          obsidianDefinition(
            "MathJax",
            "Preserve inline $...$ and display $$...$$ math source.",
            "math",
          ),
          obsidianDefinition("Tags", "Preserve #tag and nested #tag/subtag tokens.", "tags"),
          obsidianDefinition(
            "Inline footnotes",
            "Preserve Obsidian ^[inline footnote] syntax.",
            "inlineFootnotes",
          ),
          obsidianDefinition("Highlights", "Preserve Obsidian ==highlight== syntax.", "highlights"),
        ],
      },
      {
        type: "group" as const,
        heading: "Markdownlint",
        items: [
          {
            name: "Apply markdownlint fixes",
            desc: "Run markdownlint after Prettier and apply only fixes supplied by enabled markdownlint rules.",
            control: { type: "toggle" as const, key: "runMarkdownlintFixes" },
          },
          {
            name: "Markdownlint configuration",
            desc: "JSON rule configuration, merged over the defaults. Saved to the project config file when one is active, otherwise to the plugin settings.",
            render: (setting: Setting) => {
              const textarea = setting.controlEl.createEl("textarea", {
                cls: "markdown-formatter-markdownlint-config",
                attr: { spellcheck: "false" },
              });
              textarea.value = this.markdownlintConfigText();
              textarea.addEventListener("change", () => {
                void this.saveMarkdownlintJson(textarea.value);
              });
            },
          },
        ],
      },
    ];
  }

  /** Effective markdownlint config as JSON text: the project file's object, else the plugin's. */
  private markdownlintConfigText(): string {
    const project = this.plugin.getActiveProjectConfig();
    return project?.markdownlint
      ? JSON.stringify(project.markdownlint, null, 2)
      : this.plugin.settings.markdownlintConfigJson;
  }

  private async saveMarkdownlintJson(value: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      new Notice("Markdownlint configuration is not valid JSON.");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      new Notice("Markdownlint configuration must be a JSON object.");
      return;
    }
    if (this.plugin.isProjectConfigActive()) {
      await this.plugin.updateProjectConfig((config) => {
        config.markdownlint = parsed as ProjectConfig["markdownlint"];
      });
    } else {
      this.plugin.settings.markdownlintConfigJson = value;
      await this.plugin.saveSettings();
    }
    new Notice("Markdownlint configuration saved.");
  }
}

// A "prettier"/"preserve" (or "format"/"preserve") dropdown for one nested setting key.
function structureDefinition(name: string, desc: string, key: keyof MarkdownStructureSettings) {
  return {
    name,
    desc,
    control: {
      type: "dropdown" as const,
      key: `markdownStructures.${key}`,
      defaultValue: key === "fencedCodeBlocks" ? "preserve" : "prettier",
      options: {
        prettier: "Normalize with Prettier",
        preserve: "Preserve source syntax",
      },
    },
  };
}

function linkDefinition(name: string, desc: string, key: keyof MarkdownLinkSettings) {
  return {
    name,
    desc,
    control: {
      type: "dropdown" as const,
      key: `links.${key}`,
      defaultValue: key === "markdownLinks" ? "prettier" : "preserve",
      options: {
        prettier: "Normalize with formatter",
        preserve: "Preserve source syntax",
      },
    },
  };
}

function obsidianDefinition(name: string, desc: string, key: keyof ObsidianSyntaxSettings) {
  return {
    name,
    desc,
    control: {
      type: "dropdown" as const,
      key: `obsidianSyntax.${key}`,
      defaultValue: "preserve",
      options: {
        preserve: "Preserve for Obsidian",
        format: "Allow formatter",
      },
    },
  };
}

const BOOLEAN_SETTING_KEYS = new Set([
  "useProjectConfig",
  "formatOnModify",
  "formatOnOpen",
  "formatOnClose",
  "showRibbonButton",
  "usePrettierConfig",
  "runMarkdownlintFixes",
  "stampUpdatedProperty",
]);

const oneOf = (value: unknown, allowed: readonly string[]): boolean =>
  typeof value === "string" && allowed.includes(value);

/** Validate and coerce a value coming from the UI for `key`; throws if it is not acceptable. */
function normalizeControlValue(key: string, value: unknown): unknown {
  if (BOOLEAN_SETTING_KEYS.has(key)) {
    if (typeof value !== "boolean") throw new Error(`${key} must be true or false.`);
    return value;
  }

  if (key === "projectConfigPath") {
    if (typeof value !== "string" || !isSafeVaultRelativePath(value.trim())) {
      throw new Error("Project configuration path must be a safe vault-relative path.");
    }
    return value.trim();
  }
  if (key === "updatedProperty") {
    if (typeof value !== "string" || !UPDATED_PROPERTY_PATTERN.test(value.trim())) {
      throw new Error(
        "Updated-date property name must be 1–64 letters, digits, spaces, hyphens, or underscores.",
      );
    }
    return value.trim();
  }
  if (key === "debounceMs") {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error("Debounce must be a finite number.");
    return Math.min(DEBOUNCE_MAX_MS, Math.max(DEBOUNCE_MIN_MS, Math.round(value)));
  }
  if (key === "proseWrap") {
    if (!oneOf(value, PROSE_WRAP_MODES)) throw new Error("Invalid prose wrapping mode.");
    return value;
  }
  if (key.startsWith("markdownStructures.")) {
    if (!oneOf(value, STRUCTURE_MODES)) throw new Error("Invalid Markdown structure mode.");
    return value;
  }
  if (key.startsWith("links.")) {
    if (!oneOf(value, LINK_MODES)) throw new Error("Invalid link formatting mode.");
    return value;
  }
  if (key.startsWith("obsidianSyntax.")) {
    if (!oneOf(value, OBSIDIAN_SYNTAX_MODES)) throw new Error("Invalid Obsidian syntax mode.");
    return value;
  }

  throw new Error(`Unknown plugin setting: ${key}.`);
}

// A control key is a flat setting name or exactly `<group>.<key>`. Resolving the
// target directly (never walking an arbitrary path) keeps the prototype chain
// unreachable.
const NESTED_SETTING_GROUPS = new Set(["markdownStructures", "links", "obsidianSyntax"]);
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function splitControlKey(path: string): { group: string | null; leaf: string } {
  const dot = path.indexOf(".");
  return dot === -1
    ? { group: null, leaf: path }
    : { group: path.slice(0, dot), leaf: path.slice(dot + 1) };
}

/** Read a plugin setting by flat name or `group.key`; `undefined` if absent. */
function getPath(root: Record<string, unknown>, path: string): unknown {
  const { group, leaf } = splitControlKey(path);
  if (group === null) return Object.hasOwn(root, leaf) ? root[leaf] : undefined;
  if (!NESTED_SETTING_GROUPS.has(group) || !Object.hasOwn(root, group)) return undefined;
  const sub = root[group];
  if (sub === null || typeof sub !== "object" || !Object.hasOwn(sub, leaf)) return undefined;
  return (sub as Record<string, unknown>)[leaf];
}

/** Write a plugin setting by flat name or `group.key`. */
function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const { group, leaf } = splitControlKey(path);
  if (leaf.length === 0) throw new Error("Setting path is empty.");
  if (FORBIDDEN_SEGMENTS.has(leaf) || (group !== null && FORBIDDEN_SEGMENTS.has(group))) {
    throw new Error(`Unsafe setting path: ${path}.`);
  }
  if (group === null) {
    root[leaf] = value;
    return;
  }
  if (!NESTED_SETTING_GROUPS.has(group)) throw new Error(`Unknown plugin setting group: ${group}.`);
  const existing = root[group];
  const target =
    existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : ((root[group] = {}) as Record<string, unknown>);
  target[leaf] = value;
}
