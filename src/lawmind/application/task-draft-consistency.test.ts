/**
 * Task/draft consistency — read-only dual-truth checks.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistDraft } from "../drafts/index.js";
import { ensureTaskRecord } from "../tasks/index.js";
import {
  checkTaskDraftConsistency,
  formatTaskDraftConsistencyReport,
} from "./task-draft-consistency.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-td-"));
  dirs.push(d);
  return d;
}

describe("task-draft-consistency", () => {
  it("reports orphan drafts", () => {
    const ws = tmpWs();
    persistDraft(ws, {
      taskId: "orphan-1",
      title: "孤草稿",
      output: "docx",
      templateId: "builtin/memo",
      summary: "x",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const issues = checkTaskDraftConsistency(ws);
    expect(issues.some((i) => i.code === "orphan_draft" && i.taskId === "orphan-1")).toBe(true);
  });

  it("reports missing draft for deliverable task", () => {
    const ws = tmpWs();
    ensureTaskRecord(ws, {
      taskId: "t-missing",
      kind: "draft.word",
      output: "docx",
      instruction: "写备忘",
      summary: "写备忘",
      riskLevel: "medium",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
      deliverableType: "document.general",
    });
    const recordPath = path.join(ws, "tasks", "t-missing.json");
    const raw = JSON.parse(fs.readFileSync(recordPath, "utf8")) as {
      status?: string;
      reviewStatus?: string;
    };
    raw.status = "drafted";
    raw.reviewStatus = "pending";
    fs.writeFileSync(recordPath, `${JSON.stringify(raw, null, 2)}\n`);
    const issues = checkTaskDraftConsistency(ws);
    expect(
      issues.some(
        (i) => i.code === "missing_draft_for_deliverable_task" && i.taskId === "t-missing",
      ),
    ).toBe(true);
  });

  it("format report OK when empty", () => {
    const ws = tmpWs();
    expect(formatTaskDraftConsistencyReport(ws)).toContain("OK");
  });
});
