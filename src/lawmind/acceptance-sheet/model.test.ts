import { describe, expect, it } from "vitest";
import type { ReviewTable } from "../deliverables/review-table.js";
import type { ArtifactDraft, ResearchBundle } from "../types.js";
import {
  acceptanceChartFromSpec,
  acceptanceClaimId,
  acceptancePageNumber,
  buildAcceptanceSheet,
  relativeMaterialPath,
  tooStrongInstruction,
  acceptanceDecisionClaims,
  acceptanceAsideCount,
  showAcceptanceClaim,
} from "./model.js";

function bundle(overrides: Partial<ResearchBundle> = {}): ResearchBundle {
  return {
    taskId: "task-1",
    query: "违约金上限",
    sources: [
      {
        id: "src-1",
        title: "采购合同",
        kind: "contract",
        citation: "第 8.2 条",
        excerpt: "违约金不超过合同总额的百分之二十。",
        url: "cases/m1/采购合同.pdf#page=12",
      },
    ],
    claims: [
      {
        text: "违约金约定为合同总额的百分之二十。",
        sourceIds: ["src-1"],
        confidence: 0.82,
        model: "legal",
        pin: { clause: "第 8.2 条", page: "12", quote: "不超过合同总额的百分之二十" },
      },
    ],
    riskFlags: ["对方可能主张该比例仍过高"],
    missingItems: ["未见实际损失的证据"],
    requiresReview: true,
    completedAt: "2026-09-27T00:00:00.000Z",
    ...overrides,
  };
}

const draft: ArtifactDraft = {
  taskId: "task-1",
  title: "采购合同审查备忘",
  matterId: "m1",
  output: "docx",
  templateId: "word/legal-memo-default",
  summary: "建议把违约金写成可调整。",
  sections: [{ heading: "结论", body: "见检索。", citations: ["src-1"] }],
  reviewNotes: [],
  reviewStatus: "pending",
  createdAt: "2026-09-27T00:00:00.000Z",
};

