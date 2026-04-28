import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "../types.js";
import { buildLawMindRetrievalAdaptersFromEnvForTest } from "./engine-tools.js";
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("retrieval mode adapters", () => {
  it("single mode uses one OpenAI-compatible stack for general and legal", () => {
    vi.stubEnv("LAWMIND_RETRIEVAL_MODE", "single");
    vi.stubEnv("LAWMIND_AGENT_BASE_URL", "https://api.example/v1");
    vi.stubEnv("LAWMIND_AGENT_API_KEY", "k");
    vi.stubEnv("LAWMIND_AGENT_MODEL", "m");
    const ws = tmpWorkspace();
    const adapters = buildLawMindRetrievalAdaptersFromEnvForTest(ws);
    const names = adapters.map((a) => a.name);
    expect(names).toContain("model-general");
    expect(names).toContain("model-legal");
  });

  it("dual mode with ChatLaw exposes model-legal-chatlaw", () => {
    vi.stubEnv("LAWMIND_RETRIEVAL_MODE", "dual");
    vi.stubEnv("LAWMIND_AGENT_BASE_URL", "https://api.example/v1");
    vi.stubEnv("LAWMIND_AGENT_API_KEY", "k");
    vi.stubEnv("LAWMIND_AGENT_MODEL", "m");
    vi.stubEnv("LAWMIND_CHATLAW_BASE_URL", "http://127.0.0.1:8999/v1");
    vi.stubEnv("LAWMIND_CHATLAW_MODEL", "law-chatlaw");
    const ws = tmpWorkspace();
    const adapters = buildLawMindRetrievalAdaptersFromEnvForTest(ws);
    expect(adapters.some((a) => a.name === "model-general")).toBe(true);
    expect(adapters.some((a) => a.name === "model-legal-chatlaw")).toBe(true);
  });
});

