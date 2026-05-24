import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentTurn } from "../agent/types.js";
import { persistDraft } from "./index.js";
import {
  buildRevisionRetryInstruction,
  draftRevisionWasPersisted,
  snapshotDraftRevisionBaseline,
  turnHasSuccessfulDraftWrite,
} from "./revision-persisted.js";

describe("revision-persisted", () => {
  let workspaceDir = "";

  afterEach(() => {
    if (workspaceDir) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      workspaceDir = "";
    }
  });

  it("detects successful write_document to target draft path", () => {
    const turn: AgentTurn = {
      turnId: "t1",
      sessionId: "s1",
      instruction: "revise",
      messages: [
        {
          role: "tool",
          content: "",
          timestamp: new Date().toISOString(),
          toolCallResponses: [
            {
              toolCallId: "tc1",
              name: "write_document",
              result: {
                ok: true,
                data: { filePath: "drafts/task-a.json", bytes: 10 },
              },
            },
          ],
        },
      ],
      toolCallsExecuted: 1,
      status: "completed",
      startedAt: new Date().toISOString(),
    };
    expect(turnHasSuccessfulDraftWrite(turn, "task-a")).toBe(true);
    expect(turnHasSuccessfulDraftWrite(turn, "task-b")).toBe(false);
  });

  it("detects successful update_draft for task id", () => {
    const turn: AgentTurn = {
      turnId: "t2",
      sessionId: "s1",
      instruction: "revise",
      messages: [
        {
          role: "tool",
          content: "",
          timestamp: new Date().toISOString(),
          toolCallResponses: [
            {
              toolCallId: "tc2",
              name: "update_draft",
              result: {
                ok: true,
                data: { taskId: "task-a", draftPath: "drafts/task-a.json" },
              },
            },
          ],
        },
      ],
      toolCallsExecuted: 1,
      status: "completed",
      startedAt: new Date().toISOString(),
    };
    expect(turnHasSuccessfulDraftWrite(turn, "task-a")).toBe(true);
  });

  it("draftRevisionWasPersisted requires file change or successful write", () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-rev-persist-"));
    const taskId = "task-rev-1";
    const now = new Date().toISOString();
    persistDraft(workspaceDir, {
      taskId,
      title: "T",
      output: "docx",
      templateId: "word/contract-default",
      summary: "old",
      sections: [{ heading: "正文", body: "old body" }],
      reviewNotes: [],
      reviewStatus: "modified",
      createdAt: now,
    });
    const baseline = snapshotDraftRevisionBaseline(workspaceDir, taskId);
    expect(baseline).toBeDefined();
    expect(draftRevisionWasPersisted(workspaceDir, taskId, baseline, undefined)).toBe(false);

    persistDraft(workspaceDir, {
      taskId,
      title: "T",
      output: "docx",
      templateId: "word/contract-default",
      summary: "new",
      sections: [{ heading: "正文", body: "new body" }],
      reviewNotes: [],
      reviewStatus: "modified",
      createdAt: now,
    });
    expect(draftRevisionWasPersisted(workspaceDir, taskId, baseline, undefined)).toBe(true);
  });

  it("buildRevisionRetryInstruction references task id", () => {
    expect(buildRevisionRetryInstruction("abc-123")).toContain("drafts/abc-123.json");
  });
});
