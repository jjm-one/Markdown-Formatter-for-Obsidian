// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from "vitest";
import { diffLines, groupHunks, type DiffHunk } from "../src/cli/diff";

function hunksFor(a: string[], b: string[]): DiffHunk[] {
  return groupHunks(diffLines(a, b));
}

/** Reconstruct `b` from `a` and the hunks, to prove the edit script is correct. */
function apply(a: string[], b: string[], hunks: DiffHunk[]): string[] {
  const out: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    out.push(...a.slice(cursor, hunk.aStart));
    out.push(...b.slice(hunk.bStart, hunk.bStart + hunk.bCount));
    cursor = hunk.aStart + hunk.aCount;
  }
  out.push(...a.slice(cursor));
  return out;
}

describe("diffLines / groupHunks", () => {
  it("produces no hunks for identical arrays", () => {
    const a = ["one", "two", "three"];
    expect(hunksFor(a, [...a])).toEqual([]);
  });

  it("handles two empty arrays", () => {
    expect(hunksFor([], [])).toEqual([]);
  });

  it("detects a pure insertion", () => {
    const a = ["a", "b", "c"];
    const b = ["a", "x", "y", "b", "c"];
    const hunks = hunksFor(a, b);
    expect(hunks).toEqual([{ aStart: 1, aCount: 0, bStart: 1, bCount: 2 }]);
    expect(apply(a, b, hunks)).toEqual(b);
  });

  it("detects a pure deletion", () => {
    const a = ["a", "b", "c", "d"];
    const b = ["a", "d"];
    const hunks = hunksFor(a, b);
    expect(hunks).toEqual([{ aStart: 1, aCount: 2, bStart: 1, bCount: 0 }]);
    expect(apply(a, b, hunks)).toEqual(b);
  });

  it("detects a one-line replacement", () => {
    const a = ["#Bad", "text"];
    const b = ["# Bad", "text"];
    const hunks = hunksFor(a, b);
    expect(hunks).toEqual([{ aStart: 0, aCount: 1, bStart: 0, bCount: 1 }]);
    expect(apply(a, b, hunks)).toEqual(b);
  });

  it("detects an appended trailing newline (extra empty final element)", () => {
    const a = "line".split("\n");
    const b = "line\n".split("\n");
    const hunks = hunksFor(a, b);
    expect(hunks).toEqual([{ aStart: 1, aCount: 0, bStart: 1, bCount: 1 }]);
    expect(apply(a, b, hunks)).toEqual(b);
  });

  it("handles multiple separated hunks and reconstructs the target exactly", () => {
    const a = ["h1", "", "para one", "", "para two  ", "end"];
    const b = ["h1", "", "para one", "", "para two", "", "end"];
    const hunks = hunksFor(a, b);
    expect(hunks.length).toBeGreaterThan(0);
    expect(apply(a, b, hunks)).toEqual(b);
  });

  it("round-trips on a larger randomized-shape document", () => {
    const a = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const b = [...a];
    b.splice(150, 2, "changed 150", "changed 151", "inserted");
    b.splice(50, 3);
    b.push("", "");
    const hunks = hunksFor(a, b);
    expect(apply(a, b, hunks)).toEqual(b);
  });
});
