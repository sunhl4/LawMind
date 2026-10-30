import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyFactorState, ingestToolResult } from "./factor-state.js";
import { buildWitnessProbes, scoreWitnessAnswer } from "./factor-witness.js";
import type { AgentContext } from "./types.js";

const mocks = vi.hoisted(() => ({
  callModel: vi.fn(),
  recordWitness: vi.fn(),
}));

vi.mock("./runtime-model-call.js", () => ({
  callModelWithRetry: mocks.callModel,
}));

vi.mock("./observation-bus.js", () => ({
  recordWitnessObservation: mocks.recordWitness,
}));

import {
  activeWitnessEnabled,
  applyWitnessScores,
  planActiveWitness,
  renderWitnessProbeMessages,
  runActiveWitnessForTurn,
} from "./witness-measurement.js";

function stateWithAmount(value = 88000) {
  const state = emptyFactorState();
  ingestToolResult(state, "calculate", { op: "economic_compensation", value });
  state.turnEpoch = 3;
  return state;
}

function ctx(): AgentContext {
  return {
    workspaceDir: "/tmp/lm-witness",
    sessionId: "session-1",
    actorId: "lawyer",
    reviewModel: {
      provider: "openai-compatible",
      baseUrl: "https://example.invalid/v1",
      apiKey: "sk-test",
      model: "cheap-model",
      timeoutMs: 30_000,
    },
  };
}

beforeEach(() => {
  mocks.callModel.mockReset();
  mocks.recordWitness.mockReset();
  delete process.env.LAWMIND_FACTOR_WITNESS;
});

afterEach(() => {
  delete process.env.LAWMIND_FACTOR_WITNESS;
});

