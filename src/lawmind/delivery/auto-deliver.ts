/**
 * Internal low-risk auto-deliver. Outbound / high / missing lint-escape never unlocks.
 */

import { draftTextFromUnknown, runLegalLint } from "../lint/run-lint.js";
import { buildNorthStarSnapshot } from "../metrics/north-star.js";
import { appendProductMetric } from "../metrics/product-metrics.js";
import { recordLintRunEvent } from "../metrics/runtime-events.js";
import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
import type { ArtifactDraft } from "../types.js";
import {
  isAutonomyUnlocked,
  resolveProgressiveAutonomyThresholds,
} from "./progressive-autonomy.js";
import { resolveDeliveryTier, resolveFirmForceFullReview } from "./resolve-delivery-tier.js";
import type { DeliveryRiskLevel } from "./types.js";

const OUTBOUND_AUDIENCE = /客户|对方|法院|仲裁|外发|client|court/i;
const OUTBOUND_TYPE = /^(letter\.|email\.|mail\.)/;

export function isOutboundDraft(
  draft: Pick<ArtifactDraft, "audience" | "deliverableType">,
): boolean {
  if (OUTBOUND_AUDIENCE.test(draft.audience ?? "")) {
    return true;
  }
  return OUTBOUND_TYPE.test(draft.deliverableType ?? "");
}

export function evaluateAutoDeliver(input: {
  workspaceDir: string;
  draft: ArtifactDraft;
  riskLevel?: DeliveryRiskLevel;
}): { tier: ReturnType<typeof resolveDeliveryTier>; shouldAutoDeliver: boolean } {
  const policy = readWorkspacePolicyFile(input.workspaceDir);
  const north = buildNorthStarSnapshot(input.workspaceDir);
  const thresholds = resolveProgressiveAutonomyThresholds(policy);
  const firstPassSamples = north.samples.firstPassOk + north.samples.firstPassFail;
  // 北极星 v2 口径：lintEscapeRate 为 null ⟺ 已交付样本为 0 —— 空样本不得解锁自动交付。
  const unlocked = isAutonomyUnlocked({
    firstPassRate: north.firstPassRate,
    firstPassSamples,
    lintEscapeRate: north.lintEscapeRate,
    lintEscapeSamples: north.lintEscapeRate == null ? null : north.samples.deliveries,
    ...thresholds,
  });
  const outbound = isOutboundDraft(input.draft);
  const riskLevel = input.riskLevel ?? "medium";
  const tier = resolveDeliveryTier({
    riskLevel,
    audience: input.draft.audience,
    outbound,
    edition: policy?.edition,
    autonomyUnlocked: unlocked,
    firmForceFullReview: resolveFirmForceFullReview(policy),
  });
  if (tier !== "auto_deliver" || outbound) {
    return { tier, shouldAutoDeliver: false };
  }
  const text = draftTextFromUnknown(input.draft);
  const lint = runLegalLint(text, undefined, undefined, undefined, {
    deliverableType: input.draft.deliverableType,
  });
  recordLintRunEvent(input.workspaceDir, {
    taskId: input.draft.taskId,
    matterId: input.draft.matterId,
    deliverableType: input.draft.deliverableType,
    ruleIds: lint.findings.map((f) => f.ruleId),
    failCount: lint.blockerCount + lint.warningCount,
    blockerCount: lint.blockerCount,
    warningCount: lint.warningCount,
  });
  return { tier, shouldAutoDeliver: lint.blockerCount === 0 && lint.warningCount === 0 };
}

export function recordDeliveryAutonomy(
  workspaceDir: string,
  draft: ArtifactDraft,
  outcome: "unattended" | "attended",
): void {
  try {
    appendProductMetric(workspaceDir, {
      kind: "delivery_autonomy",
      outcome,
      taskId: draft.taskId,
      matterId: draft.matterId,
      deliverableType: draft.deliverableType,
    });
  } catch {
    /* metrics must not block draft persist */
  }
}
