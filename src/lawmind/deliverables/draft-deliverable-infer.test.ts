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
  it("keeps an explicit contract type even when the title looks like an ESG report", () => {
    const draft = makeDraft({
      deliverableType: "contract.rental",
      title: "2025 年度 ESG 可持续发展报告",
      sections: [
        { heading: "环境绩效", body: "碳排放与能源使用…" },
        { heading: "社会责任", body: "员工与供应链…" },
        { heading: "公司治理", body: "董事会与内控…" },
      ],
    });
    expect(inferDeliverableTypeForAcceptance(draft)).toBe("contract.rental");
  });

  it("does not retag an opinion as a compliance dossier because later sections mention those headings", () => {
    const draft = makeDraft({
      deliverableType: "memo.opinion",
      title: "项目执行摘要",
      sections: [
        { heading: "问题陈述", body: "涉外合规与管辖区效力…" },
        { heading: "来源附录", body: "风险域发现见下。" },
      ],
    });
    expect(inferDeliverableTypeForAcceptance(draft)).toBe("memo.opinion");
  });

  it("still infers a compliance dossier from an untyped title", () => {
    const draft = makeDraft({
      deliverableType: "document.general",
      title: "新能源汽车出口欧盟合规卷宗",
      sections: [{ heading: "正文", body: "…" }],
    });
    expect(inferDeliverableTypeForAcceptance(draft)).toBe("report.compliance");
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
