// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Turn a before/after pair of Markdown texts into the complete list of changes the
 * formatter makes: each with a location, a human-readable description, and the
 * exact original and expected lines.
 */

import { diffLines } from "./diff";

export type ChangeKind =
  | "trailing-whitespace"
  | "leading-whitespace"
  | "whitespace"
  | "list-marker"
  | "list-numbering"
  | "heading"
  | "emphasis"
  | "escape"
  | "code-fence"
  | "horizontal-rule"
  | "table"
  | "rewrap"
  | "blank-line-added"
  | "blank-line-removed"
  | "line-added"
  | "line-removed"
  | "line-changed"
  | "final-newline"
  | "line-endings"
  | "encoding";

export interface FormattingChange {
  /**
   * `at`: `line`–`endLine` are real lines of the original file. `after`: an
   * insertion point after `line` (0 = start of file). `file`: the whole file.
   */
  anchor: "at" | "after" | "file";
  /** 1-based line in the original file. */
  line: number;
  endLine: number;
  kind: ChangeKind;
  /** Human-readable description of what has to change, e.g. "Change the list marker "*" to "-"." */
  message: string;
  /** The original lines this change replaces or removes (empty for a pure insertion). */
  before: string[];
  /** The lines the formatter produces instead (empty for a pure removal). */
  after: string[];
}

/** Short label and description per {@link ChangeKind}, for report tooling (e.g. SARIF rule metadata). */
export const CHANGE_KIND_INFO: Record<ChangeKind, { name: string; description: string }> = {
  "trailing-whitespace": {
    name: "Trailing whitespace",
    description: "Lines must not end with spaces or tabs.",
  },
  "leading-whitespace": {
    name: "Indentation",
    description: "Leading whitespace (indentation) does not match the formatter's output.",
  },
  whitespace: {
    name: "Whitespace",
    description: "Spacing inside the line does not match the formatter's output.",
  },
  "list-marker": {
    name: "List marker",
    description: "Bullet list items use one consistent marker character.",
  },
  "list-numbering": {
    name: "List numbering",
    description: "Ordered list items are numbered consistently.",
  },
  heading: {
    name: "Heading style",
    description: "Headings use the ATX style (# Heading) with a space after the # marker.",
  },
  emphasis: {
    name: "Emphasis markers",
    description: "Bold and italic text use one consistent marker style.",
  },
  escape: {
    name: "Escaping",
    description: "Special characters are escaped only where Markdown requires it.",
  },
  "code-fence": {
    name: "Code fence",
    description: "Fenced code blocks use one consistent fence style.",
  },
  "horizontal-rule": {
    name: "Horizontal rule",
    description: "Horizontal rules (thematic breaks) use one consistent style.",
  },
  table: {
    name: "Table formatting",
    description: "Table columns are aligned and the separator row is normalized.",
  },
  rewrap: {
    name: "Line wrapping",
    description: "Paragraph text is wrapped according to the configured prose wrap.",
  },
  "blank-line-added": {
    name: "Missing blank line",
    description:
      "Blocks such as headings, lists, tables, and code must be separated by a blank line.",
  },
  "blank-line-removed": {
    name: "Extra blank line",
    description: "Blocks are separated by exactly one blank line.",
  },
  "line-added": { name: "Missing content", description: "The formatter adds content here." },
  "line-removed": { name: "Extra content", description: "The formatter removes this content." },
  "line-changed": {
    name: "Content mismatch",
    description: "Line content does not match the formatter's output.",
  },
  "final-newline": {
    name: "End of file",
    description: "The file must end with exactly one newline and no trailing blank lines.",
  },
  "line-endings": {
    name: "Line endings",
    description: "All lines use the configured line ending.",
  },
  encoding: {
    name: "Encoding",
    description: "Files are UTF-8 without a byte order mark.",
  },
};

/**
 * Aligning lines costs O(D·(N+M)) memory for D differing lines; past this many
 * edits a region is described as one block instead of line by line.
 */
const MAX_ALIGNMENT_EDITS = 5000;

