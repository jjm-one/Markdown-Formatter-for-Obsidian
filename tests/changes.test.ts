// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFormattingChanges,
  describeBlock,
  formatChangeLocation,
  type FormattingChange,
} from "../src/cli/changes";
import { effectiveSettingsFromProject, formatMarkdown } from "../src/core";

/**
 * Apply every reported line change to `original`. If the change list is
 * complete and exact, the result is the formatter output (modulo BOM, line
 * endings, and the final newline, which are reported as file-level changes).
 */
function applyChanges(original: string, changes: readonly FormattingChange[]): string[] {
  const text = original.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  const lines = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
  if (text === "") lines.length = 0;
  // File-level changes (BOM, line endings, the final newline itself) carry no lines.
  const lineChanges = changes.filter(
    (change) => change.anchor !== "file" && (change.before.length > 0 || change.after.length > 0),
  );
  const position = (change: FormattingChange) =>
    change.anchor === "after" ? change.line + 0.5 : change.line;
  for (const change of [...lineChanges].sort((x, y) => position(y) - position(x))) {
    if (change.anchor === "after") lines.splice(change.line, 0, ...change.after);
    else {
      expect(lines.slice(change.line - 1, change.endLine)).toEqual(change.before);
      lines.splice(change.line - 1, change.endLine - change.line + 1, ...change.after);
    }
  }
  return lines;
}

function linesOf(text: string): string[] {
  const normalized = text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  if (normalized === "") return [];
  return (normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized).split("\n");
}