describe("Engine-Bridge Tools", () => {
  it("registry contains all engine tools", () => {
    const registry = createLegalToolRegistry();
    const names = registry.listDefinitions().map((t) => t.name);

    expect(names).toContain("plan_task");
    expect(names).toContain("research_task");
    expect(names).toContain("draft_document");
    expect(names).toContain("render_document");
    expect(names).toContain("execute_workflow");
    expect(names).toContain("register_template");
    expect(names).toContain("list_templates");
  });

  it("total tool count is 22 (15 legal + 7 engine)", () => {
    const registry = createLegalToolRegistry();
    expect(registry.size()).toBe(22);
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
    expect(data.deliverableType).toBe("letter.demand");
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

describe("clarification pending guard", () => {
  it("blocks execute_workflow when clarificationBlockingHeavyTools", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("execute_workflow")!;
    const ctx: AgentContext = {
      ...makeCtx(ws, "m-clarify"),
      clarificationBlockingHeavyTools: true,
    };
    const result = await tool.execute({ instruction: "请审查合同", matter_id: "m-clarify" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("待澄清");
  });

  it("blocks draft_document when clarificationBlockingHeavyTools", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("draft_document")!;
    const ctx: AgentContext = { ...makeCtx(ws, "m-d"), clarificationBlockingHeavyTools: true };
    const result = await tool.execute({ instruction: "请整理合同审查意见", matter_id: "m-d" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("待澄清");
  });

  it("blocks research_task when clarificationBlockingHeavyTools", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const plan = registry.get("plan_task")!;
    const planned = await plan.execute(
      { instruction: "请审查合同", matter_id: "m-r" },
      makeCtx(ws, "m-r"),
    );
    expect(planned.ok).toBe(true);
    const taskId = (planned.data as { taskId: string }).taskId;
    const research = registry.get("research_task")!;
    const ctx: AgentContext = { ...makeCtx(ws, "m-r"), clarificationBlockingHeavyTools: true };
    const result = await research.execute(
      { task_id: taskId, instruction: "请审查合同", matter_id: "m-r" },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("待澄清");
  });

  it("blocks render_document when clarificationBlockingHeavyTools", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("render_document")!;
    const ctx: AgentContext = { ...makeCtx(ws, "m-ren"), clarificationBlockingHeavyTools: true };
    const result = await tool.execute(
      { task_id: "any-id", __approved: true } as Record<string, unknown>,
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("待澄清");
  });
});

describe("execute_workflow", () => {
  it("renders docx when force_render is set (medium-risk draft path)", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("execute_workflow")!;

    const result = await tool.execute(
      {
        instruction: "请审查这份合同的主要条款并列出风险点",
        matter_id: "m-workflow-test",
        force_render: true,
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

  it("rejects existing_task_id without restart_from", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("execute_workflow")!;
    const result = await tool.execute(
      { instruction: "test", matter_id: "m-norestart", existing_task_id: "any-id" },
      makeCtx(ws, "m-norestart"),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("restart_from");
  });

  it("resumes with existing_task_id and restart_from research", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("execute_workflow")!;
    const first = await tool.execute(
      { instruction: "检索合同法基本原则", matter_id: "m-resume-wf", force_render: false },
      makeCtx(ws, "m-resume-wf"),
    );
    expect(first.ok).toBe(true);
    const tid = (first.data as { taskId: string }).taskId;
    expect(tid).toBeTruthy();

    const second = await tool.execute(
      {
        instruction: "检索合同法基本原则",
        matter_id: "m-resume-wf",
        existing_task_id: tid,
        restart_from: "research",
        force_render: true,
      },
      makeCtx(ws, "m-resume-wf"),
    );
    expect(second.ok).toBe(true);
    const steps = (second.data as { steps: string[] }).steps;
    expect(steps.some((s) => s.includes("续跑任务"))).toBe(true);
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

  it("uses the latest draft when task_id is omitted and can auto-approve before render", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const draftTool = registry.get("draft_document")!;
    const renderTool = registry.get("render_document")!;

    const draftResult = await draftTool.execute(
      {
        instruction: "请审查这份合同的违约责任条款",
        matter_id: "m-render-latest",
      },
      makeCtx(ws, "m-render-latest"),
    );
    expect(draftResult.ok).toBe(true);

    const result = await renderTool.execute(
      {
        approve: true,
        approval_note: "同意导出 Word 正式稿",
        // Smoke test exercises the auto-approve + render plumbing, not the Deliverable-First
        // acceptance gate (which would block this auto-generated review draft for missing
        // blocker sections — see src/lawmind/deliverables/registry.ts).
        bypass_acceptance_gate: true,
      },
      makeCtx(ws, "m-render-latest"),
    );

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.taskId).toBeTruthy();
    expect(data.outputPath).toBeTruthy();
    expect(String(data.outputPath)).toMatch(/\.docx$/);
  });

  it("blocks render when the Deliverable-First acceptance gate is unmet", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const draftTool = registry.get("draft_document")!;
    const renderTool = registry.get("render_document")!;

    const draftResult = await draftTool.execute(
      {
        instruction: "请审查这份合同的违约责任条款",
        matter_id: "m-render-gated",
      },
      makeCtx(ws, "m-render-gated"),
    );
    expect(draftResult.ok).toBe(true);

    const blocked = await renderTool.execute(
      { approve: true, approval_note: "同意导出" },
      makeCtx(ws, "m-render-gated"),
    );

    expect(blocked.ok).toBe(false);
    expect((blocked as { pendingApproval?: boolean }).pendingApproval).toBe(true);
    const detail = (blocked as { data?: Record<string, unknown> }).data ?? {};
    expect(detail.acceptance).toBeTruthy();
    const acceptance = detail.acceptance as { ready: boolean; blockerCount: number };
    expect(acceptance.ready).toBe(false);
    expect(acceptance.blockerCount).toBeGreaterThan(0);
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

  it("accepts explicit template_id", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("draft_document")!;

    const result = await tool.execute(
      {
        instruction: "请整理合同审查意见",
        title: "合同审查意见书",
        matter_id: "m-draft-template",
        template_id: "word/contract-default",
      },
      makeCtx(ws, "m-draft-template"),
    );

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.templateId).toBe("word/contract-default");
  });

  it("generates a full rental contract draft even when retrieval is sparse", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("draft_document")!;

    const result = await tool.execute(
      {
        instruction: "请起草一份房屋租赁合同",
      },
      makeCtx(ws),
    );

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.title).toBe("房屋租赁合同");
    expect(data.templateId).toBe("word/contract-default");
    expect(data.deliverableType).toBe("contract.rental");
    expect(data.deliveryReadiness).toBe("draft_with_placeholders");
    expect(
      (data.sections as Array<{ heading: string }>).some((s) => s.heading === "合同当事人"),
    ).toBe(true);
    expect(
      (data.clarificationQuestions as Array<{ key: string }>).some(
        (item) => item.key === "rent_and_deposit",
      ),
    ).toBe(true);
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

describe("template tools", () => {
  it("registers and lists uploaded templates", async () => {
    const ws = tmpWorkspace();
    const sourcePath = path.join(ws, "firm-template.docx");
    fs.writeFileSync(sourcePath, "fake-docx", "utf8");
    const registry = createLegalToolRegistry();
    const registerTool = registry.get("register_template")!;
    const listTool = registry.get("list_templates")!;

    const registerResult = await registerTool.execute(
      {
        id: "upload/firm-template",
        format: "docx",
        label: "Firm Template",
        source_path: sourcePath,
        placeholder_map_json: '{"case_title":"title"}',
      },
      makeCtx(ws),
    );
    expect(registerResult.ok).toBe(true);

    const listResult = await listTool.execute({}, makeCtx(ws));
    expect(listResult.ok).toBe(true);
    const data = listResult.data as Record<string, unknown>;
    expect((data.builtIn as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect((data.uploaded as Array<{ id: string }>)[0]?.id).toBe("upload/firm-template");
  });
});
