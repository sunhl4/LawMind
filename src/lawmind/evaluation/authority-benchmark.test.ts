import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "../agent/tools/registry.js";
import type { AgentContext } from "../agent/types.js";
import type { AuthorityCallOutcome } from "../retrieval/authority-outcome.js";
import {
  authorityBenchmarkValidity,
  collectAuthorityProof,
  preflightBenchmarkAuthority,
  shouldStopAuthorityBenchmark,
} from "./authority-benchmark.js";
import { observeAuthorityBenchmark } from "./authority-benchmark.js";

function response(outcome?: AuthorityCallOutcome) {
  return {
    name: "search_statute",
    result: {
      data: { authorityProvider: "pkulaw", authorityLive: true, authorityOutcome: outcome },
    },
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("authority benchmark admission", () => {
  it("observes real executions once without replacing tools or retaining query text", async () => {
    const original = new ToolRegistry();
    const execute = vi.fn(
      async () => response({ status: "empty", hitCount: 0, httpStatus: 200 }).result,
    );
    original.register({
      definition: {
        name: "search_statute",
        description: "search",
        category: "search",
        parameters: {},
      },
      execute: async () => ({ ok: true, ...(await execute()) }),
    });
    const before = original.get("search_statute")?.execute;
    const observed = observeAuthorityBenchmark(original);
    await observed.registry
      .get("search_statute")!
      .execute({ query: "private-query" }, {} as AgentContext);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(original.get("search_statute")?.execute).toBe(before);
    expect(observed.proof()).toMatchObject({ searches: 1, empty: 1 });
    expect(JSON.stringify(observed.proof())).not.toContain("private-query");
  });
  it("keeps a thrown search as unverified instead of silently losing that attempt", async () => {
    const original = new ToolRegistry();
    original.register({
      definition: {
        name: "search_case_law",
        description: "search",
        category: "search",
        parameters: {},
      },
      execute: async () => {
        throw new Error("unexpected failure");
      },
    });
    const observed = observeAuthorityBenchmark(original);
    await expect(
      observed.registry.get("search_case_law")!.execute({}, {} as AgentContext),
    ).rejects.toThrow("unexpected failure");
    expect(observed.proof()).toMatchObject({ searches: 1, unverified: 1 });
    expect(shouldStopAuthorityBenchmark(observed.proof())).toBe(true);
  });

  it("does not mistake legacy livePkulaw flags for verified calls", () => {
    const proof = collectAuthorityProof([response()]);
    expect(proof).toMatchObject({ livePkulaw: 0, unverified: 1, providerContaminated: false });
    expect(authorityBenchmarkValidity(proof, { ok: true, checkedAt: "now", checks: [] })).toBe(
      "unverified",
    );
    expect(shouldStopAuthorityBenchmark(proof)).toBe(true);
  });

  it("accepts normal empty results, but excludes a row with even one service error", () => {
    const proof = collectAuthorityProof([
      response({ status: "ok", hitCount: 2, httpStatus: 200 }),
      response({ status: "empty", hitCount: 0, httpStatus: 200 }),
    ]);
    const preflight = { ok: true, checkedAt: "now", checks: [] };
    expect(proof).toMatchObject({ searches: 2, livePkulaw: 2, withHits: 1, empty: 1 });
    expect(authorityBenchmarkValidity(proof, preflight)).toBe("valid");
    expect(shouldStopAuthorityBenchmark(proof)).toBe(false);
    const contaminated = collectAuthorityProof([
      response({ status: "quota_exhausted", hitCount: 0, httpStatus: 200 }),
    ]);
    expect(authorityBenchmarkValidity(contaminated, preflight)).toBe("contaminated");
    expect(shouldStopAuthorityBenchmark(contaminated)).toBe(true);
    expect(authorityBenchmarkValidity(proof, null)).toBe("unverified");
    expect(shouldStopAuthorityBenchmark(proof, false)).toBe(true);
  });

  it.each(["empty", "quota", "unrelated", "healthy"])(
    "preflight validates usable content on law and case endpoints: %s",
    async (variant) => {
      vi.stubEnv("LAWMIND_AUTHORITY_PROVIDER", "pkulaw");
      vi.stubEnv("LAWMIND_AUTHORITY_ENDPOINT", "https://authority.example/mcp-law");
      vi.stubEnv("LAWMIND_PKULAW_CASE_ENDPOINT", "https://authority.example/mcp-case");
      const calls: string[] = [];
      const fetchImpl: typeof fetch = async (url) => {
        const urlText = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        calls.push(urlText);
        if (variant === "quota") {
          return Response.json({
            result: { isError: true, content: [{ type: "text", text: "积分不足" }] },
          });
        }
        if (variant === "empty") {
          return Response.json({ hits: [] });
        }
        return Response.json({
          hits: [
            {
              title:
                variant === "unrelated"
                  ? "无关结果"
                  : urlText.includes("mcp-case")
                    ? "买卖合同纠纷判决"
                    : "中华人民共和国民法典",
            },
          ],
        });
      };
      const probe = await preflightBenchmarkAuthority({ workspaceDir: "", fetchImpl });
      expect(probe.ok).toBe(variant === "healthy");
      expect(calls).toHaveLength(variant === "quota" ? 1 : 2);
      if (variant === "empty") {
        expect(probe.checks.every((c) => c.status === "empty")).toBe(true);
      }
      if (variant === "quota") {
        expect(probe.checks[0]?.status).toBe("quota_exhausted");
      }
    },
  );
});
