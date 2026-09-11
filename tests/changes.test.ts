// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createFormattingChanges, formatChangeLocation } from "../src/cli/changes";

describe("createFormattingChanges", () => {
  it("classifies trailing whitespace", () => {
    const changes = createFormattingChanges("line one  \nline two\n", "line one\nline two\n");
    expect(changes).toEqual([
      {
        anchor: "at",
        line: 1,
        endLine: 1,
        kind: "trailing-whitespace",
        message: "Remove trailing whitespace.",
      },
    ]);
    expect(formatChangeLocation(changes[0])).toBe("line 1");
  });

  it("classifies indentation-only changes", () => {
    const changes = createFormattingChanges("  - item\n", "- item\n");
    expect(changes[0]).toMatchObject({ kind: "leading-whitespace", message: "Fix indentation." });
  });

  it("classifies internal whitespace normalization", () => {
    const changes = createFormattingChanges("a   b\n", "a b\n");
    expect(changes[0]).toMatchObject({ kind: "whitespace", message: "Normalize whitespace." });
  });

  it("classifies a single inserted space as whitespace, not content", () => {
    const changes = createFormattingChanges("#Bad\n", "# Bad\n");
    expect(changes[0]).toMatchObject({ kind: "whitespace", message: "Normalize whitespace." });
  });

  it("classifies genuine content changes", () => {
    const changes = createFormattingChanges("# Old Title\n", "# New Title\n");
    expect(changes[0]).toMatchObject({ kind: "line-changed", message: "Update line content." });
  });

  it("classifies a missing trailing newline", () => {
    const changes = createFormattingChanges("text", "text\n");
    expect(changes).toEqual([
      {
        anchor: "after",
        line: 1,
        endLine: 1,
        kind: "final-newline",
        message: "Add a trailing newline at the end of the file.",
      },
    ]);
    expect(formatChangeLocation(changes[0])).toBe("after line 1");
  });

  it("classifies an extra trailing newline", () => {
    const changes = createFormattingChanges("text\n\n", "text\n");
    expect(changes[0]).toMatchObject({
      kind: "final-newline",
      message: "Remove the extra trailing newline.",
    });
  });

  it("classifies removed and inserted blank lines", () => {
    const removed = createFormattingChanges("a\n\n\nb\n", "a\nb\n");
    expect(removed[0]).toMatchObject({ kind: "blank-line-removed" });

    const inserted = createFormattingChanges("a\nb\n", "a\n\nb\n");
    expect(inserted[0]).toMatchObject({ anchor: "after", line: 1, kind: "blank-line-added" });
  });

  it("classifies non-blank line insertions and removals with a count", () => {
    const inserted = createFormattingChanges("a\nc\n", "a\nb1\nb2\nc\n");
    expect(inserted[0]).toMatchObject({ kind: "line-added", message: "Insert 2 line(s)." });

    const removed = createFormattingChanges("a\nb1\nb2\nc\n", "a\nc\n");
    expect(removed[0]).toMatchObject({ kind: "line-removed", message: "Remove 2 line(s)." });
  });

  it("classifies a mixed N-for-M line replacement", () => {
    const changes = createFormattingChanges("a\nold1\nold2\nz\n", "a\nnew\nz\n");
    expect(changes[0]).toMatchObject({
      line: 2,
      endLine: 3,
      kind: "line-changed",
      message: "Replace 2 line(s) with 1 line(s).",
    });
  });

  it("returns nothing for identical text", () => {
    expect(createFormattingChanges("same\n", "same\n")).toEqual([]);
  });

  it("truncates after the configured limit and notes the omission", () => {
    const originalLines = Array.from({ length: 10 }, (_, i) => `line ${i}  `).join("\n");
    const formattedLines = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    const changes = createFormattingChanges(`${originalLines}\n`, `${formattedLines}\n`, 3);
    expect(changes).toHaveLength(4);
    expect(changes.slice(0, 3).every((c) => c.kind === "trailing-whitespace")).toBe(true);
    expect(changes[3].message).toContain("Further changes omitted after 3");
  });
});
