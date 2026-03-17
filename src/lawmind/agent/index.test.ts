import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSession,
  loadSession,
  listSessions,
  appendTurn,
  loadTurns,
  compactHistory,
} from "./session.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createLegalToolRegistry } from "./tools/legal-tools.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentMessage, AgentTurn } from "./types.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-agent-test-"));
}

describe("ToolRegistry", () => {
  it("registers and retrieves tools", () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "test_tool",
        description: "A test tool",
        category: "system",
        parameters: { query: { type: "string", description: "test", required: true } },
      },
      async execute() {
        return { ok: true, data: { result: "ok" } };
      },
    });

    expect(registry.size()).toBe(1);
    expect(registry.get("test_tool")).toBeDefined();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("prevents duplicate registration", () => {
    const registry = new ToolRegistry();
    const tool = {
      definition: {
        name: "dup",
        description: "duplicate",
        category: "system" as const,
        parameters: {},
      },
      async execute() {
        return { ok: true };
      },
    };
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow("already registered");
  });

  it("lists by category", () => {
    const registry = createLegalToolRegistry();
    const searchTools = registry.listByCategory("search");
    expect(searchTools.length).toBeGreaterThanOrEqual(2);
    expect(searchTools.every((t) => t.category === "search")).toBe(true);
  });

  it("converts to OpenAI tools format", () => {
    const registry = createLegalToolRegistry();
    const openAITools = registry.toOpenAITools();
    expect(openAITools.length).toBe(registry.size());

    for (const tool of openAITools) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.parameters.type).toBe("object");
    }
  });
});

describe("Legal Tool Registry", () => {
  it("contains expected tools", () => {
    const registry = createLegalToolRegistry();
    const names = registry.listDefinitions().map((t) => t.name);

    expect(names).toContain("search_matter");
    expect(names).toContain("search_workspace");
    expect(names).toContain("get_matter_summary");
    expect(names).toContain("list_matters");
    expect(names).toContain("read_case_file");
    expect(names).toContain("add_case_note");
    expect(names).toContain("analyze_document");
    expect(names).toContain("write_document");
    expect(names).toContain("list_tasks");
    expect(names).toContain("list_drafts");
    expect(names).toContain("get_audit_trail");
  });

  it("can execute list_matters tool", async () => {
    const ws = tmpDir();
    const registry = createLegalToolRegistry();
    const tool = registry.get("list_matters")!;

    const result = await tool.execute(
      {},
      {
        workspaceDir: ws,
        sessionId: "test-session",
        actorId: "test",
      },
    );

    expect(result.ok).toBe(true);
    expect((result.data as { matters: string[] }).matters).toEqual([]);
  });

  it("search_matter returns error without matterId", async () => {
    const ws = tmpDir();
    const registry = createLegalToolRegistry();
    const tool = registry.get("search_matter")!;

    const result = await tool.execute(
      { query: "test" },
      { workspaceDir: ws, sessionId: "s", actorId: "a" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("未指定案件 ID");
  });

  it("analyze_document blocks reads outside workspace", async () => {
    const ws = tmpDir();
    const registry = createLegalToolRegistry();
    const tool = registry.get("analyze_document")!;

    const result = await tool.execute(
      { file_path: "../../../etc/passwd" },
      { workspaceDir: ws, sessionId: "s", actorId: "a" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("工作区外");
  });
});

describe("Session Management", () => {
  it("creates and loads a session", () => {
    const ws = tmpDir();
    const session = createSession({ workspaceDir: ws, matterId: "m-001", actorId: "lawyer" });

    expect(session.sessionId).toBeTruthy();
    expect(session.matterId).toBe("m-001");

    const loaded = loadSession(ws, session.sessionId);
    expect(loaded).toBeDefined();
    expect(loaded!.sessionId).toBe(session.sessionId);
  });

  it("lists sessions sorted by updatedAt", () => {
    const ws = tmpDir();
    const s1 = createSession({ workspaceDir: ws, actorId: "a" });
    const s2 = createSession({ workspaceDir: ws, actorId: "a" });

    // Write files directly with distinct timestamps to avoid saveSession overwriting
    const sessDir = path.join(ws, "sessions");
    s1.updatedAt = "2026-01-01T00:00:00.000Z";
    s2.updatedAt = "2026-01-02T00:00:00.000Z";
    fs.writeFileSync(path.join(sessDir, `${s1.sessionId}.json`), JSON.stringify(s1), "utf8");
    fs.writeFileSync(path.join(sessDir, `${s2.sessionId}.json`), JSON.stringify(s2), "utf8");

    const sessions = listSessions(ws);
    expect(sessions.length).toBe(2);
    expect(sessions[0].sessionId).toBe(s2.sessionId);
    expect(sessions[1].sessionId).toBe(s1.sessionId);
  });

  it("appends and loads turns", () => {
    const ws = tmpDir();
    const session = createSession({ workspaceDir: ws, actorId: "a" });

    const turn: AgentTurn = {
      turnId: "t-1",
      sessionId: session.sessionId,
      instruction: "test",
      messages: [],
      toolCallsExecuted: 0,
      status: "completed",
      result: "done",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    appendTurn(ws, turn);
    appendTurn(ws, { ...turn, turnId: "t-2" });

    const turns = loadTurns(ws, session.sessionId);
    expect(turns.length).toBe(2);
    expect(turns[0].turnId).toBe("t-1");
  });
});

describe("compactHistory", () => {
  it("keeps all messages when under limit", () => {
    const msgs: AgentMessage[] = [
      { role: "system", content: "sys", timestamp: "" },
      { role: "user", content: "hi", timestamp: "" },
      { role: "assistant", content: "hello", timestamp: "" },
    ];
    expect(compactHistory(msgs, 10)).toHaveLength(3);
  });

  it("trims old non-system messages when over limit", () => {
    const msgs: AgentMessage[] = [
      { role: "system", content: "sys", timestamp: "" },
      ...Array.from({ length: 10 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
        timestamp: "",
      })),
    ];
    const compact = compactHistory(msgs, 5);
    expect(compact.length).toBe(5);
    expect(compact[0].role).toBe("system");
    expect(compact[1].content).toBe("msg-6");
  });
});

describe("System Prompt", () => {
  it("builds prompt with tools and context", () => {
    const prompt = buildSystemPrompt({
      lawyerName: "张律师",
      lawyerProfile: "专注于公司法和合同纠纷",
      availableTools: [
        {
          name: "search_matter",
          description: "搜索案件",
          category: "search",
          parameters: { query: { type: "string", description: "关键词", required: true } },
        },
      ],
    });

    expect(prompt).toContain("LawMind");
    expect(prompt).toContain("张律师");
    expect(prompt).toContain("search_matter");
    expect(prompt).toContain("准确性第一");
    expect(prompt).toContain("安全边界");
  });

  it("includes matter context when provided", () => {
    const prompt = buildSystemPrompt({
      matterContext: "合同纠纷案件",
      matterId: "m-001",
      availableTools: [],
    });

    expect(prompt).toContain("m-001");
    expect(prompt).toContain("合同纠纷案件");
  });
});
