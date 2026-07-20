/**
 * Authority retrieval adapter — empty corpus must not invent claims.
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
  it("emits explicit missingItems when endpoint unset (no fabricated claims)", async () => {
    const prev = process.env.LAWMIND_AUTHORITY_ENDPOINT;
    delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
    try {
      const adapter = createAuthorityAdapterFromEnv({ endpoint: "" });
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
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const r = await adapter.retrieve({ intent: legalIntent(), memory: emptyMemory() });
    expect(r.sources).toHaveLength(1);
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]?.sourceIds).toEqual(["stat-1"]);
    expect(r.missingItems).toEqual([]);
  });

  it("retrieve() sanitizes claims and keeps missingItems when authority empty", async () => {
    const adapter = createAuthorityAdapterFromEnv({ endpoint: "" });
    const bundle = await retrieve({
      intent: legalIntent(),
      memory: emptyMemory(),
      adapters: [adapter],
    });
    expect(bundle.claims).toEqual([]);
    expect(bundle.missingItems.length).toBeGreaterThan(0);
    expect(bundle.requiresReview).toBe(true);
  });
});
