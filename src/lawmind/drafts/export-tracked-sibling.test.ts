import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { exportTrackedSiblingForTask, selectTrackedExportHunks } from "./export-tracked-sibling.js";
import { persistDraft } from "./index.js";
import { writeRedlineProposal } from "./redline-proposal.js";
import type { RedlineHunk } from "./redline-proposal.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const hunks: RedlineHunk[] = [
  {
    hunkId: "pending",
    sectionIndex: 0,
    before: "十日",
    after: "五日",
    status: "pending",
    granularity: "surgical",
  },
  {
    hunkId: "kept",
    sectionIndex: 0,
    before: "甲方",
    after: "买方",
    status: "accepted",
    granularity: "surgical",
  },
  {
    hunkId: "dropped",
    sectionIndex: 0,
    before: "应当",
    after: "可以",
    status: "rejected",
    granularity: "surgical",
  },
];

describe("selectTrackedExportHunks", () => {
  it("keeps pending revisions for the add-in and only accepted ones for the preview", () => {
    expect(selectTrackedExportHunks(hunks, false).map((hunk) => hunk.hunkId)).toEqual([
      "pending",
      "kept",
    ]);
    expect(selectTrackedExportHunks(hunks, true).map((hunk) => hunk.hunkId)).toEqual(["kept"]);
  });
});

describe("exportTrackedSiblingForTask", () => {
  it("does not write a file when the preview has no accepted revision", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-export-preview-"));
    dirs.push(workspaceDir);
    const draft: ArtifactDraft = {
      taskId: "task-preview",
      title: "补充协议",
      output: "docx",
      templateId: "word/contract-default",
      summary: "",
      sections: [{ heading: "付款", body: "甲方应于十日内付款。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: "2026-09-27T00:00:00.000Z",
    };
    persistDraft(workspaceDir, draft);
    writeRedlineProposal(workspaceDir, {
      taskId: draft.taskId,
      baselineSections: draft.sections,
      hunks: hunks.filter((hunk) => hunk.status === "pending"),
      updatedAt: "2026-09-27T01:00:00.000Z",
    });
    const result = await exportTrackedSiblingForTask({
      workspaceDir,
      taskId: draft.taskId,
      acceptedOnly: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.status).toBe(409);
    expect(result.code).toBe("nothing_accepted");
    expect(result.error).toContain("还没有接受的修改");
  });
});
