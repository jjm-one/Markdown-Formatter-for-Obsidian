// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Project-configuration model: types, built-in defaults, validation, and the
 * merge into fully-resolved {@link EffectiveSettings}. Shared by both runtime
 * surfaces.
 */

import type * as prettier from "prettier";

// === Configuration model ===================================================

export type MarkdownlintConfig = Record<string, boolean | string | Record<string, unknown>>;

// "prettier"/"preserve" for structures and links; "format"/"preserve" for Obsidian syntax.
type MarkdownStructureMode = "prettier" | "preserve";
type MarkdownLinkMode = "prettier" | "preserve";
type ObsidianSyntaxMode = "format" | "preserve";

export type MarkdownStructureSettings = {
  tables: MarkdownStructureMode;
  lists: MarkdownStructureMode;
  fencedCodeBlocks: MarkdownStructureMode;
  blockquotes: MarkdownStructureMode;
  horizontalRules: MarkdownStructureMode;
};

export type MarkdownLinkSettings = {
  markdownLinks: MarkdownLinkMode;
  referenceDefinitions: MarkdownLinkMode;
  obsidianWikilinks: MarkdownLinkMode;
  autolinks: MarkdownLinkMode;
};

export type ObsidianSyntaxSettings = {
  properties: ObsidianSyntaxMode;
  callouts: ObsidianSyntaxMode;
  blockIds: ObsidianSyntaxMode;
  comments: ObsidianSyntaxMode;
  math: ObsidianSyntaxMode;
  tags: ObsidianSyntaxMode;
  inlineFootnotes: ObsidianSyntaxMode;
  highlights: ObsidianSyntaxMode;
};

export type IgnoreSettings = {
  file: string;
  patterns: string[];
};

/** The committed `.markdown-formatter.json` policy. Every field is optional. */
export type ProjectConfig = {
  $schema?: string;
  formatOnModify?: boolean;
  formatOnOpen?: boolean;
  formatOnClose?: boolean;
  showRibbonButton?: boolean;
  debounceMs?: number;
  runMarkdownlintFixes?: boolean;
  usePrettierConfig?: boolean;
  proseWrap?: "always" | "never" | "preserve";
  markdownStructures?: Partial<MarkdownStructureSettings>;
  links?: Partial<MarkdownLinkSettings>;
  obsidianSyntax?: Partial<ObsidianSyntaxSettings>;
  prettier?: prettier.Options;
  markdownlint?: MarkdownlintConfig;
  ignore?: Partial<IgnoreSettings>;
  /** When a format changes a note, also set `updatedProperty` to the current date. */
  stampUpdatedProperty?: boolean;
  /** Frontmatter key refreshed by {@link stampUpdatedProperty} (only if already present). */
  updatedProperty?: string;
};

/** Fully-resolved settings for a single formatting run, after merging every configuration layer. */
export interface EffectiveSettings {
  formatOnModify: boolean;
  formatOnOpen: boolean;
  formatOnClose: boolean;
  showRibbonButton: boolean;
  debounceMs: number;
  runMarkdownlintFixes: boolean;
  usePrettierConfig: boolean;
  proseWrap: "always" | "never" | "preserve";
  markdownStructures: MarkdownStructureSettings;
  links: MarkdownLinkSettings;
  obsidianSyntax: ObsidianSyntaxSettings;
  prettier: prettier.Options;
  markdownlint: MarkdownlintConfig;
  ignore: IgnoreSettings;
  stampUpdatedProperty: boolean;
  updatedProperty: string;
}

// === Defaults =============================================================

/**
 * Base markdownlint rules. MD013/MD033/MD041/MD045 conflict with common Obsidian
 * conventions; MD018 is off because a leading `#word` is a tag, not a broken
 * heading (set `"MD018": true` to re-enable). See docs/CONFIGURATION.md.
 */
export const DEFAULT_MARKDOWNLINT_CONFIG: MarkdownlintConfig = {
  default: true,
  MD013: false,
  MD018: false,
  MD033: false,
  MD041: false,
  MD045: false,
};

// Shared value constraints. The project-config validator below enforces them on
// the vault file; the plugin's UI-input and persisted-settings sanitizers reuse
// the same limits so the three layers cannot drift.
export const DEBOUNCE_MIN_MS = 250;
export const DEBOUNCE_MAX_MS = 600_000;
export const PROSE_WRAP_MODES = ["always", "never", "preserve"] as const;
export const STRUCTURE_MODES = ["prettier", "preserve"] as const;
export const LINK_MODES = ["prettier", "preserve"] as const;
export const OBSIDIAN_SYNTAX_MODES = ["format", "preserve"] as const;
/** Accepted shape of the frontmatter key stamped by `stampUpdatedProperty`. */
export const UPDATED_PROPERTY_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;
export const DEFAULT_UPDATED_PROPERTY = "updated";

