import { describe, expect, it } from "vitest";
import { compileIntent } from "./compile-intent.js";
import { INTENT_GOLD_CASES, INTENT_GOLD_FATAL_PAIRS } from "./gold-set.js";
import { compiledIntentInjectsSkillBodies } from "./understand-first.js";

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

  it("look-only and continue gold cases do not inject Skill bodies", () => {
    const softIds = new Set([
      "vague-plus-contract-file",
      "look-plus-complaint-file",
      "process-plus-letter-file",
      "talk-file",
      "invoice-file-only",
      "summons-file",
      "privacy-file",
      "greeting-plus-contract",
      "continue-keeps-review",
      "matter-litigation-vague-evidence",
      "review-nl",
      "review-short",
      "letter-nl",
      "reject-review-check-letter",
      "letter-qa-plus-letter-file",
      "quick",
    ]);
    const failures: string[] = [];
    for (const row of INTENT_GOLD_CASES) {
      if (!softIds.has(row.id)) {
        continue;
      }
      const compiled = compileIntent(row.input);
      if (compiledIntentInjectsSkillBodies(compiled)) {
        failures.push(`${row.id}: unexpected Skill dump from ${compiled.source}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("hard nails still inject Skill bodies", () => {
    const hardIds = [
      "skill-dollar-override",
      "mail-short",
      "word-file-page",
      "lock-letter",
      "word-revise-complaint",
      "true-contract-review-file",
      "labor",
    ];
    const failures: string[] = [];
    for (const id of hardIds) {
      const row = INTENT_GOLD_CASES.find((r) => r.id === id);
      if (!row) {
        failures.push(`${id}: missing gold case`);
        continue;
      }
      const compiled = compileIntent(row.input);
      if (!compiledIntentInjectsSkillBodies(compiled)) {
        failures.push(`${id}: expected Skill dump, got ${compiled.source}/${compiled.confidence}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
