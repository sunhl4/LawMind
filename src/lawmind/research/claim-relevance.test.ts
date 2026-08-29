import { describe, expect, it } from "vitest";
import type { ResearchBundle, TaskIntent } from "../types.js";
import {
  claimMatchesTopic,
  extractTopicTokens,
  filterBundleByTopicRelevance,
} from "./claim-relevance.js";

describe("claim-relevance", () => {
  it("extracts topic tokens from NEV export instruction", () => {
    const tokens = extractTopicTokens("新能源汽车中国内地出口欧盟合规研究卷宗");
    expect(tokens.some((t) => t.includes("新能源") || t.includes("汽车"))).toBe(true);
    expect(tokens.some((t) => t.includes("欧盟") || t.includes("出口"))).toBe(true);
  });

  it("drops labor-law claims for NEV export topic", () => {
    const intent = {
      taskId: "t1",
      kind: "draft.word",
      output: "docx",
      instruction: "新能源汽车出口欧盟合规研究卷宗",
      summary: "NEV 出口合规",
      riskLevel: "high",
      models: ["general"],
      requiresConfirmation: true,
      deliverableType: "report.compliance",
      createdAt: new Date().toISOString(),
    } satisfies TaskIntent;

    const bundle: ResearchBundle = {
      taskId: "t1",
      query: intent.summary,
      sources: [
        { id: "s1", title: "劳动合同法解除", kind: "statute" },
        { id: "s2", title: "EU battery regulation", kind: "regulation" },
      ],
      claims: [
        {
          text: "用人单位解除劳动合同应当提前通知",
          sourceIds: ["s1"],
          confidence: 0.9,
          model: "legal",
        },
        {
          text: "出口欧盟新能源汽车须符合电池法规与型式认证要求",
          sourceIds: ["s2"],
          confidence: 0.9,
          model: "legal",
        },
      ],
      riskFlags: [],
      missingItems: [],
      requiresReview: false,
      completedAt: new Date().toISOString(),
    };

    expect(
      claimMatchesTopic(bundle.claims[0], bundle.sources, extractTopicTokens(intent.instruction)),
    ).toBe(false);
    const filtered = filterBundleByTopicRelevance(intent, bundle);
    expect(filtered.bundle.claims.map((c) => c.text)).toEqual([
      "出口欧盟新能源汽车须符合电池法规与型式认证要求",
    ]);
    expect(filtered.droppedClaims).toBe(1);
  });
});