/** True if `value` is a non-empty relative path with no absolute prefix, drive letter, `..`, or NUL. */
export function isSafeVaultRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) return false;
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split("/").includes("..");
}

export const DEFAULT_MARKDOWN_STRUCTURES: MarkdownStructureSettings = {
  tables: "prettier",
  lists: "prettier",
  fencedCodeBlocks: "preserve",
  blockquotes: "prettier",
  horizontalRules: "prettier",
};

export const DEFAULT_LINK_SETTINGS: MarkdownLinkSettings = {
  markdownLinks: "prettier",
  referenceDefinitions: "preserve",
  obsidianWikilinks: "preserve",
  autolinks: "preserve",
};

export const DEFAULT_OBSIDIAN_SYNTAX: ObsidianSyntaxSettings = {
  properties: "preserve",
  callouts: "preserve",
  blockIds: "preserve",
  comments: "preserve",
  math: "preserve",
  tags: "preserve",
  inlineFootnotes: "preserve",
  highlights: "preserve",
};

export const DEFAULT_IGNORE_SETTINGS: IgnoreSettings = {
  file: ".markdown-formatter-ignore",
  patterns: [],
};

/** `$schema` written into a generated `.markdown-formatter.json`. */
export const PROJECT_CONFIG_SCHEMA_URL =
  "https://raw.githubusercontent.com/jjm-one/Markdown-Formatter-for-Obsidian/main/.markdown-formatter.schema.json";

/** Seed for a newly created `.markdown-formatter.json`. */
export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  $schema: PROJECT_CONFIG_SCHEMA_URL,
  formatOnModify: false,
  formatOnOpen: false,
  formatOnClose: false,
  showRibbonButton: true,
  debounceMs: 900,
  runMarkdownlintFixes: true,
  usePrettierConfig: true,
  proseWrap: "preserve",
  markdownStructures: { ...DEFAULT_MARKDOWN_STRUCTURES },
  links: { ...DEFAULT_LINK_SETTINGS },
  obsidianSyntax: { ...DEFAULT_OBSIDIAN_SYNTAX },
  prettier: {},
  markdownlint: { ...DEFAULT_MARKDOWNLINT_CONFIG },
  ignore: { ...DEFAULT_IGNORE_SETTINGS },
  stampUpdatedProperty: false,
  updatedProperty: DEFAULT_UPDATED_PROPERTY,
};

// === Project configuration validation =====================================

/** Assert that `config` is a well-formed {@link ProjectConfig}; unknown keys are rejected. */
export function validateProjectConfig(config: unknown): asserts config is ProjectConfig {
  if (!isPlainObject(config)) throw new Error("Project configuration must be a JSON object.");

  const allowedKeys = new Set([
    "$schema",
    "formatOnModify",
    "formatOnOpen",
    "formatOnClose",
    "showRibbonButton",
    "debounceMs",
    "runMarkdownlintFixes",
    "usePrettierConfig",
    "proseWrap",
    "markdownStructures",
    "links",
    "obsidianSyntax",
    "prettier",
    "markdownlint",
    "ignore",
    "stampUpdatedProperty",
    "updatedProperty",
  ]);
  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) throw new Error(`Unknown project configuration option: ${key}.`);
  }

  for (const key of [
    "formatOnModify",
    "formatOnOpen",
    "formatOnClose",
    "showRibbonButton",
    "runMarkdownlintFixes",
    "usePrettierConfig",
    "stampUpdatedProperty",
  ] as const) {
    if (config[key] !== undefined && typeof config[key] !== "boolean")
      throw new Error(`${key} must be true or false.`);
  }

  if (config.$schema !== undefined && typeof config.$schema !== "string")
    throw new Error("$schema must be a string.");
  if (
    config.debounceMs !== undefined &&
    (typeof config.debounceMs !== "number" ||
      !Number.isFinite(config.debounceMs) ||
      config.debounceMs < DEBOUNCE_MIN_MS ||
      config.debounceMs > DEBOUNCE_MAX_MS)
  ) {
    throw new Error(
      `debounceMs must be a finite number between ${DEBOUNCE_MIN_MS} and ${DEBOUNCE_MAX_MS} milliseconds.`,
    );
  }

  if (
    config.proseWrap !== undefined &&
    (typeof config.proseWrap !== "string" ||
      !(PROSE_WRAP_MODES as readonly string[]).includes(config.proseWrap))
  ) {
    throw new Error('proseWrap must be "always", "never", or "preserve".');
  }

  validateModeObject(
    config.markdownStructures,
    DEFAULT_MARKDOWN_STRUCTURES,
    STRUCTURE_MODES,
    "markdownStructures",
  );
  validateModeObject(config.links, DEFAULT_LINK_SETTINGS, LINK_MODES, "links");
  validateModeObject(
    config.obsidianSyntax,
    DEFAULT_OBSIDIAN_SYNTAX,
    OBSIDIAN_SYNTAX_MODES,
    "obsidianSyntax",
  );

  if (
    config.updatedProperty !== undefined &&
    (typeof config.updatedProperty !== "string" ||
      !UPDATED_PROPERTY_PATTERN.test(config.updatedProperty.trim()))
  ) {
    throw new Error(
      "updatedProperty must be 1-64 letters, digits, spaces, hyphens, or underscores.",
    );
  }

  if (config.markdownlint !== undefined && !isPlainObject(config.markdownlint))
    throw new Error("markdownlint must be a JSON object.");
  if (config.prettier !== undefined && !isPlainObject(config.prettier))
    throw new Error("prettier must be a JSON object.");

  if (config.ignore !== undefined) {
    if (!isPlainObject(config.ignore)) throw new Error("ignore must be a JSON object.");
    for (const key of Object.keys(config.ignore))
      if (key !== "file" && key !== "patterns") throw new Error(`Unknown ignore option: ${key}.`);
    if (config.ignore.file !== undefined && !isSafeVaultRelativePath(config.ignore.file)) {
      throw new Error(
        "ignore.file must be a non-empty vault-relative path without NUL characters or parent-directory traversal.",
      );
    }
    if (config.ignore.patterns !== undefined)
      validateStringArray(config.ignore.patterns, "ignore.patterns");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value); // typed `any` by lib.es5
  return prototype === Object.prototype || prototype === null;
}

