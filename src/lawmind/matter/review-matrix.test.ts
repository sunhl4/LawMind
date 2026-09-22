import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareMatrixExcerpts } from "./review-matrix-compare.js";
import {
  buildMatterReviewMatrix,
  cleanReviewExcerpt,
  excerptForQuestion,
  exportReviewMatrixCsv,
  humanizeMatrixDocumentTitle,
} from "./review-matrix.js";

describe("buildMatterReviewMatrix", () => {
  it("builds rows from draft and research sources", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-matrix-"));
    const matterId = "m-matrix";
    const taskId = "task-1";
    fs.mkdirSync(path.join(ws, "drafts"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "drafts", `${taskId}.json`),
      JSON.stringify({
        taskId,
        matterId,
        title: "主合同",
        sections: [{ heading: "违约", body: "甲方违约时应赔偿乙方损失。" }],
        reviewStatus: "pending",
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(ws, "drafts", `${taskId}.research.json`),
      JSON.stringify({
        taskId,
        sources: [{ id: "s1", title: "法规", excerpt: "违约责任条款说明" }],
        claims: [],
      }),
      "utf8",
    );
    fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "tasks", `${taskId}.json`),
      JSON.stringify({
        taskId,
        matterId,
        kind: "agent.instruction",
        status: "running",
        summary: "合同",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      }),
      "utf8",
    );

    const matrix = buildMatterReviewMatrix(ws, matterId);
    expect(matrix.documents.some((d) => d.kind === "draft")).toBe(true);
    expect(matrix.documents.some((d) => d.sourceId === "s1")).toBe(true);
    const riskCell = matrix.cells.find(
      (c) => c.questionId === "q-risk" && c.documentId.startsWith("draft:"),
    );
    expect(riskCell?.excerpt).toMatch(/违约|赔偿/);
    expect(riskCell?.status).toBe("suggested");
  });

  it("does not fill unmatched columns with document head", () => {
    const caseBody = [
      "# 案件档案：sun",
      "## 1. 基本信息",
      "- 案件名称：sun",
      "- 案由：待补充",
      "## 2. 当事人",
      "- 甲方：待补充",
    ].join("\n");
    expect(excerptForQuestion(caseBody, "q-parties")).toMatch(/当事人|甲方/);
    expect(excerptForQuestion(caseBody, "q-ip")).toBe("");
    expect(excerptForQuestion(caseBody, "q-governing")).toBe("");
    expect(excerptForQuestion(caseBody, "q-misc")).toBe("");
  });

  it("humanizes case file titles and strips markdown noise", () => {
    expect(humanizeMatrixDocumentTitle("CASE.md")).toBe("案件档案");
    expect(humanizeMatrixDocumentTitle("MATTER_STRATEGY.md")).toBe("案件策略");
    expect(cleanReviewExcerpt("## 标题\n- **加粗**\n---\n正文")).toContain("标题");
    expect(cleanReviewExcerpt("## 标题\n- **加粗**\n---\n正文")).not.toMatch(/#|\*\*|---/);
  });

  it("exports CSV with citation column and compare flags danger", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-matrix-csv-"));
    const matterId = "m-csv";
    const taskId = "task-csv";
    fs.mkdirSync(path.join(ws, "drafts"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "drafts", `${taskId}.json`),
      JSON.stringify({
        taskId,
        matterId,
        title: "主合同",
        sections: [{ heading: "违约", body: "甲方违约时应赔偿乙方损失。" }],
        reviewStatus: "pending",
      }),
      "utf8",
    );
    fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "tasks", `${taskId}.json`),
      JSON.stringify({
        taskId,
        matterId,
        kind: "agent.instruction",
        status: "running",
        summary: "合同",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      }),
      "utf8",
    );
    const csv = exportReviewMatrixCsv(buildMatterReviewMatrix(ws, matterId));
    expect(csv).toMatch(/citation/);
    expect(csv).toMatch(/task-csv|draft:/);
    expect(compareMatrixExcerpts("普通条款", "乙方承担无限责任").danger).toBe(true);
    expect(compareMatrixExcerpts("a", "a").changed).toBe(false);
  });
});
