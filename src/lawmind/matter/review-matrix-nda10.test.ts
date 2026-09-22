import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildMatterReviewMatrix, exportReviewMatrixCsv } from "./review-matrix.js";

const fixtureDocs = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/lawmind-review-matrix-nda10/docs",
);

describe("G5 NDA×10 matrix with citations", () => {
  it("exports CSV with citation for 10 NDA drafts", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-nda10-"));
    const matterId = "m-nda10";
    fs.mkdirSync(path.join(ws, "drafts"), { recursive: true });
    fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
    const files = fs
      .readdirSync(fixtureDocs)
      .filter((n) => n.endsWith(".md"))
      .toSorted();
    expect(files.length).toBe(10);
    for (let i = 0; i < files.length; i++) {
      const name = files[i]!;
      const body = fs.readFileSync(path.join(fixtureDocs, name), "utf8");
      const taskId = `nda-task-${i + 1}`;
      fs.writeFileSync(
        path.join(ws, "drafts", `${taskId}.json`),
        JSON.stringify({
          taskId,
          matterId,
          title: name.replace(/\.md$/, ""),
          sections: [{ heading: "正文", body }],
          reviewStatus: "pending",
          deliverableType: "contract.nda",
        }),
        "utf8",
      );
      fs.writeFileSync(
        path.join(ws, "drafts", `${taskId}.research.json`),
        JSON.stringify({
          taskId,
          sources: [{ id: `src-${i + 1}`, title: `来源-${i + 1}`, excerpt: "保密义务条款说明" }],
          claims: [],
        }),
        "utf8",
      );
      fs.writeFileSync(
        path.join(ws, "tasks", `${taskId}.json`),
        JSON.stringify({
          taskId,
          matterId,
          kind: "agent.instruction",
          status: "done",
          summary: name,
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        }),
        "utf8",
      );
    }
    const matrix = buildMatterReviewMatrix(ws, matterId);
    expect(matrix.documents.filter((d) => d.kind === "draft").length).toBe(10);
    const csv = exportReviewMatrixCsv(matrix);
    expect(csv.startsWith("documentId,")).toBe(true);
    expect(csv).toMatch(/citation/);
    const dataRows = csv.trim().split("\n").slice(1);
    expect(dataRows.length).toBeGreaterThanOrEqual(10);
    expect(csv).toMatch(/src-\d+|nda-task-\d+/);
    fs.rmSync(ws, { recursive: true, force: true });
  });
});
