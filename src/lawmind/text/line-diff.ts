/**
 * Simple line-level diff for memory/audit previews (no external deps).
 */

export type DiffHunkType = "equal" | "add" | "remove";

export type DiffHunk = {
  type: DiffHunkType;
  lines: string[];
};

export type LineDiffResult = {
  hunks: DiffHunk[];
};

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }
  const parts = text.split(/\r?\n/);
  if (text.endsWith("\n") || text.endsWith("\r\n")) {
    return parts;
  }
  return parts;
}

/** Myers-style LCS table for modest line counts (memory files). */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

function buildOps(a: string[], b: string[]): Array<{ type: DiffHunkType; line: string }> {
  const dp = lcsTable(a, b);
  const ops: Array<{ type: DiffHunkType; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "remove", line: a[i] });
      i++;
    } else {
      ops.push({ type: "add", line: b[j] });
      j++;
    }
  }
  while (i < a.length) {
    ops.push({ type: "remove", line: a[i] });
    i++;
  }
  while (j < b.length) {
    ops.push({ type: "add", line: b[j] });
    j++;
  }
  return ops;
}

function coalesceOps(ops: Array<{ type: DiffHunkType; line: string }>): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  for (const op of ops) {
    const last = hunks[hunks.length - 1];
    if (last && last.type === op.type) {
      last.lines.push(op.line);
    } else {
      hunks.push({ type: op.type, lines: [op.line] });
    }
  }
  return hunks;
}

export function diffLines(before: string, after: string): LineDiffResult {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length === 0 && b.length === 0) {
    return { hunks: [] };
  }
  if (a.join("\n") === b.join("\n")) {
    return { hunks: [{ type: "equal", lines: a }] };
  }
  return { hunks: coalesceOps(buildOps(a, b)) };
}
