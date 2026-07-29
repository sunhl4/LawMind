import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  embedTextsLocalStub,
  getEmbeddingIndexConfig,
  rankHybrid,
} from "./index.js";

describe("embeddings stub", () => {
  it("produces normalized vectors", () => {
    const [v] = embedTextsLocalStub(["民法典 合同"], 32);
    expect(v).toHaveLength(32);
    const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
    expect(n).toBeCloseTo(1, 5);
  });

  it("rankHybrid prefers overlapping docs when disabled", () => {
    const prev = process.env.LAWMIND_EMBEDDING_ENABLED;
    delete process.env.LAWMIND_EMBEDDING_ENABLED;
    try {
      expect(getEmbeddingIndexConfig().enabled).toBe(false);
      const hits = rankHybrid({
        query: "押金 返还",
        docs: [
          { id: "a", text: "押金返还条款争议" },
          { id: "b", text: "完全无关的天气讨论" },
        ],
      });
      expect(hits[0]?.id).toBe("a");
    } finally {
      if (prev !== undefined) {
        process.env.LAWMIND_EMBEDDING_ENABLED = prev;
      }
    }
  });

  it("cosineSimilarity is 1 for identical", () => {
    const [a] = embedTextsLocalStub(["hello"], 16);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });
});
