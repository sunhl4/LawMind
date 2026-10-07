import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeRedlineProposal } from "../drafts/redline-proposal.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { AgentContext, AgentTurn } from "./types.js";
import {
  autoDeliverWordRevisionIfNeeded,
  shouldAutoDeliverWordRevision,
} from "./word-revision-auto-deliver.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

function turn(status: AgentTurn["status"], workspaceDir = "/tmp/ws"): AgentTurn {
  return {
    turnId: "t1",
    sessionId: "s1",
    instruction: "改这份",
    status,
    startedAt: "t",
    messages: [],
    workspaceDir,
  } as AgentTurn;
}

function ctx(partial: Partial<AgentContext> = {}): AgentContext {
  return {
    workspaceDir: partial.workspaceDir ?? "/tmp/ws",
    sessionId: "s1",
    wordRevisionTurn: true,
    permissionMode: "standard",
    ...partial,
  } as AgentContext;
}

function withHunks(workspaceDir: string, taskId: string): void {
  fs.mkdirSync(path.join(workspaceDir, "drafts"), { recursive: true });
  writeRedlineProposal(workspaceDir, {
    taskId,
    baselineSections: [{ heading: "一", body: "甲" }],
    hunks: [
      {
        hunkId: "h1",
        sectionIndex: 0,
        before: "甲",
        after: "乙",
        status: "pending",
      },
    ],
    updatedAt: "2026-09-28T00:00:00.000Z",
  });
}

describe("shouldAutoDeliverWordRevision", () => {
  it("does not write a completed turn that has no revisions", () => {
    expect(shouldAutoDeliverWordRevision({ ctx: ctx(), turn: turn("completed") })).toBe(false);
  });

  it("does not write while clarifying, paused, or awaiting approval", () => {
    expect(
      shouldAutoDeliverWordRevision({ ctx: ctx(), turn: turn("awaiting_clarification") }),
    ).toBe(false);
    expect(shouldAutoDeliverWordRevision({ ctx: ctx(), turn: turn("paused") })).toBe(false);
    expect(shouldAutoDeliverWordRevision({ ctx: ctx(), turn: turn("awaiting_approval") })).toBe(
      false,
    );
  });

  it("does not write in readonly or research mode", () => {
    expect(
      shouldAutoDeliverWordRevision({
        ctx: ctx({ permissionMode: "readonly" }),
        turn: turn("completed"),
      }),
    ).toBe(false);
    expect(
      shouldAutoDeliverWordRevision({
        ctx: ctx({ permissionMode: "research" }),
        turn: turn("completed"),
      }),
    ).toBe(false);
  });

  it("writes each revised draft that was not successfully exported, including a failed earlier try", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-auto-deliver-"));
    tmpDirs.push(workspaceDir);
    withHunks(workspaceDir, "done");
    withHunks(workspaceDir, "failed");
    const t = turn("completed", workspaceDir);
    t.messages = [
      {
        role: "tool",
        content: "",
        timestamp: "t",
        toolCallResponses: [
          {
            toolCallId: "a",
            name: "render_tracked_draft",
            result: { ok: true, data: { taskId: "done", outputPath: "/tmp/done.docx" } },
          },
          {
            toolCallId: "b",
            name: "render_tracked_draft",
            result: { ok: false, error: "独立审稿未过", data: { taskId: "failed" } },
          },
        ],
      },
    ];
    expect(shouldAutoDeliverWordRevision({ ctx: ctx({ workspaceDir }), turn: t })).toBe(true);
  });

  it("exports only the drafts that still need a file", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-auto-deliver-"));
    tmpDirs.push(workspaceDir);
    withHunks(workspaceDir, "done");
    withHunks(workspaceDir, "failed");
    const t = turn("completed", workspaceDir);
    t.messages = [
      {
        role: "tool",
        content: "",
        timestamp: "t",
        toolCallResponses: [
          {
            toolCallId: "a",
            name: "apply_surgical_edits",
            result: { ok: true, data: { taskId: "done" } },
          },
          {
            toolCallId: "b",
            name: "render_tracked_draft",
            result: { ok: true, data: { taskId: "done", outputPath: "/tmp/done.docx" } },
          },
          {
            toolCallId: "c",
            name: "render_tracked_draft",
            result: { ok: false, error: "未过", data: { taskId: "failed" } },
          },
        ],
      },
    ];
    const calls: string[] = [];
    const agent = ctx({ workspaceDir });
    const registry = {
      get(name: string) {
        if (name !== "render_tracked_draft") {
          return undefined;
        }
        return {
          execute: async (params: { task_id?: string }) => {
            calls.push(params.task_id ?? "");
            return {
              ok: true,
              data: {
                outputPath: `/tmp/${params.task_id}.docx`,
                message: `已写出 ${params.task_id}`,
              },
            };
          },
        };
      },
    } as unknown as ToolRegistry;
    const note = await autoDeliverWordRevisionIfNeeded({ ctx: agent, registry, turn: t });
    expect(calls).toEqual(["failed"]);
    expect(note).toContain("已写出 failed");
  });
});