describe("createFormattingChanges", () => {
  it("describes trailing whitespace with the exact lines", () => {
    const changes = createFormattingChanges("line one  \nline two\n", "line one\nline two\n");
    expect(changes).toEqual([
      {
        anchor: "at",
        line: 1,
        endLine: 1,
        kind: "trailing-whitespace",
        message: "Remove the trailing whitespace (2 spaces).",
        before: ["line one  "],
        after: ["line one"],
      },
    ]);
    expect(formatChangeLocation(changes[0])).toBe("line 1");
  });

  it("names a hard line break when trailing spaces are reduced to two", () => {
    const [change] = createFormattingChanges("a    \nb\n", "a  \nb\n");
    expect(change?.message).toBe(
      "Reduce the trailing whitespace from 4 spaces to 2 spaces (a Markdown hard line break).",
    );
  });

  it("describes indentation changes with both widths", () => {
    const [change] = createFormattingChanges("- a\n    - b\n", "- a\n  - b\n");
    expect(change).toMatchObject({
      kind: "leading-whitespace",
      message: "Change the indentation from 4 spaces to 2 spaces.",
    });
  });

  it("pairs re-marked list items", () => {
    const changes = createFormattingChanges("* one\n* two\n", "- one\n- two\n");
    expect(changes).toEqual([
      {
        anchor: "at",
        line: 1,
        endLine: 2,
        kind: "list-marker",
        message: 'Change the list marker "*" to "-".',
        before: ["* one", "* two"],
        after: ["- one", "- two"],
      },
    ]);
  });

  it("describes list renumbering", () => {
    const [change] = createFormattingChanges("1. a\n1. b\n", "1. a\n2. b\n");
    expect(change).toMatchObject({
      kind: "list-numbering",
      message: 'Renumber the list item from "1." to "2.".',
    });
  });

  it("combines several fixes on one line, structural first", () => {
    const [change] = createFormattingChanges("* a   b  \n", "- a b\n");
    expect(change).toMatchObject({
      kind: "list-marker",
      message:
        'Change the list marker "*" to "-"; collapse repeated spaces into one; remove the trailing whitespace (2 spaces).',
    });
  });

  it("describes heading, emphasis, escape, fence, and rule changes", () => {
    expect(createFormattingChanges("#Bad\n", "# Bad\n")[0]?.message).toBe(
      "Add a space after the heading marker.",
    );
    expect(createFormattingChanges("# T ##\n", "# T\n")[0]?.message).toBe(
      "Remove the closing # characters from the heading.",
    );
    expect(createFormattingChanges("__b__ *i*\n", "**b** _i_\n")[0]).toMatchObject({
      kind: "emphasis",
      message: 'Use "**" instead of "__" for bold text and "_" instead of "*" for italic text.',
    });
    expect(createFormattingChanges("a \\_ b\n", "a _ b\n")[0]?.kind).toBe("escape");
    expect(createFormattingChanges("~~~\nx\n~~~\n", "```\nx\n```\n")[0]).toMatchObject({
      kind: "code-fence",
      line: 1,
    });
    expect(createFormattingChanges("***\n", "---\n")[0]?.message).toBe(
      'Change the horizontal rule "***" to "---".',
    );
  });

  it("describes setext-to-ATX heading conversion", () => {
    const [change] = createFormattingChanges("Title\n=====\n", "# Title\n");
    expect(change).toMatchObject({
      kind: "heading",
      line: 1,
      endLine: 2,
      before: ["Title", "====="],
      after: ["# Title"],
    });
  });

  it("merges a reformatted table into one change", () => {
    const changes = createFormattingChanges(
      "|A|B|\n|-|-|\n|1|2|\n",
      "| A   | B   |\n| --- | --- |\n| 1   | 2   |\n",
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "table", line: 1, endLine: 3 });
  });

  it("describes re-wrapped paragraphs", () => {
    const [change] = createFormattingChanges("one two\nthree four\n", "one two three four\n");
    expect(change).toMatchObject({
      kind: "rewrap",
      message: "Re-wrap the paragraph text: 2 lines become 1 line.",
    });
  });

  it("explains missing blank lines with the neighbouring blocks", () => {
    const [change] = createFormattingChanges("# H\n- a\n", "# H\n\n- a\n");
    expect(change).toEqual({
      anchor: "after",
      line: 1,
      endLine: 1,
      kind: "blank-line-added",
      message: "Insert a blank line between the heading (line 1) and the list item (line 2).",
      before: [],
      after: [""],
    });
    expect(formatChangeLocation(change)).toBe("after line 1");
  });

  it("explains superfluous blank lines", () => {
    const [extra] = createFormattingChanges("a\n\n\n\nb\n", "a\n\nb\n");
    expect(extra).toMatchObject({
      kind: "blank-line-removed",
      line: 3,
      endLine: 4,
      message:
        "Remove 2 extra blank lines between the paragraph (line 1) and the paragraph (line 5); a single blank line separates them.",
    });

    const [all] = createFormattingChanges("- a\n\n- b\n", "- a\n- b\n");
    expect(all?.message).toBe(
      "Remove the blank line between the list item (line 1) and the list item (line 3).",
    );
  });

  it("describes end-of-file problems", () => {
    expect(createFormattingChanges("text", "text\n")).toEqual([
      {
        anchor: "after",
        line: 1,
        endLine: 1,
        kind: "final-newline",
        message: "Add a newline at the end of the file.",
        before: [],
        after: [],
      },
    ]);
    expect(createFormattingChanges("text\n\n\n", "text\n")[0]).toMatchObject({
      kind: "final-newline",
      message: "Remove the 2 blank lines at the end of the file.",
    });
  });

  it("reports line-ending and BOM changes as whole-file changes", () => {
    const changes = createFormattingChanges("\uFEFFa\r\nb\r\n", "a\nb\n");
    expect(changes.map((change) => [change.kind, change.message])).toEqual([
      ["encoding", "Remove the byte order mark (BOM) at the start of the file."],
      ["line-endings", "Convert CRLF line endings to LF."],
    ]);
    expect(formatChangeLocation(changes[0])).toBe("whole file");
  });

  it("always reports a change for differing text", () => {
    expect(createFormattingChanges("a​\n", "a​​\n")).not.toEqual([]);
    expect(createFormattingChanges("same\n", "same\n")).toEqual([]);
  });

  it("merges a long run of identical fixes into one change", () => {
    const original = Array.from({ length: 300 }, (_, i) => `line ${i}  `).join("\n");
    const formatted = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
    const changes = createFormattingChanges(`${original}\n`, `${formatted}\n`);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ line: 1, endLine: 300, kind: "trailing-whitespace" });
    expect(changes[0]?.before).toHaveLength(300);
  });

  it("falls back to one exact block for very large rewrites", () => {
    const original = Array.from({ length: 6000 }, (_, i) => `a${i}`).join("\n");
    const formatted = Array.from({ length: 6000 }, (_, i) => `b${i}`).join("\n");
    const changes = createFormattingChanges(original, formatted);
    expect(changes).toHaveLength(1);
    expect(applyChanges(original, changes)).toEqual(linesOf(formatted));
  });

  it("covers every change: applying them reproduces the formatter output", async () => {
    const effective = effectiveSettingsFromProject();
    const corpus = path.join(__dirname, "..", "fuzz", "corpus");
    const samples = fs
      .readdirSync(corpus)
      .map((name) => fs.readFileSync(path.join(corpus, name), "utf8"));
    samples.push(
      "Title\n=====\n#Intro   \nSome   text __b__ *i*.   \n* one\n* two\n    * nested\n1. first\n1. second\n|A|B|\n|-|-|\n|1|2|\n\n\n\n***\n~~~js\ncode\n~~~\nLast",
      "# H\n\n\n\nPara one\nwraps here\n\n> quote\n>more\n\n- [ ] task\n+ other\n\n\n",
    );
    for (const original of samples) {
      const formatted = await formatMarkdown(original, "/vault/note.md", effective);
      const changes = createFormattingChanges(original, formatted);
      expect(applyChanges(original, changes)).toEqual(linesOf(formatted));
      for (const change of changes) expect(change.message).toMatch(/^[A-Z].*\.$/s);
    }
  });
});

describe("describeBlock", () => {
  it("names common Markdown blocks", () => {
    expect(describeBlock("## H")).toBe("heading");
    expect(describeBlock("- [ ] todo")).toBe("task list item");
    expect(describeBlock("1. item")).toBe("list item");
    expect(describeBlock("> [!note] x")).toBe("callout");
    expect(describeBlock("> q")).toBe("blockquote");
    expect(describeBlock("| a | b |")).toBe("table row");
    expect(describeBlock("```ts")).toBe("code fence");
    expect(describeBlock("---")).toBe("horizontal rule");
    expect(describeBlock("text")).toBe("paragraph");
  });
});
