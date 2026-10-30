/**
 * Witness（记性抽查）的弱测量接线。
 *
 * 被动路径：工具返回 `witnessAnswers` 时，`observation-builders` 打分后交给这里，
 * 每个锚维护一组 `obeyed` / `invented` 对数几率。通道按值 / 出处 / 反事实分开：
 * 同一通道重复答对不增加独立证据，两个不同基都指向同一读法才算稳定。
 *
 * 主动路径：回合收口前（仅在 `LAWMIND_FACTOR_WITNESS=1` 时）用 reviewModel 问
 * 一个不含答案的探针，再走同一套滤波。默认关闭；开启后每回合最多一次，
 * 回答只进观察账本，不改正文、不改判定。
 *
 * 这里的失败只表达「注入的读数块没有被正确取用」，不证明模型判断对错。
 */

import { createFilter, decide, observe, type EvidenceFilterDecision } from "./evidence-filter.js";
import { renderEngineReadings, type FactorState } from "./factor-state.js";
import {
  buildWitnessProbes,
  scoreWitnessAnswer,
  witnessChannelOf,
  type WitnessProbe,
  type WitnessScore,
} from "./factor-witness.js";
import { recordWitnessObservation } from "./observation-bus.js";
import { callModelWithRetry } from "./runtime-model-call.js";
import type { AgentContext } from "./types.js";

/** 一次回答是一个弱读数；两个独立基才够判定。 */
const WITNESS_LLR = 1;
const WITNESS_DECAY = 0.5;
const WITNESS_CONFIRM_ABOVE = 1.5;
const WITNESS_MARGIN = 0.5;
const WITNESS_MIN_CHANNELS = 2;

export const WITNESS_OBEYED = "obeyed";
export const WITNESS_INVENTED = "invented";

const WITNESS_TIMEOUT_MS = 20_000;
/** 带思考的便宜模型也要能答完一条短回答；仍设硬上限。 */
const WITNESS_MAX_TOKENS = 1_024;
const WITNESS_MAX_CANDIDATES = 6;

const WITNESS_SYSTEM_PROMPT = [
  "你是引擎侧的记性抽查员。",
  "只根据下面给出的引擎核定读数回答，不要解释，不要引用对话或原文。",
  "回答不超过 30 个字。若读数里没有唯一已核值，直接回答【待核实】。",
].join("");

export type WitnessFilterReading = {
  anchor: string;
  channel: string;
  decision: EvidenceFilterDecision;
};

/** 该锚已经测过的独立通道（跨值 / 出处 / 反事实）。 */
export function witnessChannelsByAnchor(state: FactorState): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const factor of state.factors) {
    const filter = factor.witnessFilter;
    if (!filter) {
      continue;
    }
    const channels = [...new Set(Object.values(filter.channels).flat())];
    if (channels.length > 0) {
      out[factor.anchor] = channels;
    }
  }
  return out;
}

/** 把一个打分写进该锚的 witness 滤波；返回当前判定。 */
export function observeWitnessScore(
  state: FactorState,
  score: WitnessScore,
  round: number,
): EvidenceFilterDecision {
  const factor = state.factors.find((item) => item.anchor === score.anchor);
  if (!factor) {
    return { kind: "mixed", ids: [], reason: "没有该锚" };
  }
  const filter = factor.witnessFilter ?? createFilter(factor.anchor);
  const outcomeId = score.verdict === "pass" ? WITNESS_OBEYED : WITNESS_INVENTED;
  const channel = `witness:${witnessChannelOf({ kind: score.kind })}`;
  factor.witnessFilter = observe(
    filter,
    { outcomeId, llr: WITNESS_LLR, round, channel },
    { decay: WITNESS_DECAY },
  );
  return decide(factor.witnessFilter, {
    upper: WITNESS_CONFIRM_ABOVE,
    margin: WITNESS_MARGIN,
    minChannels: WITNESS_MIN_CHANNELS,
  });
}

/** 批量写入被动 witness 回答；返回逐条滤波结果，供观察账本记录。 */
export function applyWitnessScores(
  state: FactorState,
  scores: readonly WitnessScore[],
  round: number,
): WitnessFilterReading[] {
  return scores.map((score) => ({
    anchor: score.anchor,
    channel: `witness:${witnessChannelOf({ kind: score.kind })}`,
    decision: observeWitnessScore(state, score, round),
  }));
}

