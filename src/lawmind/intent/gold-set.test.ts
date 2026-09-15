import { describe, expect, it } from "vitest";
import { compileIntent } from "./compile-intent.js";
import { INTENT_GOLD_CASES, INTENT_GOLD_FATAL_PAIRS } from "./gold-set.js";

describe("intent gold set", () => {
  it("has at least 50 lawyer-shaped cases", () => {
    expect(INTENT_GOLD_CASES.length).toBeGreaterThanOrEqual(50);
  });

  it("matches expected capability (or unbound) on every case", () => {
    const failures: string[] = [];
    for (const row of INTENT_GOLD_CASES) {
      const compiled = compileIntent(row.input);
      if (row.unbound) {
        if (compiled.capabilityId) {
          failures.push(`${row.id}: expected unbound, got ${compiled.capabilityId}`);
        }
        continue;
      }
      if (compiled.capabilityId !== row.expect) {
        failures.push(
          `${row.id}: expected ${row.expect}, got ${compiled.capabilityId ?? "unbound"}`,
        );
      }
      if (row.pipeline === "tracked_redline" && compiled.pipelineOverride !== "tracked_redline") {
        failures.push(`${row.id}: expected tracked_redline`);
      }
      if (row.pipeline !== "tracked_redline" && compiled.pipelineOverride === "tracked_redline") {
        if (row.deliveryShape === "opinion_memo") {
          failures.push(`${row.id}: opinion memo must not lock tracked_redline`);
        }
      }
      if (row.deliveryShape && compiled.delivery.artifactShape !== row.deliveryShape) {
        failures.push(
          `${row.id}: delivery shape expected ${row.deliveryShape}, got ${compiled.delivery.artifactShape}`,
        );
      }
      if (row.deliveryPlace && compiled.delivery.outputPlace !== row.deliveryPlace) {
        failures.push(
          `${row.id}: delivery place expected ${row.deliveryPlace}, got ${compiled.delivery.outputPlace}`,
        );
      }
      if (compiled.softAsk) {
        failures.push(`${row.id}: compiler must not ask the lawyer to classify`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("does not silently invert the contract/litigation fatal pair", () => {
    for (const row of INTENT_GOLD_CASES) {
      if (!row.expect || row.unbound) {
        continue;
      }
      const compiled = compileIntent(row.input);
      for (const [a, b] of INTENT_GOLD_FATAL_PAIRS) {
        if (row.expect === a && compiled.capabilityId === b) {
          throw new Error(`${row.id}: fatal invert ${a}→${b}`);
        }
        if (row.expect === b && compiled.capabilityId === a) {
          throw new Error(`${row.id}: fatal invert ${b}→${a}`);
        }
      }
    }
  });

  it("records a chain when review and a demand letter are in one instruction", () => {
    const compiled = compileIntent({ instruction: "审查这份合同并写催告函" });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.chain).toContain("letter.draft");
  });
});
