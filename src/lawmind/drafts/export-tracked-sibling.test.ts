import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import {
  exportTrackedSiblingForTask,
  reviewFileLockMessage,
  selectTrackedExportHunks,
} from "./export-tracked-sibling.js";
import { persistDraft, readDraft } from "./index.js";
import { writeRedlineProposal } from "./redline-proposal.js";
import type { RedlineHunk } from "./redline-proposal.js";
import { openWordReviewTicket } from "./word-review.js";

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

  it("overwrites the first review file and leaves the source bytes alone", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-export-overwrite-"));
    dirs.push(workspaceDir);
    const source = path.join(workspaceDir, "contracts", "服务合同.docx");
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
        `<w:p><w:r><w:t>甲方应于十日内付款。</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
    );
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `</Types>`,
    );
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, await zip.generateAsync({ type: "nodebuffer" }));
    const before = fs.readFileSync(source);
    const task: ArtifactDraft = {
      taskId: "task-overwrite",
      title: "服务合同",
      output: "docx",
      templateId: "word/contract-default",
      summary: "",
      sections: [{ heading: "付款", body: "甲方应于五日内付款。" }],
      reviewNotes: [],
      reviewStatus: "approved",
      createdAt: "2026-09-28T00:00:00.000Z",
      contractEdit: { baselineRelativePath: "contracts/服务合同.docx", mode: "surgical" },
    };
    persistDraft(workspaceDir, task);
    writeRedlineProposal(workspaceDir, {
      taskId: task.taskId,
      baselineSections: [{ heading: "付款", body: "甲方应于十日内付款。" }],
      hunks: [
        {
          hunkId: "kept",
          sectionIndex: 0,
          before: "甲方应于十日内付款。",
          after: "甲方应于五日内付款。",
          status: "accepted",
          granularity: "surgical",
        },
      ],
      updatedAt: "2026-09-28T01:00:00.000Z",
    });
    const first = await exportTrackedSiblingForTask({
      workspaceDir,
      taskId: task.taskId,
      acceptedOnly: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const stored = readDraft(workspaceDir, task.taskId);
    expect(stored?.outputPath).toBe(first.outputPath);
    expect(
      openWordReviewTicket({ workspaceDir, taskId: task.taskId, reviewAbs: first.outputPath })
        .opened,
    ).toBe(true);
    const second = await exportTrackedSiblingForTask({
      workspaceDir,
      taskId: task.taskId,
      acceptedOnly: true,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.outputPath).toBe(first.outputPath);
    expect(fs.readFileSync(source).equals(before)).toBe(true);
    expect(fs.readdirSync(path.dirname(source)).some((name) => name.includes("_02"))).toBe(false);
  });

  it("reports a locked review file instead of minting another sibling", () => {
    expect(reviewFileLockMessage({ code: "EBUSY" })).toContain("仍留在在办");
    expect(reviewFileLockMessage(new Error("nope"))).toBeUndefined();
  });
});
