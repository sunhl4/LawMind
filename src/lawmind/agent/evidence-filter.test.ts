import { describe, expect, it } from "vitest";
import {
  createFilter,
  decide,
  observe,
  observeStrong,
  posterior,
  resetFilter,
} from "./evidence-filter.js";

describe("sequential evidence filter", () => {
  it("keeps one weak reading mixed and upgrades after repeated independent readings", () => {
    let state = createFilter("amount:economic_compensation");
    state = observe(state, { outcomeId: "88000", llr: 0.8, round: 1, channel: "c1" });
    expect(decide(state, { minChannels: 2 }).kind).toBe("mixed");
    state = observe(state, { outcomeId: "88000", llr: 0.8, round: 2, channel: "c2" });
    expect(decide(state, { minChannels: 2 }).kind).toBe("mixed");
    state = observe(state, { outcomeId: "88000", llr: 0.8, round: 3, channel: "c3" });
    const decision = decide(state, { minChannels: 2 });
    expect(decision.kind).toBe("definite");
    if (decision.kind === "definite") {
      expect(decision.id).toBe("88000");
    }
  });

  it("does not treat the same channel repeated as independent evidence", () => {
    let state = createFilter("amount:wage");
    for (let round = 1; round <= 4; round += 1) {
      state = observe(state, { outcomeId: "15000", llr: 0.9, round, channel: "same-span" });
    }
    const decision = decide(state, { minChannels: 2 });
    expect(decision.kind).toBe("mixed");
    if (decision.kind === "mixed") {
      expect(decision.reason).toContain("独立通道不足");
    }
  });

  it("reports conflict when two readings stay within the margin", () => {
    let state = createFilter("clause:解除");
    state = observe(state, { outcomeId: "may_terminate", llr: 2, round: 1, channel: "c1" });
    state = observe(state, { outcomeId: "may_not", llr: 2, round: 1, channel: "c2" });
    const decision = decide(state);
    expect(decision.kind).toBe("conflict");
    if (decision.kind === "conflict") {
      expect(decision.ids).toEqual(["may_not", "may_terminate"]);
    }
  });

  it("decays old evidence instead of keeping a stale definite reading", () => {
    let state = createFilter("amount:wage");
    state = observe(state, { outcomeId: "88000", llr: 2, round: 1, channel: "c1" });
    expect(decide(state).kind).toBe("definite");
    state = observe(state, { outcomeId: "99000", llr: 0, round: 5, channel: "c2" }, { decay: 0.5 });
    const decision = decide(state);
    expect(decision.kind).toBe("mixed");
  });

  it("exposes a probability posterior for display only", () => {
    let state = createFilter("amount:wage");
    state = observe(state, { outcomeId: "a", llr: 1, round: 1, channel: "c1" });
    state = observe(state, { outcomeId: "b", llr: -1, round: 1, channel: "c2" });
    const probs = posterior(state);
    expect(Object.keys(probs).toSorted()).toEqual(["a", "b"]);
    const total = Object.values(probs).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(probs.a).toBeGreaterThan(probs.b ?? 0);
  });

  it("resets to a named reading without carrying old channel ids", () => {
    let state = createFilter("amount:wage");
    state = observe(state, { outcomeId: "a", llr: 3, round: 1, channel: "c1" });
    state = resetFilter(state, ["a"]);
    expect(state.logOdds).toEqual({ a: 0 });
    expect(state.channels).toEqual({ a: [] });
    expect(state.observations).toBe(0);
  });

  it("lets a strong tool result project in one observation", () => {
    let state = createFilter("amount:wage");
    state = observeStrong(state, { outcomeId: "88000", llr: 0, round: 1, channel: "calculate:1" });
    const decision = decide(state);
    expect(decision.kind).toBe("definite");
  });
});
