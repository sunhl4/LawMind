/**
 * Governance metadata must cover every tool in the legal registry
 * (including collaboration + web) without throwing.
 */

import { describe, expect, it } from "vitest";
import { SURGICAL_MAX_FIND_WITH_TERMINATOR } from "../../drafts/surgical-span-gate.js";
import type { AgentConfig } from "../../types.js";
import { estimateTextTokens } from "../context-budget.js";
import {
  BACKGROUND_JOB_TOOLS,
  IDEMPOTENT_READ_TOOLS,
  MATTER_SCOPE_REQUIRED,
  WRITE_TOOLS,
} from "../tool-name-sets.js";
import {
  buildToolGovernanceMetadata,
  listToolGovernanceMetadata,
  promptCatalogToolNames,
} from "./governance.js";
import { createLegalToolRegistry } from "./legal-tools.js";

const baseConfig: AgentConfig = {
  workspaceDir: "/tmp/lawmind-governance-drift",
  model: {
    provider: "openai-compatible",
    baseUrl: "https://example.invalid/v1",
    apiKey: "test",
    model: "test-model",
  },
  enableCollaboration: true,
  allowWebSearch: true,
  assistantId: "assistant-test",
};

describe("tool governance drift", () => {
  it("buildToolGovernanceMetadata works for every registered tool", () => {
    const registry = createLegalToolRegistry({
      allowWebSearch: true,
      enableCollaboration: true,
      baseConfig,
    });

    const tools = registry.listTools();
    expect(tools.length).toBeGreaterThan(10);

    for (const tool of tools) {
      expect(() => buildToolGovernanceMetadata(tool)).not.toThrow();
      const meta = buildToolGovernanceMetadata(tool);
      expect(meta.name).toBe(tool.definition.name);
      expect(meta.auditEventKind).toBe("tool_call");
    }

    const listed = listToolGovernanceMetadata(registry);
    const listedNames = listed.map((m) => m.name).toSorted();
    const registryNames = tools.map((t) => t.definition.name).toSorted();
    expect(listedNames).toEqual(registryNames);

    const openAiNames = registry
      .toOpenAITools()
      .map((t) => t.function.name)
      .toSorted();
    expect(openAiNames).toEqual(registryNames);
  });

  it("classification sets have no dead names and stay mutually consistent", () => {
    const registry = createLegalToolRegistry({
      allowWebSearch: true,
      enableCollaboration: true,
      baseConfig,
    });
    const registryNames = new Set(registry.listTools().map((t) => t.definition.name));

    // 1) 无死名：分类集合中的名字必须真实注册（此前 list_all_drafts 类漂移曾漏网）。
    for (const [label, set] of [
      ["WRITE_TOOLS", WRITE_TOOLS],
      ["IDEMPOTENT_READ_TOOLS", IDEMPOTENT_READ_TOOLS],
      ["MATTER_SCOPE_REQUIRED", MATTER_SCOPE_REQUIRED],
      ["BACKGROUND_JOB_TOOLS", BACKGROUND_JOB_TOOLS],
    ] as const) {
      for (const name of set) {
        expect(registryNames.has(name), `${label} 死名: ${name}`).toBe(true);
      }
    }

    // 2) 读写互斥：幂等只读集合不得含写工具。
    for (const name of IDEMPOTENT_READ_TOOLS) {
      expect(WRITE_TOOLS.has(name), `既读又写: ${name}`).toBe(false);
    }

    // 3) 语义一致：definition.requiresApproval 的工具必须落在写/后台集合，
    //    否则 strict 模式下审批管线与治理元数据会对不上。
    for (const tool of registry.listTools()) {
      if (tool.definition.requiresApproval === true) {
        expect(
          WRITE_TOOLS.has(tool.definition.name) || BACKGROUND_JOB_TOOLS.has(tool.definition.name),
          `requiresApproval 未归类: ${tool.definition.name}`,
        ).toBe(true);
      }
    }

    // 4) 推导一致：写工具推导出的 runtimeMode 不得为 readonly，且风险不低于 medium。
    const meta = listToolGovernanceMetadata(registry);
    for (const m of meta) {
      if (WRITE_TOOLS.has(m.name)) {
        expect(m.runtimeMode === "readonly", `写工具被标 readonly: ${m.name}`).toBe(false);
        expect(m.riskLevel === "low", `写工具被标低风险: ${m.name}`).toBe(false);
      }
    }
  });

  it("apply_surgical_edits advertised description is a Craft/gate pointer, not the span essay", () => {
    const registry = createLegalToolRegistry({
      allowWebSearch: true,
      enableCollaboration: true,
      baseConfig,
    });
    const tools = registry.toOpenAITools({ names: promptCatalogToolNames() });
    const surgical = tools.find((t) => t.function.name === "apply_surgical_edits");
    expect(surgical).toBeDefined();
    const desc = surgical?.function.description ?? "";
    const beforeDesc = `对已 seed 的合同草稿做精确 find/replace 落改。跨度硬门禁：能改几个字就只改几个字；段内只改有问题的句子；含句读的 find≤${SURGICAL_MAX_FIND_WITH_TERMINATOR} 字；整句/整段删写会被跳过/拒绝。条数不限（全文可很多处）。须附 craft_check.deferred（缓办，不是自评覆盖率；缺失视为工具错误）。勿把整节塞进 update_draft.sections。成功后返回 redlinePending；≥1 后再 render_tracked_draft。非锁定路径若省略 edits，可回落 drafts/<taskId>.redline-plan.json（意见推荐措辞编译结果）。`;
    expect(desc).toContain("craft_check");
    expect(desc).toContain("redlinePending");
    expect(desc).toContain("Craft Skill");
    expect(desc).toContain("render_tracked_draft");
    expect(desc).not.toMatch(/含句读/);
    expect(desc).not.toMatch(/能改几个字就只改几个字/);
    expect(desc).not.toMatch(/find≤/);
    expect(desc.length).toBeLessThan(280);
    expect(estimateTextTokens(desc)).toBeLessThan(estimateTextTokens(beforeDesc));
    expect(estimateTextTokens(desc)).toBeLessThan(180);
    const catalogJson = JSON.stringify(tools);
    // eslint-disable-next-line no-console -- measurement the review asked for
    console.log(
      `[token] catalog tools json tokens=${estimateTextTokens(catalogJson)} surgical_desc before=${estimateTextTokens(beforeDesc)} after=${estimateTextTokens(desc)} saved=${estimateTextTokens(beforeDesc) - estimateTextTokens(desc)}`,
    );
  });
});
