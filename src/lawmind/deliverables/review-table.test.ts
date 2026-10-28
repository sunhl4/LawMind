import { describe, expect, it } from "vitest";
import {
  cellProvenance,
  detectNameColumnKeys,
  formatReviewCellEvidenceLine,
  lineRefFromReviewSource,
  mergeLawyerReviewRows,
  newReviewTable,
  reviewTableAcceptanceProblems,
  reviewTableProvenanceXlsxRows,
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

  it("normalizes legacy #line= / #page= locators for evidence export", () => {
    expect(lineRefFromReviewSource("a.pdf#line=3")).toBe("L3");
    expect(lineRefFromReviewSource("a.pdf#page=2")).toBe("P2");
    expect(lineRefFromReviewSource("a.txt#L4-L5")).toBe("L4-L5");
    const row: ReviewTable["rows"][number] = {
      id: "r1",
      cells: { finding: "100万" },
      cellMeta: {
        finding: {
          source: "a.pdf#line=7",
          candidates: [
            {
              value: "100万",
              locator: "line=7",
              lineText: "注册资本人民币100万元",
              patternLabel: "amount",
            },
          ],
        },
      },
    };
    expect(formatReviewCellEvidenceLine(row, "finding")).toBe("L7：注册资本人民币100万元");
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
          cellMeta: {
            purpose: {
              source: "cases/m/materials/合同.pdf#line=3",
              note: "证明双方存在劳动关系",
              confidence: "high",
            },
          },
        },
      ],
    };
    const md = reviewTableToMarkdown(table);
    expect(md).toContain("| 证据名称 |");
    expect(md).toContain("劳动合同");
    expect(md).toContain("cases/m/materials/合同.pdf");
    const rows = reviewTableToXlsxRows(table);
    expect(rows[0]).toEqual([
      "证据名称",
      "证明目的",
      "证明目的_依据",
      "关联争点",
      "关联争点_依据",
      "证明力",
      "证明力_依据",
      "来源",
    ]);
    expect(rows[1]?.[0]).toBe("劳动合同");
    expect(rows[1]?.[2]).toBe("L3：证明双方存在劳动关系");
    const plain = reviewTableToXlsxRows(table, { includeEvidenceColumns: false });
    expect(plain[0]).toEqual(["证据名称", "证明目的", "关联争点", "证明力", "来源"]);
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
    expect(reviewTableAcceptanceProblems(noSource)).toEqual([]);
    const good: ReviewTable = {
      ...noSource,
      rows: [
        { id: "r1", cells: { item: "股权结构", source: "cases/m/materials/b.pdf" } },
        { id: "r2", cells: { item: "重大合同", source: "cases/m/materials/a.pdf" } },
      ],
    };
    expect(reviewTableAcceptanceProblems(good)).toEqual([]);
    const guessed: ReviewTable = {
      ...newReviewTable("t-1", "due_diligence"),
      rows: [
        {
          id: "r1",
          cells: { item: "付款", finding: "有上限", source: "cases/m/materials/a.pdf" },
          source: "cases/m/materials/a.pdf",
        },
      ],
    };
    expect(reviewTableAcceptanceProblems(guessed)).toEqual(["1 行缺来源"]);
    const cited: ReviewTable = {
      ...guessed,
      rows: [
        {
          ...guessed.rows[0],
          cellMeta: { finding: { source: "cases/m/materials/a.pdf#line=3", confidence: "high" } },
        },
      ],
    };
    expect(reviewTableAcceptanceProblems(cited)).toEqual([]);
  });

  it("counts a pattern-only cell as a gap, not as verified", () => {
    const base = newReviewTable("t-1", "due_diligence");
    const weak: ReviewTable = {
      ...base,
      rows: [
        {
          id: "r1",
          cells: { item: "股权结构", finding: "人民币100万元", source: "cases/m/materials/a.pdf" },
          cellMeta: {
            finding: {
              source: "cases/m/materials/a.pdf#line=1",
              confidence: "medium",
              basis: "pattern_only",
            },
          },
          source: "cases/m/materials/a.pdf",
        },
      ],
    };
    expect(reviewTableAcceptanceProblems(weak)).toEqual(["1 行仅有模式命中，需核对是否同一字段"]);

    // 同一格改成原句命中，就不是缺口。
    const verified: ReviewTable = {
      ...weak,
      rows: [
        {
          ...weak.rows[0],
          cellMeta: {
            finding: {
              source: "cases/m/materials/a.pdf#line=2",
              confidence: "high",
              basis: "exact_quote",
            },
          },
        },
      ],
    };
    expect(reviewTableAcceptanceProblems(verified)).toEqual([]);
  });

  it("counts a cell left with several candidates as an unresolved gap", () => {
    const base = newReviewTable("t-1", "due_diligence");
    const ambiguous: ReviewTable = {
      ...base,
      rows: [
        {
          id: "r1",
          cells: { item: "股权结构", finding: "无法判断（证据不足）" },
          cellMeta: {
            finding: {
              abstained: true,
              note: "有 2 处可能的值，无法确定取哪一个",
              confidence: "low",
              basis: "abstained",
              candidates: [
                { value: "100万元", locator: "line=1", lineText: "注册资本", patternLabel: "金额" },
                { value: "300万元", locator: "line=2", lineText: "总价款", patternLabel: "金额" },
              ],
            },
          },
          source: "cases/m/materials/a.pdf",
        },
      ],
    };
    expect(reviewTableAcceptanceProblems(ambiguous)).toEqual(["1 行有多个候选值，未确定取哪个"]);
  });

  it("keeps cellProvenance able to report the basis for the UI", () => {
    const row = {
      id: "r1",
      cells: { finding: "人民币100万元" },
      cellMeta: {
        finding: {
          source: "a.pdf#line=1",
          confidence: "medium" as const,
          basis: "pattern_only" as const,
          note: "请核对",
        },
      },
    };
    expect(cellProvenance(row, "finding")).toMatchObject({
      state: "sourced",
      basis: "pattern_only",
    });
  });

  it("does not treat a custom clause column as a filename column", () => {
    const keys = detectNameColumnKeys({
      columns: [
        { key: "clause", label: "条款" },
        { key: "payment", label: "付款条款" },
        { key: "finding", label: "发现" },
      ],
    });
    expect(keys).toEqual(["clause"]);
  });

  it("keeps citations on untouched cells when the lawyer edits another cell", () => {
    const previous: ReviewTable["rows"] = [
      {
        id: "r1",
        cells: { finding: "原结论", risk: "低" },
        source: "a.pdf",
        cellMeta: {
          finding: { source: "a.pdf#line=2" },
          risk: { source: "a.pdf#line=4" },
        },
        review: { locked: true },
      },
    ];
    const merged = mergeLawyerReviewRows(previous, [
      { id: "r1", cells: { finding: "律师改过", risk: "低" } },
    ]);
    expect(merged[0]?.cells.finding).toBe("原结论");
    expect(merged[0]?.cellMeta?.finding?.source).toBe("a.pdf#line=2");
    expect(merged[0]?.cellMeta?.risk?.source).toBe("a.pdf#line=4");
    expect(merged[0]?.review?.locked).toBe(true);
    expect(merged[0]?.source).toBe("a.pdf");
  });

  it("keeps a locked row when a save omits it or rewrites its cells", () => {
    const previous: ReviewTable["rows"] = [
      {
        id: "locked",
        cells: { finding: "已核对" },
        cellMeta: { finding: { source: "a.pdf#line=1" } },
        review: { locked: true },
      },
    ];
    const rewritten = mergeLawyerReviewRows(previous, [
      { id: "locked", cells: { finding: "被盖掉" } },
    ]);
    expect(rewritten[0]?.cells.finding).toBe("已核对");
    const omitted = mergeLawyerReviewRows(previous, []);
    expect(omitted[0]?.id).toBe("locked");
    const unlocked = mergeLawyerReviewRows(previous, [
      { id: "locked", cells: { finding: "律师改过" }, review: { locked: false } },
    ]);
    expect(unlocked[0]?.cells.finding).toBe("律师改过");
    expect(unlocked[0]?.cellMeta?.finding).toBeUndefined();
    expect(unlocked[0]?.review?.locked).toBe(false);
  });

  it("puts cell citations on a second sheet", () => {
    const table: ReviewTable = {
      ...newReviewTable("t-1", "due_diligence"),
      rows: [
        {
          id: "r1",
          cells: { item: "付款", finding: "120万" },
          cellMeta: { finding: { source: "a.pdf#line=1", confidence: "high" } },
        },
      ],
    };
    const rows = reviewTableProvenanceXlsxRows(table);
    expect(rows[0]).toContain("出处");
    expect(rows.some((row) => row.includes("a.pdf#line=1"))).toBe(true);
    expect(rows.some((row) => row[1] === "审查事项")).toBe(false);
  });

  it("previews an empty table honestly instead of rendering a broken grid", () => {
    expect(reviewTableToMarkdown(newReviewTable("t-1", "evidence"))).toContain("空表");
  });
});
