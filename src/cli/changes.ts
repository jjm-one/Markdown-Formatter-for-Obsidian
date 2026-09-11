// SPDX-License-Identifier: LGPL-3.0-only

/** Turn a before/after diff into a human-readable list of required changes. */

import { diffLines, groupHunks, type DiffHunk } from "./diff";

export type ChangeKind =
  | "trailing-whitespace"
  | "leading-whitespace"
  | "whitespace"
  | "blank-line-added"
  | "blank-line-removed"
  | "line-added"
  | "line-removed"
  | "line-changed"
  | "final-newline";

export interface FormattingChange {
  /** Whether `line`/`endLine` name real lines in the original file, or an insertion point after them. */
  anchor: "at" | "after";
  /** 1-based; for `anchor: "after"`, 0 means "before the first line". */
  line: number;
  endLine: number;
  kind: ChangeKind;
  message: string;
}

/** Short label and description per {@link ChangeKind}, for report tooling (e.g. SARIF rule metadata). */
export const CHANGE_KIND_INFO: Record<ChangeKind, { name: string; description: string }> = {
  "trailing-whitespace": {
    name: "Trailing whitespace",
    description: "Trailing whitespace at the end of a line.",
  },
  "leading-whitespace": {
    name: "Indentation",
    description: "Leading whitespace (indentation) does not match the formatter's output.",
  },
  whitespace: {
    name: "Whitespace",
    description: "Internal whitespace does not match the formatter's output.",
  },
  "blank-line-added": { name: "Missing blank line", description: "A blank line is required here." },
  "blank-line-removed": {
    name: "Extra blank line",
    description: "This blank line should be removed.",
  },
  "line-added": { name: "Missing content", description: "Content is missing here." },
  "line-removed": { name: "Extra content", description: "This content should be removed." },
  "line-changed": { name: "Content mismatch", description: "Line content does not match." },
  "final-newline": {
    name: "Trailing newline",
    description: "The file must end with exactly one trailing newline.",
  },
};

/**
 * Classify the line-level differences between `original` and `formatted` into a
 * bounded list of actionable changes (e.g. "line 12: Remove trailing whitespace.").
 */
export function createFormattingChanges(
  original: string,
  formatted: string,
  limit = 100,
): FormattingChange[] {
  const a = splitLines(original);
  const b = splitLines(formatted);
  const hunks = groupHunks(diffLines(a, b));
  const changes: FormattingChange[] = [];
  let truncated = false;

  outer: for (const hunk of hunks) {
    for (const change of classifyHunk(hunk, a, b)) {
      if (changes.length >= limit) {
        truncated = true;
        break outer;
      }
      changes.push(change);
    }
  }
  if (truncated) {
    changes.push({
      anchor: "at",
      line: 0,
      endLine: 0,
      kind: "line-changed",
      message: `Further changes omitted after ${limit} entr${limit === 1 ? "y" : "ies"}.`,
    });
  }
  return changes;
}

/** Render a change's location the way a person reading the file would say it. */
export function formatChangeLocation(change: FormattingChange): string {
  if (change.line === 0 && change.anchor === "at") return "…";
  if (change.anchor === "after") return `after line ${change.line}`;
  return change.line === change.endLine
    ? `line ${change.line}`
    : `line ${change.line}-${change.endLine}`;
}

function splitLines(text: string): string[] {
  return text.replaceAll("\r\n", "\n").split("\n");
}

/** Classify one diff hunk. Aligned 1:1 replacements decompose into one entry per line. */
function classifyHunk(
  hunk: DiffHunk,
  a: readonly string[],
  b: readonly string[],
): FormattingChange[] {
  const removed = a.slice(hunk.aStart, hunk.aStart + hunk.aCount);
  const added = b.slice(hunk.bStart, hunk.bStart + hunk.bCount);
  const atEndOfFile =
    hunk.aStart + hunk.aCount === a.length && hunk.bStart + hunk.bCount === b.length;

  if (atEndOfFile && hunk.aCount === 0 && hunk.bCount === 1 && added[0] === "") {
    return [
      {
        anchor: "after",
        line: hunk.aStart,
        endLine: hunk.aStart,
        kind: "final-newline",
        message: "Add a trailing newline at the end of the file.",
      },
    ];
  }
  if (atEndOfFile && hunk.bCount === 0 && hunk.aCount === 1 && removed[0] === "") {
    const line = hunk.aStart + 1;
    return [
      {
        anchor: "at",
        line,
        endLine: line,
        kind: "final-newline",
        message: "Remove the extra trailing newline.",
      },
    ];
  }

  if (hunk.aCount === hunk.bCount && hunk.aCount >= 1) {
    const pairs: FormattingChange[] = [];
    for (let offset = 0; offset < hunk.aCount; offset += 1) {
      const before = removed[offset] ?? "";
      const after = added[offset] ?? "";
      if (before === after) continue;
      pairs.push(classifyLinePair(before, after, hunk.aStart + offset + 1));
    }
    return pairs;
  }

  if (hunk.bCount === 0) {
    const from = hunk.aStart + 1;
    const to = hunk.aStart + hunk.aCount;
    const allBlank = removed.every((line) => line.trim() === "");
    return [
      {
        anchor: "at",
        line: from,
        endLine: to,
        kind: allBlank ? "blank-line-removed" : "line-removed",
        message: allBlank
          ? hunk.aCount === 1
            ? "Remove the blank line."
            : "Remove the blank lines."
          : `Remove ${hunk.aCount} line(s).`,
      },
    ];
  }

  if (hunk.aCount === 0) {
    const allBlank = added.every((line) => line.trim() === "");
    return [
      {
        anchor: "after",
        line: hunk.aStart,
        endLine: hunk.aStart,
        kind: allBlank ? "blank-line-added" : "line-added",
        message: allBlank
          ? hunk.bCount === 1
            ? "Insert a blank line."
            : "Insert blank lines."
          : `Insert ${hunk.bCount} line(s).`,
      },
    ];
  }

  const from = hunk.aStart + 1;
  const to = hunk.aStart + hunk.aCount;
  return [
    {
      anchor: "at",
      line: from,
      endLine: to,
      kind: "line-changed",
      message: `Replace ${hunk.aCount} line(s) with ${hunk.bCount} line(s).`,
    },
  ];
}

/** Classify a single aligned before/after line pair. */
function classifyLinePair(before: string, after: string, line: number): FormattingChange {
  // Same non-whitespace characters in the same order => only whitespace moved,
  // however it's arranged (trailing, leading, collapsed runs, or a single
  // inserted/removed space, e.g. "#Bad" -> "# Bad").
  const stripWhitespace = (value: string) => value.replace(/\s/g, "");
  if (stripWhitespace(before) === stripWhitespace(after)) {
    if (before.replace(/[ \t]+$/, "") === after) {
      return {
        anchor: "at",
        line,
        endLine: line,
        kind: "trailing-whitespace",
        message: "Remove trailing whitespace.",
      };
    }
    if (before.replace(/^[ \t]+/, "") === after.replace(/^[ \t]+/, "")) {
      return {
        anchor: "at",
        line,
        endLine: line,
        kind: "leading-whitespace",
        message: "Fix indentation.",
      };
    }
    return {
      anchor: "at",
      line,
      endLine: line,
      kind: "whitespace",
      message: "Normalize whitespace.",
    };
  }
  return {
    anchor: "at",
    line,
    endLine: line,
    kind: "line-changed",
    message: "Update line content.",
  };
}