/** Classify every difference between `original` and `formatted` into actionable changes. */
export function createFormattingChanges(original: string, formatted: string): FormattingChange[] {
  if (original === formatted) return [];
  const changes: FormattingChange[] = [];

  const originalBom = original.startsWith("\uFEFF");
  const formattedBom = formatted.startsWith("\uFEFF");
  if (originalBom !== formattedBom) {
    changes.push(
      fileChange(
        "encoding",
        originalBom
          ? "Remove the byte order mark (BOM) at the start of the file."
          : "Add a byte order mark (BOM) at the start of the file.",
      ),
    );
  }
  const a = originalBom ? original.slice(1) : original;
  const b = formattedBom ? formatted.slice(1) : formatted;

  const originalEol = lineEndingStyle(a);
  const formattedEol = lineEndingStyle(b);
  if (originalEol !== formattedEol && originalEol !== "none" && formattedEol !== "none") {
    const from = originalEol === "mixed" ? "mixed line endings" : `${originalEol} line endings`;
    changes.push(fileChange("line-endings", `Convert ${from} to ${formattedEol}.`));
  }

  const before = splitContent(a);
  const after = splitContent(b);
  changes.push(...describeLines(before.lines, after.lines));

  if (before.finalNewline !== after.finalNewline) {
    const last = before.lines.length;
    changes.push(
      after.finalNewline
        ? {
            anchor: "after",
            line: last,
            endLine: last,
            kind: "final-newline",
            message: "Add a newline at the end of the file.",
            before: [],
            after: [],
          }
        : {
            anchor: "at",
            line: Math.max(1, last),
            endLine: Math.max(1, last),
            kind: "final-newline",
            message: "Remove the newline at the end of the file.",
            before: [],
            after: [],
          },
    );
  }

  // Differences no classifier names (e.g. invisible characters) get a generic change.
  if (changes.length === 0) {
    changes.push(fileChange("line-changed", "File content differs from the formatter output."));
  }
  return changes;
}

/** One entry of the compact `check --show-errors` listing. */
export interface FormattingDiagnostic {
  /** Where the change applies, e.g. "line 3" or "after line 7"; empty for the omission note. */
  location: string;
  message: string;
  /** The current lines, joined with "\n"; absent for a pure insertion. */
  actual?: string;
  /** The formatted lines, joined with "\n"; absent for a pure removal. */
  expected?: string;
}

/**
 * A bounded, compact view of `changes` for `check --show-errors`: one entry per
 * change (at most `limit`), plus a note saying how many more were omitted.
 */
export function createFormattingDiagnostics(
  changes: readonly FormattingChange[],
  limit = 20,
): FormattingDiagnostic[] {
  const diagnostics: FormattingDiagnostic[] = changes.slice(0, limit).map((change) => ({
    location: formatChangeLocation(change),
    message: change.message,
    ...(change.before.length > 0 ? { actual: change.before.join("\n") } : {}),
    ...(change.after.length > 0 ? { expected: change.after.join("\n") } : {}),
  }));
  const omitted = changes.length - limit;
  if (omitted > 0) {
    diagnostics.push({
      location: "",
      message: `${plural(omitted, "further change")} omitted (limit ${limit}).`,
    });
  }
  return diagnostics;
}

/** Render a change's location the way a person reading the file would say it. */
export function formatChangeLocation(change: FormattingChange): string {
  if (change.anchor === "file") return "whole file";
  if (change.anchor === "after") {
    return change.line === 0 ? "start of file" : `after line ${change.line}`;
  }
  return change.line === change.endLine
    ? `line ${change.line}`
    : `line ${change.line}-${change.endLine}`;
}

function fileChange(kind: ChangeKind, message: string): FormattingChange {
  return { anchor: "file", line: 1, endLine: 1, kind, message, before: [], after: [] };
}

function lineEndingStyle(text: string): "CRLF" | "LF" | "mixed" | "none" {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) return "none";
  if (crlf > 0 && lf > 0) return "mixed";
  return crlf > 0 ? "CRLF" : "LF";
}

