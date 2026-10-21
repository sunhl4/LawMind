/** Evaluation admission only. Never blocks a lawyer's interactive turn. */
import { retrieveAuthorityHitsForChat } from "../agent/tools/legal/search-authority.js";
import { ToolRegistry } from "../agent/tools/registry.js";
import type { ToolCallResult } from "../agent/types.js";
import type { AuthorityCallOutcome } from "../retrieval/authority-outcome.js";
import { authorityCallSucceeded } from "../retrieval/authority-outcome.js";

export type AuthorityBenchmarkProof = {
  searches: number;
  livePkulaw: number;
  providers: string[];
  withHits: number;
  empty: number;
  errors: number;
  unverified: number;
  statuses: Record<string, number>;
  providerContaminated: boolean;
};

type SearchResponse = { name: string; result: { data?: unknown } };

/** Read each tool response once. Old configuration-only live flags are not evidence. */
export function collectAuthorityProof(responses: SearchResponse[]): AuthorityBenchmarkProof {
  const proof: AuthorityBenchmarkProof = {
    searches: 0,
    livePkulaw: 0,
    providers: [],
    withHits: 0,
    empty: 0,
    errors: 0,
    unverified: 0,
    statuses: {},
    providerContaminated: false,
  };
  for (const response of responses) {
    if (!["search_statute", "search_case_law"].includes(response.name)) {
      continue;
    }
    proof.searches++;
    const data = response.result.data as
      | { authorityProvider?: string; authorityOutcome?: AuthorityCallOutcome }
      | undefined;
    const provider = data?.authorityProvider;
    if (provider && !proof.providers.includes(provider)) {
      proof.providers.push(provider);
    }
    const outcome = data?.authorityOutcome;
    if (!outcome || provider !== "pkulaw") {
      proof.unverified++;
      continue;
    }
    proof.statuses[outcome.status] = (proof.statuses[outcome.status] ?? 0) + 1;
    if (authorityCallSucceeded(outcome.status)) {
      proof.livePkulaw++;
      if (outcome.status === "ok" && outcome.hitCount > 0) {
        proof.withHits++;
      } else if (outcome.status === "empty" && outcome.hitCount === 0) {
        proof.empty++;
      } else {
        proof.unverified++;
      }
    } else {
      proof.errors++;
    }
  }
  proof.providerContaminated = proof.errors > 0;
  return proof;
}

/** Wrap real tools without replacing execution. Capture once before history pruning/compaction. */
export function observeAuthorityBenchmark(registry: ToolRegistry): {
  registry: ToolRegistry;
  proof: () => AuthorityBenchmarkProof;
} {
  const observed = new ToolRegistry();
  const responses: SearchResponse[] = [];
  for (const tool of registry.listTools()) {
    observed.register({
      ...tool,
      execute: async (params, ctx) => {
        let result: ToolCallResult;
        try {
          result = await tool.execute(params, ctx);
        } catch (error) {
          if (["search_statute", "search_case_law"].includes(tool.definition.name)) {
            responses.push({ name: tool.definition.name, result: {} });
          }
          throw error;
        }
        if (["search_statute", "search_case_law"].includes(tool.definition.name)) {
          const data = result.data as
            | { authorityProvider?: string; authorityOutcome?: AuthorityCallOutcome }
            | undefined;
          responses.push({
            name: tool.definition.name,
            result: {
              data: {
                authorityProvider: data?.authorityProvider,
                authorityOutcome: data?.authorityOutcome,
              },
            },
          });
        }
        return result;
      },
    });
  }
  return { registry: observed, proof: () => collectAuthorityProof(responses) };
}

export type AuthorityPreflight = {
  checkedAt: string;
  ok: boolean;
  checks: Array<{ kind: "law" | "case"; status: string; hitCount: number; expectedHit: boolean }>;
};

/** Two fixed control queries test both billed endpoints, not benchmark answers. */
export async function preflightBenchmarkAuthority(opts: {
  workspaceDir: string;
  fetchImpl?: typeof fetch;
}): Promise<AuthorityPreflight> {
  const checks: AuthorityPreflight["checks"] = [];
  for (const control of [
    { kind: "law" as const, query: "中华人民共和国民法典", expected: /民法典/ },
    { kind: "case" as const, query: "买卖合同纠纷", expected: /买卖合同/ },
  ]) {
    const result = await retrieveAuthorityHitsForChat({
      ...opts,
      query: control.query,
      searchKind: control.kind,
    });
    const expectedHit =
      result.provider === "pkulaw" &&
      result.live &&
      !result.demoCorpus &&
      result.hits.some((hit) => control.expected.test([hit.title, hit.snippet].join(" ")));
    checks.push({
      kind: control.kind,
      status: result.outcome?.status ?? "unverified",
      hitCount: result.hits.length,
      expectedHit,
    });
    // Do not keep spending credits after an explicit service failure.
    if (result.outcome && !authorityCallSucceeded(result.outcome.status)) {
      break;
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    ok: checks.length === 2 && checks.every((c) => c.status === "ok" && c.expectedHit),
    checks,
  };
}

/** A normal empty result is valid; a broken control probe is inconclusive, not proof of no credit. */
export function authorityBenchmarkValidity(
  proof: AuthorityBenchmarkProof | null | undefined,
  preflight: AuthorityPreflight | null,
): "valid" | "contaminated" | "unverified" {
  if (proof?.providerContaminated) {
    return "contaminated";
  }
  if (!preflight?.ok || !proof || proof.unverified > 0) {
    return "unverified";
  }
  return "valid";
}

export function shouldStopAuthorityBenchmark(
  proof: AuthorityBenchmarkProof,
  controlOk = true,
): boolean {
  return proof.errors > 0 || proof.unverified > 0 || !controlOk;
}
