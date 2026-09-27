import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSession, saveSession } from "../agent/session.js";
import type { AgentMessage } from "../agent/types.js";
import { persistDraft } from "../drafts/index.js";
import { persistResearchSnapshot } from "../drafts/research-snapshot.js";
import type { ResearchBundle } from "../types.js";
import { acceptanceClaimId } from "./model.js";
import {
  acceptanceTaskCandidates,
  applyAcceptanceMark,
  latestSourcedCharts,
  resolveAcceptanceSheet,
} from "./store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-acceptance-"));
  tempDirs.push(dir);
  return dir;
}

function research(taskId: string): ResearchBundle {
  return {
    taskId,
    query: "违约金",
    sources: [
      {
        id: "src-1",
        title: "合同",
        kind: "contract",
        citation: "第 8 条",
        url: "cases/m/合同.pdf",
      },
    ],
    claims: [
      {
        text: "违约金为百分之二十。",
        sourceIds: ["src-1"],
        confidence: 0.8,
        model: "legal",
        pin: { page: "4" },
      },
    ],
    riskFlags: [],
    missingItems: [],
    requiresReview: true,
    completedAt: "2026-09-27T00:00:00.000Z",
  };
}

describe("acceptance sheet store", () => {
  it("prefers the latest tool task over an older linked task", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: "旧的",
        timestamp: "2026-09-27T00:00:00.000Z",
        executionState: {
          phase: "complete",
          status: "completed",
          linkedTaskId: "old-task",
          recoverable: false,
        },
      },
      {
        role: "tool",
        content: "",
        timestamp: "2026-09-27T00:01:00.000Z",
        toolCallResponses: [
          {
            toolCallId: "c1",
            name: "research_task",
            result: { ok: true, data: { taskId: "new-task" } },
          },
        ],
      },
    ];
    expect(acceptanceTaskCandidates(messages, "pinned")).toEqual([
      "pinned",
      "new-task",
      "old-task",
    ]);
  });

  it("resolves the session sheet and persists a mark without rewriting the draft", () => {
    const dir = workspace();
    const session = createSession({ workspaceDir: dir, actorId: "lawyer" });
    const taskId = "task-accept-1";
    persistResearchSnapshot(dir, research(taskId));
    persistDraft(dir, {
      taskId,
      title: "备忘",
      output: "docx",
      templateId: "word/legal-memo-default",
      summary: "摘要",
      sections: [{ heading: "结论", body: "正文" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: "2026-09-27T00:00:00.000Z",
    });
    const before = fs.readFileSync(path.join(dir, "drafts", `${taskId}.json`), "utf8");
    session.conversationHistory.push({
      role: "tool",
      content: "",
      timestamp: "2026-09-27T00:01:00.000Z",
      toolCallResponses: [
        {
          toolCallId: "c1",
          name: "draft_document",
          result: { ok: true, data: { taskId } },
        },
      ],
    });
    saveSession(dir, session);

    const sheet = resolveAcceptanceSheet(dir, session.sessionId);
    expect(sheet?.taskId).toBe(taskId);
    expect(sheet?.claims).toHaveLength(1);
    const claimId = acceptanceClaimId("违约金为百分之二十。", ["src-1"]);
    const marked = applyAcceptanceMark(dir, taskId, claimId, "accepted");
    expect(marked.ok).toBe(true);
    if (marked.ok) {
      expect(marked.sheet.claims[0]?.mark).toBe("accepted");
    }
    expect(fs.readFileSync(path.join(dir, "drafts", `${taskId}.json`), "utf8")).toBe(before);
    expect(applyAcceptanceMark(dir, taskId, "c-nope", "removed")).toEqual({
      ok: false,
      error: "unknown_claim",
    });
  });

  it("shows the newest conversation sheet ahead of an older pinned task", () => {
    const dir = workspace();
    const session = createSession({ workspaceDir: dir, actorId: "lawyer" });
    persistResearchSnapshot(dir, research("old-task"));
    persistResearchSnapshot(dir, research("new-task"));
    session.conversationHistory.push({
      role: "tool",
      content: "",
      timestamp: "2026-09-27T00:02:00.000Z",
      toolCallResponses: [
        {
          toolCallId: "c1",
          name: "research_task",
          result: { ok: true, data: { taskId: "new-task" } },
        },
      ],
    });
    saveSession(dir, session);
    expect(resolveAcceptanceSheet(dir, session.sessionId, "old-task")?.taskId).toBe("new-task");
  });

  it("uses the pinned task when this conversation has not produced a sheet", () => {
    const dir = workspace();
    const session = createSession({ workspaceDir: dir, actorId: "lawyer" });
    persistResearchSnapshot(dir, research("old-task"));
    saveSession(dir, session);
    expect(resolveAcceptanceSheet(dir, session.sessionId, "old-task")?.taskId).toBe("old-task");
  });

  it("opens a read-only chart when the latest figure names a file", () => {
    const dir = workspace();
    const session = createSession({ workspaceDir: dir, actorId: "lawyer" });
    session.conversationHistory.push(
      {
        role: "tool",
        content: "",
        timestamp: "2026-09-27T00:01:00.000Z",
        toolCallResponses: [
          {
            toolCallId: "c-old",
            name: "render_chart",
            result: {
              ok: true,
              data: {
                path: "artifacts/charts/old.json",
                spec: {
                  title: "旧图",
                  type: "bar",
                  categories: ["甲"],
                  series: [{ name: "额", values: [1] }],
                  source: { path: "cases/m/旧.xlsx" },
                },
              },
            },
          },
        ],
      },
      {
        role: "tool",
        content: "",
        timestamp: "2026-09-27T00:02:00.000Z",
        toolCallResponses: [
          {
            toolCallId: "c-new",
            name: "run_compute",
            result: {
              ok: true,
              data: {
                charts: [
                  {
                    path: "artifacts/charts/fee.json",
                    spec: {
                      title: "费用",
                      type: "bar",
                      categories: ["合计"],
                      series: [{ name: "额", values: [12] }],
                      source: { path: "cases/m/费用.xlsx", sheet: "汇总" },
                    },
                  },
                  {
                    path: "artifacts/charts/guess.json",
                    spec: {
                      title: "猜的",
                      type: "bar",
                      categories: ["甲"],
                      series: [{ name: "数", values: [1] }],
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    );
    saveSession(dir, session);
    const charts = latestSourcedCharts(session.conversationHistory);
    expect(charts.map((chart) => chart.title)).toEqual(["费用"]);
    const sheet = resolveAcceptanceSheet(dir, session.sessionId);
    expect(sheet?.taskId).toBe("session-chart");
    expect(sheet?.charts?.map((chart) => chart.sourcePath)).toEqual(["cases/m/费用.xlsx"]);
  });
});
