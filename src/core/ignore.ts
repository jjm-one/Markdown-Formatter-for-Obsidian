// SPDX-License-Identifier: LGPL-3.0-only

/** Gitignore-style ignore-pattern parsing and matching for Markdown discovery. */

/** Parse an ignore file's text into a trimmed, comment- and blank-free pattern list. */
export function parseIgnorePatterns(source: string): string[] {
  if (typeof source !== "string") throw new Error("Ignore file contents must be text.");
  if (source.length > 1024 * 1024)
    throw new Error("Ignore file is larger than the supported 1 MiB limit.");
  if (source.includes("\0")) throw new Error("Ignore file contains an invalid NUL character.");
  const patterns = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (patterns.length > 10000) throw new Error("Ignore file contains more than 10000 patterns.");
  const oversized = patterns.find((pattern) => pattern.length > 4096);
  if (oversized !== undefined) throw new Error("Ignore patterns may not exceed 4096 characters.");
  return patterns;
}

/** A reusable tester for repo-relative paths against a fixed set of gitignore-style patterns. */
export interface IgnoreMatcher {
  matches(relativePath: string): boolean;
}

interface CompiledIgnoreRule {
  negated: boolean;
  test: (normalizedPath: string) => boolean;
}

// Isolated so the `Array.isArray` narrowing to `any[]` does not leak into callers.
function assertValidIgnorePatternList(patterns: unknown): asserts patterns is readonly string[] {
  if (
    !Array.isArray(patterns) ||
    !patterns.every(
      (pattern) => typeof pattern === "string" && pattern.length <= 4096 && !pattern.includes("\0"),
    )
  ) {
    throw new Error(
      "Ignore patterns must be strings of at most 4096 characters without NUL characters.",
    );
  }
}

/** Compile ignore patterns once so a directory walk does not rebuild a RegExp per path. */
export function createIgnoreMatcher(patterns: readonly string[]): IgnoreMatcher {
  assertValidIgnorePatternList(patterns);

  const rules: CompiledIgnoreRule[] = [];
  for (const rawPattern of patterns) {
    let pattern: string = rawPattern.trim();
    if (!pattern || pattern.startsWith("#")) continue;

    const negated: boolean = pattern.startsWith("!");
    if (negated) pattern = pattern.slice(1).trim();
    if (!pattern) continue;

    const test = compileIgnorePattern(pattern);
    if (test !== null) rules.push({ negated, test });
  }

  return {
    matches(relativePath: string): boolean {
      if (typeof relativePath !== "string" || relativePath.includes("\0"))
        throw new Error("Path to test against ignore patterns is invalid.");
      const normalizedPath = normalizeIgnorePath(relativePath);
      let ignored = false;
      for (const rule of rules) {
        if (rule.test(normalizedPath)) ignored = !rule.negated;
      }
      return ignored;
    },
  };
}

/** One-shot convenience wrapper around {@link createIgnoreMatcher}. */
export function isPathIgnored(relativePath: string, patterns: readonly string[]): boolean {
  return createIgnoreMatcher(patterns).matches(relativePath);
}

function normalizeIgnorePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Compile one gitignore-style pattern into a path predicate, or null if it is empty.
 *
 * The pattern is matched without building a dynamic `RegExp`: glob metacharacters
 * are pre-parsed into tokens and matched by {@link globMatches}, whose memoised
 * walk is linear in `tokens.length * path.length` and so cannot backtrack
 * pathologically regardless of the pattern.
 */
function compileIgnorePattern(rawPattern: string): ((normalizedPath: string) => boolean) | null {
  let pattern = normalizeIgnorePath(rawPattern);
  const rootAnchored = rawPattern.trim().startsWith("/");
  const directoryPattern = pattern.endsWith("/");
  pattern = pattern.replace(/\/+$/, "");
  if (!pattern) return null;

  const tokens = parseGlob(pattern);
  const atEnd = (path: string, pos: number): boolean => pos === path.length;
  const atSegmentEnd = (path: string, pos: number): boolean =>
    pos === path.length || path[pos] === "/";

  // Anchored to the vault root, or contains a slash: the whole path must match.
  if (rootAnchored || pattern.includes("/")) {
    const accept = directoryPattern ? atSegmentEnd : atEnd;
    return (path) => globMatches(tokens, path, 0, (pos) => accept(path, pos));
  }

  // A bare name: match it against any single path segment. The trailing
  // "match anything below" is added for directory patterns and for names
  // without a dot (gitignore's "this name, anywhere" behaviour).
  const accept = directoryPattern || !pattern.includes(".") ? atSegmentEnd : atEnd;
  return (path) => {
    for (let start = 0; start <= path.length; start += 1) {
      if (
        (start === 0 || path[start - 1] === "/") &&
        globMatches(tokens, path, start, (pos) => accept(path, pos))
      ) {
        return true;
      }
    }
    return false;
  };
}

type GlobToken =
  | { kind: "literal"; value: string }
  | { kind: "anyChar" } // ?   — one character other than "/"
  | { kind: "star" } // *   — zero or more characters other than "/"
  | { kind: "globstarSlash" } // **/ — zero or more complete path segments
  | { kind: "globstar" }; // **  — zero or more characters, "/" included

/** Split a glob into literal runs and wildcard tokens. */
function parseGlob(pattern: string): GlobToken[] {
  const tokens: GlobToken[] = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        tokens.push({ kind: "globstarSlash" });
        index += 2;
      } else {
        tokens.push({ kind: "globstar" });
        index += 1;
      }
    } else if (char === "*") {
      tokens.push({ kind: "star" });
    } else if (char === "?") {
      tokens.push({ kind: "anyChar" });
    } else {
      const last = tokens[tokens.length - 1];
      if (last?.kind === "literal") last.value += char;
      else tokens.push({ kind: "literal", value: char ?? "" });
    }
  }
  return tokens;
}

/**
 * Does `tokens` match `text` starting at `start`, ending where `accept` allows?
 * A set of failed `(tokenIndex, textIndex)` states keeps the walk linear.
 */
function globMatches(
  tokens: readonly GlobToken[],
  text: string,
  start: number,
  accept: (pos: number) => boolean,
): boolean {
  const stride = text.length + 1;
  const failed = new Set<number>();

  const walk = (ti: number, si: number): boolean => {
    const token = tokens[ti];
    if (token === undefined) return accept(si);

    const key = ti * stride + si;
    if (failed.has(key)) return false;

    let matched = false;
    if (token.kind === "literal") {
      matched = text.startsWith(token.value, si) && walk(ti + 1, si + token.value.length);
    } else if (token.kind === "anyChar") {
      matched = si < text.length && text[si] !== "/" && walk(ti + 1, si + 1);
    } else if (token.kind === "star") {
      for (let pos = si; ; pos += 1) {
        if (walk(ti + 1, pos)) {
          matched = true;
          break;
        }
        if (pos >= text.length || text[pos] === "/") break;
      }
    } else if (token.kind === "globstar") {
      for (let pos = si; ; pos += 1) {
        if (walk(ti + 1, pos)) {
          matched = true;
          break;
        }
        if (pos >= text.length) break;
      }
    } else if (walk(ti + 1, si)) {
      matched = true; // globstarSlash consuming no segments
    } else {
      for (let pos = si; pos < text.length; pos += 1) {
        if (text[pos] === "/" && walk(ti + 1, pos + 1)) {
          matched = true;
          break;
        }
      }
    }

    if (!matched) failed.add(key);
    return matched;
  };

  return walk(0, start);
}