function splitContent(text: string): { lines: string[]; finalNewline: boolean } {
  const normalized = text.replaceAll("\r\n", "\n");
  const finalNewline = normalized.endsWith("\n");
  const body = finalNewline ? normalized.slice(0, -1) : normalized;
  return { lines: body === "" && !finalNewline ? [] : body.split("\n"), finalNewline };
}

// --- Line alignment -----------------------------------------------------------

const BULLET = /^([-*+])(?=\s|$)/;
const ORDERED = /^(\d{1,9})([.)])(?=\s|$)/;
const FENCE = /^(`{3,}|~{3,})/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Alignment key that ignores whitespace, list markers/numbers, emphasis markers,
 * escapes, and fence or rule characters, so differently formatted versions of
 * the same line pair up.
 */
function alignmentKey(line: string): string {
  const trimmed = line.trim();
  if (trimmed === "") return "blank";
  if (THEMATIC_BREAK.test(line)) return "rule";
  if (TABLE_SEPARATOR.test(trimmed) && trimmed.includes("|")) return "table-separator";
  return `text:${trimmed
    .replace(/^(?:[-*+]|\d{1,9}[.)])(?=\s|$)/, "•")
    .replace(FENCE, "fence")
    .replace(/\s+#+$/, "")
    .replace(/[\s\\*_]/g, "")}`;
}

function describeLines(a: readonly string[], b: readonly string[]): FormattingChange[] {
  // Common prefix/suffix are cheap to skip and keep the alignment small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd -= 1;
    bEnd -= 1;
  }
  if (start === aEnd && start === bEnd) return [];

  const ops = diffLines(
    a.slice(start, aEnd).map(alignmentKey),
    b.slice(start, bEnd).map(alignmentKey),
    MAX_ALIGNMENT_EDITS,
  );
  if (ops === undefined) return describeRun(a, b, start, aEnd, start, bEnd);

  const changes: FormattingChange[] = [];
  let i = start;
  let j = start;
  let k = 0;
  while (k < ops.length) {
    if (ops[k] === "equal") {
      const before = a[i] ?? "";
      const after = b[j] ?? "";
      if (before !== after) changes.push(describeLinePair(before, after, i + 1));
      i += 1;
      j += 1;
      k += 1;
      continue;
    }
    const runA = i;
    const runB = j;
    while (k < ops.length && ops[k] !== "equal") {
      if (ops[k] === "delete") i += 1;
      else j += 1;
      k += 1;
    }
    changes.push(...describeRun(a, b, runA, i, runB, j));
  }
  return mergeAdjacent(changes);
}

// --- Unpaired runs: inserted/removed blank lines and content blocks -----------

function describeRun(
  a: readonly string[],
  b: readonly string[],
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): FormattingChange[] {
  const before = a.slice(aStart, aEnd);
  const after = b.slice(bStart, bEnd);
  const removedContent = before.filter((line) => line.trim() !== "");
  const addedContent = after.filter((line) => line.trim() !== "");

  // Only blank lines moved: say where a separator is missing or superfluous.
  if (removedContent.length === 0 && addedContent.length === 0) {
    const delta = after.length - before.length;
    if (delta > 0) return [blankLinesAdded(a, aStart, aEnd, delta)];
    if (delta < 0) {
      return [
        blankLinesRemoved(
          a,
          Array.from({ length: -delta }, (_, i) => aStart + i),
        ),
      ];
    }
    return [];
  }

  // Content changed. The change carries the run's exact lines (blank ones
  // included), so applying every reported change reproduces the formatter output.
  const blankNote = describeBlankDelta(
    before.length - removedContent.length,
    after.length - addedContent.length,
  );
  if (before.length === 0) {
    return [
      {
        anchor: "after",
        line: aStart,
        endLine: aStart,
        kind: "line-added",
        message:
          addedContent.length === 1
            ? `Insert a ${describeBlock(addedContent[0] ?? "")} line${blankNote}.`
            : `Insert ${addedContent.length} lines${blankNote}.`,
        before,
        after,
      },
    ];
  }
  const location = { anchor: "at" as const, line: aStart + 1, endLine: aEnd, before, after };
  if (addedContent.length === 0) {
    return [
      {
        ...location,
        kind: "line-removed",
        message:
          removedContent.length === 1
            ? `Remove this ${describeBlock(removedContent[0] ?? "")} line${blankNote}.`
            : `Remove these ${removedContent.length} lines${blankNote}.`,
      },
    ];
  }
  const replacement = describeReplacement(removedContent, addedContent);
  return [
    {
      ...location,
      kind: replacement.kind,
      message: `${replacement.message.slice(0, -1)}${blankNote}.`,
    },
  ];
}

/** ", and add 1 blank line" style suffix when a content change also moves blank lines. */
function describeBlankDelta(removedBlank: number, addedBlank: number): string {
  const delta = addedBlank - removedBlank;
  if (delta === 0) return "";
  return delta > 0
    ? `, and add ${plural(delta, "blank line")}`
    : `, and remove ${plural(-delta, "blank line")}`;
}

function describeReplacement(
  before: readonly string[],
  after: readonly string[],
): Pick<FormattingChange, "kind" | "message"> {
  const heading = /^(#{1,2}) /.exec(after[0] ?? "");
  if (
    before.length === 2 &&
    after.length === 1 &&
    heading &&
    /^ {0,3}(=+|-+)\s*$/.test(before[1] ?? "")
  ) {
    return {
      kind: "heading",
      message: `Convert the underlined (setext) heading to an ATX heading ("${heading[1]} …").`,
    };
  }
  if ([...before, ...after].every((line) => line.trim() === "" || isTableRow(line))) {
    return { kind: "table", message: "Reformat the table and align its columns." };
  }
  const collapse = (lines: readonly string[]) => lines.join(" ").replace(/\s+/g, " ").trim();
  if (collapse(before) === collapse(after)) {
    return {
      kind: "rewrap",
      message:
        before.length === after.length
          ? "Re-wrap the paragraph text at different line breaks."
          : `Re-wrap the paragraph text: ${plural(before.length, "line")} become ${plural(after.length, "line")}.`,
    };
  }
  return {
    kind: "line-changed",
    message: `Replace ${plural(before.length, "line")} with ${plural(after.length, "line")}.`,
  };
}

function blankLinesAdded(
  a: readonly string[],
  aStart: number,
  aEnd: number,
  count: number,
): FormattingChange {
  const previous = findContent(a, aStart - 1, -1);
  const next = findContent(a, aEnd, 1);
  const what = count === 1 ? "a blank line" : `${count} blank lines`;
  let message: string;
  if (previous !== undefined && next !== undefined) {
    message = `Insert ${what} between the ${describeBlock(a[previous] ?? "")} (line ${previous + 1}) and the ${describeBlock(a[next] ?? "")} (line ${next + 1}).`;
  } else if (next !== undefined) {
    message = `Insert ${what} at the start of the file, before the ${describeBlock(a[next] ?? "")} (line ${next + 1}).`;
  } else {
    message = `Insert ${what} at the end of the file.`;
  }
  return {
    anchor: "after",
    line: aStart,
    endLine: aStart,
    kind: "blank-line-added",
    message,
    before: [],
    after: Array.from({ length: count }, () => ""),
  };
}

function blankLinesRemoved(a: readonly string[], removed: readonly number[]): FormattingChange {
  const first = removed[0] ?? 0;
  const last = removed.at(-1) ?? first;
  const count = removed.length;
  const previous = findContent(a, first - 1, -1);
  const next = findContent(a, last + 1, 1);
  const base = {
    anchor: "at" as const,
    line: first + 1,
    endLine: last + 1,
    before: removed.map((index) => a[index] ?? ""),
    after: [],
  };

  if (next === undefined) {
    return {
      ...base,
      kind: "final-newline",
      message:
        count === 1
          ? "Remove the blank line at the end of the file."
          : `Remove the ${count} blank lines at the end of the file.`,
    };
  }
  const nextLabel = `${describeBlock(a[next] ?? "")} (line ${next + 1})`;
  if (previous === undefined) {
    return {
      ...base,
      kind: "blank-line-removed",
      message: `Remove ${count === 1 ? "the blank line" : `the ${count} blank lines`} at the start of the file, before the ${nextLabel}.`,
    };
  }
  const previousLabel = `${describeBlock(a[previous] ?? "")} (line ${previous + 1})`;
  const removedSet = new Set(removed);
  let keepsBlank = false;
  for (let index = previous + 1; index < next; index += 1) {
    if (!removedSet.has(index)) keepsBlank = true;
  }
  return {
    ...base,
    kind: "blank-line-removed",
    message: keepsBlank
      ? `Remove ${count === 1 ? "an extra blank line" : `${count} extra blank lines`} between the ${previousLabel} and the ${nextLabel}; a single blank line separates them.`
      : `Remove ${count === 1 ? "the blank line" : `the ${count} blank lines`} between the ${previousLabel} and the ${nextLabel}.`,
  };
}

// --- Paired lines: same line, formatted differently ---------------------------

/** Order in which fixes are listed; the first one also names the change's kind. */
const FIX_PRIORITY: readonly ChangeKind[] = [
  "heading",
  "list-marker",
  "list-numbering",
  "code-fence",
  "horizontal-rule",
  "table",
  "emphasis",
  "escape",
  "leading-whitespace",
  "whitespace",
  "trailing-whitespace",
  "line-changed",
];

interface Fix {
  kind: ChangeKind;
  text: string;
}

function describeLinePair(before: string, after: string, line: number): FormattingChange {
  const base = { anchor: "at" as const, line, endLine: line, before: [before], after: [after] };
  if (before.trim() === "" && after === "") {
    return {
      ...base,
      kind: "trailing-whitespace",
      message: "Remove the whitespace from this blank line.",
    };
  }

  const fixes: Fix[] = [];
  let current = before;

  const trailingBefore = /[ \t]+$/.exec(current)?.[0] ?? "";
  const trailingAfter = /[ \t]+$/.exec(after)?.[0] ?? "";
  if (trailingBefore !== trailingAfter) {
    fixes.push({
      kind: "trailing-whitespace",
      text:
        trailingAfter === ""
          ? `remove the trailing whitespace (${describeWhitespace(trailingBefore)})`
          : trailingAfter === "  "
            ? `reduce the trailing whitespace from ${describeWhitespace(trailingBefore)} to 2 spaces (a Markdown hard line break)`
            : `change the trailing whitespace from ${describeWhitespace(trailingBefore)} to ${describeWhitespace(trailingAfter)}`,
    });
    current = current.slice(0, current.length - trailingBefore.length) + trailingAfter;
  }

  const leadBefore = /^[ \t]*/.exec(current)?.[0] ?? "";
  const leadAfter = /^[ \t]*/.exec(after)?.[0] ?? "";
  if (leadBefore !== leadAfter) {
    fixes.push({
      kind: "leading-whitespace",
      text: `change the indentation from ${describeIndent(leadBefore)} to ${describeIndent(leadAfter)}`,
    });
    current = leadAfter + current.slice(leadBefore.length);
  }

  // From here on both lines share their indentation; compare the bodies.
  let body = current.slice(leadAfter.length);
  const target = after.slice(leadAfter.length);

  const bulletBefore = BULLET.exec(body);
  const bulletAfter = BULLET.exec(target);
  if (bulletBefore && bulletAfter && bulletBefore[1] !== bulletAfter[1]) {
    fixes.push({
      kind: "list-marker",
      text: `change the list marker "${bulletBefore[1]}" to "${bulletAfter[1]}"`,
    });
    body = (bulletAfter[1] ?? "") + body.slice(1);
  }

  const orderedBefore = ORDERED.exec(body);
  const orderedAfter = ORDERED.exec(target);
  if (orderedBefore && orderedAfter && orderedBefore[0] !== orderedAfter[0]) {
    fixes.push({
      kind: "list-numbering",
      text: `renumber the list item from "${orderedBefore[0]}" to "${orderedAfter[0]}"`,
    });
    body = orderedAfter[0] + body.slice(orderedBefore[0].length);
  }

  const headingBefore = /^(#{1,6})(?=[^\s#])/.exec(body);
  if (headingBefore && /^#{1,6}\s/.test(target)) {
    fixes.push({ kind: "heading", text: "add a space after the heading marker" });
    body = `${headingBefore[1]} ${body.slice(headingBefore[0].length)}`;
  }
  if (/^#{1,6}\s/.test(body) && /\s+#+\s*$/.test(body) && !/\s+#+\s*$/.test(target)) {
    fixes.push({ kind: "heading", text: "remove the closing # characters from the heading" });
    body = body.replace(/\s+#+\s*$/, "");
  }

  const fenceBefore = FENCE.exec(body);
  const fenceAfter = FENCE.exec(target);
  if (fenceBefore && fenceAfter && fenceBefore[1] !== fenceAfter[1]) {
    fixes.push({
      kind: "code-fence",
      text: `change the code fence "${fenceBefore[1]}" to "${fenceAfter[1]}"`,
    });
    body = (fenceAfter[1] ?? "") + body.slice((fenceBefore[1] ?? "").length);
  }

  if (THEMATIC_BREAK.test(body) && THEMATIC_BREAK.test(target) && body !== target) {
    fixes.push({
      kind: "horizontal-rule",
      text: `change the horizontal rule "${body.trim()}" to "${target.trim()}"`,
    });
    body = target;
  }

  if (body !== target) fixes.push(...describeInlineDifference(body, target));

  fixes.sort((x, y) => FIX_PRIORITY.indexOf(x.kind) - FIX_PRIORITY.indexOf(y.kind));
  const message = fixes.map((fix) => fix.text).join("; ");
  return {
    ...base,
    kind: fixes[0]?.kind ?? "line-changed",
    message: `${message.charAt(0).toUpperCase()}${message.slice(1)}.`,
  };
}

type Normalization = "whitespace" | "spacing" | "emphasis" | "escape";

const NORMALIZERS: Record<Normalization, (value: string) => string> = {
  whitespace: (value) => value.replace(/[ \t]+/g, " "),
  spacing: (value) => value.replace(/[ \t]+/g, ""),
  emphasis: (value) => value.replace(/[*_]/g, "*"),
  // CommonMark lets a backslash escape any ASCII punctuation character.
  escape: (value) => value.replace(/\\(?=[!-/:-@[-`{-~])/g, ""),
};

