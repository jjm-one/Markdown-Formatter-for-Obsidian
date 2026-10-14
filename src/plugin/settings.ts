// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

/** Shape, defaults, and validation of the settings Obsidian persists for this plugin. */

import {
  DEFAULT_SETTINGS,
  isSafeVaultRelativePath,
  validateProjectSetting,
  type EffectiveSettings,
} from "../core";

/** The project-config settings the plugin also stores itself (markdownlint as editable JSON text). */
type SharedSettings = Omit<EffectiveSettings, "prettier" | "markdownlint" | "ignore">;

export interface FormatterSettings extends SharedSettings {
  /** Read and write `.markdown-formatter.json` when it exists. */
  useProjectConfig: boolean;
  projectConfigPath: string;
  markdownlintConfigJson: string;
  /**
   * Allow Prettier configuration that can run code (JS/TS configs, shared
   * configs, plugins). Plugin-only, so a vault file cannot grant itself trust.
   */
  trustPrettierConfig: boolean;
}

const {
  prettier: _prettier,
  markdownlint: defaultMarkdownlint,
  ignore: _ignore,
  ...sharedDefaults
} = DEFAULT_SETTINGS;

const DEFAULT_PLUGIN_SETTINGS: FormatterSettings = {
  ...sharedDefaults,
  useProjectConfig: true,
  projectConfigPath: ".markdown-formatter.json",
  markdownlintConfigJson: JSON.stringify(defaultMarkdownlint, null, 2),
  trustPrettierConfig: false,
};

/** A fresh, mutable copy of the defaults. */
export function cloneDefaultSettings(): FormatterSettings {
  return structuredClone(DEFAULT_PLUGIN_SETTINGS);
}

/**
 * Validate one plugin setting, addressed as `key` or `group.key`; throws if the
 * value is not acceptable. Settings shared with the project config use the
 * project-config rules, so both stores accept exactly the same values.
 */
export function validatePluginSetting(path: string, value: unknown): void {
  const key = path.split(".", 1)[0] ?? "";
  if (!Object.hasOwn(DEFAULT_PLUGIN_SETTINGS, key))
    throw new Error(`Unknown plugin setting: ${path}.`);
  switch (path) {
    case "useProjectConfig":
    case "trustPrettierConfig":
      if (typeof value !== "boolean") throw new Error(`${path} must be true or false.`);
      return;
    case "projectConfigPath":
      if (!isSafeVaultRelativePath(value))
        throw new Error("Project configuration path must be a safe vault-relative path.");
      return;
    case "markdownlintConfigJson":
      if (typeof value !== "string") throw new Error("markdownlintConfigJson must be text.");
      return;
    default:
      validateProjectSetting(path, value);
  }
}

/**
 * Coerce persisted settings (which may be stale or corrupt) into valid
 * {@link FormatterSettings}: every valid value is kept (strings trimmed), every
 * invalid or missing one falls back to its default — per entry for grouped settings.
 */
export function normalizePluginSettings(value: unknown): FormatterSettings {
  const settings = cloneDefaultSettings();
  if (!isRecord(value)) return settings;
  const target = settings as unknown as Record<string, unknown>;

  for (const [key, fallback] of Object.entries(settings)) {
    const candidate = value[key];
    if (isRecord(fallback)) {
      if (!isRecord(candidate)) continue;
      for (const name of Object.keys(fallback)) {
        if (isValid(`${key}.${name}`, candidate[name])) fallback[name] = candidate[name];
      }
      continue;
    }
    const trimmed = typeof candidate === "string" ? candidate.trim() : candidate;
    if (candidate !== undefined && isValid(key, trimmed)) target[key] = trimmed;
  }
  return settings;
}

function isValid(path: string, value: unknown): boolean {
  try {
    validatePluginSetting(path, value);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
