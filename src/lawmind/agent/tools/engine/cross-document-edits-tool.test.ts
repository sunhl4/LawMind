import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDraft, persistDraft } from "../../../drafts/index.js";
import type { AgentContext } from "../../types.js";
import { executeCrossDocumentEdits, newCrossDocumentBatchId } from "./cross-document-edits-tool.js";

function ctxFor(workspaceDir: string): AgentContext {
  return { workspaceDir } as unknown as AgentContext;
}

/** 合同正文草稿：已有 contractEdit 基线与足够长的正文，避免测试里触发 seed 路径。 */
function seedContractDraft(workspaceDir: string, taskId: string, bodies: string[]): void {
  persistDraft(workspaceDir, {
    taskId,
    matterId: "m-batch",
    title: `合同-${taskId}`,
    summary: "",
    output: "docx",
    templateId: "word/legal-memo-default",
    deliverableType: "contract.review",
    contractEdit: {
      baselineRelativePath: `cases/m-batch/materials/${taskId}.docx`,
      mode: "surgical",
    },
    sections: bodies.map((body, i) => ({ heading: `第${i + 1}条`, body, citations: [] })),
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  });
}

describe("executeCrossDocumentEdits", () => {
  let workspaceDir: string;
  const longTail = "本条其余内容保持不变，用于满足正文长度下限并保持上下文稳定。";

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-xdoc-"));
    seedContractDraft(workspaceDir, "c1", [
      `甲方为北京示例科技有限公司。${longTail}`,
      `北京示例科技有限公司应在十日内开票。${longTail}`,
    ]);
    seedContractDraft(workspaceDir, "c2", [`本协议由北京示例科技有限公司与王某签订。${longTail}`]);
    seedContractDraft(workspaceDir, "c3", [`本协议无相关当事人约定。${longTail}`]);
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("changes every document that carries the anchor and keeps a change manifest", async () => {
    const result = await executeCrossDocumentEdits({
      params: {
        task_ids: ["c1", "c2", "c3"],
        edits: [
          {
            find: "北京示例科技有限公司",
            replace: "北京示例集团有限公司",
            occurrences: "all",
          },
        ],
      },
      ctx: ctxFor(workspaceDir),
      taskIds: ["c1", "c2", "c3"],
      craftCheck: { deferred: [] },
    });

    expect(result.ok).toBe(true);
    const data = result.data as {
      totals: { documents: number; documentsChanged: number; replacements: number };
      docs: Array<{ taskId: string; redlinePending: number; missed: string[] }>;
      manifestPath: string;
      redlinePending: number;
    };
    expect(data.totals).toMatchObject({ documents: 3, documentsChanged: 2, replacements: 3 });
    expect(data.redlinePending).toBeGreaterThanOrEqual(2);
    const c1 = data.docs.find((d) => d.taskId === "c1");
    expect(c1?.redlinePending).toBeGreaterThanOrEqual(1);
    const c3 = data.docs.find((d) => d.taskId === "c3");
    // 最短改动的锚点是共有部分之外的「科技」。
    expect(c3?.missed).toEqual(["科技"]);

    // 正文按同一口径落改，且每份都出了修订轨提案
    const c1Draft = readDraft(workspaceDir, "c1");
    expect(c1Draft?.sections[0].body).toBe(`甲方为北京示例集团有限公司。${longTail}`);
    expect(c1Draft?.sections[1].body).toBe(`北京示例集团有限公司应在十日内开票。${longTail}`);
    const c3Draft = readDraft(workspaceDir, "c3");
    expect(c3Draft?.sections[0].body).toBe(`本协议无相关当事人约定。${longTail}`);
    expect(fs.existsSync(path.join(workspaceDir, "drafts", "c1.redline.json"))).toBe(true);

    // 变更清单落盘
    expect(fs.existsSync(path.join(workspaceDir, data.manifestPath))).toBe(true);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, data.manifestPath), "utf8"),
    ) as { docs: Array<{ taskId: string }>; totals: { replacements: number } };
    expect(manifest.docs).toHaveLength(3);
    expect(manifest.totals.replacements).toBe(3);
  });

  it("stops the whole batch without writing when an anchor is ambiguous", async () => {
    const result = await executeCrossDocumentEdits({
      params: {
        task_ids: ["c1", "c2"],
        edits: [{ find: "北京示例科技有限公司", replace: "示例集团" }],
      },
      ctx: ctxFor(workspaceDir),
      taskIds: ["c1", "c2"],
      craftCheck: { deferred: [] },
    });

    expect(result.ok).toBe(false);
    const data = result.data as { code: string; conflicts: Array<{ taskId: string }> };
    expect(data.code).toBe("anchor_ambiguous");
    expect(data.conflicts.map((c) => c.taskId)).toEqual(["c1"]);
    // 零落改：正文与修订轨都没动
    expect(readDraft(workspaceDir, "c1")?.sections[0].body).toContain("北京示例科技有限公司");
    expect(fs.existsSync(path.join(workspaceDir, "drafts", "c1.redline.json"))).toBe(false);
  });

  it("refuses the batch when any target draft is missing", async () => {
    const result = await executeCrossDocumentEdits({
      params: { task_ids: ["c1", "nope"], edits: [{ find: "王某", replace: "李四" }] },
      ctx: ctxFor(workspaceDir),
      taskIds: ["c1", "nope"],
      craftCheck: { deferred: [] },
    });
    expect(result.ok).toBe(false);
    const data = result.data as { code: string; taskId: string };
    expect(data.code).toBe("draft_not_found");
    expect(data.taskId).toBe("nope");
    expect(readDraft(workspaceDir, "c1")?.sections[1].body).toContain("北京示例科技有限公司");
    expect(fs.existsSync(path.join(workspaceDir, "drafts", "c1.redline.json"))).toBe(false);
  });

  it("reports edits_invalid for a malformed occurrences value", async () => {
    const result = await executeCrossDocumentEdits({
      params: {
        task_ids: ["c1"],
        edits: [{ find: "王某", replace: "李某", occurrences: "everywhere" }],
      },
      ctx: ctxFor(workspaceDir),
      taskIds: ["c1"],
      craftCheck: { deferred: [] },
    });
    expect(result.ok).toBe(false);
    expect((result.data as { code: string }).code).toBe("edits_invalid");
  });

  it("warns when a batch edit brings in a party label the documents never define", async () => {
    const result = await executeCrossDocumentEdits({
      params: {
        task_ids: ["c2"],
        edits: [{ find: "王某", replace: "王某，承包人应交付" }],
      },
      ctx: ctxFor(workspaceDir),
      taskIds: ["c2"],
      craftCheck: { deferred: [] },
    });
    expect(result.ok).toBe(true);
    const data = result.data as {
      terminologyWarnings?: Array<{ taskId: string; token: string }>;
      terminologyNotice?: string;
    };
    expect(data.terminologyWarnings).toEqual([
      { taskId: "c2", token: "承包人", reason: expect.any(String) },
    ]);
    expect(data.terminologyNotice).toContain("本文未定义");
  });
});

describe("newCrossDocumentBatchId", () => {
  it("stays sortable and unique", () => {
    const a = newCrossDocumentBatchId(new Date("2026-09-20T02:00:00.000Z"));
    const b = newCrossDocumentBatchId(new Date("2026-09-20T03:00:00.000Z"));
    expect(a.startsWith("xdoc-20260920-")).toBe(true);
    expect(a < b).toBe(true);
    expect(a).not.toBe(newCrossDocumentBatchId(new Date("2026-09-20T02:00:00.000Z")));
  });
});
