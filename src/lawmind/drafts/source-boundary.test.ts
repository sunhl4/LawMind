import { describe, expect, it } from "vitest";
import type { ResearchBundle } from "../types.js";
import { formatSignOffLine, formatSourceBoundaryBody } from "./source-boundary.js";

function bundle(partial: Partial<ResearchBundle> = {}): ResearchBundle {
  return {
    taskId: "t1",
    query: "",
    claims: [],
    sources: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("source-boundary", () => {
  it("keeps three columns when retrieval is empty", () => {
    const body = formatSourceBoundaryBody(bundle());
    expect(body).toContain("已核验：");
    expect(body).toContain("未核验：");
    expect(body).toContain("缺口：");
    expect(formatSignOffLine(bundle())).toContain("结论待定");
  });

  it("marks demo corpus as unverified and cited sources as verified", () => {
    const body = formatSourceBoundaryBody(
      bundle({
        sources: [
          {
            id: "s1",
            title: "民法典",
            kind: "statute",
            citation: "《民法典》第577条",
          },
          {
            id: "s2",
            title: "演示合同样本",
            kind: "workspace",
            demo: true,
          },
        ],
        claims: [{ text: "违约可主张赔偿", sourceIds: ["s1"], confidence: 0.8, model: "legal" }],
      }),
    );
    expect(body).toContain("《民法典》第577条");
    expect(body).toContain("演示语料");
    expect(
      formatSignOffLine(
        bundle({ claims: [{ text: "x", sourceIds: ["s1"], confidence: 1, model: "legal" }] }),
      ),
    ).toContain("非正式签署结论");
  });
});
