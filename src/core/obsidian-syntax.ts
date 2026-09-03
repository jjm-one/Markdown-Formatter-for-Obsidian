// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Obsidian-syntax protection: split off Properties/frontmatter, tokenize
 * preserved constructs (wikilinks, math, callouts, tags, ...), and add
 * `prettier-ignore` shields so Prettier only ever reformats plain Markdown.
 */

import type { EffectiveSettings } from "./config";

// Line classifiers used only for placing preserve directives.
function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = trimmed.split("|").map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}
function isTopLevelListItem(line: string): boolean {
  return /^[ ]{0,3}(?:[-+*]|\d+[.)])\s+/.test(line);
}
function isHorizontalRule(line: string): boolean {
  const compact = line.trim().replace(/\s+/g, "");
  return /^(?:\*{3,}|-{3,}|_{3,})$/.test(compact);
}

/**
 * Prefix each block whose structure/link/callout mode is `preserve` with a
 * `<!-- prettier-ignore -->` shield so Prettier leaves that block untouched.
 */
export function addPreserveDirectives(content: string, effective: EffectiveSettings): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let fenceChar: "`" | "~" | null = null;
  let fenceLength = 0;
  let inListBlock = false;
  const addDirective = (kind: string) => {
    out.push(`<!-- markdown-formatter:preserve:${kind} -->`);
    out.push("<!-- prettier-ignore -->");
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fence = line.match(/^[ ]{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1] ?? "";
      const char = marker[0] as "`" | "~";
      if (fenceChar === null) {
        if (effective.markdownStructures.fencedCodeBlocks === "preserve")
          addDirective("fencedCodeBlocks");
        fenceChar = char;
        fenceLength = marker.length;
      } else if (char === fenceChar && marker.length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }
      out.push(line);
      continue;
    }
    if (fenceChar !== null) {
      out.push(line);
      continue;
    }
    if (inListBlock) {
      if (line.trim() === "" || isTopLevelListItem(line) || /^(?:\t| {2,})\S/.test(line)) {
        out.push(line);
        continue;
      }
      inListBlock = false;
    }
    if (
      effective.links.referenceDefinitions === "preserve" &&
      /^[ ]{0,3}\[[^\]\n]+\]:\s+\S+/.test(line)
    ) {
      out.push("<!-- markdown-formatter:preserve:referenceDefinitions -->");
      out.push("<!-- prettier-ignore -->");
    }
    if (
      effective.obsidianSyntax.callouts === "preserve" &&
      /^[ ]{0,3}>[ ]?\[![^\]\n]+\][+-]?/.test(line)
    ) {
      const previous = i > 0 ? (lines[i - 1] ?? "") : "";
      if (!/^[ ]{0,3}>/.test(previous)) addDirective("obsidianCallout");
    }
    if (effective.markdownStructures.tables === "preserve") {
      const next = lines[i + 1];
      if (line.includes("|") && next !== undefined && isTableDelimiter(next))
        addDirective("tables");
    }
    if (effective.markdownStructures.lists === "preserve" && isTopLevelListItem(line)) {
      addDirective("lists");
      inListBlock = true;
    }
    if (effective.markdownStructures.blockquotes === "preserve" && /^[ ]{0,3}>/.test(line)) {
      const previous = i > 0 ? (lines[i - 1] ?? "") : "";
      if (!/^[ ]{0,3}>/.test(previous)) addDirective("blockquotes");
    }
    if (effective.markdownStructures.horizontalRules === "preserve" && isHorizontalRule(line))
      addDirective("horizontalRules");
    out.push(line);
  }
  return out.join("\n");
}

/** Strip the shield comments added by {@link addPreserveDirectives}. */
export function removePreserveDirectives(content: string): string {
  return content.replace(
    /<!-- markdown-formatter:preserve:(?:tables|lists|fencedCodeBlocks|blockquotes|horizontalRules|referenceDefinitions|obsidianCallout) -->\r?\n<!-- prettier-ignore -->\r?\n/g,
    "",
  );
}

/**
 * Split the leading Properties block off `content` so Prettier never sees it, and
 * return a `restore` that reattaches it byte-for-byte. The match includes the
 * blank lines after the closing `---` so they survive reformatting of the body.
 */
export function extractProtectedFrontmatter(
  content: string,
  effective: EffectiveSettings,
): { content: string; restore: (value: string) => string } {
  if (effective.obsidianSyntax.properties !== "preserve")
    return { content, restore: (value) => value };
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n(?:[ \t]*\r?\n)*)?/);
  if (!match) return { content, restore: (value) => value };
  const prefix = match[0];
  return { content: content.slice(prefix.length), restore: (value) => `${prefix}${value}` };
}

