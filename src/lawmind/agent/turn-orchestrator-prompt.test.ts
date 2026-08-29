import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "./tools/registry.js";
import { prepareTurnPromptContext } from "./turn-orchestrator-prompt.js";
import type { AgentConfig, AgentSession } from "./types.js";

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
    expect(result.systemPromptFinal).toContain("本轮 LawMind 能力：合同审查");
    expect(result.systemPromptFinal).toContain("产品化办件");
    expect(result.systemPromptFinal.length).toBeGreaterThan(0);
    expect(session.conversationHistory).toHaveLength(1);
    expect(session.conversationHistory[0]?.role).toBe("system");
    expect(session.conversationHistory[0]?.content).toBe(result.systemPromptFinal);
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
    expect(result.systemPromptFinal).toContain("合同审查 · 快车道");
    expect(result.systemPromptFinal).toContain("检索类工具本回合会直接拒绝");
    expect(result.systemPromptFinal).toContain("审查对照要点");
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
    expect(result.systemPromptFinal).toContain("Word 改稿 · 原文件审阅痕迹");
    expect(result.systemPromptFinal).toContain("禁止 `render_document`");
    expect(result.systemPromptFinal).toContain("禁止 `prepare_outbound_mail`");
    expect(result.systemPromptFinal).toContain("合同审阅改稿手艺");
    expect(result.systemPromptFinal).toContain("技术与许可");
    expect(result.systemPromptFinal).toContain("### tech.scope");
    expect(result.systemPromptFinal).not.toContain("### pr.pay");
    expect(result.systemPromptFinal).not.toContain("邮件合同审阅 · 短路径");
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
    expect(result.systemPromptFinal).toContain("Word 改稿 · 原文件审阅痕迹");
    expect(result.systemPromptFinal).toContain("唯一交付物");
    expect(result.systemPromptFinal).toContain("己方立场：甲方");
    expect(result.systemPromptFinal).not.toContain("邮件合同审阅 · 短路径");
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
    expect(result.systemPromptFinal).toContain("律师选定「采购供货」");
    expect(result.systemPromptFinal).toContain("尾款与验收合格挂钩");
    expect(result.systemPromptFinal).not.toContain("条款 Playbook");
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
    expect(result.systemPromptFinal).toContain("表格分析");
    expect(result.systemPromptFinal).toContain("analyze_spreadsheet");
    expect(result.systemPromptFinal).toContain("lm-chart");
  });
});
