import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDraft, listDraftReviewHeads, listDrafts, persistDraft } from "./index.js";

describe("listDrafts", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("skips outline sidecars and missing createdAt", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-drafts-list-"));
    tmp.push(workspaceDir);
    persistDraft(workspaceDir, {
      taskId: "t1",
      matterId: "m1",
      title: "起诉状",
      output: "docx",
      templateId: "x",
      summary: "s",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: "2026-09-09T00:00:00.000Z",
    });
    fs.writeFileSync(
      path.join(workspaceDir, "drafts", "orphan.outline.json"),
      JSON.stringify({ title: "outline only" }),
      "utf8",
    );
    const listed = listDrafts(workspaceDir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe("起诉状");
  });

  it("skips guardian sidecars", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-drafts-list-"));
    tmp.push(workspaceDir);
    persistDraft(workspaceDir, {
      taskId: "t1",
      matterId: "m1",
      title: "起诉状",
      output: "docx",
      templateId: "x",
      summary: "s",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: "2026-09-09T00:00:00.000Z",
    });
    fs.writeFileSync(
      path.join(workspaceDir, "drafts", "t1.guardian.json"),
      JSON.stringify({ taskId: "t1", latest: { verdict: "fail" }, rounds: [] }),
      "utf8",
    );
    const listed = listDrafts(workspaceDir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe("起诉状");
  });

  it("review heads keep status fields and do not need the body", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-drafts-list-"));
    tmp.push(workspaceDir);
    persistDraft(workspaceDir, {
      taskId: "t-body",
      matterId: "m1",
      title: "答辩状",
      output: "docx",
      templateId: "x",
      summary: "s",
      sections: [{ heading: "一", body: '正文 "引号" {括号}' }],
      reviewNotes: [],
      reviewStatus: "modified",
      createdAt: "2026-09-09T00:00:00.000Z",
      reviewedAt: "2026-09-10T00:00:00.000Z",
    });
    const heads = listDraftReviewHeads(workspaceDir);
    const full = listDrafts(workspaceDir);
    expect(heads).toEqual([
      {
        taskId: "t-body",
        matterId: "m1",
        title: "答辩状",
        reviewStatus: "modified",
        createdAt: "2026-09-09T00:00:00.000Z",
        reviewedAt: "2026-09-10T00:00:00.000Z",
      },
    ]);
    expect(full[0]?.sections).toHaveLength(1);
  });

  it("deleteDraft removes outline and redline-plan sidecars", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-drafts-list-"));
    tmp.push(workspaceDir);
    persistDraft(workspaceDir, {
      taskId: "t1",
      matterId: "m1",
      title: "起诉状",
      output: "docx",
      templateId: "x",
      summary: "s",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: "2026-09-09T00:00:00.000Z",
    });
    const dir = path.join(workspaceDir, "drafts");
    fs.writeFileSync(path.join(dir, "t1.outline.json"), "{}", "utf8");
    fs.writeFileSync(path.join(dir, "t1.redline-plan.json"), "{}", "utf8");
    fs.writeFileSync(path.join(dir, "t1.redline.json.lock"), "{}", "utf8");
    expect(listDrafts(workspaceDir)).toHaveLength(1);
    expect(deleteDraft(workspaceDir, "t1")).toBe(true);
    expect(fs.existsSync(path.join(dir, "t1.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "t1.outline.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "t1.redline-plan.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "t1.redline.json.lock"))).toBe(false);
    expect(listDrafts(workspaceDir)).toHaveLength(0);
  });
});