/** Smallest set of normalizations that makes the two bodies equal, in increasing order of size. */
const NORMALIZATION_SETS: readonly (readonly Normalization[])[] = [
  ["whitespace"],
  ["emphasis"],
  ["escape"],
  ["spacing"],
  ["whitespace", "emphasis"],
  ["whitespace", "escape"],
  ["emphasis", "escape"],
  ["spacing", "emphasis"],
  ["spacing", "escape"],
  ["whitespace", "emphasis", "escape"],
  ["spacing", "emphasis", "escape"],
];

function describeInlineDifference(body: string, target: string): Fix[] {
  const table = isTableRow(body) && isTableRow(target);
  for (const set of NORMALIZATION_SETS) {
    const normalize = (value: string) => set.reduce((text, name) => NORMALIZERS[name](text), value);
    if (normalize(body) !== normalize(target)) continue;

    const fixes: Fix[] = [];
    if (set.includes("whitespace") || set.includes("spacing")) {
      if (table) {
        fixes.push({
          kind: "table",
          text: TABLE_SEPARATOR.test(body)
            ? "normalize the table separator row"
            : "align the table cells",
        });
      } else {
        fixes.push({
          kind: "whitespace",
          text: set.includes("whitespace")
            ? "collapse repeated spaces into one"
            : "adjust the spacing inside the line",
        });
      }
    }
    if (set.includes("emphasis"))
      fixes.push({ kind: "emphasis", text: describeEmphasis(body, target) });
    if (set.includes("escape")) {
      fixes.push({
        kind: "escape",
        text:
          count(body, "\\") > count(target, "\\")
            ? "remove unnecessary backslash escapes"
            : "escape special characters with a backslash",
      });
    }
    return fixes;
  }
  if (table && TABLE_SEPARATOR.test(body) && TABLE_SEPARATOR.test(target)) {
    return [{ kind: "table", text: "normalize the table separator row" }];
  }
  return [{ kind: "line-changed", text: "update the line content" }];
}

