import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { inferDeliverableTypeForAcceptance } from "./draft-deliverable-infer.js";

function makeDraft(partial: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "task-infer-1",
    title: "测试",
    output: "docx",
    templateId: "document-general-default",
    summary: "",
    sections: [],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("draft-deliverable-infer", () => {
  it("detects ESG content even when tagged as contract.rental", () => {
    const draft = makeDraft({
      deliverableType: "contract.rental",
      title: "2025 年度 ESG 可持续发展报告",
      sections: [
        { heading: "环境绩效", body: "碳排放与能源使用…" },
        { heading: "社会责任", body: "员工与供应链…" },
        { heading: "公司治理", body: "董事会与内控…" },
      ],
    });
    expect(inferDeliverableTypeForAcceptance(draft)).toBe("report.esg");
  });

  it("detects generic report from title", () => {
    const draft = makeDraft({
      deliverableType: "document.general",
      title: "目标公司尽职调查报告",
      sections: [{ heading: "概述", body: "…" }],
    });
    expect(inferDeliverableTypeForAcceptance(draft)).toBe("report.general");
  });

  it("keeps explicit contract types when content is not report-like", () => {
    const draft = makeDraft({
      deliverableType: "contract.rental",
      title: "房屋租赁合同",
      sections: [{ heading: "一、合同主体", body: "甲方乙方…" }],
    });
    expect(inferDeliverableTypeForAcceptance(draft)).toBe("contract.rental");
  });

  it("keeps explicit report.compliance even when body mentions ESG terms", () => {
    const draft = makeDraft({
      deliverableType: "report.compliance",
      title: "新能源汽车出口欧盟合规卷宗",
      sections: [
        { heading: "管辖区效力矩阵", body: "中国内地与欧盟监管要点…" },
        { heading: "附注", body: "对方可能同时要求 ESG 披露，但不改变本卷宗类型。" },
      ],
    });
    expect(inferDeliverableTypeForAcceptance(draft)).toBe("report.compliance");
  });
});
