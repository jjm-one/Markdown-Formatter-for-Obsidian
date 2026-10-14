// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from "vitest";
import { diffLines, type DiffOpType } from "../src/cli/diff";

function opsFor(a: string[], b: string[]): DiffOpType[] {
  const ops = diffLines(a, b);
  if (ops === undefined) throw new Error("unbounded diff gave up");
  return ops;
}

/** Replay the edit script on `a`, to prove it turns `a` into `b`. */
function apply(a: string[], b: string[], ops: readonly DiffOpType[]): string[] {
  const out: string[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === "equal") {
      expect(a[i]).toBe(b[j]);
      out.push(a[i] ?? "");
      i += 1;
      j += 1;
    } else if (op === "delete") i += 1;
    else {
      out.push(b[j] ?? "");
      j += 1;
    }
  }
  expect(i).toBe(a.length);
  return out;
}

const edits = (ops: readonly DiffOpType[]) => ops.filter((op) => op !== "equal").length;

describe("diffLines", () => {
  it("produces only equal ops for identical arrays", () => {
    const a = ["one", "two", "three"];
    expect(opsFor(a, [...a])).toEqual(["equal", "equal", "equal"]);
  });

  it("handles two empty arrays", () => {
    expect(opsFor([], [])).toEqual([]);
  });

  it("detects a pure insertion", () => {
    const a = ["a", "b", "c"];
    const b = ["a", "x", "y", "b", "c"];
    const ops = opsFor(a, b);
    expect(ops).toEqual(["equal", "insert", "insert", "equal", "equal"]);
    expect(apply(a, b, ops)).toEqual(b);
  });

  it("detects a pure deletion", () => {
    const a = ["a", "b", "c", "d"];
    const b = ["a", "d"];
    const ops = opsFor(a, b);
    expect(ops).toEqual(["equal", "delete", "delete", "equal"]);
    expect(apply(a, b, ops)).toEqual(b);
  });

  it("detects a one-line replacement", () => {
    const a = ["#Bad", "text"];
    const b = ["# Bad", "text"];
    const ops = opsFor(a, b);
    expect(edits(ops)).toBe(2);
    expect(apply(a, b, ops)).toEqual(b);
  });

  it("finds a shortest edit script across multiple separated changes", () => {
    const a = ["h1", "", "para one", "", "para two  ", "end"];
    const b = ["h1", "", "para one", "", "para two", "", "end"];
    const ops = opsFor(a, b);
    expect(edits(ops)).toBe(3);
    expect(apply(a, b, ops)).toEqual(b);
  });

  it("round-trips on a larger document", () => {
    const a = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const b = [...a];
    b.splice(150, 2, "changed 150", "changed 151", "inserted");
    b.splice(50, 3);
    b.push("", "");
    expect(apply(a, b, opsFor(a, b))).toEqual(b);
  });

  it("gives up once the edit script would exceed maxEdits", () => {
    const a = ["a", "b", "c"];
    const b = ["x", "y", "z"];
    expect(diffLines(a, b, 5)).toBeUndefined();
    expect(diffLines(a, b, 6)).toHaveLength(6);
  });
});
