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
});
