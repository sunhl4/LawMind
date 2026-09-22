import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applySystemPromptToHistory,
  buildSystemPrompt,
  buildSystemPromptParts,
  buildSystemPromptWithMeta,
  describeAssembledPromptSections,
  LAWMIND_AGENT_BEHAVIOR_EPOCH,
  LAWMIND_PROMPT_DYNAMIC_BOUNDARY,
  listSystemPromptSectionCatalog,
  splitSystemPromptAtBoundary,
  type SystemPromptContext,
} from "./system-prompt.js";

const minimalCtx: SystemPromptContext = {
  availableTools: [
    {
      name: "draft_document",
      description: "起草",
      category: "draft",
      parameters: {},
      riskLevel: "medium",
    },
  ],
};

describe("system prompt sections", () => {
  it("always-on lawyer sections assemble by catalog id, not copy", () => {
    const ids = listSystemPromptSectionCatalog().map((s) => s.id);
    expect(ids).toContain("identity_principles");
    expect(ids).toContain("autonomous_workflow");
    expect(ids).toContain("available_tools");
    expect(ids).toContain("safety_boundaries");

    const assembled = describeAssembledPromptSections(buildSystemPrompt(minimalCtx)).map(
      (s) => s.id,
    );
    expect(assembled).toContain("identity_principles");
    expect(assembled).toContain("autonomous_workflow");
    expect(assembled).toContain("available_tools");
    expect(assembled).toContain("safety_boundaries");
  });

  it("buildSystemPromptWithMeta keeps assembled text identical and toggles optional ids", () => {
    const text = buildSystemPrompt(minimalCtx);
    const meta = buildSystemPromptWithMeta(minimalCtx);
    expect(meta.text).toBe(text);
    const ids = meta.sections.map((s) => s.id);
    expect(ids).toContain("identity_principles");
    expect(ids).toContain("autonomous_workflow");
    expect(ids).toContain("review_delivery_loop");
    expect(ids).toContain("available_tools");
    expect(ids).not.toContain("web_search");
    expect(ids).toContain("web_search_off");
    expect(meta.text).toContain("list_more_tools");
  });

  it("optional sections appear only when context provides them", () => {
    const withWeb = buildSystemPromptWithMeta({ ...minimalCtx, allowWebSearch: true });
    expect(withWeb.sections.some((s) => s.id === "web_search")).toBe(true);
    expect(withWeb.sections.some((s) => s.id === "web_search_off")).toBe(false);
    const sections = describeAssembledPromptSections(withWeb.text);
    expect(sections.find((s) => s.id === "review_delivery_loop")).toBeTruthy();
    const withMail = buildSystemPromptWithMeta({
      ...minimalCtx,
      mailSendFormatHint: "## 外发邮件落款\n\n落款：某某律师事务所",
    });
    expect(withMail.sections.some((s) => s.id === "mail_send_format")).toBe(true);
    expect(withMail.text).toContain("某某律师事务所");
    const withAuthority = buildSystemPromptWithMeta({
      ...minimalCtx,
      authorityLive: true,
      authorityProviderLabel: "北大法宝（闭源·手动）",
    });
    expect(withAuthority.sections.some((s) => s.id === "authority_corpus")).toBe(true);
    expect(withAuthority.text).toContain("北大法宝（闭源·手动）");
    const withNpc = buildSystemPromptWithMeta({
      ...minimalCtx,
      authorityOfficialPublic: true,
    });
    expect(withNpc.sections.some((s) => s.id === "authority_official_public")).toBe(true);
    expect(withNpc.text).toContain("国家法律法规数据库");
    expect(withNpc.text).toContain("未接商业法宝");
  });

  it("catalog marks identity as static and matter as session", () => {
    const rows = listSystemPromptSectionCatalog();
    expect(rows.find((s) => s.id === "identity_principles")?.cache).toBe("static");
    expect(rows.find((s) => s.id === "matter_context")?.cache).toBe("session");
    expect(rows.find((s) => s.id === "available_tools")?.cache).toBe("static");
  });
});

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("system prompt cache boundary", () => {
  it("keeps static hash when only profile or matter changes", () => {
    const base = buildSystemPromptParts(minimalCtx);
    const withProfile = buildSystemPromptParts({
      ...minimalCtx,
      lawyerName: "张律师",
      lawyerProfile: "专注公司法",
    });
    const withMatter = buildSystemPromptParts({
      ...minimalCtx,
      matterId: "m-1",
      matterContext: "股权转让争议",
    });
    expect(hashText(base.staticText)).toBe(hashText(withProfile.staticText));
    expect(hashText(base.staticText)).toBe(hashText(withMatter.staticText));
    expect(withProfile.sessionText).toContain("张律师");
    expect(withMatter.sessionText).toContain("股权转让争议");
    const withMail = buildSystemPromptParts({
      ...minimalCtx,
      mailSendFormatHint: "## 外发邮件落款\n\n落款：某某所",
    });
    expect(hashText(base.staticText)).toBe(hashText(withMail.staticText));
    expect(withMail.sessionText).toContain("外发邮件落款");
    expect(base.staticText).toContain(LAWMIND_AGENT_BEHAVIOR_EPOCH);
    expect(base.staticText).not.toContain(LAWMIND_PROMPT_DYNAMIC_BOUNDARY);
  });

  it("changes static text when the behavior epoch is embedded", () => {
    const { staticText } = buildSystemPromptParts(minimalCtx);
    expect(staticText).toContain(`lawmind-epoch:${LAWMIND_AGENT_BEHAVIOR_EPOCH}`);
  });

  it("applySystemPromptToHistory keeps the already-sent static prefix", () => {
    const first = buildSystemPrompt(minimalCtx);
    const second = buildSystemPrompt({
      ...minimalCtx,
      lawyerProfile: "新的画像",
      matterId: "m-2",
      matterContext: "新案件",
    });
    const applied = applySystemPromptToHistory(first, second);
    expect(splitSystemPromptAtBoundary(applied).staticText).toBe(
      splitSystemPromptAtBoundary(first).staticText,
    );
    expect(applied).toContain("新的画像");
    expect(applied).toContain(LAWMIND_PROMPT_DYNAMIC_BOUNDARY);
  });

  it("compact verbosity still expands search_conversations parameters", () => {
    const filler: SystemPromptContext["availableTools"] = Array.from({ length: 20 }, (_, i) => ({
      name: `extra_tool_${i}`,
      description: "占位",
      category: "search" as const,
      parameters: {},
      riskLevel: "low" as const,
    }));
    const text = buildSystemPrompt({
      ...minimalCtx,
      agentPromptVerbosity: "compact",
      availableTools: [
        ...minimalCtx.availableTools,
        ...filler,
        {
          name: "search_conversations",
          description: "检索本机其他对话",
          category: "search",
          parameters: {
            query: { type: "string", description: "关键词", required: true },
          },
          riskLevel: "low",
        },
        {
          name: "read_conversation",
          description: "阅读历史对话",
          category: "search",
          parameters: {
            session_id: { type: "string", description: "会话 id", required: true },
          },
          riskLevel: "low",
        },
      ],
    });
    expect(text).toContain("### 常用工具（含参数）");
    expect(text).toContain("search_conversations");
    expect(text).toContain("query (string, 必填): 关键词");
    expect(text).toContain("read_conversation");
    expect(text).toContain("session_id (string, 必填): 会话 id");
  });

  it("compact verbosity expands disclosed explore_folder / list_dir / read_skill / draft_worker", () => {
    const filler: SystemPromptContext["availableTools"] = Array.from({ length: 20 }, (_, i) => ({
      name: `extra_tool_${i}`,
      description: "占位",
      category: "search" as const,
      parameters: {},
      riskLevel: "low" as const,
    }));
    const text = buildSystemPrompt({
      ...minimalCtx,
      agentPromptVerbosity: "compact",
      availableTools: [
        ...minimalCtx.availableTools,
        ...filler,
        {
          name: "explore_folder",
          description: "探查文件夹",
          category: "search",
          parameters: {
            goal: { type: "string", description: "要做的事", required: true },
          },
          riskLevel: "low",
        },
        {
          name: "list_dir",
          description: "列目录",
          category: "search",
          parameters: {
            path: { type: "string", description: "目录路径" },
          },
          riskLevel: "low",
        },
        {
          name: "read_skill",
          description: "读技能",
          category: "system",
          parameters: {
            skill_id: { type: "string", description: "技能 id" },
          },
          riskLevel: "low",
        },
        {
          name: "draft_worker",
          description: "并行写稿",
          category: "draft",
          parameters: {
            goal: { type: "string", description: "要做的事", required: true },
            section: { type: "string", description: "章节" },
          },
          riskLevel: "low",
        },
      ],
    });
    expect(text).toContain("### 常用工具（含参数）");
    expect(text).toContain("explore_folder");
    expect(text).toContain("goal (string, 必填): 要做的事");
    expect(text).toContain("list_dir");
    expect(text).toContain("path (string): 目录路径");
    expect(text).toContain("read_skill");
    expect(text).toContain("skill_id (string): 技能 id");
    expect(text).toContain("draft_worker");
    expect(text).toContain("section (string): 章节");
    expect(text).toContain("### 其他工具（按类别；需要完整参数时按名称调用即可）");
    expect(text).toContain("extra_tool_0");
  });
});