export function activeWitnessEnabled(): boolean {
  return process.env.LAWMIND_FACTOR_WITNESS === "1";
}

export type ActiveWitnessPlan = {
  probe: WitnessProbe;
  reason: string;
};

/**
 * 选一个值得问的探针。只挑有已核读数的金额 / 引用；正文已经说出该读数的
 * 不重复问（那说明通道在用），本轮已经问过的锚也不再问。
 */
export function planActiveWitness(params: {
  state: FactorState;
  reply: string;
  round: number;
}): ActiveWitnessPlan | undefined {
  if (!params.reply.trim()) {
    return undefined;
  }
  const probes = buildWitnessProbes(params.state, WITNESS_MAX_CANDIDATES, {
    usedChannels: witnessChannelsByAnchor(params.state),
  });
  for (const probe of probes) {
    if (probe.kind === "unverified") {
      continue;
    }
    const factor = params.state.factors.find((item) => item.anchor === probe.anchor);
    const lastRound = factor?.witnessFilter?.lastRound ?? Number.NEGATIVE_INFINITY;
    if (lastRound >= params.round) {
      continue;
    }
    if (probe.expected && params.reply.includes(probe.expected)) {
      continue;
    }
    return {
      probe,
      reason:
        probe.kind === "counterfactual"
          ? "已核读数未在正文出现，换反事实基再测一次"
          : "正文没用到已核读数，问一次值/出处",
    };
  }
  return undefined;
}

/** 主动探针的请求体：只给引擎读数和问题，不给对话历史。 */
export function renderWitnessProbeMessages(
  state: FactorState,
  probe: WitnessProbe,
): Array<{ role: "system" | "user"; content: string }> | undefined {
  const readings = renderEngineReadings(state).trim();
  if (!readings) {
    return undefined;
  }
  return [
    { role: "system", content: WITNESS_SYSTEM_PROMPT },
    { role: "user", content: `${readings}\n\n【抽查】${probe.question}` },
  ];
}

/**
 * 回合收口前的主动抽查。默认关闭；任何失败都吞掉，观察不能打断回合。
 * 只写观察与滤波状态，不改 finalReply。
 */
export async function runActiveWitnessForTurn(params: {
  ctx: AgentContext;
  state: FactorState;
  reply: string;
  turnId: string;
}): Promise<WitnessScore | undefined> {
  if (!activeWitnessEnabled()) {
    return undefined;
  }
  const model = params.ctx.reviewModel;
  if (!model?.apiKey || !model.baseUrl || !model.model) {
    return undefined;
  }
  const round = params.state.turnEpoch ?? 0;
  const plan = planActiveWitness({ state: params.state, reply: params.reply, round });
  if (!plan) {
    return undefined;
  }
  const messages = renderWitnessProbeMessages(params.state, plan.probe);
  if (!messages) {
    return undefined;
  }
  let answer = "";
  try {
    const response = await callModelWithRetry(
      {
        ...model,
        maxTokens: WITNESS_MAX_TOKENS,
        maxRetries: 0,
        timeoutMs: Math.min(model.timeoutMs ?? WITNESS_TIMEOUT_MS, WITNESS_TIMEOUT_MS),
      },
      messages,
      [],
      {
        admission: { sessionId: params.ctx.sessionId, kind: "worker" },
        reasoningEffort: "high",
        ...(params.ctx.abortSignal ? { signal: params.ctx.abortSignal } : {}),
      },
    );
    answer = response.choices[0]?.message?.content ?? "";
  } catch {
    return undefined;
  }
  const score = scoreWitnessAnswer(plan.probe, answer);
  const decision = observeWitnessScore(params.state, score, round);
  try {
    recordWitnessObservation(
      params.ctx.workspaceDir,
      {
        sessionId: params.ctx.sessionId,
        ...(params.ctx.matterId ? { matterId: params.ctx.matterId } : {}),
      },
      {
        probes: 1,
        verdict: score.verdict,
        driftAnchors: score.verdict === "drift" ? [score.anchor] : [],
        scores: [score],
        source: "active",
        channel: `witness:${plan.probe.channel}`,
        reason: plan.reason,
        filter: [
          {
            anchor: score.anchor,
            channel: `witness:${plan.probe.channel}`,
            decision,
          },
        ],
      },
      params.turnId,
    );
  } catch {
    /* observation must not break the turn */
  }
  return score;
}
