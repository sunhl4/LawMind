import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RETRIEVAL_ETA,
  RETRIEVAL_KEEP,
  RETRIEVAL_POOL_CAP,
  RETRIEVAL_ROUNDS,
  amplifyRetrievalCandidates,
  discreteAgreement,
  retrievalAgreement,
} from "./retrieval-amplify.js";

describe("§4.2 retrieval amplification", () => {
  it("uses three multiplicative rounds and does not claim a quadratic search", () => {
    expect(RETRIEVAL_ROUNDS).toBe(3);
    expect(RETRIEVAL_ETA).toBe(1);
    expect(RETRIEVAL_POOL_CAP).toBe(200);
    expect(RETRIEVAL_KEEP).toBe(20);
    const src = readFileSync(new URL("./retrieval-amplify.ts", import.meta.url), "utf8");
    expect(src).toContain("No quadratic speedup");
    expect(src).not.toMatch(/turn-orchestrator/);
  });

  it("snaps scores onto {-1, 0, +1}", () => {
    expect(discreteAgreement(1)).toBe(1);
    expect(discreteAgreement(-1)).toBe(-1);
    expect(discreteAgreement(0)).toBe(0);
    expect(discreteAgreement(0.5)).toBe(0);
    expect(discreteAgreement(Number.NaN)).toBe(0);
  });

  it("marks demo and a rejected amount as -1, and a pinned article or grounded amount as +1", () => {
    expect(retrievalAgreement({ demo: true, text: "《劳动合同法》第四十七条" })).toBe(-1);
    expect(
      retrievalAgreement({
        text: "经济补偿为 99999 元",
        groundedAmounts: ["88000"],
        rejectedAmounts: ["99999"],
      }),
    ).toBe(-1);
    expect(
      retrievalAgreement({
        text: "经济补偿为 88000 元，见第四十七条",
        groundedAmounts: ["88000"],
        rejectedAmounts: ["99999"],
      }),
    ).toBe(1);
    expect(retrievalAgreement({ text: "《劳动合同法》第四十七条" })).toBe(1);
    expect(retrievalAgreement({ text: "案号（2020）沪01民终1号" })).toBe(1);
    expect(retrievalAgreement({ text: "只有标题" })).toBe(0);
  });

  it("keeps input order when every score is zero", () => {
    const items = ["a", "b", "c"];
    expect(amplifyRetrievalCandidates(items, () => 0)).toEqual(items);
  });

  it("promotes a pinned hit past a block of demo rows and keeps only 20", () => {
    const demos = Array.from({ length: 20 }, (_, index) => ({
      id: `demo-${index}`,
      demo: true,
      text: "演示摘录",
    }));
    const live = { id: "live-47", demo: false, text: "《劳动合同法》第四十七条" };
    const ranked = amplifyRetrievalCandidates([...demos, live], (row) =>
      retrievalAgreement({ demo: row.demo, text: row.text }),
    );
    expect(ranked).toHaveLength(RETRIEVAL_KEEP);
    expect(ranked[0]?.id).toBe("live-47");
    expect(ranked.some((row) => row.id === "demo-19")).toBe(false);
    expect(ranked[1]?.id).toBe("demo-0");
  });

  it("ignores candidates past the pool cap of 200", () => {
    const rows = Array.from({ length: 210 }, (_, index) => ({
      id: `row-${index}`,
      text: index === 205 ? "《劳动合同法》第四十七条" : "标题",
    }));
    const ranked = amplifyRetrievalCandidates(rows, (row) =>
      retrievalAgreement({ text: row.text }),
    );
    expect(ranked.some((row) => row.id === "row-205")).toBe(false);
    expect(ranked[0]?.id).toBe("row-0");
  });

  it("sharpens a +1 ahead of 0 ahead of -1 after three exp steps", () => {
    const rows = [
      { id: "down", score: -1 },
      { id: "flat", score: 0 },
      { id: "up", score: 1 },
    ];
    const ranked = amplifyRetrievalCandidates(rows, (row) => row.score);
    expect(ranked.map((row) => row.id)).toEqual(["up", "flat", "down"]);
    const up = Math.exp(RETRIEVAL_ETA * RETRIEVAL_ROUNDS);
    const down = Math.exp(-RETRIEVAL_ETA * RETRIEVAL_ROUNDS);
    expect(up).toBeGreaterThan(1);
    expect(down).toBeLessThan(1);
  });
});
