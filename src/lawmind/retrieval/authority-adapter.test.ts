/**
 * Authority retrieval adapter — empty corpus must not invent claims.
 * Default provider is open (local sample); HTTP paths need provider=generic.
 */

import { describe, expect, it, vi } from "vitest";
import type { MemoryContext } from "../memory/index.js";
import type { TaskIntent } from "../types.js";
import { createAuthorityAdapterFromEnv } from "./authority-adapter.js";
import { retrieve } from "./index.js";

function legalIntent(): TaskIntent {
  const now = new Date().toISOString();
  return {
    taskId: "t-auth-1",
    kind: "research.legal",
    output: "markdown",
    instruction: "检索民法典合同编解除条款",
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

describe("createAuthorityAdapterFromEnv", () => {
  it("open provider returns sample hits without commercial endpoint", async () => {
    const prev = process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    try {
      const adapter = createAuthorityAdapterFromEnv({ endpoint: "" });
      const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
      expect(r.sources.length).toBeGreaterThan(0);
      expect(r.claims.every((c) => c.sourceIds.length > 0)).toBe(true);
      expect(r.missingItems).toEqual([]);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_AUTHORITY_PROVIDER;
      } else {
        process.env.LAWMIND_AUTHORITY_PROVIDER = prev;
      }
    }
  });

  it("emits explicit missingItems when generic endpoint unset (no fabricated claims)", async () => {
    const prev = process.env.LAWMIND_AUTHORITY_ENDPOINT;
    delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
    try {
      const adapter = createAuthorityAdapterFromEnv({ endpoint: "", provider: "generic" });
      const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
      expect(r.sources).toEqual([]);
      expect(r.claims).toEqual([]);
      expect(r.missingItems.some((m) => m.includes("不得编造"))).toBe(true);
    } finally {
      if (prev !== undefined) {
        process.env.LAWMIND_AUTHORITY_ENDPOINT = prev;
      }
    }
  });

  it("maps HTTP hits into sources+claims with sourceIds", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        hits: [
          {
            id: "stat-1",
            title: "民法典第五百六十三条",
            kind: "statute",
            citation: "《民法典》第563条",
            excerpt: "当事人可以解除合同的情形……",
          },
        ],
      }),
    );
    const adapter = createAuthorityAdapterFromEnv({
      endpoint: "https://authority.example/search",
      apiKey: "vendor-secret",
      provider: "generic",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.sources).toHaveLength(1);
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]?.sourceIds).toEqual(["stat-1"]);
    expect(r.missingItems).toEqual([]);
    const init = fetchImpl.mock.calls[0]?.[1] as { headers?: Record<string, string> };
    expect(init.headers?.authorization).toBe("Bearer vendor-secret");
  });

  it("retrieve() sanitizes claims and keeps missingItems when generic authority empty", async () => {
    const adapter = createAuthorityAdapterFromEnv({ endpoint: "", provider: "generic" });
    const bundle = await retrieve({
      intent: legalIntent(),
      memory: emptyMemory(),
      adapters: [adapter],
    });
    expect(bundle.claims).toEqual([]);
    expect(bundle.missingItems.length).toBeGreaterThan(0);
    expect(bundle.requiresReview).toBe(true);
  });

  it("fail-closed on invalid endpoint URL without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const adapter = createAuthorityAdapterFromEnv({
      endpoint: "ftp://not-allowed.example/search",
      provider: "generic",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.sources).toEqual([]);
    expect(r.claims).toEqual([]);
    expect(r.riskFlags.some((f) => f.includes("fail-closed"))).toBe(true);
    expect(r.missingItems.some((m) => m.includes("不得编造"))).toBe(true);
  });

  it("returns HTTP error path when authority endpoint responds non-OK", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const adapter = createAuthorityAdapterFromEnv({
      endpoint: "https://authority.example/search",
      provider: "generic",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims).toEqual([]);
    expect(r.riskFlags.some((f) => f.includes("503"))).toBe(true);
  });

  it("pkulaw provider maps hits; 429 yields quota missingItems", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        hits: [
          {
            id: "s1",
            title: "民法典第五百六十三条",
            kind: "statute",
            excerpt: "解除合同……",
          },
        ],
      }),
    );
    const adapter = createAuthorityAdapterFromEnv({
      endpoint: "https://authority.example/pkulaw",
      provider: "pkulaw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.sources).toHaveLength(1);
    expect(r.claims[0]?.sourceIds).toEqual(["s1"]);

    const limited = createAuthorityAdapterFromEnv({
      endpoint: "https://authority.example/pkulaw",
      provider: "pkulaw",
      fetchImpl: vi.fn(
        async () => new Response("rate", { status: 429 }),
      ) as unknown as typeof fetch,
    });
    const r2 = await limited.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r2.missingItems.some((m) => m.includes("额度") || m.includes("限流"))).toBe(true);
  });

  it("lexis provider returns explicit not-implemented missingItems", async () => {
    const adapter = createAuthorityAdapterFromEnv({
      endpoint: "https://lexis.example/search",
      provider: "lexis",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.sources).toEqual([]);
    expect(r.missingItems.some((m) => m.includes("Lexis"))).toBe(true);
  });

  it("returns empty-hit missingItems when authority returns no hits", async () => {
    const adapter = createAuthorityAdapterFromEnv({
      endpoint: "https://authority.example/search",
      provider: "generic",
      fetchImpl: vi.fn(async () => Response.json({ hits: [] })) as unknown as typeof fetch,
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.sources).toEqual([]);
    expect(r.missingItems.some((m) => m.includes("未检索到"))).toBe(true);
  });

  it("accepts items[] alias and skips hits without title", async () => {
    const adapter = createAuthorityAdapterFromEnv({
      endpoint: "https://authority.example/search",
      provider: "generic",
      fetchImpl: vi.fn(async () =>
        Response.json({
          items: [
            { id: "x1", title: "有效条目", kind: "regulation", excerpt: "摘要" },
            { id: "x2", title: "  ", kind: "case" },
          ],
        }),
      ) as unknown as typeof fetch,
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]?.kind).toBe("regulation");
  });

  it("supports hybrid intent keyword trigger for open sample", async () => {
    const adapter = createAuthorityAdapterFromEnv({ endpoint: "", provider: "open" });
    const now = new Date().toISOString();
    const r = await adapter.retrieve({
      intent: {
        taskId: "t-hybrid",
        kind: "research.hybrid",
        output: "markdown",
        instruction: "综合检索",
        summary: "民法典解除",
        riskLevel: "low",
        models: ["legal"],
        requiresConfirmation: false,
        createdAt: now,
      },
      memory: emptyMemory(),
    });
    expect(r.sources.length).toBeGreaterThan(0);
  });

  it("network failure returns missingItems without claims", async () => {
    const adapter = createAuthorityAdapterFromEnv({
      endpoint: "https://authority.example/search",
      provider: "generic",
      fetchImpl: vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.claims).toEqual([]);
    expect(r.riskFlags.some((f) => f.includes("network down"))).toBe(true);
  });
});