/**
 * A run of opaque placeholder tokens. `protect` swaps a matched fragment for a
 * token; `restore` swaps every token back — looping in case a restored fragment
 * holds another token (nested protection). `replaceAll(token, () => original)`
 * uses a function replacer so `$&`/`$1` in `original` stay literal.
 */
function createTokenStore(defaultKind: string) {
  const originals = new Map<string, string>();
  let counter = 0;
  const protect = (value: string, kind = defaultKind): string => {
    const token = `MDF${kind}TOKEN${String(counter++).padStart(8, "0")}X`;
    originals.set(token, value);
    return token;
  };
  const restore = (value: string): string => {
    let restored = value;
    for (let pass = 0; pass < 4; pass += 1) {
      let changed = false;
      for (const [token, original] of originals) {
        if (restored.includes(token)) {
          restored = restored.replaceAll(token, () => original);
          changed = true;
        }
      }
      if (!changed) break;
    }
    return restored;
  };
  return { protect, restore };
}

/**
 * Replace preserved Obsidian tokens (comments, math, footnotes, highlights,
 * block IDs, tags) with opaque placeholders, and return a `restore` that swaps
 * them back.
 */
export function protectObsidianSyntax(
  content: string,
  effective: EffectiveSettings,
): { content: string; restore: (value: string) => string } {
  const { protect, restore } = createTokenStore("OBS");
  let protectedContent = content;
  if (effective.obsidianSyntax.comments === "preserve")
    protectedContent = protectedContent.replace(/%%[\s\S]*?%%/g, (value) =>
      protect(value, "COMMENT"),
    );
  if (effective.obsidianSyntax.math === "preserve") {
    protectedContent = protectedContent.replace(/\$\$[\s\S]*?\$\$/g, (value) =>
      protect(value, "MATHBLOCK"),
    );
    // `\\` is excluded from the fallback class so only `\\.` can consume a
    // backslash — disjoint alternatives, no exponential backtracking.
    protectedContent = protectedContent.replace(
      /(?<!\\)\$(?!\$)(?:\\.|[^\n$\\])+?(?<!\\)\$/g,
      (value) => protect(value, "MATH"),
    );
  }
  if (effective.obsidianSyntax.inlineFootnotes === "preserve")
    protectedContent = protectedContent.replace(/\^\[(?:\\.|[^\]\n\\])*\]/g, (value) =>
      protect(value, "FOOTNOTE"),
    );
  if (effective.obsidianSyntax.highlights === "preserve")
    protectedContent = protectedContent.replace(/==(?=\S)(?:\\.|[^\n\\])*?(?<=\S)==/g, (value) =>
      protect(value, "HIGHLIGHT"),
    );
  if (effective.obsidianSyntax.blockIds === "preserve")
    protectedContent = protectedContent.replace(
      /[ \t]+\^[A-Za-z0-9-]+(?=[ \t]*(?:\r?$))/gm,
      (value) => protect(value, "BLOCKID"),
    );
  if (effective.obsidianSyntax.tags === "preserve") {
    protectedContent = protectedContent.replace(
      /(^|[\s([{>])#[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*/gmu,
      (value, prefix: string) => `${prefix}${protect(value.slice(prefix.length), "TAG")}`,
    );
  }
  return { content: protectedContent, restore };
}

/**
 * Replace preserved link syntax (wikilinks, embeds, angle-bracket autolinks, and
 * inline/reference Markdown links) with opaque placeholders, with a `restore`.
 */
export function protectInlineLinks(
  content: string,
  effective: EffectiveSettings,
): { content: string; restore: (value: string) => string } {
  const { protect, restore } = createTokenStore("LINK");
  const tokenize = (value: string) => protect(value);
  let protectedContent = content;
  if (effective.links.obsidianWikilinks === "preserve")
    protectedContent = protectedContent.replace(/!?\[\[[^\]\n]+?\]\]/g, tokenize);
  if (effective.links.autolinks === "preserve")
    protectedContent = protectedContent.replace(/<(?:https?:\/\/|mailto:)[^>\n]+>/gi, tokenize);
  if (effective.links.markdownLinks === "preserve") {
    // `\([^()\n]*\)` allows one level of balanced parens in the destination, e.g.
    // `[x](https://en.wikipedia.org/wiki/Foo_(bar))`. The three branches are
    // disjoint by first character (`\\`, `(`, anything else), so no backtracking.
    protectedContent = protectedContent.replace(
      /!?\[[^\]\n]*\]\((?:\\.|\([^()\n]*\)|[^()\n\\])*\)/g,
      tokenize,
    );
    protectedContent = protectedContent.replace(/!?\[[^\]\n]+\]\[[^\]\n]*\]/g, tokenize);
  }
  return { content: protectedContent, restore };
}
