export type DiffLine = { type: "same" | "add" | "del"; text: string; oldNo?: number; newNo?: number };

/** Small LCS line diff; fine for the few-hundred-line files DUALDEV handles. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ type: "same", text: a[i], oldNo: ++i, newNo: ++j });
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: "del", text: a[i], oldNo: ++i });
    else out.push({ type: "add", text: b[j], newNo: ++j });
  }
  while (i < n) out.push({ type: "del", text: a[i], oldNo: ++i });
  while (j < m) out.push({ type: "add", text: b[j], newNo: ++j });
  return out;
}

export function diffStats(lines: DiffLine[]) {
  return { added: lines.filter((l) => l.type === "add").length, removed: lines.filter((l) => l.type === "del").length };
}
