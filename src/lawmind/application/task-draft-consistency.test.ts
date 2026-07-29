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

  it("format report lists issues when present", () => {
    const ws = tmpWs();
    persistDraft(ws, {
      taskId: "orphan-fmt",
      title: "孤",
      output: "docx",
      templateId: "builtin/memo",
      summary: "x",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const report = formatTaskDraftConsistencyReport(ws);
    expect(report).toContain("orphan_draft");
    expect(report).not.toContain("OK");
  });

  it("reports deliverable pointing at missing draft", async () => {
    const ws = tmpWs();
    const { createPlannedDeliverable, transitionDeliverable } = await import(
      "./services/deliverable-service.js"
    );
    const { loadDeliverable, saveDeliverable } = await import(
      "../adapters/matter-storage/index.js"
    );
    createPlannedDeliverable(ws, {
      matterId: "m-dd",
      deliverableId: "del-ghost",
      kind: "legal-memo",
      taskId: "ghost-draft",
    });
    transitionDeliverable(ws, "m-dd", "del-ghost", "drafting");
    const d = loadDeliverable(ws, "m-dd", "del-ghost");
    expect(d).toBeTruthy();
    saveDeliverable(ws, {
      ...d!,
      currentDraftTaskId: "ghost-draft",
      updatedAt: new Date().toISOString(),
    });
    const issues = checkTaskDraftConsistency(ws);
    expect(
      issues.some(
        (i) =>
          i.code === "deliverable_draft_missing" &&
          i.taskId === "ghost-draft" &&
          i.deliverableId === "del-ghost",
      ),
    ).toBe(true);
  });

  it("reports deliverable_review_drift when review stamps diverge", async () => {
    const ws = tmpWs();
    const { createPlannedDeliverable, transitionDeliverable } = await import(
      "./services/deliverable-service.js"
    );
    const { loadDeliverable, saveDeliverable } = await import(
      "../adapters/matter-storage/index.js"
    );
    const now = new Date().toISOString();
    persistDraft(ws, {
      taskId: "draft-rev",
      title: "备忘",
      output: "docx",
      templateId: "builtin/memo",
      summary: "x",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });
    ensureTaskRecord(ws, {
      taskId: "draft-rev",
      kind: "draft.word",
      output: "docx",
      instruction: "写备忘",
      summary: "写备忘",
      riskLevel: "medium",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: now,
      deliverableType: "document.general",
    });
    createPlannedDeliverable(ws, {
      matterId: "m-rev",
      deliverableId: "del-rev",
      kind: "legal-memo",
      taskId: "draft-rev",
    });
    transitionDeliverable(ws, "m-rev", "del-rev", "drafting");
    const d = loadDeliverable(ws, "m-rev", "del-rev");
    expect(d).toBeTruthy();
    saveDeliverable(ws, {
      ...d!,
      currentDraftTaskId: "draft-rev",
      currentReviewStatus: "approved",
      updatedAt: now,
    });
    const issues = checkTaskDraftConsistency(ws);
    expect(
      issues.some(
        (i) =>
          i.code === "deliverable_review_drift" &&
          i.taskId === "draft-rev" &&
          i.deliverableId === "del-rev",
      ),
    ).toBe(true);
  });
});

