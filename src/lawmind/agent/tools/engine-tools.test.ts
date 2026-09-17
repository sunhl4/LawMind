import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { persistDraft, readDraft } from "../../drafts/index.js";
import { writeRedlinePlan } from "../../drafts/redline-plan.js";
import { writeRedlineProposal } from "../../drafts/redline-proposal.js";
import { persistResearchSnapshot } from "../../drafts/research-snapshot.js";
import { addCustomModel, setRetrievalModelId } from "../../models/custom-store.js";
import type { ResearchBundle } from "../../types.js";
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

function makeCtx(ws: string, matterId?: string, extras?: Partial<AgentContext>): AgentContext {
  return {
    workspaceDir: ws,
    sessionId: "test-session",
    actorId: "test-lawyer",
    matterId,
    ...extras,
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
    expect(adapters.some((a) => a.name === "model-legal")).toBe(false);
  });

  it("dual mode with store retrievalModelId adds model-legal alongside ChatLaw", () => {
    vi.stubEnv("LAWMIND_RETRIEVAL_MODE", "dual");
    vi.stubEnv("LAWMIND_AGENT_BASE_URL", "https://api.example/v1");
    vi.stubEnv("LAWMIND_AGENT_API_KEY", "k");
    vi.stubEnv("LAWMIND_AGENT_MODEL", "m");
    vi.stubEnv("LAWMIND_CHATLAW_BASE_URL", "http://127.0.0.1:8999/v1");
    vi.stubEnv("LAWMIND_CHATLAW_MODEL", "law-chatlaw");
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-retr-store-"));
    const row = addCustomModel(lawMindRoot, {
      label: "垂类",
      baseUrl: "https://legal.example/v1",
      model: "chatlaw-store",
      apiKey: "sk-legal",
    });
    setRetrievalModelId(lawMindRoot, row.id);
    const ws = tmpWorkspace();
    const adapters = buildLawMindRetrievalAdaptersFromEnvForTest(ws, { lawMindRoot });
    expect(adapters.some((a) => a.name === "model-legal")).toBe(true);
    expect(adapters.some((a) => a.name === "model-legal-chatlaw")).toBe(true);
    fs.rmSync(lawMindRoot, { recursive: true, force: true });
  });

  it("dual mode with only store retrievalModelId exposes model-legal without ChatLaw env", () => {
    vi.stubEnv("LAWMIND_RETRIEVAL_MODE", "dual");
    vi.stubEnv("LAWMIND_AGENT_BASE_URL", "https://api.example/v1");
    vi.stubEnv("LAWMIND_AGENT_API_KEY", "k");
    vi.stubEnv("LAWMIND_AGENT_MODEL", "m");
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-retr-only-"));
    const row = addCustomModel(lawMindRoot, {
      label: "垂类",
      baseUrl: "https://legal.example/v1",
      model: "chatlaw-store",
      apiKey: "sk-legal",
    });
    setRetrievalModelId(lawMindRoot, row.id);
    const ws = tmpWorkspace();
    const adapters = buildLawMindRetrievalAdaptersFromEnvForTest(ws, { lawMindRoot });
    expect(adapters.some((a) => a.name === "model-general")).toBe(true);
    expect(adapters.some((a) => a.name === "model-legal")).toBe(true);
    expect(adapters.some((a) => a.name === "model-legal-chatlaw")).toBe(false);
    fs.rmSync(lawMindRoot, { recursive: true, force: true });
  });

  it("includes brave-web only when allowWebSearch is true", () => {
    const ws = tmpWorkspace();
    const off = buildLawMindRetrievalAdaptersFromEnvForTest(ws);
    expect(off.some((a) => a.name === "brave-web")).toBe(false);
    const on = buildLawMindRetrievalAdaptersFromEnvForTest(ws, { allowWebSearch: true });
    expect(on.some((a) => a.name === "brave-web")).toBe(true);
    expect(on.some((a) => a.name === "url-dossier")).toBe(true);
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
    expect(names).toContain("render_tracked_draft");
    expect(names).toContain("apply_surgical_edits");
    expect(names).toContain("prepare_outbound_mail");
    expect(names).toContain("list_mail_inbox");
    expect(names).toContain("list_mail_attachments");
    expect(names).toContain("execute_workflow");
    expect(names).toContain("register_template");
    expect(names).toContain("list_templates");
    expect(names).toContain("open_work_queue_item");
    expect(names).toContain("request_approval");
    expect(names).toContain("record_deadline");
    expect(names).toContain("deep_research");
    expect(names).toContain("update_plan");
    expect(names).toContain("search_conversations");
    expect(names).toContain("read_conversation");
    expect(names).toContain("read_skill");
    expect(names).toContain("search_company_registry");
  });

  it("total tool count is 55 (40 legal + 15 engine) without web/collaboration extras", () => {
    const registry = createLegalToolRegistry();
    expect(registry.size()).toBe(55);
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
    expect(data.deliverableType).toBe("letter.counsel");
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

  it("research_task and deep_research refuse entertainment public-web facts", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const research = registry.get("research_task")!;
    const deep = registry.get("deep_research")!;
    const instruction = "查一下2026年新说唱总冠军";

    const offResearch = await research.execute({ task_id: "t-pub", instruction }, makeCtx(ws));
    expect(offResearch.ok).toBe(false);
    expect(offResearch.error).toContain("联网");
    expect(offResearch.error).not.toContain("待澄清");

    const onResearch = await research.execute(
      { task_id: "t-pub", instruction },
      makeCtx(ws, undefined, { allowWebSearch: true }),
    );
    expect(onResearch.ok).toBe(false);
    expect(onResearch.error).toContain("web_search");

    const offDeep = await deep.execute({ instruction }, makeCtx(ws));
    expect(offDeep.ok).toBe(false);
    expect(offDeep.error).toContain("联网");

    const onDeep = await deep.execute(
      { instruction },
      makeCtx(ws, undefined, { allowWebSearch: true }),
    );
    expect(onDeep.ok).toBe(false);
    expect(onDeep.error).toContain("web_search");
  });

  it("allows research_task when clarificationBlockingHeavyTools (read/research stay open)", async () => {
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
    // May fail for missing adapters/API, but must not be the clarification write-gate.
    expect(result.error ?? "").not.toContain("待澄清");
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
  it("rejects force_render when LAWMIND_WORKFLOW_ALLOW_FORCE_RENDER is not set", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const tool = registry.get("execute_workflow")!;

    const result = await tool.execute(
      {
        instruction: "请审查这份合同的主要条款并列出风险点",
        matter_id: "m-force-render-denied",
        force_render: true,
      },
      makeCtx(ws, "m-force-render-denied"),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("force_render 已被禁用");
    expect(result.error).toContain("LAWMIND_WORKFLOW_ALLOW_FORCE_RENDER");
  });

  it("renders docx when force_render is set (medium-risk draft path)", async () => {
    vi.stubEnv("LAWMIND_WORKFLOW_ALLOW_FORCE_RENDER", "1");
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
    expect(caseContent).toMatch(/任务目标|工作进展记录/);
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
    expect(steps.some((s) => s.includes("等待律师审批"))).toBe(true);
  });

  it("refuses high-risk workflow when research is demo-corpus only", async () => {
    const ws = tmpWorkspace();
    const prevProvider = process.env.LAWMIND_AUTHORITY_PROVIDER;
    const prevMode = process.env.LAWMIND_OPEN_LAW_MODE;
    process.env.LAWMIND_AUTHORITY_PROVIDER = "open";
    process.env.LAWMIND_OPEN_LAW_MODE = "local";
    try {
      const registry = createLegalToolRegistry();
      const tool = registry.get("execute_workflow")!;
      // Instruction that matches bundled sample statutes → demo riskFlag.
      const result = await tool.execute(
        {
          instruction: "依据民法典第563条写一封催款律师函",
          matter_id: "m-demo-refuse",
        },
        makeCtx(ws, "m-demo-refuse"),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/演示语料|拒绝自动起草/);
      expect((result.data as { demoCorpus?: boolean } | undefined)?.demoCorpus).toBe(true);
    } finally {
      if (prevProvider === undefined) {
        delete process.env.LAWMIND_AUTHORITY_PROVIDER;
      } else {
        process.env.LAWMIND_AUTHORITY_PROVIDER = prevProvider;
      }
      if (prevMode === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_MODE;
      } else {
        process.env.LAWMIND_OPEN_LAW_MODE = prevMode;
      }
    }
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
    vi.stubEnv("LAWMIND_WORKFLOW_ALLOW_FORCE_RENDER", "1");
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

  it("prefers workspace linkedTaskId over latest draft when task_id is omitted", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const draftTool = registry.get("draft_document")!;
    const renderTool = registry.get("render_document")!;

    const first = await draftTool.execute(
      { instruction: "请审查合同条款A", matter_id: "m-link-render" },
      makeCtx(ws, "m-link-render"),
    );
    expect(first.ok).toBe(true);
    const tid1 = (first.data as { taskId: string }).taskId;

    const second = await draftTool.execute(
      { instruction: "请审查合同条款B", matter_id: "m-link-render" },
      makeCtx(ws, "m-link-render"),
    );
    expect(second.ok).toBe(true);
    const tid2 = (second.data as { taskId: string }).taskId;
    expect(tid1).not.toBe(tid2);

    const result = await renderTool.execute(
      {
        approve: true,
        approval_note: "同意导出 Word 正式稿",
        bypass_acceptance_gate: true,
      },
      makeCtx(ws, "m-link-render", { linkedTaskId: tid1 }),
    );

    expect(result.ok).toBe(true);
    expect((result.data as { taskId: string }).taskId).toBe(tid1);
    expect((result.data as { taskId: string }).taskId).not.toBe(tid2);
  });

  it("falls back to latest draft when linkedTaskId does not match any draft", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const draftTool = registry.get("draft_document")!;
    const renderTool = registry.get("render_document")!;

    await draftTool.execute(
      { instruction: "请审查合同条款A", matter_id: "m-link-fallback" },
      makeCtx(ws, "m-link-fallback"),
    );
    const second = await draftTool.execute(
      { instruction: "请审查合同条款B", matter_id: "m-link-fallback" },
      makeCtx(ws, "m-link-fallback"),
    );
    expect(second.ok).toBe(true);
    const tid2 = (second.data as { taskId: string }).taskId;

    const result = await renderTool.execute(
      {
        approve: true,
        approval_note: "同意导出",
        bypass_acceptance_gate: true,
      },
      makeCtx(ws, "m-link-fallback", { linkedTaskId: "no-such-draft-id" }),
    );

    expect(result.ok).toBe(true);
    expect((result.data as { taskId: string }).taskId).toBe(tid2);
  });

  it("blocks render when acceptance gate is unmet even after local-export stamp", async () => {
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

    const blocked = await renderTool.execute({}, makeCtx(ws, "m-render-gated"));

    expect(blocked.ok).toBe(false);
    expect((blocked.data as { renderFailureCategory?: string })?.renderFailureCategory).toBe(
      "acceptance_gate",
    );
  });

  it("approve=true alone does NOT bypass acceptance gate; bypass_acceptance_gate=true is required", async () => {
    const ws = tmpWorkspace();
    const registry = createLegalToolRegistry();
    const draftTool = registry.get("draft_document")!;
    const renderTool = registry.get("render_document")!;

    const draftResult = await draftTool.execute(
      {
        instruction: "请审查这份合同的违约责任条款",
        matter_id: "m-render-gated-approve",
      },
      makeCtx(ws, "m-render-gated-approve"),
    );
    expect(draftResult.ok).toBe(true);

    // approve=true sets review status to approved but must NOT silently bypass the
    // Deliverable-First acceptance gate when blockers/placeholders remain.
    const gated = await renderTool.execute(
      { approve: true, approval_note: "律师已同意导出 Word" },
      makeCtx(ws, "m-render-gated-approve"),
    );
    expect(gated.ok).toBe(false);
    expect((gated as { approvalRequest?: boolean }).approvalRequest).toBeFalsy();
    const gatedData = gated.data as { renderFailureCategory?: string };
    expect(gatedData.renderFailureCategory).toBe("acceptance_gate");

    // Lawyer must explicitly accept placeholders via bypass_acceptance_gate=true.
    const rendered = await renderTool.execute(
      {
        approve: true,
        bypass_acceptance_gate: true,
        approval_note: "律师已知情接受占位符并导出 Word",
      },
      makeCtx(ws, "m-render-gated-approve"),
    );

    expect(rendered.ok).toBe(true);
    expect(String((rendered.data as { outputPath?: string }).outputPath)).toMatch(/\.docx$/);
  });

  it("blocks opinion export on independent Guardian fail without leaking the transcript", async () => {
    const ws = tmpWorkspace();
    const taskId = "task-opinion-guardian";
    persistDraft(ws, {
      taskId,
      title: "管辖意见",
      output: "docx",
      templateId: "word/legal-memo-default",
      deliverableType: "memo.opinion",
      summary: "管辖",
      sections: [
        { heading: "争点", body: "管辖条款是否有效。" },
        { heading: "结论", body: "约定管辖有效。" },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    });
    const registry = createLegalToolRegistry();
    const tool = registry.get("render_document")!;
    const result = await tool.execute(
      { task_id: taskId, bypass_acceptance_gate: true },
      makeCtx(ws, undefined, {
        guardianCaller: async () =>
          '{"verdict":"fail","gaps":[{"code":"coverage_gap","message":"未写保留意见"}]}RAW',
      }),
    );
    expect(result.ok).toBe(false);
    expect((result.data as { code?: string } | undefined)?.code).toBe("legal_guardian_fail");
    expect(result.error).toContain("独立审稿未过");
    expect(JSON.stringify(result.data)).not.toContain("RAW");
  });

  it("does not invoke Guardian for internal memos", async () => {
    const ws = tmpWorkspace();
    const taskId = "task-internal-memo";
    persistDraft(ws, {
      taskId,
      title: "办案周报",
      output: "docx",
      templateId: "word/legal-memo-default",
      deliverableType: "memo.internal",
      summary: "周报",
      sections: [
        { heading: "事项", body: "本周开庭准备。" },
        { heading: "结论", body: "下周提交证据。" },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    });
    let called = 0;
    const registry = createLegalToolRegistry();
    const tool = registry.get("render_document")!;
    const result = await tool.execute(
      { task_id: taskId, bypass_acceptance_gate: true },
      makeCtx(ws, undefined, {
        guardianCaller: async () => {
          called += 1;
          return '{"verdict":"fail","gaps":[{"code":"coverage_gap","message":"不应出现"}]}';
        },
      }),
    );
    expect(called).toBe(0);
    expect((result.data as { code?: string } | undefined)?.code).not.toBe("legal_guardian_fail");
  });
});

describe("update_draft", () => {
  it("updates sections on an existing modified draft", async () => {
    const ws = tmpWorkspace();
    const taskId = "update-draft-1";
    const now = new Date().toISOString();
    persistDraft(ws, {
      taskId,
      title: "原稿",
      output: "docx",
      templateId: "word/contract-default",
      summary: "摘要",
      sections: [{ heading: "正文", body: "旧内容" }],
      reviewNotes: [],
      reviewStatus: "modified",
      createdAt: now,
    });
    const registry = createLegalToolRegistry();
    const tool = registry.get("update_draft")!;

    const result = await tool.execute(
      {
        task_id: taskId,
        sections: [{ heading: "正文", body: "扩展后的专业内容" }],
        summary: "更新摘要",
      },
      makeCtx(ws, undefined, { linkedTaskId: taskId }),
    );

    expect(result.ok).toBe(true);
    const stored = readDraft(ws, taskId);
    expect(stored?.sections[0]?.body).toBe("扩展后的专业内容");
    expect(stored?.summary).toBe("更新摘要");
  });

  it("surfaces a demo-corpus warning when the research snapshot is demo-only", async () => {
    const ws = tmpWorkspace();
    const taskId = "update-draft-demo";
    const now = new Date().toISOString();
    persistDraft(ws, {
      taskId,
      title: "演示草稿",
      output: "docx",
      templateId: "word/contract-default",
      summary: "摘要",
      sections: [{ heading: "正文", body: "旧内容" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
    });
    persistResearchSnapshot(ws, {
      taskId,
      query: "演示查询",
      sources: [],
      claims: [],
      riskFlags: ["演示语料（非正式完整法库；正式引用请核对官方法条）"],
      missingItems: [],
      requiresReview: false,
      completedAt: now,
    } satisfies ResearchBundle);

    const registry = createLegalToolRegistry();
    const tool = registry.get("update_draft")!;
    const result = await tool.execute(
      {
        task_id: taskId,
        sections: [{ heading: "正文", body: "修订内容" }],
      },
      makeCtx(ws, undefined, { linkedTaskId: taskId }),
    );

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.demoCorpus).toBe(true);
    expect(typeof data.demoCorpusWarning).toBe("string");
    expect(data.draftPath).toBe(`drafts/${taskId}.json`);
  });

  it("omits the demo-corpus warning when the snapshot is not demo-only", async () => {
    const ws = tmpWorkspace();
    const taskId = "update-draft-clean";
    const now = new Date().toISOString();
    persistDraft(ws, {
      taskId,
      title: "正式草稿",
      output: "docx",
      templateId: "word/contract-default",
      summary: "摘要",
      sections: [{ heading: "正文", body: "旧内容" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
    });
    persistResearchSnapshot(ws, {
      taskId,
      query: "正式查询",
      sources: [],
      claims: [],
      riskFlags: [],
      missingItems: [],
      requiresReview: false,
      completedAt: now,
    } satisfies ResearchBundle);

    const registry = createLegalToolRegistry();
    const tool = registry.get("update_draft")!;
    const result = await tool.execute(
      {
        task_id: taskId,
        sections: [{ heading: "正文", body: "修订内容" }],
      },
      makeCtx(ws, undefined, { linkedTaskId: taskId }),
    );

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.demoCorpus).toBeUndefined();
    expect(data.demoCorpusWarning).toBeUndefined();
  });

  it("omits the demo-corpus warning when no research snapshot exists", async () => {
    const ws = tmpWorkspace();
    const taskId = "update-draft-nosnap";
    const now = new Date().toISOString();
    persistDraft(ws, {
      taskId,
      title: "无快照草稿",
      output: "docx",
      templateId: "word/contract-default",
      summary: "摘要",
      sections: [{ heading: "正文", body: "旧内容" }],
      reviewNotes: [],
      reviewStatus: "modified",
      createdAt: now,
    });

    const registry = createLegalToolRegistry();
    const tool = registry.get("update_draft")!;
    const result = await tool.execute(
      {
        task_id: taskId,
        sections: [{ heading: "正文", body: "修订内容" }],
      },
      makeCtx(ws, undefined, { linkedTaskId: taskId }),
    );

    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.demoCorpus).toBeUndefined();
    expect(data.demoCorpusWarning).toBeUndefined();
  });

  it("hard-rejects oversized rewrite when LAWMIND_SURGICAL_ENFORCE=1", async () => {
    vi.stubEnv("LAWMIND_SURGICAL_ENFORCE", "1");
    const ws = tmpWorkspace();
    const taskId = "update-draft-enforce";
    const now = new Date().toISOString();
    const before = "甲".repeat(200) + "应依约履行付款义务并承担违约责任。";
    const after = "乙".repeat(220) + "可随时解除合同且无需通知。";
    persistDraft(ws, {
      taskId,
      title: "合同",
      output: "docx",
      templateId: "word/contract-default",
      summary: "",
      sections: [{ heading: "正文", body: before }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
      contractEdit: { baselineRelativePath: "c.docx", mode: "surgical" },
    });
    const registry = createLegalToolRegistry();
    const tool = registry.get("update_draft")!;
    const result = await tool.execute(
      {
        task_id: taskId,
        sections: [{ heading: "正文", body: after }],
      },
      makeCtx(ws, undefined, { linkedTaskId: taskId }),
    );
    expect(result.ok).toBe(false);
    const data = result.data as { gateDecision?: { decision?: string; category?: string } };
    expect(data.gateDecision?.decision).toBe("block");
    expect(data.gateDecision?.category).toBe("safety_hard");
    expect(readDraft(ws, taskId)?.sections[0]?.body).toBe(before);
  });

  it("rejects sections on the Word short path without writing body", async () => {
    const ws = tmpWorkspace();
    const taskId = "update-draft-legacy-word";
    const now = new Date().toISOString();
    persistDraft(ws, {
      taskId,
      title: "合同",
      output: "docx",
      templateId: "word/contract-default",
      summary: "",
      sections: [{ heading: "正文", body: "原条款不得整段重写。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
    });
    const registry = createLegalToolRegistry();
    const tool = registry.get("update_draft")!;
    const ctx = makeCtx(ws, undefined, { linkedTaskId: taskId, wordRevisionTurn: true });
    const result = await tool.execute(
      {
        task_id: taskId,
        sections: [{ heading: "正文", body: "整段重写后的新条款。" }],
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/apply_surgical_edits/);
    expect((result.data as { code?: string }).code).toBe("legacy_update_draft_body");
    expect(ctx.pendingWorldStateCraftPatch).toMatch(/【改稿路径】/);
    expect(readDraft(ws, taskId)?.sections[0]?.body).toBe("原条款不得整段重写。");
  });

  it("rejects sections on the mail short path but still allows seed-only updates", async () => {
    const ws = tmpWorkspace();
    const taskId = "update-draft-legacy-mail";
    const now = new Date().toISOString();
    persistDraft(ws, {
      taskId,
      title: "合同",
      output: "docx",
      templateId: "word/contract-default",
      summary: "旧摘要",
      sections: [{ heading: "正文", body: "原条款" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
    });
    const registry = createLegalToolRegistry();
    const tool = registry.get("update_draft")!;
    const blocked = await tool.execute(
      {
        task_id: taskId,
        sections: [{ heading: "正文", body: "新条款" }],
        summary: "想顺手改摘要",
      },
      makeCtx(ws, undefined, { linkedTaskId: taskId, mailContractTurn: true }),
    );
    expect(blocked.ok).toBe(false);
    expect(readDraft(ws, taskId)?.sections[0]?.body).toBe("原条款");
    expect(readDraft(ws, taskId)?.summary).toBe("旧摘要");

    const seeded = await tool.execute(
      { task_id: taskId, summary: "仅改摘要" },
      makeCtx(ws, undefined, { linkedTaskId: taskId, mailContractTurn: true }),
    );
    expect(seeded.ok).toBe(true);
    expect(readDraft(ws, taskId)?.summary).toBe("仅改摘要");
    expect(readDraft(ws, taskId)?.sections[0]?.body).toBe("原条款");
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

    expect(result.ok, result.error ?? "draft_document failed").toBe(true);
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

    expect(result.ok, result.error ?? "draft_document failed").toBe(true);
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

  it("stamps contractEdit from a compose Word pin on unlocked 合同审查", async () => {
    const ws = tmpWorkspace();
    const rel = "uploads/采购合同.docx";
    fs.mkdirSync(path.join(ws, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "placeholder");
    const tool = createLegalToolRegistry().get("draft_document")!;
    const result = await tool.execute(
      { instruction: "请审查这份采购合同的违约责任" },
      makeCtx(ws, undefined, {
        contextPins: [{ pinKind: "file", root: "workspace", relPath: rel, kind: "file" }],
      }),
    );
    expect(result.ok, result.error ?? "draft_document failed").toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.deliverableType).toBe("contract.review");
    expect(data.pairedDeliverable).toBe(true);
    expect(
      (data.contractEdit as { baselineRelativePath?: string } | undefined)?.baselineRelativePath,
    ).toBe(rel);
    const headings = ((data.sections as Array<{ heading: string }>) ?? []).map((s) => s.heading);
    expect(headings).toContain("宏观审查");
  });

  it("does not stamp paired redline when the lawyer asked for an opinion sidecar", async () => {
    const ws = tmpWorkspace();
    const rel = "uploads/采购合同.docx";
    fs.mkdirSync(path.join(ws, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "placeholder");
    const tool = createLegalToolRegistry().get("draft_document")!;
    const result = await tool.execute(
      { instruction: "给我一些审查意见放到桌面，不要在源文件上修改" },
      makeCtx(ws, undefined, {
        contextPins: [{ pinKind: "file", root: "workspace", relPath: rel, kind: "file" }],
        deliveryIntent: {
          artifactShape: "opinion_memo",
          mutateSource: "forbid",
          outputPlace: "desktop",
          chatMirror: "required",
        },
      }),
    );
    expect(result.ok, result.error ?? "draft_document failed").toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.pairedDeliverable).not.toBe(true);
  });
});

describe("render_tracked_draft hunk gate", () => {
  it("blocks contractEdit drafts with zero redline hunks", async () => {
    const ws = tmpWorkspace();
    const taskId = "task-empty-redline";
    persistDraft(ws, {
      taskId,
      title: "合作协议",
      output: "docx",
      templateId: "word/contract-default",
      deliverableType: "contract.review",
      summary: "仅摘要无正文改动",
      sections: [{ heading: "第一条", body: "原文不变。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      contractEdit: {
        baselineRelativePath: "cases/m1/mail/attachments/x/a.docx",
        mode: "surgical",
      },
    });
    const registry = createLegalToolRegistry();
    const tool = registry.get("render_tracked_draft")!;
    const result = await tool.execute({ task_id: taskId }, makeCtx(ws, "m1"));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("redline hunks");
    expect((result.data as { code?: string } | undefined)?.code).toBe("redline_hunks_required");
  });

  it("does not refuse tracked export solely because this turn is an opinion memo", async () => {
    const ws = tmpWorkspace();
    const tool = createLegalToolRegistry().get("render_tracked_draft")!;
    const result = await tool.execute(
      { task_id: "any" },
      makeCtx(ws, undefined, {
        deliveryIntent: {
          artifactShape: "opinion_memo",
          mutateSource: "forbid",
          outputPlace: "desktop",
          chatMirror: "required",
        },
      }),
    );
    expect((result.data as { code?: string } | undefined)?.code).not.toBe("opinion_memo_sidecar");
    expect(result.error ?? "").not.toContain("新的意见书");
  });

  it("allow_empty_redline bypasses the hunk gate", async () => {
    const ws = tmpWorkspace();
    const taskId = "task-allow-empty";
    persistDraft(ws, {
      taskId,
      title: "合作协议",
      output: "docx",
      templateId: "word/contract-default",
      deliverableType: "contract.review",
      summary: "s",
      sections: [{ heading: "第一条", body: "原文不变。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      contractEdit: {
        baselineRelativePath: "cases/m1/mail/attachments/x/a.docx",
        mode: "surgical",
      },
    });
    const registry = createLegalToolRegistry();
    const tool = registry.get("render_tracked_draft")!;
    const result = await tool.execute(
      { task_id: taskId, allow_empty_redline: true },
      makeCtx(ws, "m1"),
    );
    // May fail later on missing baseline file / conversion — but must not be the hunk gate.
    expect(result.error ?? "").not.toContain("redline hunks");
    if (!result.ok) {
      expect((result.data as { code?: string } | undefined)?.code).not.toBe(
        "redline_hunks_required",
      );
    }
  });

  it("blocks tracked export when surgical hunks exist but craft_check was never attached", async () => {
    const ws = tmpWorkspace();
    const taskId = "task-no-craft";
    persistDraft(ws, {
      taskId,
      title: "合作协议",
      output: "docx",
      templateId: "word/contract-default",
      deliverableType: "contract.review",
      summary: "s",
      sections: [{ heading: "第一条", body: "由上海仲裁委员会仲裁。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      contractEdit: {
        baselineRelativePath: "cases/m1/mail/attachments/x/a.docx",
        mode: "surgical",
      },
    });
    writeRedlineProposal(ws, {
      taskId,
      baselineSections: [{ heading: "第一条", body: "由甲方所在地人民法院仲裁。" }],
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          sectionHeading: "第一条",
          before: "甲方所在地人民法院",
          after: "上海仲裁委员会",
          status: "pending",
          granularity: "surgical",
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    const registry = createLegalToolRegistry();
    const tool = registry.get("render_tracked_draft")!;
    const result = await tool.execute({ task_id: taskId }, makeCtx(ws, "m1"));
    expect(result.ok).toBe(false);
    expect((result.data as { code?: string } | undefined)?.code).toBe("craft_check_required");
    expect(result.error).toContain("craft_check");
  });
});

describe("render_tracked_draft legal Guardian", () => {
  it("blocks export on reviewer fail and returns gaps without reviewer transcript", async () => {
    const ws = tmpWorkspace();
    const taskId = "task-guardian-fail";
    persistDraft(ws, {
      taskId,
      title: "合作协议",
      output: "docx",
      templateId: "word/contract-default",
      deliverableType: "contract.review",
      summary: "改管辖",
      sections: [{ heading: "争议解决", body: "由上海仲裁委员会仲裁解决。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      contractEdit: {
        baselineRelativePath: "cases/m1/mail/attachments/x/a.docx",
        mode: "surgical",
      },
    });
    writeRedlineProposal(ws, {
      taskId,
      baselineSections: [{ heading: "争议解决", body: "由甲方所在地人民法院仲裁解决。" }],
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          sectionHeading: "争议解决",
          before: "甲方所在地人民法院",
          after: "上海仲裁委员会",
          status: "pending",
          granularity: "surgical",
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    writeRedlinePlan(ws, {
      taskId,
      items: [{ find: "甲方所在地人民法院", replace: "上海仲裁委员会" }],
      skipped: [],
      updatedAt: new Date().toISOString(),
      craftCheckAttached: true,
    });
    const registry = createLegalToolRegistry();
    const tool = registry.get("render_tracked_draft")!;
    const result = await tool.execute(
      { task_id: taskId },
      makeCtx(ws, "m1", {
        guardianCaller: async () =>
          '{"verdict":"fail","gaps":[{"code":"coverage_gap","message":"停项被改"}]}RAW',
      }),
    );
    expect(result.ok).toBe(false);
    expect((result.data as { code?: string } | undefined)?.code).toBe("legal_guardian_fail");
    expect(result.error).toContain("独立审稿未过");
    expect(JSON.stringify(result.data)).not.toContain("RAW");
    expect(
      (result.data as { guardian?: { gaps?: Array<{ code: string }> } } | undefined)?.guardian
        ?.gaps?.[0]?.code,
    ).toBe("coverage_gap");
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
