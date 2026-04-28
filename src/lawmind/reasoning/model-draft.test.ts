/**
 * Model reasoning tests (fetch mocked).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResearchBundle, TaskIntent } from "../types.js";
import { buildDraftAsync } from "./index.js";

function minimalIntent(overrides: Partial<TaskIntent> = {}): TaskIntent {
  return {
    taskId: "t-model-1",
    kind: "analyze.contract",
    output: "docx",
    instruction: "请审查合同违约金条款",
    summary: "合同审查",
    riskLevel: "medium",
    models: ["general", "legal"],
    requiresConfirmation: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function minimalBundle(): ResearchBundle {
  return {
    taskId: "t-model-1",
    query: "审查",
    sources: [{ id: "s1", title: "来源A", kind: "memo" }],
    claims: [
      { text: "违约金条款需明确计算方式", confidence: 0.9, sourceIds: ["s1"], model: "legal" },
    ],
    riskFlags: ["证据链待补充"],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
  };
}

describe("buildDraftAsync model reasoning", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
    vi.unstubAllGlobals();
  });

  it("uses rule buildDraft when reasoning mode off", async () => {
    delete process.env.LAWMIND_REASONING_MODE;
    const draft = await buildDraftAsync({ intent: minimalIntent(), bundle: minimalBundle() });
    expect(draft.sections.some((s) => s.heading === "审查结论")).toBe(true);
  });

  it("merges model sections when LAWMIND_REASONING_MODE=model", async () => {
    process.env.LAWMIND_REASONING_MODE = "model";
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "模型生成标题",
                  sections: [
                    { heading: "一、结论", body: "应修订违约金条款。", citations: ["s1"] },
                  ],
                }),
              },
            },
          ],
        }),
      })),
    );

    const draft = await buildDraftAsync({ intent: minimalIntent(), bundle: minimalBundle() });
    expect(draft.title).toBe("模型生成标题");
    expect(draft.sections.some((s) => s.heading === "一、结论")).toBe(true);
    expect(draft.sections.some((s) => s.heading === "主要风险提示")).toBe(true);
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
