// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * The settings model: {@link DEFAULT_SETTINGS} defines which settings exist and
 * their defaults; the project-config type, validation, and merging derive from it.
 */

import type * as prettier from "prettier";

// --- Settings model ---------------------------------------------------------

export type MarkdownlintConfig = Record<string, boolean | string | Record<string, unknown>>;

export const PROSE_WRAP_MODES = ["always", "never", "preserve"] as const;
/** Modes for Markdown structures and links: normalize with Prettier, or keep the source. */
export const FORMATTER_MODES = ["prettier", "preserve"] as const;
export const OBSIDIAN_SYNTAX_MODES = ["format", "preserve"] as const;

export type ProseWrap = (typeof PROSE_WRAP_MODES)[number];
type FormatterMode = (typeof FORMATTER_MODES)[number];
type ObsidianSyntaxMode = (typeof OBSIDIAN_SYNTAX_MODES)[number];

export type MarkdownStructureSettings = Record<
  "tables" | "lists" | "fencedCodeBlocks" | "blockquotes" | "horizontalRules",
  FormatterMode
>;

export type MarkdownLinkSettings = Record<
  "markdownLinks" | "referenceDefinitions" | "obsidianWikilinks" | "autolinks",
  FormatterMode
>;

export type ObsidianSyntaxSettings = Record<
  | "properties"
  | "callouts"
  | "blockIds"
  | "comments"
  | "math"
  | "tags"
  | "inlineFootnotes"
  | "highlights",
  ObsidianSyntaxMode
>;

export type IgnoreSettings = {
  file: string;
  patterns: string[];
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
  proseWrap: ProseWrap;
  markdownStructures: MarkdownStructureSettings;
  links: MarkdownLinkSettings;
  obsidianSyntax: ObsidianSyntaxSettings;
  prettier: prettier.Options;
  markdownlint: MarkdownlintConfig;
  ignore: IgnoreSettings;
  /** When a format changes a note, also set `updatedProperty` to the current date. */
  stampUpdatedProperty: boolean;
  /** Frontmatter key refreshed by {@link stampUpdatedProperty} (only if already present). */
  updatedProperty: string;
}

/** Settings that group several named options; a project file may set any subset of them. */
type GroupedSettingKey = "markdownStructures" | "links" | "obsidianSyntax" | "ignore";

/** The committed `.markdown-formatter.json` policy: any subset of {@link EffectiveSettings}. */
export type ProjectConfig = { $schema?: string } & Partial<
  Omit<EffectiveSettings, GroupedSettingKey>
> & { [K in GroupedSettingKey]?: Partial<EffectiveSettings[K]> };

// --- Defaults ---------------------------------------------------------------

// Value limits shared by the validator and the plugin's settings tab.
export const DEBOUNCE_MIN_MS = 250;
export const DEBOUNCE_MAX_MS = 600_000;
/** Accepted shape of the frontmatter key stamped by `stampUpdatedProperty`. */
export const UPDATED_PROPERTY_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;

/** `$schema` written into a generated `.markdown-formatter.json`. */
export const PROJECT_CONFIG_SCHEMA_URL =
  "https://raw.githubusercontent.com/jjm-one/Markdown-Formatter-for-Obsidian/main/.markdown-formatter.schema.json";

/**
 * Built-in defaults for every setting. Obsidian-specific syntax is preserved.
 *
 * markdownlint: MD013/MD033/MD041/MD045 conflict with common Obsidian
 * conventions; MD018 is off because a leading `#word` is a tag, not a broken
 * heading (set `"MD018": true` to re-enable). See docs/CONFIGURATION.md.
 */
export const DEFAULT_SETTINGS: EffectiveSettings = deepFreeze({
  formatOnModify: false,
  formatOnOpen: false,
  formatOnClose: false,
  showRibbonButton: true,
  debounceMs: 900,
  runMarkdownlintFixes: true,
  usePrettierConfig: true,
  proseWrap: "preserve",
  markdownStructures: {
    tables: "prettier",
    lists: "prettier",
    fencedCodeBlocks: "preserve",
    blockquotes: "prettier",
    horizontalRules: "prettier",
  },
  links: {
    markdownLinks: "prettier",
    referenceDefinitions: "preserve",
    obsidianWikilinks: "preserve",
    autolinks: "preserve",
  },
  obsidianSyntax: {
    properties: "preserve",
    callouts: "preserve",
    blockIds: "preserve",
    comments: "preserve",
    math: "preserve",
    tags: "preserve",
    inlineFootnotes: "preserve",
    highlights: "preserve",
  },
  prettier: {},
  markdownlint: {
    default: true,
    MD013: false,
    MD018: false,
    MD033: false,
    MD041: false,
    MD045: false,
  },
  ignore: { file: ".markdown-formatter-ignore", patterns: [] },
  stampUpdatedProperty: false,
  updatedProperty: "updated",
});

