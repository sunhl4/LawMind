import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentContext } from "../types.js";
import { createLegalToolRegistry } from "./legal-tools.js";

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-engine-tools-"));
  // Engine needs MEMORY.md and LAWYER_PROFILE.md
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# 通用记忆\n\n测试记忆", "utf8");
  fs.writeFileSync(path.join(dir, "LAWYER_PROFILE.md"), "# 律师偏好\n\n测试律师", "utf8");
  return dir;
}

function makeCtx(ws: string, matterId?: string): AgentContext {
  return {
    workspaceDir: ws,
    sessionId: "test-session",
    actorId: "test-lawyer",
    matterId,
  };
}

describe("Engine-Bridge Tools", () => {
  it("registry contains all engine tools", () => {
    const registry = createLegalToolRegistry();
    const names = registry.listDefinitions().map((t) => t.name);

    expect(names).toContain("plan_task");
    expect(names).toContain("research_task");
    expect(names).toContain("draft_document");
    expect(names).toContain("render_document");
    expect(names).toContain("execute_workflow");
  });

  it("total tool count is 16 (11 legal + 5 engine)", () => {
    const registry = createLegalToolRegistry();
    expect(registry.size()).toBe(16);
  });
});

describe("plan_task", () => {
  it("parses a contract review instruction", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("plan_task")!;

    const result = await tool.execute(
      { instruction: "请审查这份合同条款", matter_id: "m-test" },
      makeCtx(ws, "m-test"),
    );

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.taskId).toBeTruthy();
    expect(data.kind).toBe("analyze.contract");
    expect(data.riskLevel).toBeTruthy();
    expect(data.output).toBeTruthy();
    expect(data.matterId).toBe("m-test");
  });

  it("parses a legal letter instruction as high risk", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("plan_task")!;

    const result = await tool.execute(
      { instruction: "起草一份律师函", audience: "对方" },
      makeCtx(ws),
    );

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.kind).toBe("draft.word");
    expect(data.riskLevel).toBe("high");
    expect(data.requiresConfirmation).toBe(true);
  });

  it("rejects invalid matter_id format", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("plan_task")!;

    const result = await tool.execute(
      { instruction: "请审查合同", matter_id: "../../bad-id" },
      makeCtx(ws),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("matter_id 格式不合法");
  });
});

describe("execute_workflow", () => {
  it("executes complete workflow for low-risk task", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("execute_workflow")!;

    const result = await tool.execute(
      {
        instruction: "检索关于公司法的最新规定",
        matter_id: "m-workflow-test",
      },
      makeCtx(ws, "m-workflow-test"),
    );

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.taskId).toBeTruthy();
    expect(data.kind).toBeTruthy();
    expect(data.status).toBe("delivered");
    expect((data.steps as string[]).length).toBeGreaterThanOrEqual(4);

    // Verify task was persisted
    const tasksDir = path.join(ws, "tasks");
    expect(fs.existsSync(tasksDir)).toBe(true);
    const taskFiles = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".json"));
    expect(taskFiles.length).toBeGreaterThanOrEqual(1);

    // Verify CASE.md was created
    const caseMd = path.join(ws, "cases", "m-workflow-test", "CASE.md");
    expect(fs.existsSync(caseMd)).toBe(true);
    const caseContent = fs.readFileSync(caseMd, "utf8");
    expect(caseContent).toContain("任务目标");
  });

  it("stops at awaiting_lawyer_review for high-risk tasks", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("execute_workflow")!;

    const result = await tool.execute(
      { instruction: "起草一份律师函发送给对方", matter_id: "m-highrisk" },
      makeCtx(ws, "m-highrisk"),
    );

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.riskLevel).toBe("high");
    expect(data.status).toBe("awaiting_lawyer_review");

    const steps = data.steps as string[];
    const lastStep = steps[steps.length - 1];
    expect(lastStep).toContain("等待律师审批");
  });

  it("creates audit trail during workflow", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("execute_workflow")!;

    await tool.execute(
      { instruction: "检索合同法相关法条", matter_id: "m-audit" },
      makeCtx(ws, "m-audit"),
    );

    const auditDir = path.join(ws, "audit");
    expect(fs.existsSync(auditDir)).toBe(true);
    const auditFiles = fs.readdirSync(auditDir).filter((f) => f.endsWith(".jsonl"));
    expect(auditFiles.length).toBeGreaterThanOrEqual(1);

    const content = fs.readFileSync(path.join(auditDir, auditFiles[0]), "utf8");
    const events = content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.length).toBeGreaterThanOrEqual(3); // task.created, research.started, research.completed, ...
  });
});

describe("render_document", () => {
  it("fails when no draft exists", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("render_document")!;

    const result = await tool.execute({ task_id: "nonexistent-task" }, makeCtx(ws));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("找不到");
  });
});

describe("draft_document", () => {
  it("generates a structured draft", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("draft_document")!;

    const result = await tool.execute(
      {
        instruction: "请整理合同审查意见",
        title: "合同审查意见书",
        matter_id: "m-draft",
      },
      makeCtx(ws, "m-draft"),
    );

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.title).toBe("合同审查意见书");
    expect(data.sectionsCount).toBeGreaterThanOrEqual(1);
    expect(data.reviewStatus).toBe("pending");
  });

  it("rejects empty instruction", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("draft_document")!;

    const result = await tool.execute(
      {
        instruction: "   ",
      },
      makeCtx(ws),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("instruction 不能为空");
  });
});
