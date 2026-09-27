import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * Loopback chat.completions cassette. The outbound proxy bypasses global fetch
 * (DNS pinning), so tests script real HTTP over 127.0.0.1 instead of stubbing
 * globalThis.fetch.
 */
type StubRound = { status?: number; json: unknown };

type StubServer = {
  baseUrl: string;
  requests: Array<{ rawBody: string }>;
  enqueue: (...rounds: StubRound[]) => void;
  close: () => Promise<void>;
};

async function startChatCompletionsStub(): Promise<StubServer> {
  const queue: StubRound[] = [];
  const requests: Array<{ rawBody: string }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      requests.push({ rawBody: raw });
      const round = queue.shift();
      if (!round) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "cassette exhausted" }));
        return;
      }
      const status = round.status ?? 200;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(typeof round.json === "string" ? round.json : JSON.stringify(round.json));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    enqueue: (...rounds) => {
      queue.push(...rounds);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function chatJsonRound(content: string): StubRound {
  return { json: { choices: [{ message: { content } }] } };
}

const servers: StubServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function startServer(): Promise<StubServer> {
  const server = await startChatCompletionsStub();
  servers.push(server);
  return server;
}

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
    const server = await startServer();
    server.enqueue(
      chatJsonRound(
        JSON.stringify({
          claims: [{ text: "条文摘要", confidence: 0.8 }],
          sources: [{ title: "民法典", citation: "第563条" }],
          riskFlags: [],
          missingItems: [],
        }),
      ),
    );
    const [adapter] = createOpenAICompatibleAdapters({
      legal: {
        baseUrl: server.baseUrl,
        apiKey: "k",
        model: "legal-model",
      },
    });
    expect(adapter).toBeTruthy();
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims).toHaveLength(1);
    expect(r.sources).toHaveLength(1);
  });

  it("falls back when model returns markdown instead of JSON", async () => {
    const server = await startServer();
    for (let i = 0; i < modelAttemptBudget(); i += 1) {
      server.enqueue(chatJsonRound("## 摘要\n\n根据民法典第509条……"));
    }
    const [adapter] = createOpenAICompatibleAdapters({
      general: {
        baseUrl: server.baseUrl,
        apiKey: "k",
        model: "general",
      },
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims.length).toBe(1);
    expect(r.riskFlags.some((f) => f.includes("降级"))).toBe(true);
    expect(server.requests).toHaveLength(modelAttemptBudget());
  });

  it("resamples non-JSON then parses", async () => {
    const server = await startServer();
    server.enqueue(
      chatJsonRound("## 摘要\n\n根据民法典第509条……"),
      chatJsonRound(
        JSON.stringify({
          claims: [{ text: "条文摘要", confidence: 0.9 }],
          sources: [],
          riskFlags: [],
          missingItems: [],
        }),
      ),
    );
    const [adapter] = createOpenAICompatibleAdapters({
      general: {
        baseUrl: server.baseUrl,
        apiKey: "k",
        model: "general",
      },
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims).toHaveLength(1);
    expect(r.riskFlags.some((f) => f.includes("降级"))).toBe(false);
    expect(server.requests).toHaveLength(2);
  });

  it("reads JSON from reasoning_content when content is empty", async () => {
    const server = await startServer();
    server.enqueue({
      json: {
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
      },
    });
    const [adapter] = createOpenAICompatibleAdapters({
      legal: {
        baseUrl: server.baseUrl,
        apiKey: "k",
        model: "legal-model",
      },
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims[0]?.text).toBe("推理区 JSON");
  });

  it("retries 503 then parses", async () => {
    const server = await startServer();
    server.enqueue(
      { status: 503, json: "busy" },
      chatJsonRound(
        JSON.stringify({
          claims: [{ text: "ok", confidence: 0.8 }],
          sources: [],
          riskFlags: [],
          missingItems: [],
        }),
      ),
    );
    const [adapter] = createOpenAICompatibleAdapters({
      general: {
        baseUrl: server.baseUrl,
        apiKey: "k",
        model: "general",
      },
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims[0]?.text).toBe("ok");
    expect(server.requests).toHaveLength(2);
  });

  it("returns riskFlags on HTTP error", async () => {
    const server = await startServer();
    server.enqueue({ status: 400, json: "err" });
    const [adapter] = createOpenAICompatibleAdapters({
      general: {
        baseUrl: server.baseUrl,
        apiKey: "k",
        model: "general",
      },
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims).toEqual([]);
    expect(r.riskFlags.some((f) => f.includes("400"))).toBe(true);
  });

  it("caps identity memory with the same fingerprint windows as chat", async () => {
    const server = await startServer();
    server.enqueue(
      chatJsonRound(
        JSON.stringify({
          claims: [],
          sources: [],
          riskFlags: [],
          missingItems: [],
        }),
      ),
    );
    const [adapter] = createOpenAICompatibleAdapters({
      legal: {
        baseUrl: server.baseUrl,
        apiKey: "k",
        model: "legal-model",
      },
    });
    const profile = `${"甲".repeat(1_200)}MID_MARKER_SHOULD_DROP${"乙".repeat(1_200)}`;
    await adapter.retrieve({
      intent: legalIntent(),
      memory: { ...emptyMemory(), profile },
    });
    const payload = JSON.parse(server.requests[0]?.rawBody ?? "{}") as {
      messages?: Array<{ role?: string; content?: string }>;
      max_tokens?: number;
    };
    const userContent = payload.messages?.find((m) => m.role === "user")?.content ?? "";
    expect(payload.max_tokens).toBe(resolveClassifySidecarLimits({}).maxTokens);
    expect(userContent).toContain("read_workspace_file");
    expect(userContent).toContain("LAWYER_PROFILE.md");
    expect(userContent).not.toContain("MID_MARKER_SHOULD_DROP");
  });
});