function describeEmphasis(body: string, target: string): string {
  const bold = body.includes("__") && target.includes("**") && !target.includes("__");
  const italic = /(^|[^*])\*(?!\*)/.test(body) && /(^|[^_])_(?!_)/.test(target);
  if (bold && italic) {
    return 'use "**" instead of "__" for bold text and "_" instead of "*" for italic text';
  }
  if (bold) return 'use "**" instead of "__" for bold text';
  if (italic) return 'use "_" instead of "*" for italic text';
  return "normalize the bold/italic markers";
}

/** Merge consecutive same-message line changes (e.g. every item of a list) and table rows into one entry. */
function mergeAdjacent(changes: readonly FormattingChange[]): FormattingChange[] {
  const merged: FormattingChange[] = [];
  for (const change of changes) {
    const previous = merged.at(-1);
    const contiguous =
      previous !== undefined &&
      previous.anchor === "at" &&
      change.anchor === "at" &&
      change.line === previous.endLine + 1;
    const sameMessage =
      previous?.message === change.message &&
      previous.before.length === previous.after.length &&
      change.before.length === change.after.length;
    const sameTable = previous?.kind === "table" && change.kind === "table";
    if (previous && contiguous && (sameMessage || sameTable)) {
      merged[merged.length - 1] = {
        ...previous,
        endLine: change.endLine,
        message: sameMessage ? previous.message : "Reformat the table and align its columns.",
        before: [...previous.before, ...change.before],
        after: [...previous.after, ...change.after],
      };
      continue;
    }
    merged.push(change);
  }
  return merged;
}

