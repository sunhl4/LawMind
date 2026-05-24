/**
 * Model reasoning tests (fetch mocked).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDraftWithModelEnabled } from "../models/custom-store.js";
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

  it("uses store preference via lawMindRoot without LAWMIND_REASONING_MODE", async () => {
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-draft-async-"));
    try {
      setDraftWithModelEnabled(lawMindRoot, true);
      delete process.env.LAWMIND_REASONING_MODE;
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
                    title: "偏好开启标题",
                    sections: [{ heading: "一、分析", body: "模型扩写正文。", citations: ["s1"] }],
                  }),
                },
              },
            ],
          }),
        })),
      );

      const draft = await buildDraftAsync({
        intent: minimalIntent(),
        bundle: minimalBundle(),
        lawMindRoot,
      });
      expect(draft.title).toBe("偏好开启标题");
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(lawMindRoot, { recursive: true, force: true });
    }
  });
});
