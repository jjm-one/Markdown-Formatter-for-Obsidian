// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

/** Detection of, and minimal non-destructive edits to, a note's leading YAML frontmatter block. */

const FRONTMATTER = /^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/;

/** A note's leading frontmatter block, split into its delimiters and body. */
export interface FrontmatterBlock {
  /** The opening `---` line, including its line ending. */
  open: string;
  body: string;
  /** The closing `---` line, including its line ending (if any). */
  close: string;
  /** Length of the whole block in the source text. */
  length: number;
}

/** The frontmatter block at the very start of `content`, or `null` if there is none. */
export function matchFrontmatter(content: string): FrontmatterBlock | null {
  const match = FRONTMATTER.exec(content);
  if (!match) return null;
  const [block, open = "", body = "", close = ""] = match;
  return { open, body, close, length: block.length };
}

/**
 * Render `value` as a YAML scalar. Plain letters/digits/spaces and date
 * separators are left bare; anything else (e.g. a `:` from a time format) is
 * double-quoted so a parser cannot misread it.
 */
function toYamlScalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9 _\-./,]*$/.test(value) ? value : JSON.stringify(value);
}

/** Strip one matching pair of surrounding single or double quotes. */
function unquote(text: string): string {
  const first = text[0];
  if ((first === '"' || first === "'") && text.length >= 2 && text.at(-1) === first) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Set an **existing** top-level scalar property in `content`'s frontmatter to
 * `value`. Returns the updated document, or `null` when there is nothing to do:
 * no frontmatter, the key is absent (it is never added), or the value already
 * matches. Only the matched line changes; key quoting and spacing are kept.
 */
export function setFrontmatterProperty(content: string, key: string, value: string): string | null {
  if (key.length === 0) return null;
  const block = matchFrontmatter(content);
  if (!block) return null;

  const rendered = `${key}: ${toYamlScalar(value)}`;

  // Rewrite the first top-level (unindented) line whose key matches.
  const lines = block.body.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (raw.length === 0 || raw[0] === " " || raw[0] === "\t") continue; // nested / blank
    const carriageReturn = raw.endsWith("\r");
    const text = carriageReturn ? raw.slice(0, -1) : raw;
    const colon = text.indexOf(":");
    if (colon === -1) continue;
    if (unquote(text.slice(0, colon).trimEnd()) !== key) continue;

    if (text === rendered) return null;
    lines[i] = carriageReturn ? `${rendered}\r` : rendered;
    return `${block.open}${lines.join("\n")}${block.close}${content.slice(block.length)}`;
  }
  return null;
}
