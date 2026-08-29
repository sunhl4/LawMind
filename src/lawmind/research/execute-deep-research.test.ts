import { describe, expect, it, vi } from "vitest";
import type { MemoryContext } from "../memory/index.js";
import type { RetrievalAdapter } from "../retrieval/index.js";
import type { TaskIntent } from "../types.js";
import { executeDeepResearchPlan } from "./execute-deep-research.js";

const memory = {
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
} satisfies MemoryContext;

function intent(): TaskIntent {
  return {
    taskId: "task-deep-1",
    kind: "draft.word",
    output: "docx",
    deliverableType: "report.compliance",
    instruction: "跨境数据合规卷宗 https://www.samr.gov.cn/example",
    summary: "合规",
    riskLevel: "medium",
    models: ["general"],
    requiresConfirmation: false,
    createdAt: new Date().toISOString(),
  };
}

describe("executeDeepResearchPlan", () => {
  it("skips url-dossier adapter and URL fetch when allowWebSearch is false", async () => {
    const urlAdapter: RetrievalAdapter = {
      name: "url-dossier",
      supports: () => true,
      retrieve: vi.fn(async () => ({
        sources: [
          {
            id: "url-should-not",
            title: "blocked",
            kind: "web" as const,
            provider: "url-dossier",
          },
        ],
        claims: [],
        riskFlags: [],
        missingItems: [],
      })),
    };
    const local: RetrievalAdapter = {
      name: "workspace",
      supports: () => true,
      retrieve: async () => ({
        sources: [{ id: "w1", title: "本地", kind: "memo" as const }],
        claims: [
          {
            id: "c1",
            text: "本地结论",
            confidence: 0.7,
            sourceIds: ["w1"],
            model: "t",
          },
        ],
        riskFlags: [],
        missingItems: [],
      }),
    };

    const result = await executeDeepResearchPlan({
      intent: intent(),
      memory,
      adapters: [urlAdapter, local],
      allowWebSearch: false,
    });

    expect(urlAdapter.retrieve).not.toHaveBeenCalled();
    expect(result.bundle.sources.some((s) => s.id === "url-should-not")).toBe(false);
    expect(result.bundle.sources.some((s) => s.id === "w1")).toBe(true);
    expect(result.bundle.riskFlags.some((r) => /allowWebSearch/.test(r))).toBe(true);
    expect(result.outline.status).toBe("pending");
  });

  it("produces evidence-backed pending outline from adapter claims", async () => {
    const adapter: RetrievalAdapter = {
      name: "authority",
      supports: () => true,
      retrieve: async () => ({
        sources: [
          {
            id: "s1",
            title: "官方",
            kind: "regulation" as const,
            url: "https://www.samr.gov.cn/x",
          },
        ],
        claims: [
          {
            id: "c1",
            text: "应完成安全评估",
            confidence: 0.8,
            sourceIds: ["s1"],
            model: "t",
          },
        ],
        riskFlags: [],
        missingItems: [],
      }),
    };
    const result = await executeDeepResearchPlan({
      intent: intent(),
      memory,
      adapters: [adapter],
      allowWebSearch: false,
    });
    expect(result.outline.sections.length).toBeGreaterThan(0);
    expect(result.outline.notes.some((n) => /证据驱动/.test(n))).toBe(true);
    expect(result.plan.queries.length).toBeGreaterThan(0);
  });
});