/** A complete `.markdown-formatter.json` that reproduces `settings`. */
export function projectConfigFromSettings(settings: EffectiveSettings): ProjectConfig {
  return { $schema: PROJECT_CONFIG_SCHEMA_URL, ...structuredClone(settings) };
}

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof EffectiveSettings)[];
const BOOLEAN_SETTING_KEYS = SETTING_KEYS.filter(
  (key) => typeof DEFAULT_SETTINGS[key] === "boolean",
);

// --- Validation -------------------------------------------------------------

/** True if `value` is a non-empty relative path with no absolute prefix, drive letter, `..`, or NUL. */
export function isSafeVaultRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) return false;
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split("/").includes("..");
}

/** Assert that `config` is a well-formed {@link ProjectConfig}; unknown keys are rejected. */
export function validateProjectConfig(config: unknown): asserts config is ProjectConfig {
  if (!isPlainObject(config)) throw new Error("Project configuration must be a JSON object.");

  for (const key of Object.keys(config)) {
    if (key !== "$schema" && !Object.hasOwn(DEFAULT_SETTINGS, key))
      throw new Error(`Unknown project configuration option: ${key}.`);
  }

  for (const key of BOOLEAN_SETTING_KEYS) {
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

  if (config.proseWrap !== undefined && !isOneOf(config.proseWrap, PROSE_WRAP_MODES)) {
    throw new Error('proseWrap must be "always", "never", or "preserve".');
  }

  validateModeObject(
    config.markdownStructures,
    DEFAULT_SETTINGS.markdownStructures,
    FORMATTER_MODES,
    "markdownStructures",
  );
  validateModeObject(config.links, DEFAULT_SETTINGS.links, FORMATTER_MODES, "links");
  validateModeObject(
    config.obsidianSyntax,
    DEFAULT_SETTINGS.obsidianSyntax,
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

/**
 * Validate a single setting, addressed as `key` or `group.key` (for example
 * `markdownStructures.tables`), with the same rules and messages as
 * {@link validateProjectConfig}. Throws if the value is not acceptable.
 */
export function validateProjectSetting(path: string, value: unknown): void {
  const dot = path.indexOf(".");
  // Computed keys define own properties, so `__proto__` is rejected as unknown
  // instead of touching a prototype.
  validateProjectConfig(
    dot === -1 ? { [path]: value } : { [path.slice(0, dot)]: { [path.slice(dot + 1)]: value } },
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value); // typed `any` by lib.es5
  return prototype === Object.prototype || prototype === null;
}

function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
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
    if (!Object.hasOwn(defaults, name)) throw new Error(`Unknown ${label} option: ${name}.`);
    if (!isOneOf(mode, allowed))
      throw new Error(
        `${label}.${name} must be ${allowed.map((item) => `"${item}"`).join(" or ")}.`,
      );
  }
}

// --- Merging ----------------------------------------------------------------

/** Drop `parser`, `filepath`, and `plugins`, which configuration must not control. */
export function safeProjectPrettierOptions(options: prettier.Options): prettier.Options {
  const { parser: _parser, filepath: _filepath, plugins: _plugins, ...safeOptions } = options;
  return safeOptions;
}

/**
 * Merge an optional {@link ProjectConfig} over `base` (the built-in defaults, or
 * the plugin's own settings) into {@link EffectiveSettings}. Grouped settings
 * merge key by key; the project file wins wherever it sets a value.
 */
export function effectiveSettingsFromProject(
  project: ProjectConfig | null = null,
  base: EffectiveSettings = DEFAULT_SETTINGS,
): EffectiveSettings {
  if (project !== null) validateProjectConfig(project);
  const { $schema: _schema, ...overrides }: ProjectConfig =
    project === null ? {} : withoutUndefined(project);
  return {
    ...base,
    ...overrides,
    markdownStructures: { ...base.markdownStructures, ...overrides.markdownStructures },
    links: { ...base.links, ...overrides.links },
    obsidianSyntax: { ...base.obsidianSyntax, ...overrides.obsidianSyntax },
    prettier: safeProjectPrettierOptions({ ...base.prettier, ...overrides.prettier }),
    markdownlint: { ...base.markdownlint, ...overrides.markdownlint },
    ignore: { ...base.ignore, ...overrides.ignore },
    updatedProperty: overrides.updatedProperty?.trim() || base.updatedProperty,
  };
}

/** `value` without its `undefined` properties, so they cannot override a base value when spread. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}
