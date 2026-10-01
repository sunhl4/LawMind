import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistDraft } from "./index.js";
import {
  appendLawyerHunk,
  readRedlineProposal,
  removePendingLawyerHunk,
} from "./redline-proposal.js";

describe("removePendingLawyerHunk", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("drops a pending lawyer hunk so Control+Z can clear the rail", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-undo-hunk-"));
    dirs.push(workspaceDir);
    persistDraft(workspaceDir, {
      taskId: "task-undo",
      title: "合同",
      output: "docx",
      templateId: "word/contract-default",
      deliverableType: "contract.review",
      summary: "",
      sections: [{ heading: "正文", body: "甲方应于五日内付款。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    });
    const added = appendLawyerHunk(workspaceDir, "task-undo", {
      before: "五日",
      after: "三日",
    });
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    const removed = removePendingLawyerHunk(workspaceDir, "task-undo", added.hunkId);
    expect(removed.ok).toBe(true);
    expect(readRedlineProposal(workspaceDir, "task-undo")?.hunks).toEqual([]);
  });
});
