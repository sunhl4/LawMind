/**
 * Node-only reasoning-graph sidecar check (reads drafts/<taskId>.reasoning.json).
 * Pure gate helpers live in reasoning-validator.ts so the desktop renderer can import them.
 */

import { readReasoningSnapshot } from "../drafts/reasoning-snapshot.js";
import type { ArtifactDraft } from "../types.js";
import {
  specRequiresReasoningGraphAtDraft,
  type ReasoningGraphAtDraftReport,
  type ValidateReasoningOptions,
} from "./reasoning-validator.js";
import { getDeliverableSpec } from "./registry.js";

export type { ReasoningGraphAtDraftReport } from "./reasoning-validator.js";

/**
 * 校验草稿是否满足「草稿阶段必须写入 reasoning graph」要求。
 * 与 render-time `validateReasoningAgainstSpec` 互补：此处只检查侧车是否存在。
 */
export function validateReasoningGraphAtDraft(
  draft: ArtifactDraft,
  workspaceDir: string,
  opts?: ValidateReasoningOptions,
): ReasoningGraphAtDraftReport {
  const spec = opts?.spec ?? getDeliverableSpec(draft.deliverableType);
  const required = specRequiresReasoningGraphAtDraft(spec);
  const graph = readReasoningSnapshot(workspaceDir, draft.taskId);
  const hasSnapshot = Boolean(graph) || draft.hasLegalReasoningSnapshot === true;

  return {
    taskId: draft.taskId,
    deliverableType: draft.deliverableType ?? spec?.type,
    required,
    ready: !required || hasSnapshot,
    hasSnapshot,
    hint:
      required && !hasSnapshot
        ? "高风控交付物须在草稿阶段生成 LegalReasoningGraph 侧车（drafts/<taskId>.reasoning.json）。"
        : undefined,
    generatedAt: new Date().toISOString(),
  };
}
