import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  mcpGetReviewMatrix,
  mcpGetSourcePreview,
  mcpListDrafts,
  mcpListSourceAnnotations,
} from "./readonly-tools.js";

describe("mcp readonly-tools", () => {
  it("lists drafts and source preview", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mcp-"));
    const taskId = "t1";
    fs.mkdirSync(path.join(ws, "drafts"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "drafts", `${taskId}.json`),
      JSON.stringify({ taskId, title: "合同", sections: [], reviewStatus: "pending" }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(ws, "drafts", `${taskId}.research.json`),
      JSON.stringify({
        taskId,
        sources: [{ id: "s1", title: "法规", excerpt: "违约责任" }],
        claims: [],
      }),
      "utf8",
    );
    const drafts = mcpListDrafts(ws);
    expect(drafts.ok).toBe(true);
    expect((drafts.data as { drafts: unknown[] }).drafts).toHaveLength(1);
    const preview = mcpGetSourcePreview(ws, "s1", taskId);
    expect(preview.ok).toBe(true);
    expect(preview.text).toMatch(/违约责任/);
    const escaped = mcpGetSourcePreview(ws, "s1", "../../outside");
    expect(escaped.ok).toBe(false);
    expect(escaped.error).toBe("invalid_path");
  });

  it("returns review matrix for matter", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mcp-mx-"));
    const matterId = "m1";
    const taskId = "task-m";
    fs.mkdirSync(path.join(ws, "drafts"), { recursive: true });
    fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "drafts", `${taskId}.json`),
      JSON.stringify({
        taskId,
        matterId,
        title: "主合同",
        sections: [{ heading: "违约", body: "违约赔偿。" }],
        reviewStatus: "pending",
      }),
      "utf8",
    );
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
    const matrix = mcpGetReviewMatrix(ws, matterId);
    expect(matrix.ok).toBe(true);
    const docs = (matrix.data as { matrix: { documents: unknown[] } }).matrix.documents;
    expect(docs.length).toBeGreaterThan(0);
  });

  it("lists source annotations", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mcp-ann-"));
    const { createSourceAnnotation } = await import("../sources/source-annotation.js");
    await createSourceAnnotation(ws, path.join(ws, "audit"), {
      sourceId: "s-ann",
      comment: "需复核",
    });
    const listed = mcpListSourceAnnotations(ws, "s-ann");
    expect(listed.ok).toBe(true);
    expect((listed.data as { annotations: unknown[] }).annotations).toHaveLength(1);
  });
});
