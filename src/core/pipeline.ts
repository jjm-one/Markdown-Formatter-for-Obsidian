// SPDX-License-Identifier: LGPL-3.0-only

/**
 * The `formatMarkdown()` pipeline: resolve Prettier options, protect Obsidian
 * syntax, run Prettier then markdownlint, then unwind the protection in reverse.
 */

import * as prettier from "prettier";
import xmlPlugin from "@prettier/plugin-xml";
import tomlPlugin from "prettier-plugin-toml";
import * as phpPluginModule from "@prettier/plugin-php";
import sqlPlugin from "prettier-plugin-sql";
import { lint } from "markdownlint/sync";
import { applyFixes } from "markdownlint";
import type { EffectiveSettings, MarkdownlintConfig } from "./config";
import {
  addPreserveDirectives,
  extractProtectedFrontmatter,
  protectInlineLinks,
  protectObsidianSyntax,
  removePreserveDirectives,
} from "./obsidian-syntax";
import { needsXmlPlugin, parserForExtension, pluginPackageForExtension } from "./other-formats";

// @prettier/plugin-php's own .d.ts declares a default export, but its actual ESM
// entry point (src/index.mjs) only has named exports; a default import type-checks
// but is `undefined` at runtime. Import the namespace instead and cast past the
// package's inaccurate types — the namespace object has exactly the Plugin shape.
const phpPlugin = phpPluginModule as unknown as prettier.Plugin;

/** Third-party plugin package name -> the imported plugin module Prettier needs on `options.plugins`. */
const EXTRA_FORMAT_PLUGINS: Readonly<Record<string, prettier.Plugin>> = {
  "@prettier/plugin-xml": xmlPlugin,
  "prettier-plugin-toml": tomlPlugin,
  "@prettier/plugin-php": phpPlugin,
  "prettier-plugin-sql": sqlPlugin,
};

/** Extra behaviour flags for one formatting run. */
export interface FormatOptions {
  /**
   * Cache the on-disk `.editorconfig` / Prettier-config lookup. `true` (the
   * default) is right for a one-shot CLI run; the long-running plugin passes
   * `false` so an edited `.editorconfig` takes effect on the next format.
   */
  cacheConfig?: boolean;
}

/** Prettier options for `filePath`: discovered config (with EditorConfig) then safe project overrides. */
export async function resolvePrettierOptions(
  filePath: string,
  effective: EffectiveSettings,
  { cacheConfig = true }: FormatOptions = {},
  parser: string = "markdown",
): Promise<prettier.Options> {
  let resolved: prettier.Options | null = null;
  if (effective.usePrettierConfig) {
    resolved = await prettier.resolveConfig(filePath, {
      editorconfig: true,
      useCache: cacheConfig,
    });
  }
  const options: prettier.Options = {
    ...(resolved ?? {}),
    ...effective.prettier,
    filepath: filePath,
    parser,
  };
  // `proseWrap` only means something for Markdown; leave other languages alone.
  if (parser === "markdown") options.proseWrap = effective.proseWrap;
  return options;
}

/**
 * Format one Markdown document.
 *
 * Pipeline: pull out the frontmatter, tokenize preserved Obsidian syntax and
 * links, add `prettier-ignore` shields, run Prettier then markdownlint, then
 * undo each step in reverse so only the "plain" Markdown was reformatted.
 *
 * @throws if Prettier or markdownlint fail (the cause is preserved).
 */
