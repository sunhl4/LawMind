/**
 * Offline legal-compiler gate: lint rule floor + synthetic shadow recall.
 * Does not call the network. Empty LLM-review pairs must not enter the gate.
 */

import { scoreLlmReviewAgreement } from "../../src/lawmind/evaluation/llm-review.js";
import {
  BUILTIN_SHADOW_FIXTURES,
  runShadowReplay,
} from "../../src/lawmind/evaluation/shadow-replay.js";
import { LEGAL_LINT_RULES } from "../../src/lawmind/lint/rules.js";

const MIN_RULES = 20;
const MIN_SHADOW = 10;

function main(): void {
  const errors: string[] = [];
  if (LEGAL_LINT_RULES.length < MIN_RULES) {
    errors.push(`lint rules ${LEGAL_LINT_RULES.length} < ${MIN_RULES}`);
  }
  if (BUILTIN_SHADOW_FIXTURES.length < MIN_SHADOW) {
    errors.push(`shadow fixtures ${BUILTIN_SHADOW_FIXTURES.length} < ${MIN_SHADOW}`);
  }
  const shadow = runShadowReplay(BUILTIN_SHADOW_FIXTURES);
  if (shadow.summary.defectRecall !== 1) {
    errors.push(`shadow defectRecall ${String(shadow.summary.defectRecall)} !== 1`);
  }
  const llm = scoreLlmReviewAgreement([], []);
  if (llm.cases === 0 && llm.agreement >= 0.8) {
    errors.push("empty LLM-review pair must not pass the 80% gate");
  }
  if (errors.length > 0) {
    console.error(`legal compiler gate failed:\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }
  console.log(
    `legal compiler lint-regression gate pass: rules=${LEGAL_LINT_RULES.length} shadows=${BUILTIN_SHADOW_FIXTURES.length} plantedRecall=1 llm=${llm.reportZh}`,
  );
}

main();
