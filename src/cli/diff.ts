// SPDX-License-Identifier: LGPL-3.0-only

/** Myers shortest-edit-script line diff, used to build the `--show-changes` / report data. */

export type DiffOpType = "equal" | "delete" | "insert";

export interface DiffHunk {
  /** 0-based index into `a` where the hunk starts. */
  aStart: number;
  /** Number of `a` lines this hunk removes or replaces. */
  aCount: number;
  /** 0-based index into `b` where the hunk starts. */
  bStart: number;
  /** Number of `b` lines this hunk adds or replaces with. */
  bCount: number;
}

/**
 * The shortest edit script turning `a` into `b`, as a sequence of per-line ops.
 * O(N + D^2) where D is the number of differing lines — fast whenever the two
 * texts are close, which is the common case for a formatter's own output.
 */
export function diffLines(a: readonly string[], b: readonly string[]): DiffOpType[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];

  const offset = max;
  let v = new Array<number>(2 * max + 1).fill(0);
  const trace: number[][] = [];

  depthLoop: for (let d = 0; d <= max; d += 1) {
    trace.push(v);
    v = v.slice();
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[k - 1 + offset] ?? 0) < (v[k + 1 + offset] ?? 0));
      let x = down ? (v[k + 1 + offset] ?? 0) : (v[k - 1 + offset] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) break depthLoop;
    }
  }

  const ops: DiffOpType[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const vPrev = trace[d] ?? [];
    const k = x - y;
    const down =
      k === -d || (k !== d && (vPrev[k - 1 + offset] ?? 0) < (vPrev[k + 1 + offset] ?? 0));
    const prevK = down ? k + 1 : k - 1;
    const prevX = vPrev[prevK + offset] ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push("equal");
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      ops.push(x === prevX ? "insert" : "delete");
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/** Collapse a per-line op sequence into contiguous change hunks (equal runs dropped). */
export function groupHunks(ops: readonly DiffOpType[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let aPos = 0;
  let bPos = 0;
  let i = 0;
  while (i < ops.length) {
    if (ops[i] === "equal") {
      aPos += 1;
      bPos += 1;
      i += 1;
      continue;
    }
    const aStart = aPos;
    const bStart = bPos;
    while (i < ops.length && ops[i] !== "equal") {
      if (ops[i] === "delete") aPos += 1;
      else bPos += 1;
      i += 1;
    }
    hunks.push({ aStart, aCount: aPos - aStart, bStart, bCount: bPos - bStart });
  }
  return hunks;
}
