import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertAssistant } from "../../assistants/store.js";
import type { AgentConfig } from "../types.js";

const runLoop = vi.hoisted(() =>
  vi.fn(async () => ({
    text: "只读结论：管辖条款需律师确认。",
    grounding: "",
    toolsUsed: ["search_statute"],
    steps: [{ tool: "search_statute", ok: true }],
  })),
);

vi.mock("../draft-worker-loop.js", () => ({
  runDraftWorkerReadOnlyLoop: (...args: unknown[]) => runLoop(...args),
}));

import { readCollaborationTurnSettlement, sendAndWait } from "./message-bus.js";

describe("sendAndWait isolated worker", () => {
  beforeEach(() => {
    runLoop.mockClear();
  });

  it("returns the worker reply and does not open a nested agent turn", async () => {
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lm-collab-worker-"));
    const workspaceDir = path.join(lawMindRoot, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    upsertAssistant(lawMindRoot, {
      assistantId: "default",
      displayName: "默认助手",
      introduction: "",
      presetKey: "general_default",
    });
    const envFile = path.join(lawMindRoot, ".env.lawmind");
    fs.writeFileSync(envFile, "x=1\n", "utf8");
    const baseConfig: AgentConfig = {
      workspaceDir,
      envFile,
      model: {
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:9",
        apiKey: "k",
        model: "m",
      },
    };

    const result = await sendAndWait({
      baseConfig,
      fromAssistantId: "lead",
      toAssistantId: "default",
      message: "核对管辖条款",
    });

    expect(result.reply).toContain("管辖条款");
    expect(result.sessionId).toBeTruthy();
    expect(runLoop).toHaveBeenCalledTimes(1);
    const messages = runLoop.mock.calls[0]?.[0] as { messages?: Array<{ content?: string }> };
    const system = messages.messages?.[0]?.content ?? "";
    expect(system).toContain("禁止改原件");
    expect(system).not.toContain("交付前自检清单");
    const opts = runLoop.mock.calls[0]?.[0] as { closePrompt?: string };
    expect(opts.closePrompt).toContain("不要输出文书 JSON");
    fs.rmSync(lawMindRoot, { recursive: true, force: true });
  });
});

describe("readCollaborationTurnSettlement", () => {
  it("keeps a clarification turn from looking finished", () => {
    expect(
      readCollaborationTurnSettlement([
        {
          turnId: "t1",
          status: "awaiting_clarification",
          result: "请确认大纲",
        },
      ]),
    ).toEqual({
      state: "hold",
      hold: "awaiting_clarification",
      reply: "请确认大纲",
      turnId: "t1",
    });
  });

  it("accepts a completed turn only when it has a reply", () => {
    expect(
      readCollaborationTurnSettlement([
        { turnId: "t1", status: "completed", result: "修订稿已写入" },
      ]),
    ).toMatchObject({ state: "done", reply: "修订稿已写入" });
    expect(
      readCollaborationTurnSettlement([{ turnId: "t1", status: "completed", result: "  " }]),
    ).toMatchObject({ state: "error" });
  });
});
