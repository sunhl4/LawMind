import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTRACT_FAST_LANE_PROMPT } from "../platform/contract-fast-lane-instruction.js";
import { WORD_REVISION_PROMPT } from "../platform/word-revision-instruction.js";
import { ToolRegistry } from "./tools/registry.js";
import { prepareTurnPromptContext } from "./turn-orchestrator-prompt.js";
import type { AgentConfig, AgentSession } from "./types.js";

function visiblePrompt(result: { systemPromptFinal: string }, session: AgentSession): string {
  return [result.systemPromptFinal, session.samplingPromptTail ?? ""].join("\n");
}

/** Assembler / cache tests. Tool-lock and loop behavior: turn-orchestrator-cassettes.test.ts */
describe("turn-orchestrator-prompt", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-turn-prompt-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Global memory", "utf8");
    await fs.writeFile(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer profile", "utf8");
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("exports prepareTurnPromptContext and seeds system message head", async () => {
    expect(typeof prepareTurnPromptContext).toBe("function");

    const session: AgentSession = {
      sessionId: "sess-1",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const registry = new ToolRegistry();
    const config: AgentConfig = {
      workspaceDir,
      model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
    };

    const result = await prepareTurnPromptContext({
      config,
      registry,
      session,
      instruction: "请审查合同违约责任条款",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });

    expect(result.memory.profile).toContain("Lawyer profile");
    expect(result.systemPromptFinal.length).toBeGreaterThan(0);
    expect(session.conversationHistory).toHaveLength(1);
    expect(session.conversationHistory[0]?.role).toBe("system");
    expect(session.conversationHistory[0]?.content).toBe(result.systemPromptFinal);
  });

  it("pairs opinion and tracked redline when 合同审查 has a Word pin but is not the Word lock", async () => {
    const session: AgentSession = {
      sessionId: "sess-paired",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry: new ToolRegistry(),
      session,
      instruction: "请审查这份采购合同的违约责任",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: "/tmp/project",
      contextPins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "采购合同.docx",
          kind: "file",
        },
      ],
    });
    expect(visiblePrompt(result, session)).toContain("## 成套交件");
    expect(visiblePrompt(result, session)).toContain("## 检索协议");
    expect(visiblePrompt(result, session)).not.toContain("Word 改稿 · 原文件审阅痕迹");
    expect(result.systemPromptFinal).not.toContain("## 成套交件");
  });

  it("reinjects RULES/Craft reminder after compact flag", async () => {
    const session: AgentSession = {
      sessionId: "sess-compact",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      needsCompactReinjection: true,
    };
    const registry = new ToolRegistry();
    const config: AgentConfig = {
      workspaceDir,
      model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
    };

    const result = await prepareTurnPromptContext({
      config,
      registry,
      session,
      instruction: "请继续改合同条款",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });

    expect(result.systemPromptFinal).toContain("压缩后红线重注");
    expect(result.systemPromptFinal).toContain("空修订不得导出");
    expect(session.needsCompactReinjection).toBe(false);
  });

  it("keeps the static system prefix when session extras change", async () => {
    const { LAWMIND_PROMPT_DYNAMIC_BOUNDARY, splitSystemPromptAtBoundary } =
      await import("./system-prompt.js");
    const session: AgentSession = {
      sessionId: "sess-cache",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const registry = new ToolRegistry();
    const config: AgentConfig = {
      workspaceDir,
      model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
    };

    await prepareTurnPromptContext({
      config,
      registry,
      session,
      instruction: "请审查合同",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const first = session.conversationHistory[0]?.content ?? "";
    const firstStatic = splitSystemPromptAtBoundary(first).staticText;

    session.needsCompactReinjection = true;
    await fs.writeFile(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# 更新后的画像", "utf8");

    const second = await prepareTurnPromptContext({
      config,
      registry,
      session,
      instruction: "请继续改违约责任",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });

    const applied = session.conversationHistory[0]?.content ?? "";
    expect(splitSystemPromptAtBoundary(applied).staticText).toBe(firstStatic);
    expect(applied).toContain(LAWMIND_PROMPT_DYNAMIC_BOUNDARY);
    expect(second.systemPromptFinal).toBe(applied);
    expect(second.systemPromptFinal).toContain("压缩后红线重注");
    expect(applied).toContain("<!--lm-ws:craft-->");
    expect(applied).toContain("<!--lm-ws:permission-->");
  });

  it("injects the short-path update_draft warning into world-state craft", async () => {
    const session: AgentSession = {
      sessionId: "sess-legacy-craft",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      legacyUpdateDraftBodyWarning: true,
    };
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry: new ToolRegistry(),
      session,
      instruction: "请继续改合同条款",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    const craft = result.systemPromptFinal.match(
      /<!--lm-ws:craft-->[\s\S]*?<!--\/lm-ws:craft-->/,
    )?.[0];
    expect(craft).toContain("【改稿路径】");
    expect(craft).toContain("apply_surgical_edits");
    expect(craft).not.toContain("# Skill · 合同审阅改稿手艺");
  });

  it("records world-state hashes and does not churn permission bytes on a second prepare", async () => {
    const session: AgentSession = {
      sessionId: "sess-ws",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const registry = new ToolRegistry();
    const config: AgentConfig = {
      workspaceDir,
      model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
    };

    await prepareTurnPromptContext({
      config,
      registry,
      session,
      instruction: "请审查合同",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
      permissionMode: "strict",
    });
    const firstPermission = session.conversationHistory[0]?.content.match(
      /<!--lm-ws:permission-->[\s\S]*?<!--\/lm-ws:permission-->/,
    )?.[0];
    expect(firstPermission).toBeTruthy();
    expect(session.worldStateBaseline?.permission).toBeTruthy();
    const epochAfterFirst = session.worldStateEpoch ?? 0;

    await prepareTurnPromptContext({
      config,
      registry,
      session,
      instruction: "请审查合同",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
      permissionMode: "strict",
    });
    const secondPermission = session.conversationHistory[0]?.content.match(
      /<!--lm-ws:permission-->[\s\S]*?<!--\/lm-ws:permission-->/,
    )?.[0];
    expect(secondPermission).toBe(firstPermission);
    expect(session.worldStateEpoch).toBe(epochAfterFirst);
  });

  it("injects the contract fast-lane ops block for a 5-minute dispatch", async () => {
    const session: AgentSession = {
      sessionId: "sess-lane",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry: new ToolRegistry(),
      session,
      instruction: [
        "【交办】5 分钟合同审查",
        "交付物类型：合同审查意见",
        "- 己方立场：中立",
        "- 审查重点：管辖",
        "审查深度：标准。",
      ].join("\n"),
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    expect(visiblePrompt(result, session)).toContain(
      CONTRACT_FAST_LANE_PROMPT.split("\n")[0] ?? "",
    );
    expect(result.systemPromptFinal).not.toContain(CONTRACT_FAST_LANE_PROMPT.split("\n")[0] ?? "");
  });

  it("does not treat 办件 contract.review as the opinion-only fast lane", async () => {
    const session: AgentSession = {
      sessionId: "sess-desk-review",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry: new ToolRegistry(),
      session,
      instruction: "【办件】能力：contract.review\n流程：合同审查\n请按已附材料与钉源执行该流程。",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    expect(visiblePrompt(result, session)).not.toContain(
      CONTRACT_FAST_LANE_PROMPT.split("\n")[0] ?? "",
    );
  });

  it("injects the Word revision ops block for file-page 修改合同", async () => {
    const session: AgentSession = {
      sessionId: "sess-word-rev",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry: new ToolRegistry(),
      session,
      instruction: [
        "【用户在 LawMind 文件页将下列路径标为“本回合重点”（路径引用，需助手读取）】",
        "- [项目 · 路径引用] `泰国医疗人工智能战略合作框架协.docx`",
        "修改合同",
      ].join("\n"),
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    expect(visiblePrompt(result, session)).toContain(WORD_REVISION_PROMPT.split("\n")[0] ?? "");
    expect(visiblePrompt(result, session)).toContain("### tech.scope");
    expect(visiblePrompt(result, session)).not.toContain("### pr.pay");
    expect(visiblePrompt(result, session)).not.toContain("## 改稿计划");
    expect(visiblePrompt(result, session)).not.toContain("纸侧与交易角色");
    expect(visiblePrompt(result, session)).not.toContain("## 检索协议");
    expect(visiblePrompt(result, session)).not.toContain("## 成套交件");
    expect(result.systemPromptFinal).not.toContain(WORD_REVISION_PROMPT.split("\n")[0] ?? "");
  });

  it("keeps Word 改稿 ops on a complaint without contract-family 改稿要点", async () => {
    const session: AgentSession = {
      sessionId: "sess-word-rev-pleading",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry: new ToolRegistry(),
      session,
      instruction: "帮我改一下",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
      contextPins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "民事起诉状.docx",
          kind: "file",
        },
      ],
    });
    const prompt = visiblePrompt(result, session);
    expect(prompt).toContain(WORD_REVISION_PROMPT.split("\n")[0] ?? "");
    expect(prompt).toContain("诉讼文书");
    expect(prompt).not.toContain("按合同正文判断");
    expect(prompt).not.toContain("改路由");
  });

  it("does not inject practice playbook on the mail-contract short path", async () => {
    const session: AgentSession = {
      sessionId: "sess-mail-short",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry: new ToolRegistry(),
      session,
      instruction: [
        "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】",
        "matterId=`m1`",
        "默认 contract_edit_baseline_path=`cases/m/a.docx`",
      ].join("\n"),
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    expect(visiblePrompt(result, session)).toContain("邮件合同审阅");
    expect(visiblePrompt(result, session)).not.toContain("## 执业口径");
    expect(visiblePrompt(result, session)).not.toContain("## 封闭合同类型");
    expect(visiblePrompt(result, session)).not.toContain("## 交件对象");
    expect(visiblePrompt(result, session)).not.toContain("## 改稿计划");
    expect(visiblePrompt(result, session)).not.toContain("纸侧与交易角色");
    expect(visiblePrompt(result, session)).not.toContain("## 检索协议");
    expect(visiblePrompt(result, session)).not.toContain("## 成套交件");
  });

  it("injects the Word revision ops block for dialog 导出 with a Word pin", async () => {
    const session: AgentSession = {
      sessionId: "sess-word-rev-dialog",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry: new ToolRegistry(),
      session,
      instruction: "立场甲方，导出",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: "/tmp/project",
      contextPins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "泰国医疗人工智能战略合作框架协议.docx",
          kind: "file",
        },
      ],
    });
    expect(visiblePrompt(result, session)).toContain("Word 改稿 · 原文件审阅痕迹");
    expect(visiblePrompt(result, session)).toContain("唯一交付物");
    expect(visiblePrompt(result, session)).toContain("己方立场：甲方");
    expect(visiblePrompt(result, session)).not.toContain("邮件合同审阅 · 短路径");
    expect(visiblePrompt(result, session)).not.toContain("## 执业口径");
    expect(visiblePrompt(result, session)).not.toContain("## 封闭合同类型");
    expect(visiblePrompt(result, session)).not.toContain("## 交件对象");
    expect(visiblePrompt(result, session)).not.toContain("## 改稿计划");
    expect(visiblePrompt(result, session)).not.toContain("纸侧与交易角色");
    expect(visiblePrompt(result, session)).not.toContain("## 检索协议");
    expect(visiblePrompt(result, session)).not.toContain("## 成套交件");
  });

  it("injects a confirmed procurement checklist on Word revision", async () => {
    const session: AgentSession = {
      sessionId: "sess-word-rev-proc",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry: new ToolRegistry(),
      session,
      instruction: [
        "【Word 改稿】",
        "改稿类型：采购供货",
        "己方立场：甲方",
        "改合同，导出带修订 Word",
      ].join("\n"),
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: "/tmp/project",
      contextPins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "设备采购合同.docx",
          kind: "file",
        },
      ],
    });
    expect(visiblePrompt(result, session)).toContain("律师选定「采购供货」");
    expect(visiblePrompt(result, session)).toContain("尾款与验收合格挂钩");
    expect(visiblePrompt(result, session)).not.toContain("条款 Playbook");
    expect(visiblePrompt(result, session)).not.toContain("## 执业口径");
    expect(visiblePrompt(result, session)).not.toContain("## 封闭合同类型");
    expect(visiblePrompt(result, session)).not.toContain("## 交件对象");
    expect(visiblePrompt(result, session)).not.toContain("## 改稿计划");
    expect(visiblePrompt(result, session)).not.toContain("纸侧与交易角色");
    expect(visiblePrompt(result, session)).not.toContain("## 检索协议");
    expect(visiblePrompt(result, session)).not.toContain("## 成套交件");
  });

  it("renders the available-tools section from the caller-supplied effective tool set", async () => {
    const session: AgentSession = {
      sessionId: "sess-tools",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const registry = new ToolRegistry();
    for (const name of ["analyze_document", "write_document", "list_more_tools"]) {
      registry.register({
        definition: { name, description: name, category: "system", parameters: {} },
        async execute() {
          return { ok: true };
        },
      });
    }
    // 本轮生效工具集（如 readonly 过滤后）——prompt 目录必须由它生成。
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry,
      session,
      instruction: "请审查合同",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
      availableToolNames: ["analyze_document", "list_more_tools"],
    });
    expect(result.systemPromptFinal).toContain("**analyze_document**");
    expect(result.systemPromptFinal).toContain("**list_more_tools**");
    expect(result.systemPromptFinal).not.toContain("**write_document**");
  });

  it("falls back to the core catalog when no effective tool set is supplied", async () => {
    const session: AgentSession = {
      sessionId: "sess-tools-default",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const registry = new ToolRegistry();
    for (const name of ["analyze_document", "write_document"]) {
      registry.register({
        definition: { name, description: name, category: "system", parameters: {} },
        async execute() {
          return { ok: true };
        },
      });
    }
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry,
      session,
      instruction: "请审查合同",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    // 缺省路径（测试/无过滤场景）仍展示核心目录，含写工具。
    expect(result.systemPromptFinal).toContain("**analyze_document**");
    expect(result.systemPromptFinal).toContain("**write_document**");
  });

  it("injects spreadsheet analysis discipline when an xlsx is pinned", async () => {
    const session: AgentSession = {
      sessionId: "sess-xlsx",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry: new ToolRegistry(),
      session,
      instruction: "请分析这张费用表并出图",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
      contextPins: [
        {
          pinKind: "file",
          root: "workspace",
          relPath: "费用.xlsx",
          kind: "file",
        },
      ],
    });
    expect(visiblePrompt(result, session)).toContain("表格分析");
    expect(visiblePrompt(result, session)).toContain("analyze_spreadsheet");
    expect(visiblePrompt(result, session)).toContain("run_compute");
    expect(visiblePrompt(result, session)).toContain("lm-chart");
    expect(visiblePrompt(result, session)).toContain("在办");
  });

  it("caps a long CASE with a read_case_file overflow pointer", async () => {
    const matterId = "m-overflow";
    await fs.mkdir(path.join(workspaceDir, "cases", matterId), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "cases", matterId, "CASE.md"),
      `# 案\n\n## 1. 基本信息\n\n- 当事人：甲\n\n${"争议事实。".repeat(800)}`,
      "utf8",
    );
    const session: AgentSession = {
      sessionId: "sess-overflow",
      actorId: "system",
      matterId,
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry: new ToolRegistry(),
      session,
      instruction: "请审查合同违约责任条款",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    expect(session.samplingPromptTail).toContain("read_case_file");
    expect(session.samplingPromptTail).toContain(`cases/${matterId}/CASE.md`);
    expect(result.systemPromptFinal).not.toContain(`cases/${matterId}/CASE.md`);
    expect(result.systemPromptFinal).toContain("<permission_mode>");
    expect(result.systemPromptFinal).toContain("<!--lm-ws:permission-->");
    expect(result.systemPromptFinal).not.toContain("【窗口】大约还剩");
  });

  it("injects an incomplete turn plan into world-state without a third workflow essay", async () => {
    const session: AgentSession = {
      sessionId: "sess-plan",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turnPlan: {
        items: [
          { step: "读钉选合同", status: "in_progress" },
          { step: "标风险条款", status: "pending" },
        ],
        updatedAt: "2026-09-13T00:00:00.000Z",
      },
    };
    const result = await prepareTurnPromptContext({
      config: {
        workspaceDir,
        model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      },
      registry: new ToolRegistry(),
      session,
      instruction: "帮我审这份合同",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });
    expect(result.systemPromptFinal).toContain("<!--lm-ws:plan-->");
    expect(result.systemPromptFinal).toContain("<turn_plan>");
    expect(result.systemPromptFinal).toContain("读钉选合同");
    const planStart = result.systemPromptFinal.indexOf("<!--lm-ws:plan-->");
    const planEnd = result.systemPromptFinal.indexOf("<!--/lm-ws:plan-->");
    const planBlock = result.systemPromptFinal.slice(planStart, planEnd);
    expect(planBlock).not.toContain("自主工作流程");
  });
});
