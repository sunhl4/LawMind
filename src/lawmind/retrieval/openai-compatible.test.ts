import { describe, expect, it, vi } from "vitest";
import type { MemoryContext } from "../memory/index.js";
import type { TaskIntent } from "../types.js";
import {
  createOpenAICompatibleAdapters,
  fallbackRetrievalFromNonJson,
} from "./openai-compatible.js";

function legalIntent(): TaskIntent {
  const now = new Date().toISOString();
  return {
    taskId: "t-openai",
    kind: "research.legal",
    output: "markdown",
    instruction: "检索",
    summary: "民法典解除",
    riskLevel: "medium",
    models: ["legal"],
    requiresConfirmation: false,
    createdAt: now,
  };
}

function emptyMemory(): MemoryContext {
  return {
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
  };
}

describe("fallbackRetrievalFromNonJson", () => {
  it("salvages markdown prose as a low-confidence claim", () => {
    const out = fallbackRetrievalFromNonJson(
      "## 检索摘要\n\n根据《民法典》第509条，当事人应按约履行。",
    );
    expect(out.claims.length).toBe(1);
    expect(out.claims[0]?.text).toContain("民法典");
    expect(out.claims[0]?.confidence).toBeLessThan(0.5);
    expect(out.riskFlags.some((r) => r.includes("降级"))).toBe(true);
  });

  it("returns empty when content is blank", () => {
    const out = fallbackRetrievalFromNonJson("   ");
    expect(out.claims).toEqual([]);
  });
});

describe("createOpenAICompatibleAdapters", () => {
  it("parses JSON model output into claims and sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  claims: [{ text: "条文摘要", confidence: 0.8 }],
                  sources: [{ title: "民法典", citation: "第563条" }],
                  riskFlags: [],
                  missingItems: [],
                }),
              },
            },
          ],
        }),
      ),
    );
    const [adapter] = createOpenAICompatibleAdapters({
      legal: {
        baseUrl: "https://api.example/v1",
        apiKey: "k",
        model: "legal-model",
      },
    });
    expect(adapter).toBeTruthy();
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims).toHaveLength(1);
    expect(r.sources).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("returns riskFlags on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status: 400 })),
    );
    const [adapter] = createOpenAICompatibleAdapters({
      general: {
        baseUrl: "https://api.example/v1",
        apiKey: "k",
        model: "general",
      },
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims).toEqual([]);
    expect(r.riskFlags.some((f) => f.includes("400"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("falls back when model returns markdown instead of JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: "## 摘要\n\n根据民法典第509条……" } }],
        }),
      ),
    );
    const [adapter] = createOpenAICompatibleAdapters({
      general: {
        baseUrl: "https://api.example/v1",
        apiKey: "k",
        model: "general",
      },
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims.length).toBe(1);
    expect(r.riskFlags.some((f) => f.includes("降级"))).toBe(true);
    vi.unstubAllGlobals();
  });
});
