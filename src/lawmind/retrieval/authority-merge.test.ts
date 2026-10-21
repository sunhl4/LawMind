import { describe, expect, it } from "vitest";
import { mergeAuthorityOutcomes, mergeRetrievalResults } from "./authority-merge.js";
import type { RetrievalResult } from "./index.js";

function part(
  overrides: Partial<RetrievalResult> & {
    sources?: RetrievalResult["sources"];
    claims?: RetrievalResult["claims"];
  },
): RetrievalResult {
  return {
    sources: [],
    claims: [],
    riskFlags: [],
    missingItems: [],
    ...overrides,
  } as RetrievalResult;
}

describe("mergeAuthorityOutcomes", () => {
  it("keeps the best status and sums hits", () => {
    const merged = mergeAuthorityOutcomes([
      { status: "empty", hitCount: 0, httpStatus: 200 },
      { status: "ok", hitCount: 3, httpStatus: 200 },
      { status: "rate_limited", hitCount: 0 },
    ]);
    expect(merged).toEqual({ status: "ok", httpStatus: 200, hitCount: 3 });
  });

  it("falls back to the least-bad failure when every provider failed", () => {
    const merged = mergeAuthorityOutcomes([
      { status: "not_configured", hitCount: 0 },
      { status: "unavailable", hitCount: 0 },
    ]);
    expect(merged?.status).toBe("unavailable");
    // not_configured is the least actionable — a real call beat it.
  });
});

describe("mergeRetrievalResults", () => {
  it("keeps cross-provider duplicates (independent agreement), collapses in-provider duplicates", () => {
    const pkulawHit = part({
      sources: [
        {
          id: "pk-1",
          provider: "pkulaw",
          title: "《民法典》第五百六十三条",
          kind: "statute",
          citation: "《民法典》第563条",
        },
      ],
      claims: [{ text: "法定解除情形", sourceIds: ["pk-1"], confidence: 0.7, model: "legal" }],
    });
    const pkulawDup = part({
      sources: [
        {
          id: "pk-1",
          provider: "pkulaw",
          title: "《民法典》第五百六十三条",
          kind: "statute",
          citation: "《民法典》第563条",
        },
      ],
      claims: [{ text: "重复命中", sourceIds: ["pk-1"], confidence: 0.7, model: "legal" }],
    });
    const yuandianHit = part({
      sources: [
        {
          id: "yd-1",
          provider: "yuandian",
          title: "《民法典》第五百六十三条",
          kind: "statute",
          citation: "《中华人民共和国民法典》第五百六十三条",
        },
      ],
      claims: [{ text: "元典命中", sourceIds: ["yd-1"], confidence: 0.7, model: "legal" }],
    });
    const merged = mergeRetrievalResults([pkulawHit, pkulawDup, yuandianHit]);
    expect(merged.sources).toHaveLength(2);
    expect(merged.claims).toHaveLength(3); // 文本不同 → 都保留；同文同源才算重复 claim
    for (const claim of merged.claims) {
      for (const id of claim.sourceIds) {
        expect(merged.sources.some((s) => s.id === id)).toBe(true);
      }
    }
    expect(merged.riskFlags).toEqual([]);
  });

  it("remaps collided vendor ids to fresh ids and keeps claims valid", () => {
    const left = part({
      sources: [{ id: "same-id", provider: "pkulaw", title: "法宝命中", kind: "statute" }],
      claims: [{ text: "左", sourceIds: ["same-id"], confidence: 0.7, model: "legal" }],
    });
    const right = part({
      sources: [{ id: "same-id", provider: "yuandian", title: "元典命中", kind: "case" }],
      claims: [{ text: "右", sourceIds: ["same-id"], confidence: 0.7, model: "legal" }],
    });
    const merged = mergeRetrievalResults([left, right]);
    expect(merged.sources).toHaveLength(2);
    expect(merged.sources[1]?.id).not.toBe("same-id");
    for (const claim of merged.claims) {
      for (const id of claim.sourceIds) {
        expect(merged.sources.some((s) => s.id === id)).toBe(true);
      }
    }
  });

  it("drops claims whose only source was deduped away, unions flags in order", () => {
    const left = part({
      sources: [],
      claims: [],
      riskFlags: ["权威库无命中"],
      missingItems: [
        "权威库未检索到相关法条/案例。模型不得编造条文；请换关键词或请律师提供权威文本。",
      ],
      authorityOutcome: { status: "empty", hitCount: 0 },
    });
    const right = part({
      sources: [{ id: "r1", provider: "yuandian", title: "命中", kind: "statute" }],
      claims: [{ text: "内容", sourceIds: ["r1"], confidence: 0.7, model: "legal" }],
      riskFlags: ["元典智库提示"],
      missingItems: [],
      authorityOutcome: { status: "ok", hitCount: 1 },
    });
    const merged = mergeRetrievalResults([left, right]);
    expect(merged.sources).toHaveLength(1);
    expect(merged.claims).toHaveLength(1);
    expect(merged.riskFlags).toEqual(["权威库无命中", "元典智库提示"]);
    expect(merged.missingItems).toEqual([
      "权威库未检索到相关法条/案例。模型不得编造条文；请换关键词或请律师提供权威文本。",
    ]);
    expect(merged.authorityOutcome?.status).toBe("ok");
  });
});
