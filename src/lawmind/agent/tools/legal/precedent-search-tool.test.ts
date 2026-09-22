import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../../types.js";
import { searchPrecedents } from "./precedent-search-tool.js";

const PREV_FLAG = "LAWMIND_ALLOW_CROSS_MATTER_SEARCH";

function makeCtx(workspaceDir: string): AgentContext {
  return { workspaceDir } as unknown as AgentContext;
}

function persistApprovedDraft(
  workspaceDir: string,
  opts: { taskId: string; matterId: string; title: string; body: string },
): void {
  const dir = path.join(workspaceDir, "drafts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${opts.taskId}.json`),
    JSON.stringify({
      taskId: opts.taskId,
      matterId: opts.matterId,
      title: opts.title,
      summary: "摘要",
      deliverableType: "memo.opinion",
      reviewStatus: "approved",
      output: "docx",
      templateId: "word/legal-memo-default",
      reviewNotes: [],
      createdAt: new Date().toISOString(),
      sections: [{ heading: "分析", body: opts.body, citations: [] }],
    }),
    "utf8",
  );
}

describe("search_precedents", () => {
  let workspaceDir: string;
  let prevFlag: string | undefined;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-precedent-"));
    prevFlag = process.env[PREV_FLAG];
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    if (prevFlag === undefined) {
      delete process.env[PREV_FLAG];
    } else {
      process.env[PREV_FLAG] = prevFlag;
    }
  });

  it("is honestly off without the cross-matter flag", async () => {
    delete process.env[PREV_FLAG];
    persistApprovedDraft(workspaceDir, {
      taskId: "t-1",
      matterId: "m-old",
      title: "旧案意见",
      body: "定金不得超过主合同标的额的百分之二十。",
    });
    const r = await searchPrecedents.execute({ query: "定金" }, makeCtx(workspaceDir));
    expect(r.ok).toBe(true);
    const data = r.data as { hits: unknown[]; precedentSearchEnabled: boolean };
    expect(data.hits).toEqual([]);
    expect(data.precedentSearchEnabled).toBe(false);
  });

  it("finds approved old-matter deliverables when enabled, with matter attribution", async () => {
    process.env[PREV_FLAG] = "1";
    persistApprovedDraft(workspaceDir, {
      taskId: "t-1",
      matterId: "m-old",
      title: "旧案意见",
      body: "定金不得超过主合同标的额的百分之二十，超过部分不产生定金效力。",
    });
    // 未签批底稿不算先例。
    const dir = path.join(workspaceDir, "drafts");
    fs.writeFileSync(
      path.join(dir, "t-pending.json"),
      JSON.stringify({
        taskId: "t-pending",
        matterId: "m-draft",
        title: "未定稿意见",
        deliverableType: "memo.opinion",
        reviewStatus: "pending",
        sections: [{ heading: "分析", body: "定金酌减抗辩思路", citations: [] }],
      }),
      "utf8",
    );
    const r = await searchPrecedents.execute({ query: "定金不得超过" }, makeCtx(workspaceDir));
    expect(r.ok).toBe(true);
    const data = r.data as {
      hits: Array<{ matterId: string; citeAs: string; snippet: string }>;
      precedentSearchEnabled: boolean;
    };
    expect(data.precedentSearchEnabled).toBe(true);
    expect(data.hits.length).toBe(1);
    expect(data.hits[0]?.matterId).toBe("m-old");
    expect(data.hits[0]?.citeAs).toContain("m-old");
    expect(data.hits[0]?.snippet).toContain("定金");
  });

  it("rejects empty queries", async () => {
    process.env[PREV_FLAG] = "1";
    const r = await searchPrecedents.execute({ query: "  " }, makeCtx(workspaceDir));
    expect(r.ok).toBe(false);
  });

  it("aligns a precedent clause to the target draft's own terminology", async () => {
    process.env[PREV_FLAG] = "1";
    persistApprovedDraft(workspaceDir, {
      taskId: "t-old",
      matterId: "m-old",
      title: "旧案合同审查",
      body: "买方应在收到发票之日起十日内付款；买方逾期，卖方有权解除合同。",
    });
    persistApprovedDraft(workspaceDir, {
      taskId: "t-current",
      matterId: "m-new",
      title: "本案协议",
      body: "甲方：北京示例科技有限公司\n乙方：李某\n本协议自双方签署之日起生效。",
    });

    const r = await searchPrecedents.execute(
      {
        query: "买方应在收到发票",
        target_task_id: "t-current",
        term_map: { 买方: "甲方", 卖方: "乙方" },
      },
      makeCtx(workspaceDir),
    );
    expect(r.ok).toBe(true);
    const data = r.data as {
      hits: Array<{ alignedSnippet?: string; terminologySubstitutions?: unknown[] }>;
      terminology: { terms: Array<{ term: string }> };
      terminologyNotice: string;
    };
    expect(data.terminology.terms.map((t) => t.term)).toContain("甲方");
    const hit = data.hits[0];
    expect(hit?.alignedSnippet).toContain("甲方应在收到发票");
    expect(hit?.alignedSnippet).toContain("乙方有权解除");
    expect(hit?.alignedSnippet).not.toContain("买方");
    expect(hit?.terminologySubstitutions).toHaveLength(2);
    expect(data.terminologyNotice).toContain("alignedSnippet");
  });

  it("surfaces foreign labels it cannot map instead of silently inserting them", async () => {
    process.env[PREV_FLAG] = "1";
    persistApprovedDraft(workspaceDir, {
      taskId: "t-old",
      matterId: "m-old",
      title: "旧案合同审查",
      body: "承包人应在开工前提交施工组织设计。",
    });
    persistApprovedDraft(workspaceDir, {
      taskId: "t-current",
      matterId: "m-new",
      title: "本案协议",
      body: "甲方：北京示例科技有限公司\n乙方：李某",
    });

    const r = await searchPrecedents.execute(
      { query: "施工组织设计", target_task_id: "t-current" },
      makeCtx(workspaceDir),
    );
    expect(r.ok).toBe(true);
    const data = r.data as {
      hits: Array<{ unmappedForeignTerms?: string[] }>;
      unmappedForeignTerms?: string[];
    };
    expect(data.hits[0]?.unmappedForeignTerms).toEqual(["承包人"]);
    expect(data.unmappedForeignTerms).toEqual(["承包人"]);
  });

  it("refuses terminology alignment when the target draft is missing", async () => {
    process.env[PREV_FLAG] = "1";
    const r = await searchPrecedents.execute(
      { query: "定金", target_task_id: "nope" },
      makeCtx(workspaceDir),
    );
    expect(r.ok).toBe(false);
  });

  it("tells the caller to pass target_task_id when alignment was skipped", async () => {
    process.env[PREV_FLAG] = "1";
    persistApprovedDraft(workspaceDir, {
      taskId: "t-old",
      matterId: "m-old",
      title: "旧案意见",
      body: "定金不得超过主合同标的额的百分之二十。",
    });
    const r = await searchPrecedents.execute({ query: "定金" }, makeCtx(workspaceDir));
    const data = r.data as { note: string; terminology?: unknown };
    expect(data.note).toContain("target_task_id");
    expect(data.terminology).toBeUndefined();
  });
});
