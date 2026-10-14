// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * The `formatMarkdown()` pipeline: resolve Prettier options, protect Obsidian
 * syntax, run Prettier then markdownlint, then unwind the protection in reverse.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import * as prettier from "prettier";
import * as prettierYaml from "prettier/plugins/yaml";
import { lint } from "markdownlint/sync";
import { applyFixes } from "markdownlint";
import {
  safeProjectPrettierOptions,
  type EffectiveSettings,
  type MarkdownlintConfig,
} from "./config";
import { errorMessage } from "./errors";
import {
  addPreserveDirectives,
  extractProtectedFrontmatter,
  protectInlineLinks,
  protectObsidianSyntax,
  removePreserveDirectives,
} from "./obsidian-syntax";

/** Extra behaviour flags for one formatting run. */
export interface FormatOptions {
  /**
   * Cache the on-disk `.editorconfig` / Prettier-config lookup. `true` (the
   * default) is right for a one-shot CLI run; the long-running plugin passes
   * `false` so an edited `.editorconfig` takes effect on the next format.
   */
  cacheConfig?: boolean;
  /**
   * Allow Prettier configuration that can run code: JavaScript/TypeScript config
   * files, a config that names a shared-config module, and `plugins`. Off by
   * default, so formatting an untrusted vault or repository never executes code
   * from it; a code-capable config is then refused with an error.
   */
  trustPrettierConfig?: boolean;
}

/** Prettier options for `filePath`: discovered config (with EditorConfig) then safe project overrides. */
export async function resolvePrettierOptions(
  filePath: string,
  effective: EffectiveSettings,
  { cacheConfig = true, trustPrettierConfig = false }: FormatOptions = {},
): Promise<prettier.Options> {
  let resolved: prettier.Options | null = null;
  if (effective.usePrettierConfig) {
    const configFile = await findPrettierConfigFile(filePath, cacheConfig);
    if (configFile !== null && !trustPrettierConfig) {
      const reason = await whyPrettierConfigCanRunCode(configFile);
      if (reason !== null) {
        throw new Error(
          `Prettier configuration ${configFile} ${reason}, which can run code, so it was not loaded. ` +
            "Trust Prettier configuration (CLI: --trust-prettier-config) only for folders you trust.",
        );
      }
    }
    resolved = await prettier.resolveConfig(filePath, {
      editorconfig: true,
      useCache: cacheConfig,
      config: configFile ?? undefined,
    });
    if (resolved !== null && !trustPrettierConfig) resolved = safeProjectPrettierOptions(resolved);
  }
  return {
    ...(resolved ?? {}),
    ...effective.prettier,
    proseWrap: effective.proseWrap,
    filepath: filePath,
    parser: "markdown",
  };
}

/** Prettier's config-file lookup, memoised per directory when caching is on (the lookup itself is not). */
const configFileLookups = new Map<string, Promise<string | null>>();

function findPrettierConfigFile(filePath: string, useCache: boolean): Promise<string | null> {
  if (!useCache) return prettier.resolveConfigFile(filePath);
  const directory = path.dirname(path.resolve(filePath));
  let lookup = configFileLookups.get(directory);
  if (lookup === undefined) {
    lookup = prettier.resolveConfigFile(filePath);
    configFileLookups.set(directory, lookup);
  }
  return lookup;
}

// Prettier's own YAML config parser (used for `.prettierrc`, `.yaml`, `.yml`,
// and `package.yaml`), so the check sees exactly what Prettier would load.
const parseYamlConfig = (
  prettierYaml as unknown as { __parsePrettierYamlConfig?: (text: string) => unknown }
).__parsePrettierYamlConfig;

/**
 * Why loading `configFile` could execute code, or `null` if it is a plain
 * declarative object. A JS/TS config file is code; a JSON/JSON5/YAML config (or
 * `package.json` "prettier" key) whose value is a string names a shared-config
 * module that Prettier would `require`. TOML is always a table.
 */
async function whyPrettierConfigCanRunCode(configFile: string): Promise<string | null> {
  const name = path.basename(configFile);
  if (/\.[cm]?[jt]s$/.test(name)) return "is a JavaScript/TypeScript module";
  if (name.endsWith(".toml")) return null;

  const text = await fs.readFile(configFile, "utf8");
  const sharedConfig = "names a shared configuration module";
  try {
    if (name === "package.json") {
      return isDeclarative((JSON.parse(text) as { prettier?: unknown }).prettier)
        ? null
        : sharedConfig;
    }
    if (name.endsWith(".json") || name.endsWith(".json5")) {
      return startsWithObject(text) ? null : sharedConfig;
    }
    if (parseYamlConfig === undefined) return "cannot be checked for a shared configuration module";
    const parsed = parseYamlConfig(text);
    const value =
      name === "package.yaml" ? (parsed as { prettier?: unknown } | null)?.prettier : parsed;
    return isDeclarative(value) ? null : sharedConfig;
  } catch (error) {
    // Unparseable: Prettier itself would fail on it; report that instead.
    throw new Error(`Could not read Prettier configuration ${configFile}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/** An inline options object, or no config at all; a string would name a module to load. */
function isDeclarative(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === "object" && !Array.isArray(value))
  );
}

/** Whether a JSON/JSON5 document's top-level value is an object (skipping whitespace and comments). */
function startsWithObject(text: string): boolean {
  let index = text.startsWith("\uFEFF") ? 1 : 0;
  while (index < text.length) {
    if (/\s/.test(text[index] ?? "")) index += 1;
    else if (text.startsWith("//", index)) {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end + 1;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else return text[index] === "{";
  }
  return true; // an empty document holds no config
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
    throw new Error(`Could not format ${filePath}: ${errorMessage(error)}`, { cause: error });
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
