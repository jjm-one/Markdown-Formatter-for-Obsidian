// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Non-Markdown file types the formatter can optionally handle, via `additionalFileTypes`
 * in the project config. Deliberately an allowlist: an extension not listed here is never
 * read or written by the formatter, so a binary file can never be reached by a config typo.
 */

/** Extension (lowercase, no dot) -> the Prettier parser used to format it. */
const EXTRA_FORMAT_PARSERS: Readonly<Record<string, string>> = {
  json: "json",
  json5: "json5",
  jsonc: "jsonc",
  canvas: "json", // Obsidian's Canvas format is plain JSON.
  excalidraw: "json", // Excalidraw drawings saved in a vault are plain JSON too.
  yaml: "yaml",
  yml: "yaml",
  css: "css",
  less: "less",
  scss: "scss",
  html: "html",
  htm: "html",
  graphql: "graphql",
  gql: "graphql",
  xml: "xml",
  bpmn: "xml", // BPMN 2.0 is an XML dialect; formatted with the same printer as plain XML.
  toml: "toml",
  php: "php",
  sql: "sql",
};

/**
 * Extension -> the third-party Prettier plugin package that supplies its parser.
 * Extensions absent here use one of Prettier's own built-in parsers.
 */
const EXTRA_FORMAT_PLUGIN_PACKAGES: Readonly<Record<string, string>> = {
  xml: "@prettier/plugin-xml",
  bpmn: "@prettier/plugin-xml",
  toml: "prettier-plugin-toml",
  php: "@prettier/plugin-php",
  sql: "prettier-plugin-sql",
};

/** Every extension `additionalFileTypes` may name, sorted for stable error messages/docs. */
export const SUPPORTED_EXTRA_EXTENSIONS: readonly string[] =
  Object.keys(EXTRA_FORMAT_PARSERS).sort();

/** True if `extension` (with or without a leading dot) is a supported extra format. */
export function isSupportedExtraExtension(extension: string): boolean {
  return Object.hasOwn(EXTRA_FORMAT_PARSERS, normalizeExtension(extension));
}

/** The Prettier parser for `extension`, or `null` if it is not a supported extra format. */
export function parserForExtension(extension: string): string | null {
  return EXTRA_FORMAT_PARSERS[normalizeExtension(extension)] ?? null;
}

/** The third-party plugin package required to format `extension`, or `null` if none is needed. */
export function pluginPackageForExtension(extension: string): string | null {
  return EXTRA_FORMAT_PLUGIN_PACKAGES[normalizeExtension(extension)] ?? null;
}

/** True if formatting `extension` requires the bundled `@prettier/plugin-xml`. */
export function needsXmlPlugin(extension: string): boolean {
  return parserForExtension(extension) === "xml";
}

/**
 * Filter `value` down to the supported, de-dotted, lower-cased, de-duplicated extensions it
 * contains, dropping anything else (wrong type, unsupported, binary). Used both to normalize
 * an already-validated project config and to sanitize possibly-corrupt persisted settings.
 */
export function sanitizeAdditionalFileTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const supported = value.filter(
    (item): item is string => typeof item === "string" && isSupportedExtraExtension(item),
  );
  return [...new Set(supported.map((item) => normalizeExtension(item)))].sort();
}

function normalizeExtension(extension: string): string {
  return extension.trim().toLowerCase().replace(/^\./, "");
}
