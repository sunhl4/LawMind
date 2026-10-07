/**
 * Scoring functions aligned with the published task metrics.
 *
 * CUAD (Hendrycks et al. 2021): a Yes/No label is Yes only when a responsive
 * span exists; other answers are strings derived from that span.
 * LawBench (Fei et al. 2024): accuracy, multi-label F1, rc-F1, soft-F1,
 * ROUGE-L, and normalized log-distance. This module scores fixtures.
 * The 510-contract and 20×500 zero-shot numbers live in
 * docs/LAWMIND-LEGAL-KERNEL-BENCH.md. They are not a leaderboard claim.
 */

export function exactAccuracy(prediction: string, gold: string): number {
  return normalizeAnswer(prediction) === normalizeAnswer(gold) ? 1 : 0;
}

/** LawBench SLC rule: more than one extracted label is wrong. */
export function singleLabelAccuracy(extracted: readonly string[], gold: string): number {
  if (extracted.length !== 1) {
    return 0;
  }
  return exactAccuracy(extracted[0] ?? "", gold);
}

export function multiLabelF1(prediction: readonly string[], gold: readonly string[]): number {
  const pred = uniqueNormalized(prediction);
  const ref = uniqueNormalized(gold);
  if (pred.length === 0 && ref.length === 0) {
    return 1;
  }
  if (pred.length === 0 || ref.length === 0) {
    return 0;
  }
  const hit = pred.filter((item) => ref.includes(item)).length;
  const precision = hit / pred.length;
  const recall = hit / ref.length;
  if (precision + recall === 0) {
    return 0;
  }
  return (2 * precision * recall) / (precision + recall);
}

/** Character F-beta. LawBench 2-1 document proofreading uses F0.5. */
export function charFBeta(prediction: string, gold: string, beta: number): number {
  const score = rcF1(prediction, gold);
  if (beta === 1) {
    return score;
  }
  const pred = countChars(stripMarks(prediction));
  const ref = countChars(stripMarks(gold));
  const predTotal = totalCount(pred);
  const refTotal = totalCount(ref);
  if (predTotal === 0 && refTotal === 0) {
    return 1;
  }
  if (predTotal === 0 || refTotal === 0) {
    return 0;
  }
  let overlap = 0;
  for (const [char, count] of pred) {
    overlap += Math.min(count, ref.get(char) ?? 0);
  }
  const precision = overlap / predTotal;
  const recall = overlap / refTotal;
  const betaSq = beta * beta;
  const denom = betaSq * precision + recall;
  if (denom === 0) {
    return 0;
  }
  return ((1 + betaSq) * precision * recall) / denom;
}

/** Character rc-F1 after dropping punctuation and whitespace. */
export function rcF1(prediction: string, gold: string): number {
  const pred = countChars(stripMarks(prediction));
  const ref = countChars(stripMarks(gold));
  const predTotal = totalCount(pred);
  const refTotal = totalCount(ref);
  if (predTotal === 0 && refTotal === 0) {
    return 1;
  }
  if (predTotal === 0 || refTotal === 0) {
    return 0;
  }
  let overlap = 0;
  for (const [char, count] of pred) {
    overlap += Math.min(count, ref.get(char) ?? 0);
  }
  const precision = overlap / predTotal;
  const recall = overlap / refTotal;
  if (precision + recall === 0) {
    return 0;
  }
  return (2 * precision * recall) / (precision + recall);
}

/**
 * LawBench soft-F1: phrase exact-match is replaced by rc-F1.
 * Precision averages each prediction's best gold rc-F1, and recall the reverse.
 */
export function softF1(prediction: readonly string[], gold: readonly string[]): number {
  if (prediction.length === 0 && gold.length === 0) {
    return 1;
  }
  if (prediction.length === 0 || gold.length === 0) {
    return 0;
  }
  const precision = averageBest(prediction, gold);
  const recall = averageBest(gold, prediction);
  if (precision + recall === 0) {
    return 0;
  }
  return (2 * precision * recall) / (precision + recall);
}

/** ROUGE-L F1 from the longest common subsequence of characters. */
export function rougeL(prediction: string, gold: string): number {
  const pred = Array.from(stripMarks(prediction));
  const ref = Array.from(stripMarks(gold));
  if (pred.length === 0 && ref.length === 0) {
    return 1;
  }
  if (pred.length === 0 || ref.length === 0) {
    return 0;
  }
  const lcs = lcsLength(pred, ref);
  const precision = lcs / pred.length;
  const recall = lcs / ref.length;
  if (precision + recall === 0) {
    return 0;
  }
  return (2 * precision * recall) / (precision + recall);
}

/**
 * LawBench 3-4 / 3-5 normalized log-distance.
 * Exact numbers score 1. A nearer term scores above a farther term.
 */
export function normalizedLogDistance(prediction: number, gold: number): number {
  if (!Number.isFinite(prediction) || !Number.isFinite(gold) || prediction < 0 || gold < 0) {
    return 0;
  }
  const gap = Math.abs(Math.log(prediction + 1) - Math.log(gold + 1));
  const scale = Math.log(Math.max(prediction, gold) + 1);
  if (scale === 0) {
    return prediction === gold ? 1 : 0;
  }
  return Math.max(0, 1 - gap / scale);
}

/** CUAD unified date: 2024年3月1日 / 2024-03-01 → 03/01/2024. */
export function cuadDateAnswer(text: string): string | undefined {
  const chinese = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text);
  if (chinese?.[1] && chinese[2] && chinese[3]) {
    return `${chinese[2].padStart(2, "0")}/${chinese[3].padStart(2, "0")}/${chinese[1]}`;
  }
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso?.[1] && iso[2] && iso[3]) {
    return `${iso[2]}/${iso[3]}/${iso[1]}`;
  }
  return undefined;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeAnswer(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

function uniqueNormalized(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const next = normalizeAnswer(value);
    if (next && !out.includes(next)) {
      out.push(next);
    }
  }
  return out;
}

function stripMarks(text: string): string {
  return text.replace(/[\s，。；：、！？,.!?;:()（）「」《》]/g, "");
}

function countChars(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const char of text) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  return counts;
}

function totalCount(counts: Map<string, number>): number {
  let total = 0;
  for (const count of counts.values()) {
    total += count;
  }
  return total;
}

function averageBest(left: readonly string[], right: readonly string[]): number {
  let sum = 0;
  for (const item of left) {
    let best = 0;
    for (const other of right) {
      best = Math.max(best, rcF1(item, other));
    }
    sum += best;
  }
  return sum / left.length;
}

function lcsLength(left: readonly string[], right: readonly string[]): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp: number[] = Array.from({ length: cols }, () => 0);
  for (let i = 1; i < rows; i += 1) {
    let previous = 0;
    for (let j = 1; j < cols; j += 1) {
      const current = dp[j] ?? 0;
      if (left[i - 1] === right[j - 1]) {
        dp[j] = previous + 1;
      } else {
        dp[j] = Math.max(current, dp[j - 1] ?? 0);
      }
      previous = current;
    }
  }
  return dp[cols - 1] ?? 0;
}