describe("buildAcceptanceSheet", () => {
  it("keeps a claim that points at a real source and drops one that does not", () => {
    const sheet = buildAcceptanceSheet({
      taskId: "task-1",
      bundle: bundle({
        claims: [
          ...bundle().claims,
          {
            text: "这句没有出处。",
            sourceIds: [],
            confidence: 0.9,
            model: "general",
          },
          {
            text: "出处编号是编的。",
            sourceIds: ["missing"],
            confidence: 0.9,
            model: "general",
          },
        ],
      }),
      draft,
    });
    expect(sheet?.open).toBe(true);
    expect(sheet?.claims.map((claim) => claim.text)).toEqual([
      "违约金约定为合同总额的百分之二十。",
    ]);
    expect(sheet?.claims[0]?.sources[0]).toMatchObject({
      openKind: "pdf",
      relPath: "cases/m1/采购合同.pdf",
      page: 12,
      pageLabel: "第 12 页",
    });
    expect(sheet?.claims[0]?.locator).toContain("第 8.2 条");
    expect(sheet?.claims[0]?.quote).toContain("百分之二十");
  });

  it("drops a pasted statute and a chapter title instead of repeating them", () => {
    const article =
      "第二十八条 劳务派遣协议除上述应当载明的内容外，协议中亦可载明以下事项：（一）权利义务；（二）聘用程序。";
    const sheet = buildAcceptanceSheet({
      taskId: "task-1",
      bundle: bundle({
        sources: [
          {
            id: "src-1",
            title: "劳务派遣暂行规定",
            kind: "statute",
            citation: "第三章",
            excerpt: "第三章 劳动合同、劳务派遣协议的订立和履行",
            url: "notes/暂行规定.pdf",
          },
          {
            id: "src-2",
            title: "上海律师办理劳务派遣合同纠纷案件业务操作指引",
            kind: "book",
            citation: "第二十八条",
            excerpt: article,
            url: "notes/指引.pdf",
          },
        ],
        claims: [
          {
            text: "第三章 劳动合同、劳务派遣协议的订立和履行",
            sourceIds: ["src-1"],
            confidence: 0.55,
            model: "legal",
          },
          {
            text: article,
            sourceIds: ["src-2"],
            confidence: 0.55,
            model: "legal",
            pin: { article: "第二十八条", quote: article },
          },
          {
            text: "协议还应单独约定争议解决方式。",
            sourceIds: ["src-2"],
            confidence: 0.8,
            model: "legal",
            pin: { article: "第二十八条", quote: "（四）违约责任及争议解决方式" },
          },
        ],
      }),
      draft,
    });
    expect(sheet?.claims.map((claim) => claim.text)).toEqual(["协议还应单独约定争议解决方式。"]);
    expect(sheet?.claims[0]?.quote).toBe("（四）违约责任及争议解决方式");
    expect(sheet?.claims[0]?.confidenceLabel).toBe("高");
  });

  it("opens a file path without a scheme and labels the page", () => {
    const sheet = buildAcceptanceSheet({
      taskId: "task-1",
      bundle: bundle({
        sources: [
          {
            id: "src-1",
            title: "采购合同",
            kind: "contract",
            citation: "第 8.2 条",
            url: "cases/m1/采购合同.pdf",
          },
        ],
      }),
      draft,
    });
    expect(sheet?.claims[0]?.sources[0]).toMatchObject({
      relPath: "cases/m1/采购合同.pdf",
      openKind: "pdf",
      pageLabel: "第 12 页",
    });
  });

  it("refuses absolute paths and urls", () => {
    expect(relativeMaterialPath("/etc/passwd")).toBeUndefined();
    expect(relativeMaterialPath("https://example.com/a.pdf")).toBeUndefined();
    expect(relativeMaterialPath("cases/m1/../../secret.pdf")).toBeUndefined();
    expect(relativeMaterialPath("cases/m1/合同.docx")).toBe("cases/m1/合同.docx");
  });

  it("stays closed when nothing is sourced", () => {
    expect(
      buildAcceptanceSheet({
        taskId: "task-1",
        bundle: bundle({ claims: [], riskFlags: [], missingItems: [], sources: [] }),
        draft: { ...draft, summary: "" },
      }),
    ).toBeNull();
  });

  it("uses cited draft sections when the bundle has no claims", () => {
    const sheet = buildAcceptanceSheet({
      taskId: "task-1",
      bundle: bundle({ claims: [] }),
      draft: {
        ...draft,
        sections: [
          {
            heading: "违约责任",
            body: "违约金不超过百分之二十。",
            citations: ["src-1"],
          },
        ],
      },
    });
    expect(sheet?.claims[0]?.text).toBe("违约金不超过百分之二十。");
    expect(sheet?.claims[0]?.locator).toBe("违约责任");
    expect(sheet?.claims[0]?.confidenceLabel).toBeUndefined();
  });

  it("keeps a page number on the file that did not already name one", () => {
    const sheet = buildAcceptanceSheet({
      taskId: "task-1",
      bundle: bundle({
        sources: [
          {
            id: "src-1",
            title: "采购合同",
            kind: "contract",
            citation: "第 8.2 条",
            url: "cases/m1/采购合同.pdf",
          },
          {
            id: "src-2",
            title: "附件",
            kind: "contract",
            citation: "附件",
            url: "cases/m1/附件.pdf#page=4",
          },
        ],
        claims: [
          {
            text: "两份材料都要看。",
            sourceIds: ["src-1", "src-2"],
            confidence: 0.8,
            model: "legal",
            pin: { page: "第3条，第12页" },
          },
        ],
      }),
    });
    expect(sheet?.claims[0]?.sources.map((source) => source.page)).toEqual([12, 4]);
    expect(acceptancePageNumber("见第3条")).toBeUndefined();
    expect(acceptancePageNumber("12")).toBe(12);
    expect(acceptancePageNumber("第 12-13 页")).toBe(12);
  });

  it("shows an unsourced table cell as unlabeled instead of inventing a source", () => {
    const table: ReviewTable = {
      taskId: "task-1",
      template: "due_diligence",
      title: "尽调表",
      columns: [
        { key: "item", label: "事项" },
        { key: "finding", label: "发现" },
      ],
      rows: [
        { id: "r1", cells: { item: "付款", finding: "30 日" }, source: "合同.pdf" },
        { id: "r2", cells: { item: "解除", finding: "未写" } },
      ],
      updatedAt: "2026-09-27T00:00:00.000Z",
    };
    const sheet = buildAcceptanceSheet({ taskId: "task-1", table });
    expect(sheet?.table?.rows[1]).toMatchObject({ sourced: false, sourceLabel: "未标明出处" });
    expect(sheet?.claims).toEqual([]);
  });

  it("hides a removed claim but keeps the sheet open so it can be restored", () => {
    const text = bundle().claims[0].text;
    const id = acceptanceClaimId(text, ["src-1"]);
    const sheet = buildAcceptanceSheet({
      taskId: "task-1",
      bundle: bundle(),
      marks: { [id]: "removed" },
    });
    expect(sheet?.removedCount).toBe(1);
    expect(sheet?.open).toBe(true);
    expect(sheet?.claims[0]?.mark).toBe("removed");
  });

  it("writes a weaken instruction that keeps the quote", () => {
    const sheet = buildAcceptanceSheet({ taskId: "task-1", bundle: bundle() });
    const text = tooStrongInstruction(sheet!.claims[0]);
    expect(text).toContain("改弱");
    expect(text).toContain("不要补充没有依据");
    expect(text).toContain("百分之二十");
  });

  it("uses the article as the position when the draft heading is 结论", () => {
    const sheet = buildAcceptanceSheet({
      taskId: "task-1",
      bundle: bundle({ claims: [] }),
      draft: {
        ...draft,
        sections: [
          {
            heading: "结论",
            body: "违约金应当写成可调整的数额。",
            citations: ["src-1"],
          },
        ],
      },
    });
    expect(sheet?.claims[0]?.locator).toBe("第 8.2 条");
    expect(sheet?.claims[0]?.quote).toContain("百分之二十");
    expect(acceptanceDecisionClaims(sheet!)).toHaveLength(1);
  });

  it("counts gaps and charts as aside items, not as sentences to accept", () => {
    const sheet = buildAcceptanceSheet({
      taskId: "task-1",
      bundle: bundle({ claims: [], riskFlags: ["比例可能仍过高"], missingItems: ["未见损失证据"] }),
      draft: { ...draft, summary: "" },
    });
    expect(acceptanceDecisionClaims(sheet!)).toEqual([]);
    expect(acceptanceAsideCount(sheet!)).toBe(2);
    expect(showAcceptanceClaim({ text: "第二十八条全文。", quote: "第二十八条全文。" })).toBe(
      false,
    );
    expect(showAcceptanceClaim({ text: "应当单独约定争议解决。", quote: undefined })).toBe(true);
  });

  it("pins a chart that names a file and drops one that does not", () => {
    const sourced = acceptanceChartFromSpec(
      {
        title: "费用",
        type: "bar",
        categories: ["合计"],
        series: [{ name: "额", values: [12] }],
        source: { path: "cases/m/费用.xlsx", sheet: "汇总" },
      },
      "artifacts/charts/fee.json",
    );
    const unsourced = acceptanceChartFromSpec({
      title: "猜的",
      type: "bar",
      categories: ["甲"],
      series: [{ name: "数", values: [1] }],
    });
    expect(unsourced).toBeUndefined();
    const sheet = buildAcceptanceSheet({
      taskId: "session-chart",
      charts: sourced ? [sourced] : [],
    });
    expect(sheet?.open).toBe(true);
    expect(sheet?.title).toBe("费用");
    expect(sheet?.claims).toEqual([]);
    expect(sheet?.charts?.[0]).toMatchObject({
      sourcePath: "cases/m/费用.xlsx",
      sourceSheet: "汇总",
    });
  });
});