export async function formatMarkdown(
  content: string,
  filePath: string,
  effective: EffectiveSettings,
  formatOptions: FormatOptions = {},
): Promise<string> {
  if (typeof content !== "string") throw new Error("Markdown content must be a string.");
  if (typeof filePath !== "string" || filePath.trim().length === 0 || filePath.includes("\0"))
    throw new Error("Markdown file path is invalid.");
  if (!effective || typeof effective !== "object")
    throw new Error("Effective formatter settings are missing or invalid.");

  try {
    const options = await resolvePrettierOptions(filePath, effective, formatOptions);
    const frontmatterProtection = extractProtectedFrontmatter(content, effective);
    const obsidianProtection = protectObsidianSyntax(frontmatterProtection.content, effective);
    const linkProtection = protectInlineLinks(obsidianProtection.content, effective);
    const protectedInput = addPreserveDirectives(linkProtection.content, effective);
    let formatted = await prettier.format(protectedInput, options);
    formatted = markdownlintFix(formatted, effective);
    formatted = removePreserveDirectives(formatted);
    formatted = linkProtection.restore(formatted);
    formatted = obsidianProtection.restore(formatted);
    formatted = frontmatterProtection.restore(formatted);
    return formatted;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not format ${filePath}: ${message}`, { cause: error });
  }
}

/**
 * Format one file of an opt-in `additionalFileTypes` extension (JSON, YAML, CSS, XML, …).
 * Runs Prettier's matching parser directly, with no Obsidian-specific protection or
 * markdownlint pass — those only apply to Markdown. `.editorconfig`/Prettier config
 * resolution is identical to {@link formatMarkdown}.
 *
 * @throws if `extension` is not a supported extra format, or if Prettier fails.
 */
export async function formatOtherFile(
  content: string,
  filePath: string,
  extension: string,
  effective: EffectiveSettings,
  formatOptions: FormatOptions = {},
): Promise<string> {
  if (typeof content !== "string") throw new Error("File content must be a string.");
  if (typeof filePath !== "string" || filePath.trim().length === 0 || filePath.includes("\0"))
    throw new Error("File path is invalid.");
  if (!effective || typeof effective !== "object")
    throw new Error("Effective formatter settings are missing or invalid.");

  const parser = parserForExtension(extension);
  if (parser === null) {
    throw new Error(`Unsupported additional file type: .${extension}`);
  }

  try {
    const options = await resolvePrettierOptions(filePath, effective, formatOptions, parser);
    const pluginPackage = pluginPackageForExtension(extension);
    if (pluginPackage !== null) {
      options.plugins = [...(options.plugins ?? []), EXTRA_FORMAT_PLUGINS[pluginPackage]];
    }
    if (needsXmlPlugin(extension)) {
      // Indent block structure by default (the plugin's own default treats
      // inter-element whitespace as significant, so it leaves XML mostly as
      // typed); an explicit resolved/project Prettier option still wins.
      options.xmlWhitespaceSensitivity ??= "ignore";
    }
    return await prettier.format(content, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not format ${filePath}: ${message}`, { cause: error });
  }
}

/** The markdownlint config for a run, with rules that would rewrite a preserved construct disabled. */
export function markdownlintConfigForPreservation(
  effective: EffectiveSettings,
): MarkdownlintConfig {
  const config: MarkdownlintConfig = { ...effective.markdownlint };
  if (effective.markdownStructures.tables === "preserve")
    Object.assign(config, { MD055: false, MD056: false, MD058: false, MD060: false });
  if (effective.markdownStructures.lists === "preserve")
    Object.assign(config, {
      MD004: false,
      MD005: false,
      MD006: false,
      MD007: false,
      MD029: false,
      MD030: false,
      MD032: false,
    });
  if (effective.markdownStructures.fencedCodeBlocks === "preserve")
    Object.assign(config, { MD031: false, MD040: false, MD046: false, MD048: false });
  if (effective.markdownStructures.blockquotes === "preserve")
    Object.assign(config, { MD027: false, MD028: false });
  if (effective.markdownStructures.horizontalRules === "preserve")
    Object.assign(config, { MD035: false });
  if (effective.links.markdownLinks === "preserve")
    Object.assign(config, { MD039: false, MD054: false });
  if (effective.links.referenceDefinitions === "preserve")
    Object.assign(config, { MD053: false, MD054: false });
  if (effective.links.autolinks === "preserve") Object.assign(config, { MD034: false });
  if (effective.obsidianSyntax.properties === "preserve") Object.assign(config, { MD041: false });
  if (effective.obsidianSyntax.callouts === "preserve")
    Object.assign(config, { MD027: false, MD028: false });
  return config;
}

function markdownlintFix(content: string, effective: EffectiveSettings): string {
  if (!effective.runMarkdownlintFixes) return content;
  const result = lint({
    strings: { content },
    config: markdownlintConfigForPreservation(effective),
  });
  return applyFixes(content, result.content ?? []);
}
