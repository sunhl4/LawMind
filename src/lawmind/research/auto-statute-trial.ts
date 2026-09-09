/**
 * Deterministic runtime statute trial for unlocked legal drafting paths.
 * It reuses the normal retrieval adapters so authoritative hits, attribution,
 * and source IDs enter the same ResearchBundle as the rest of research.
 */

import type { MemoryContext } from "../memory/index.js";
import type { RetrievalAdapter } from "../retrieval/index.js";
import type { ResearchBundle, ResearchClaim, ResearchSource, TaskIntent } from "../types.js";
import { buildQueryMatrix } from "./query-matrix.js";

const ELIGIBLE = new Set(["memo.research", "memo.opinion", "memo.internal", "contract.review"]);

export function shouldAutoTrialStatute(input: {
  intent: TaskIntent;
  wordRevisionTurn?: boolean;
  mailContractTurn?: boolean;
}): boolean {
  if (input.wordRevisionTurn === true || input.mailContractTurn === true) {
    return false;
  }
  const type = input.intent.deliverableType;
  return Boolean(
    type && (ELIGIBLE.has(type) || type.startsWith("letter.") || type.startsWith("litigation.")),
  );
}

function uniqueSources(sources: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.id || `${source.title}:${source.url ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueClaims(claims: ResearchClaim[]): ResearchClaim[] {
  const seen = new Set<string>();
  return claims.filter((claim) => {
    const key = `${claim.text}:${claim.sourceIds.join(",")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export type AutoStatuteTrialResult = {
  attempted: boolean;
  query?: string;
  bundle: ResearchBundle;
  sourceCount: number;
  claimCount: number;
};

export async function runAutoStatuteTrial(input: {
  intent: TaskIntent;
  bundle: ResearchBundle;
  memory: MemoryContext;
  adapters: RetrievalAdapter[];
  signal?: AbortSignal;
  wordRevisionTurn?: boolean;
  mailContractTurn?: boolean;
}): Promise<AutoStatuteTrialResult> {
  if (!shouldAutoTrialStatute(input)) {
    return { attempted: false, bundle: input.bundle, sourceCount: 0, claimCount: 0 };
  }
  const query = buildQueryMatrix(input.intent.instruction).queryTerms;
  const trialIntent: TaskIntent = {
    ...input.intent,
    taskId: `${input.intent.taskId}:statute-trial`,
    kind: "research.legal",
    output: "none",
    instruction: query,
    summary: query,
    models: ["legal"],
    requiresConfirmation: false,
    clarificationQuestions: undefined,
  };
  const sources: ResearchSource[] = [];
  const claims: ResearchClaim[] = [];
  const riskFlags: string[] = [];
  const missingItems: string[] = [];

  // Keep the trial bounded: at most one pass per configured adapter and 20 sources total.
  for (const adapter of input.adapters) {
    if (input.signal?.aborted) {
      break;
    }
    if (!adapter.supports(trialIntent)) {
      continue;
    }
    try {
      const result = await adapter.retrieve({
        intent: trialIntent,
        memory: input.memory,
        signal: input.signal,
      });
      sources.push(...result.sources);
      claims.push(...result.claims);
      riskFlags.push(...result.riskFlags);
      missingItems.push(...result.missingItems);
      if (sources.length >= 20) {
        break;
      }
    } catch {
      // Retrieval failure is soft: drafting continues with an explicit missing item.
    }
  }
  const trialSources = uniqueSources(sources).slice(0, 20);
  const sourceIds = new Set(trialSources.map((source) => source.id));
  const trialClaims = uniqueClaims(claims).filter((claim) =>
    claim.sourceIds.some((id) => sourceIds.has(id)),
  );
  const merged: ResearchBundle = {
    ...input.bundle,
    sources: uniqueSources([...input.bundle.sources, ...trialSources]),
    claims: uniqueClaims([...input.bundle.claims, ...trialClaims]),
    riskFlags: [...new Set([...input.bundle.riskFlags, ...riskFlags])],
    missingItems:
      trialSources.length > 0
        ? [...new Set([...input.bundle.missingItems, ...missingItems])]
        : [
            ...new Set([
              ...input.bundle.missingItems,
              ...missingItems,
              `法规自动试检无命中：${query}。正文如写条号须标【待核实】。`,
            ]),
          ],
  };
  return {
    attempted: true,
    query,
    bundle: merged,
    sourceCount: trialSources.length,
    claimCount: trialClaims.length,
  };
}
