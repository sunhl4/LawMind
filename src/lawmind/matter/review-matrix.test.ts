import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildMatterReviewMatrix } from "./review-matrix.js";

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
  });
});