function validateStringArray(value: unknown, label: string): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length > 10000 ||
    !value.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item.length <= 4096 &&
        !item.includes("\0"),
    )
  ) {
    throw new Error(
      `${label} must be an array of at most 10000 non-empty strings (maximum 4096 characters each) without NUL characters.`,
    );
  }
}

function validateModeObject(
  value: unknown,
  defaults: object,
  allowed: readonly string[],
  label: string,
): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) throw new Error(`${label} must be a JSON object.`);
  for (const [name, mode] of Object.entries(value)) {
    if (!(name in defaults)) throw new Error(`Unknown ${label} option: ${name}.`);
    if (typeof mode !== "string" || !allowed.includes(mode))
      throw new Error(
        `${label}.${name} must be ${allowed.map((item) => `"${item}"`).join(" or ")}.`,
      );
  }
}

/** Drop `parser`, `filepath`, and `plugins` from project-supplied Prettier options. */
export function safeProjectPrettierOptions(options: prettier.Options): prettier.Options {
  if (!isPlainObject(options)) throw new Error("Prettier options must be a plain object.");
  const { parser: _parser, filepath: _filepath, plugins: _plugins, ...safeOptions } = options;
  void _parser;
  void _filepath;
  void _plugins;
  return safeOptions;
}

/** Merge the built-in defaults with an optional {@link ProjectConfig} into {@link EffectiveSettings}. */
export function effectiveSettingsFromProject(
  project: ProjectConfig | null = null,
  markdownlintBase: MarkdownlintConfig = DEFAULT_MARKDOWNLINT_CONFIG,
): EffectiveSettings {
  if (project !== null) validateProjectConfig(project);
  if (!isPlainObject(markdownlintBase))
    throw new Error("Base markdownlint configuration must be a JSON object.");
  return {
    formatOnModify: project?.formatOnModify ?? false,
    formatOnOpen: project?.formatOnOpen ?? false,
    formatOnClose: project?.formatOnClose ?? false,
    showRibbonButton: project?.showRibbonButton ?? true,
    debounceMs: project?.debounceMs ?? 900,
    runMarkdownlintFixes: project?.runMarkdownlintFixes ?? true,
    usePrettierConfig: project?.usePrettierConfig ?? true,
    proseWrap: project?.proseWrap ?? "preserve",
    markdownStructures: { ...DEFAULT_MARKDOWN_STRUCTURES, ...(project?.markdownStructures ?? {}) },
    links: { ...DEFAULT_LINK_SETTINGS, ...(project?.links ?? {}) },
    obsidianSyntax: { ...DEFAULT_OBSIDIAN_SYNTAX, ...(project?.obsidianSyntax ?? {}) },
    prettier: safeProjectPrettierOptions(project?.prettier ?? {}),
    markdownlint: { ...markdownlintBase, ...(project?.markdownlint ?? {}) },
    ignore: { ...DEFAULT_IGNORE_SETTINGS, ...(project?.ignore ?? {}) },
    stampUpdatedProperty: project?.stampUpdatedProperty ?? false,
    updatedProperty: project?.updatedProperty?.trim() || DEFAULT_UPDATED_PROPERTY,
  };
}