describe("witness weak measurement", () => {
  it("does not treat one channel as independent confirmation", () => {
    const state = stateWithAmount();
    const probe = buildWitnessProbes(state, 1)[0];
    const score = scoreWitnessAnswer(probe, "88,000 元");
    const [reading] = applyWitnessScores(state, [score], 3);
    expect(reading?.decision.kind).toBe("mixed");

    // 同一通道再答对一次，仍然只有一条独立通道。
    const again = applyWitnessScores(state, [score], 3);
    expect(again[0]?.decision.kind).toBe("mixed");

    const factor = state.factors.find((item) => item.anchor === probe.anchor);
    expect(Object.values(factor?.witnessFilter?.channels ?? {}).flat()).toEqual(["witness:value"]);
  });

  it("upgrades to a definite reading only after a second probe base agrees", () => {
    const state = stateWithAmount();
    const valueProbe = buildWitnessProbes(state, 1)[0];
    applyWitnessScores(state, [scoreWitnessAnswer(valueProbe, "88,000 元")], 3);

    const counterfactual = buildWitnessProbes(state, 1, {
      usedChannels: { "amount:economic_compensation": ["witness:value"] },
    })[0];
    expect(counterfactual.kind).toBe("counterfactual");
    expect(counterfactual.question).not.toContain("88000");

    const [reading] = applyWitnessScores(
      state,
      [scoreWitnessAnswer(counterfactual, "写【待核实】，不写具体数。")],
      3,
    );
    expect(reading?.decision).toEqual(expect.objectContaining({ kind: "definite", id: "obeyed" }));
  });

  it("keeps a disagreement between two probe bases as a conflict", () => {
    const state = stateWithAmount();
    const valueProbe = buildWitnessProbes(state, 1)[0];
    applyWitnessScores(state, [scoreWitnessAnswer(valueProbe, "99,999 元")], 3);
    const counterfactual = buildWitnessProbes(state, 1, {
      usedChannels: { "amount:economic_compensation": ["witness:value"] },
    })[0];
    const [reading] = applyWitnessScores(
      state,
      [scoreWitnessAnswer(counterfactual, "写待核实")],
      3,
    );
    expect(reading?.decision.kind).toBe("conflict");
  });

  it("rotates to the counterfactual probe after the value channel was used", () => {
    const state = stateWithAmount();
    state.factors[0].witnessFilter = {
      anchor: state.factors[0].anchor,
      logOdds: { obeyed: 1 },
      channels: { obeyed: ["witness:value"], invented: [] },
      lastRound: 2,
      observations: 1,
    };
    const probe = planActiveWitness({
      state,
      reply: "经济补偿按账本核定。",
      round: 3,
    })?.probe;
    expect(probe?.kind).toBe("counterfactual");
    expect(probe?.channel).toBe("counterfactual");
  });

  it("skips when the reply already used the verified reading", () => {
    const state = stateWithAmount();
    expect(planActiveWitness({ state, reply: "经济补偿为 88000 元。", round: 3 })).toBeUndefined();
  });

  it("skips an anchor already probed in the same round", () => {
    const state = stateWithAmount();
    const probe = buildWitnessProbes(state, 1)[0];
    applyWitnessScores(state, [scoreWitnessAnswer(probe, "88,000 元")], 3);
    // 下一轮可以换反事实基再问一次。
    expect(planActiveWitness({ state, reply: "按账本核定。", round: 4 })?.probe.kind).toBe(
      "counterfactual",
    );
    // 第二轮问完，同一轮内不再重复。
    applyWitnessScores(
      state,
      [scoreWitnessAnswer({ ...probe, kind: "counterfactual", expected: "" }, "写待核实")],
      4,
    );
    expect(planActiveWitness({ state, reply: "按账本核定。", round: 4 })).toBeUndefined();
  });

  it("gives the probe request the ledger readings but not the conversation", () => {
    const state = stateWithAmount();
    const probe = buildWitnessProbes(state, 1)[0];
    const messages = renderWitnessProbeMessages(state, probe)!;
    expect(messages[1]?.content).toContain("amount:economic_compensation");
    expect(messages[1]?.content).toContain(probe.question);
    expect(messages).toHaveLength(2);
  });

  it("is inactive unless the flag is on", async () => {
    const state = stateWithAmount();
    expect(activeWitnessEnabled()).toBe(false);
    const score = await runActiveWitnessForTurn({
      ctx: ctx(),
      state,
      reply: "经济补偿按账本核定。",
      turnId: "turn-1",
    });
    expect(score).toBeUndefined();
    expect(mocks.callModel).not.toHaveBeenCalled();
  });

  it("records an active probe as an observation and feeds the filter", async () => {
    process.env.LAWMIND_FACTOR_WITNESS = "1";
    mocks.callModel.mockResolvedValue({
      choices: [{ message: { role: "assistant", content: "88,000 元" } }],
    });
    const state = stateWithAmount();
    const score = await runActiveWitnessForTurn({
      ctx: ctx(),
      state,
      reply: "经济补偿按账本核定。",
      turnId: "turn-1",
    });
    expect(score).toEqual(
      expect.objectContaining({ anchor: "amount:economic_compensation", verdict: "pass" }),
    );
    expect(mocks.callModel).toHaveBeenCalledTimes(1);
    const [, messages, tools] = mocks.callModel.mock.calls[0];
    expect(tools).toEqual([]);
    expect(JSON.stringify(messages)).toContain("【引擎核定】");
    expect(mocks.recordWitness).toHaveBeenCalledWith(
      "/tmp/lm-witness",
      { sessionId: "session-1" },
      expect.objectContaining({
        source: "active",
        probes: 1,
        verdict: "pass",
        channel: "witness:value",
      }),
      "turn-1",
    );
    const factor = state.factors.find((item) => item.anchor === "amount:economic_compensation");
    expect(Object.values(factor?.witnessFilter?.channels ?? {}).flat()).toEqual(["witness:value"]);
  });

  it("swallows a probe failure instead of breaking the turn", async () => {
    process.env.LAWMIND_FACTOR_WITNESS = "1";
    mocks.callModel.mockRejectedValue(new Error("upstream 502"));
    const state = stateWithAmount();
    await expect(
      runActiveWitnessForTurn({
        ctx: ctx(),
        state,
        reply: "经济补偿按账本核定。",
        turnId: "turn-1",
      }),
    ).resolves.toBeUndefined();
    expect(mocks.recordWitness).not.toHaveBeenCalled();
  });
});