// --- Helpers ------------------------------------------------------------------

/** What a reader would call this line: "heading", "list item", "table row", … */
export function describeBlock(line: string): string {
  const trimmed = line.trim();
  if (trimmed === "") return "blank";
  if (/^ {0,3}#{1,6}(\s|$)/.test(line)) return "heading";
  if (THEMATIC_BREAK.test(line)) return "horizontal rule";
  if (/^\s*>\s*\[!/.test(line)) return "callout";
  if (/^\s*>/.test(line)) return "blockquote";
  if (/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\]/.test(line)) return "task list item";
  if (/^\s*(?:[-*+]|\d{1,9}[.)])(\s|$)/.test(line)) return "list item";
  if (isTableRow(line)) return "table row";
  if (FENCE.test(trimmed)) return "code fence";
  if (trimmed.startsWith("$$")) return "math block";
  if (trimmed.startsWith("<")) return "HTML";
  if (trimmed.startsWith("%%")) return "comment";
  return "paragraph";
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") || (trimmed.includes("|") && TABLE_SEPARATOR.test(trimmed));
}

function findContent(lines: readonly string[], from: number, step: 1 | -1): number | undefined {
  for (let index = from; index >= 0 && index < lines.length; index += step) {
    if ((lines[index] ?? "").trim() !== "") return index;
  }
  return undefined;
}

function describeIndent(value: string): string {
  if (value === "") return "none";
  return describeWhitespace(value);
}

function describeWhitespace(value: string): string {
  const spaces = count(value, " ");
  const tabs = count(value, "\t");
  return [tabs > 0 ? plural(tabs, "tab") : "", spaces > 0 ? plural(spaces, "space") : ""]
    .filter(Boolean)
    .join(" and ");
}

function count(value: string, character: string): number {
  return value.split(character).length - 1;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
