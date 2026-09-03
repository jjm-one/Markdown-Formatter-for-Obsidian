// SPDX-License-Identifier: LGPL-3.0-only

/** Minimal, non-destructive edits to a note's leading YAML frontmatter block. */

const FRONTMATTER = /^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/;

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
  if (typeof content !== "string" || typeof key !== "string" || key.length === 0) return null;
  const block = FRONTMATTER.exec(content);
  if (!block || block.index !== 0) return null;

  const [, open, body, close] = block;
  const rendered = `${key}: ${toYamlScalar(value)}`;

  // Rewrite the first top-level (unindented) line whose key matches.
  const lines = (body ?? "").split("\n");
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
    return `${open}${lines.join("\n")}${close}${content.slice(block[0].length)}`;
  }
  return null;
}
