import { afterEach, describe, expect, it, vi } from "vitest";
import * as webSearch from "../agent/tools/lawmind-web-search.js";
import type { TaskIntent } from "../types.js";
import {
  BRAVE_WEB_ADAPTER_NAME,
  BRAVE_WEB_PROVIDER,
  createBraveWebSearchAdapter,
  queryFromResearchIntent,
} from "./brave-web-search-adapter.js";

function intent(partial: Partial<TaskIntent> = {}): TaskIntent {
  return {
    taskId: "t1",
    kind: "draft.word",
    output: "docx",
    deliverableType: "report.compliance",
    instruction: "2025 年个人信息保护监管动态",
    summary: "个保监管动态",
    riskLevel: "medium",
    models: ["general"],
    requiresConfirmation: false,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("brave-web-search-adapter", () => {
  it("prefers fan-out 子问题 as the search query", () => {
    expect(
      queryFromResearchIntent(
        intent({
          instruction: "主题\n\n子问题：个人信息保护 执法与案例 要点与权威来源",
          summary: "个保监管动态",
        }),
      ),
    ).toContain("执法与案例");
  });

  it("returns a missing-backend riskFlag instead of throwing", async () => {
    vi.spyOn(webSearch, "isPublicWebSearchReady").mockReturnValue(false);
    const adapter = createBraveWebSearchAdapter("/tmp/ws");
    expect(adapter.name).toBe(BRAVE_WEB_ADAPTER_NAME);
    expect(adapter.supports(intent())).toBe(true);
    const result = await adapter.retrieve({
      intent: intent(),
      memory: {
        general: "",
        profile: "",
        firmProfile: "",
        caseMemory: "",
        matterStrategy: "",
        todayLog: "",
        yesterdayLog: "",
        clausePlaybook: "",
        courtAndOpponentProfile: "",
        clientProfile: "",
      },
    });
    expect(result.claims).toHaveLength(0);
    expect(result.riskFlags.some((f) => /当前对话模型没有厂商网页检索/.test(f))).toBe(true);
  });

  it("maps public web snippets to sourced claims", async () => {
    vi.spyOn(webSearch, "isPublicWebSearchReady").mockReturnValue(true);
    vi.spyOn(webSearch, "lawMindPublicWebSearch").mockResolvedValue({
      provider: "brave",
      results: [
        {
          title: "网信办通报",
          url: "https://www.cac.gov.cn/example",
          description: "个人信息保护行政执法典型案例",
        },
      ],
    });
    const adapter = createBraveWebSearchAdapter("/tmp/ws");
    const result = await adapter.retrieve({
      intent: intent(),
      memory: {
        general: "",
        profile: "",
        firmProfile: "",
        caseMemory: "",
        matterStrategy: "",
        todayLog: "",
        yesterdayLog: "",
        clausePlaybook: "",
        courtAndOpponentProfile: "",
        clientProfile: "",
      },
    });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.provider).toBe(BRAVE_WEB_PROVIDER);
    expect(result.sources[0]?.url).toBe("https://www.cac.gov.cn/example");
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.sourceIds).toEqual([result.sources[0]?.id]);
    expect(result.claims[0]?.text).toContain("个人信息保护");
    expect(result.riskFlags.some((f) => /公网检索命中/.test(f))).toBe(true);
  });
});
