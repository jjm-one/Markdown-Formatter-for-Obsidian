// SPDX-License-Identifier: LGPL-3.0-only

/** Shape, defaults, and load-time sanitization of the settings Obsidian persists for this plugin. */

import {
  DEBOUNCE_MAX_MS,
  DEBOUNCE_MIN_MS,
  DEFAULT_LINK_SETTINGS,
  DEFAULT_MARKDOWNLINT_CONFIG,
  DEFAULT_MARKDOWN_STRUCTURES,
  DEFAULT_OBSIDIAN_SYNTAX,
  DEFAULT_UPDATED_PROPERTY,
  isSafeVaultRelativePath,
  LINK_MODES,
  OBSIDIAN_SYNTAX_MODES,
  PROSE_WRAP_MODES,
  STRUCTURE_MODES,
  UPDATED_PROPERTY_PATTERN,
  type MarkdownLinkSettings,
  type MarkdownStructureSettings,
  type ObsidianSyntaxSettings,
} from "../core";

export interface FormatterSettings {
  formatOnModify: boolean;
  formatOnOpen: boolean;
  formatOnClose: boolean;
  showRibbonButton: boolean;
  debounceMs: number;
  runMarkdownlintFixes: boolean;
  usePrettierConfig: boolean;
  useProjectConfig: boolean;
  projectConfigPath: string;
  proseWrap: "always" | "never" | "preserve";
  markdownStructures: MarkdownStructureSettings;
  links: MarkdownLinkSettings;
  obsidianSyntax: ObsidianSyntaxSettings;
  markdownlintConfigJson: string;
  /** When a format changes a note, also set `updatedProperty` to today's date. */
  stampUpdatedProperty: boolean;
  /** Frontmatter key refreshed by {@link stampUpdatedProperty} (only if already present). */
  updatedProperty: string;
}

const DEFAULT_SETTINGS: FormatterSettings = {
  formatOnModify: false,
  formatOnOpen: false,
  formatOnClose: false,
  showRibbonButton: true,
  debounceMs: 900,
  runMarkdownlintFixes: true,
  usePrettierConfig: true,
  useProjectConfig: true,
  projectConfigPath: ".markdown-formatter.json",
  proseWrap: "preserve",
  markdownStructures: { ...DEFAULT_MARKDOWN_STRUCTURES },
  links: { ...DEFAULT_LINK_SETTINGS },
  obsidianSyntax: { ...DEFAULT_OBSIDIAN_SYNTAX },
  markdownlintConfigJson: JSON.stringify(DEFAULT_MARKDOWNLINT_CONFIG, null, 2),
  stampUpdatedProperty: false,
  updatedProperty: DEFAULT_UPDATED_PROPERTY,
};

/** A fresh copy of the defaults, with nested objects cloned so callers can mutate them freely. */
export function cloneDefaultSettings(): FormatterSettings {
  return {
    ...DEFAULT_SETTINGS,
    markdownStructures: { ...DEFAULT_MARKDOWN_STRUCTURES },
    links: { ...DEFAULT_LINK_SETTINGS },
    obsidianSyntax: { ...DEFAULT_OBSIDIAN_SYNTAX },
  };
}

/** Coerce persisted settings (which may be stale or corrupt) into a valid {@link FormatterSettings}. */
export function normalizePluginSettings(value: unknown): FormatterSettings {
  const defaults = cloneDefaultSettings();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return defaults;
  const loaded = value as Partial<FormatterSettings>;
  const bool = (candidate: unknown, fallback: boolean) =>
    typeof candidate === "boolean" ? candidate : fallback;
  const debounce =
    typeof loaded.debounceMs === "number" &&
    Number.isFinite(loaded.debounceMs) &&
    loaded.debounceMs >= DEBOUNCE_MIN_MS &&
    loaded.debounceMs <= DEBOUNCE_MAX_MS
      ? loaded.debounceMs
      : defaults.debounceMs;
  const proseWrap = (PROSE_WRAP_MODES as readonly string[]).includes(loaded.proseWrap as string)
    ? (loaded.proseWrap as FormatterSettings["proseWrap"])
    : defaults.proseWrap;
  const projectPath =
    typeof loaded.projectConfigPath === "string" &&
    isSafeVaultRelativePath(loaded.projectConfigPath.trim())
      ? loaded.projectConfigPath.trim()
      : defaults.projectConfigPath;
  const markdownlintConfigJson =
    typeof loaded.markdownlintConfigJson === "string"
      ? loaded.markdownlintConfigJson
      : defaults.markdownlintConfigJson;
  const updatedProperty =
    typeof loaded.updatedProperty === "string" &&
    UPDATED_PROPERTY_PATTERN.test(loaded.updatedProperty.trim())
      ? loaded.updatedProperty.trim()
      : defaults.updatedProperty;
  return {
    formatOnModify: bool(loaded.formatOnModify, defaults.formatOnModify),
    formatOnOpen: bool(loaded.formatOnOpen, defaults.formatOnOpen),
    formatOnClose: bool(loaded.formatOnClose, defaults.formatOnClose),
    showRibbonButton: bool(loaded.showRibbonButton, defaults.showRibbonButton),
    debounceMs: debounce,
    runMarkdownlintFixes: bool(loaded.runMarkdownlintFixes, defaults.runMarkdownlintFixes),
    usePrettierConfig: bool(loaded.usePrettierConfig, defaults.usePrettierConfig),
    useProjectConfig: bool(loaded.useProjectConfig, defaults.useProjectConfig),
    projectConfigPath: projectPath,
    proseWrap,
    markdownStructures: normalizeModes(
      loaded.markdownStructures,
      DEFAULT_MARKDOWN_STRUCTURES,
      STRUCTURE_MODES,
    ),
    links: normalizeModes(loaded.links, DEFAULT_LINK_SETTINGS, LINK_MODES),
    obsidianSyntax: normalizeModes(
      loaded.obsidianSyntax,
      DEFAULT_OBSIDIAN_SYNTAX,
      OBSIDIAN_SYNTAX_MODES,
    ),
    markdownlintConfigJson,
    stampUpdatedProperty: bool(loaded.stampUpdatedProperty, defaults.stampUpdatedProperty),
    updatedProperty,
  };
}

/** Return `defaults` with each known key overridden only by an allowed string value in `value`. */
function normalizeModes<T extends Record<string, string>>(
  value: unknown,
  defaults: T,
  allowed: readonly string[],
): T {
  const result: Record<string, string> = { ...defaults };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return result as T;
  for (const key of Object.keys(defaults)) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && allowed.includes(candidate)) result[key] = candidate;
  }
  return result as T;
}
