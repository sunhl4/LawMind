import { describe, expect, it, vi } from "vitest";
import { modelAttemptBudget } from "../llm/http-retry.js";
import type { MemoryContext } from "../memory/index.js";
import { resolveClassifySidecarLimits } from "../models/capability-envelope.js";
import type { TaskIntent } from "../types.js";
import {
  createOpenAICompatibleAdapters,
  fallbackRetrievalFromNonJson,
} from "./openai-compatible.js";

vi.mock("../llm/http-retry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm/http-retry.js")>();
  return { ...actual, waitModelRetry: async () => undefined };
});

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
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(modelAttemptBudget());
    vi.unstubAllGlobals();
  });

  it("resamples non-JSON then parses", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return Response.json({
          choices: [{ message: { content: "## 摘要\n\n根据民法典第509条……" } }],
        });
      }
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                claims: [{ text: "条文摘要", confidence: 0.9 }],
                sources: [],
                riskFlags: [],
                missingItems: [],
              }),
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const [adapter] = createOpenAICompatibleAdapters({
      general: {
        baseUrl: "https://api.example/v1",
        apiKey: "k",
        model: "general",
      },
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims).toHaveLength(1);
    expect(r.riskFlags.some((f) => f.includes("降级"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("reads JSON from reasoning_content when content is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: "",
                reasoning_content: JSON.stringify({
                  claims: [{ text: "推理区 JSON", confidence: 0.7 }],
                  sources: [],
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
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims[0]?.text).toBe("推理区 JSON");
    vi.unstubAllGlobals();
  });

  it("retries 503 then parses", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response("busy", { status: 503 });
      }
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                claims: [{ text: "ok", confidence: 0.8 }],
                sources: [],
                riskFlags: [],
                missingItems: [],
              }),
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const [adapter] = createOpenAICompatibleAdapters({
      general: {
        baseUrl: "https://api.example/v1",
        apiKey: "k",
        model: "general",
      },
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims[0]?.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("caps identity memory with the same fingerprint windows as chat", async () => {
    let userContent = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        const payload = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ role?: string; content?: string }>;
          max_tokens?: number;
        };
        userContent = payload.messages?.find((m) => m.role === "user")?.content ?? "";
        expect(payload.max_tokens).toBe(resolveClassifySidecarLimits({}).maxTokens);
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  claims: [],
                  sources: [],
                  riskFlags: [],
                  missingItems: [],
                }),
              },
            },
          ],
        });
      }),
    );
    const [adapter] = createOpenAICompatibleAdapters({
      legal: {
        baseUrl: "https://api.example/v1",
        apiKey: "k",
        model: "legal-model",
      },
    });
    const profile = `${"甲".repeat(1_200)}MID_MARKER_SHOULD_DROP${"乙".repeat(1_200)}`;
    await adapter.retrieve({
      intent: legalIntent(),
      memory: { ...emptyMemory(), profile },
    });
    expect(userContent).toContain("read_workspace_file");
    expect(userContent).toContain("LAWYER_PROFILE.md");
    expect(userContent).not.toContain("MID_MARKER_SHOULD_DROP");
    vi.unstubAllGlobals();
  });
});
