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
  it("identity tells the model to start without lane chips", () => {
    const text = buildSystemPrompt(minimalCtx);
    expect(text).toContain("先附材料，再在「办件」里选流程");
    expect(text).toContain("Cursor / Claude Code / Codex");
    expect(text).toContain("产品化能力");
    expect(text).toContain("不要要求律师记住");
  });

  it("catalog includes always-on lawyer sections", () => {
    const ids = listSystemPromptSectionCatalog().map((s) => s.id);
    expect(ids).toContain("identity_principles");
    expect(ids).toContain("autonomous_workflow");
    expect(ids).toContain("available_tools");
    expect(ids).toContain("safety_boundaries");
  });

  it("buildSystemPromptWithMeta keeps assembled text identical", () => {
    const text = buildSystemPrompt(minimalCtx);
    const meta = buildSystemPromptWithMeta(minimalCtx);
    expect(meta.text).toBe(text);
    const ids = meta.sections.map((s) => s.id);
    expect(ids).toContain("identity_principles");
    expect(ids).toContain("autonomous_workflow");
    expect(ids).toContain("review_delivery_loop");
    expect(ids).toContain("available_tools");
    expect(ids).not.toContain("web_search");
  });

  it("optional sections appear only when context provides them", () => {
    const withWeb = buildSystemPromptWithMeta({ ...minimalCtx, allowWebSearch: true });
    expect(withWeb.sections.some((s) => s.id === "web_search")).toBe(true);
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
    expect(withAuthority.text).toContain("北大法宝");
    expect(withAuthority.text).toContain("声称没有法宝接口");
    expect(withAuthority.text).toContain("设置 → 模型与连接");
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
});
