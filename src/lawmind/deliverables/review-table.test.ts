import { describe, expect, it } from "vitest";
import {
  newReviewTable,
  reviewTableAcceptanceProblems,
  reviewTableToMarkdown,
  reviewTableToXlsxRows,
  REVIEW_TABLE_TEMPLATES,
  type ReviewTable,
} from "./review-table.js";

describe("review-table deliverable model", () => {
  it("ships three templates (尽调/证据/条款矩阵)", () => {
    expect(Object.keys(REVIEW_TABLE_TEMPLATES)).toEqual([
      "due_diligence",
      "evidence",
      "clause_matrix",
    ]);
    expect(REVIEW_TABLE_TEMPLATES.due_diligence.label).toBe("尽调审查表");
    expect(REVIEW_TABLE_TEMPLATES.evidence.label).toBe("证据审查表");
    expect(REVIEW_TABLE_TEMPLATES.clause_matrix.label).toBe("条款对照矩阵");
    // 三类模板都带来源列，才可能「可核验」。
    for (const t of Object.values(REVIEW_TABLE_TEMPLATES)) {
      expect(t.columns.some((c) => c.key === "source")).toBe(true);
    }
  });

  it("newReviewTable starts empty with the template columns", () => {
    const table = newReviewTable("t-1", "evidence");
    expect(table.template).toBe("evidence");
    expect(table.columns.length).toBe(5);
    expect(table.rows).toEqual([]);
    expect(table.title).toBe("证据审查表");
  });

  it("renders markdown preview and xlsx rows from the same table", () => {
    const table: ReviewTable = {
      ...newReviewTable("t-1", "evidence"),
      rows: [
        {
          id: "r1",
          cells: {
            exhibit: "劳动合同",
            purpose: "证明劳动关系",
            source: "cases/m/materials/合同.pdf",
          },
          source: "cases/m/materials/合同.pdf",
        },
      ],
    };
    const md = reviewTableToMarkdown(table);
    expect(md).toContain("| 证据名称 |");
    expect(md).toContain("劳动合同");
    expect(md).toContain("cases/m/materials/合同.pdf");
    const rows = reviewTableToXlsxRows(table);
    expect(rows[0]).toEqual(["证据名称", "证明目的", "关联争点", "证明力", "来源"]);
    expect(rows[1]?.[0]).toBe("劳动合同");
  });

  it("escapes pipes so a cell cannot break the markdown table", () => {
    const table: ReviewTable = {
      ...newReviewTable("t-1", "clause_matrix"),
      rows: [{ id: "r1", cells: { clause: "第5条|责任上限" } }],
    };
    expect(reviewTableToMarkdown(table)).not.toContain("第5条|责任上限");
    expect(reviewTableToMarkdown(table)).toContain("第5条｜责任上限");
  });

  it("acceptance requires non-empty rows with sources", () => {
    expect(reviewTableAcceptanceProblems(newReviewTable("t-1", "due_diligence"))).toEqual([
      "审查表为空",
    ]);
    const noSource: ReviewTable = {
      ...newReviewTable("t-1", "due_diligence"),
      rows: [
        { id: "r1", cells: { item: "股权结构" } },
        { id: "r2", cells: { item: "重大合同", source: "cases/m/materials/a.pdf" } },
      ],
    };
    expect(reviewTableAcceptanceProblems(noSource)).toEqual(["1 行缺来源"]);
    const good: ReviewTable = {
      ...noSource,
      rows: [
        { id: "r1", cells: { item: "股权结构", source: "cases/m/materials/b.pdf" } },
        { id: "r2", cells: { item: "重大合同", source: "cases/m/materials/a.pdf" } },
      ],
    };
    expect(reviewTableAcceptanceProblems(good)).toEqual([]);
  });

  it("previews an empty table honestly instead of rendering a broken grid", () => {
    expect(reviewTableToMarkdown(newReviewTable("t-1", "evidence"))).toContain("空表");
  });
});
