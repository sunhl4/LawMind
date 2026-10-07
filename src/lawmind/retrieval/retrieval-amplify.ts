/**
 * §4.2 retrieval amplification: multiplicative weights on a diagonal score.
 * Not a quantum search. No quadratic speedup.
 *
 * Pool ≤ 200, rounds R ≤ 3, η = 1, a ∈ {-1, 0, +1}, keep the top 20.
 * a is a deterministic stabilizer agreement, not a model vote.
 */

export const RETRIEVAL_POOL_CAP = 200;
export const RETRIEVAL_KEEP = 20;
export const RETRIEVAL_ROUNDS = 3;
export const RETRIEVAL_ETA = 1;

const ARTICLE_RE = /第[0-9零〇一二三四五六七八九十百千]+条/;
const CASE_RE = /案号|（\s*20\d{2}\s*）|\(20\d{2}\)/;

export function discreteAgreement(raw: number): -1 | 0 | 1 {
  if (raw === 1 || raw === -1) {
    return raw;
  }
  return 0;
}

export function retrievalAgreement(input: {
  demo?: boolean;
  text?: string;
  groundedAmounts?: readonly string[];
  rejectedAmounts?: readonly string[];
}): -1 | 0 | 1 {
  if (input.demo === true) {
    return -1;
  }
  const text = input.text ?? "";
  const grounded = (input.groundedAmounts ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  const rejected = (input.rejectedAmounts ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  const hasGrounded = grounded.some((amount) => text.includes(amount));
  const hasRejected = rejected.some((amount) => text.includes(amount));
  if (hasRejected && !hasGrounded) {
    return -1;
  }
  if (hasGrounded || ARTICLE_RE.test(text) || CASE_RE.test(text)) {
    return 1;
  }
  return 0;
}

export function amplifyRetrievalCandidates<T>(
  items: readonly T[],
  score: (item: T) => number,
): T[] {
  const pool = items.slice(0, RETRIEVAL_POOL_CAP).map((item, index) => ({
    item,
    index,
    w: 1,
  }));
  for (let round = 0; round < RETRIEVAL_ROUNDS; round += 1) {
    for (const row of pool) {
      row.w *= Math.exp(RETRIEVAL_ETA * discreteAgreement(score(row.item)));
    }
  }
  const ranked = pool.toSorted((left, right) => right.w - left.w || left.index - right.index);
  return ranked.slice(0, RETRIEVAL_KEEP).map((row) => row.item);
}
