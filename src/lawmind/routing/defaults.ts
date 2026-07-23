/**
 * Default task routing — kind / deliverableType → role or assistant.
 * Persists under workspace/lawmind/routing/defaults.json
 */

import fs from "node:fs";
import path from "node:path";
import { findAssistantsByRole } from "../agent/tools/coordination/utils.js";
import { emit } from "../audit/index.js";
import { isFeatureEnabled } from "../policy/edition.js";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";

export const ROUTING_DEFAULTS_VERSION = 1 as const;

export type RoutingAssigneeRef = {
  roleId?: string;
  assistantId?: string;
};

export type RoutingDefaultsV1 = {
  version: typeof ROUTING_DEFAULTS_VERSION;
  /**
   * null/omit = inherit edition feature `forcePeerReview`;
   * true/false = workspace override.
   */
  forcePeerReview?: boolean | null;
  byKind?: Record<string, RoutingAssigneeRef>;
  byDeliverableType?: Record<string, RoutingAssigneeRef>;
};

const REL = path.join("lawmind", "routing", "defaults.json");

export function routingDefaultsPath(workspaceDir: string): string {
  return path.join(workspaceDir, REL);
}

export function emptyRoutingDefaults(): RoutingDefaultsV1 {
  return {
    version: 1,
    forcePeerReview: null,
    byKind: {
      "draft.word": { roleId: "contract_review" },
      "contract.review": { roleId: "contract_review" },
    },
    byDeliverableType: {
      "contract.review": { roleId: "contract_review" },
    },
  };
}

export function loadRoutingDefaults(workspaceDir: string): RoutingDefaultsV1 {
  const p = routingDefaultsPath(workspaceDir);
  try {
    if (!fs.existsSync(p)) {
      return emptyRoutingDefaults();
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<RoutingDefaultsV1>;
    if (raw?.version !== 1) {
      return emptyRoutingDefaults();
    }
    return {
      version: 1,
      forcePeerReview:
        raw.forcePeerReview === true || raw.forcePeerReview === false ? raw.forcePeerReview : null,
      byKind: typeof raw.byKind === "object" && raw.byKind ? raw.byKind : {},
      byDeliverableType:
        typeof raw.byDeliverableType === "object" && raw.byDeliverableType
          ? raw.byDeliverableType
          : {},
    };
  } catch {
    return emptyRoutingDefaults();
  }
}

export function saveRoutingDefaults(
  workspaceDir: string,
  next: RoutingDefaultsV1,
): RoutingDefaultsV1 {
  const normalized: RoutingDefaultsV1 = {
    version: 1,
    forcePeerReview:
      next.forcePeerReview === true || next.forcePeerReview === false ? next.forcePeerReview : null,
    byKind: next.byKind ?? {},
    byDeliverableType: next.byDeliverableType ?? {},
  };
  const p = routingDefaultsPath(workspaceDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export type ResolveDefaultAssigneeInput = {
  workspaceDir: string;
  kind?: string;
  deliverableType?: string;
  /** Chat / caller explicit pick wins */
  explicitAssistantId?: string;
  /** Shell current assistant fallback */
  fallbackAssistantId?: string;
  envFile?: string;
  auditDir?: string;
  taskId?: string;
};

export type ResolveDefaultAssigneeResult = {
  assistantId?: string;
  roleId?: string;
  source: "explicit" | "assistantId" | "roleId" | "fallback" | "none";
};

function pickFromRef(
  workspaceDir: string,
  ref: RoutingAssigneeRef | undefined,
  envFile?: string,
): { assistantId?: string; roleId?: string; source: "assistantId" | "roleId" } | undefined {
  if (!ref) {
    return undefined;
  }
  const assistantId = ref.assistantId?.trim();
  if (assistantId) {
    return { assistantId, roleId: ref.roleId?.trim() || undefined, source: "assistantId" };
  }
  const roleId = ref.roleId?.trim();
  if (!roleId) {
    return undefined;
  }
  const candidates = findAssistantsByRole(workspaceDir, roleId, envFile);
  if (candidates.length === 0) {
    return { roleId, source: "roleId" };
  }
  return { assistantId: candidates[0].assistantId, roleId, source: "roleId" };
}

export function resolveDefaultAssignee(
  input: ResolveDefaultAssigneeInput,
): ResolveDefaultAssigneeResult {
  const explicit = input.explicitAssistantId?.trim();
  if (explicit) {
    return { assistantId: explicit, source: "explicit" };
  }

  const defaults = loadRoutingDefaults(input.workspaceDir);
  const kind = input.kind?.trim();
  const deliverableType = input.deliverableType?.trim();

  const fromKind = kind
    ? pickFromRef(input.workspaceDir, defaults.byKind?.[kind], input.envFile)
    : undefined;
  const fromDeliverable =
    !fromKind?.assistantId && deliverableType
      ? pickFromRef(
          input.workspaceDir,
          defaults.byDeliverableType?.[deliverableType],
          input.envFile,
        )
      : undefined;
  const picked = fromKind?.assistantId ? fromKind : (fromDeliverable ?? fromKind);

  if (picked?.assistantId) {
    if (input.auditDir) {
      void emit(input.auditDir, {
        taskId: input.taskId ?? "system",
        kind: "routing.resolve_ok",
        actor: "system",
        detail: JSON.stringify({
          assistantId: picked.assistantId,
          roleId: picked.roleId,
          source: picked.source,
          kind,
          deliverableType,
        }),
      }).catch(() => {});
    }
    return {
      assistantId: picked.assistantId,
      roleId: picked.roleId,
      source: picked.source,
    };
  }

  const fallback = input.fallbackAssistantId?.trim();
  if (fallback) {
    if (picked?.roleId && input.auditDir) {
      void emit(input.auditDir, {
        taskId: input.taskId ?? "system",
        kind: "routing.resolve_fallback",
        actor: "system",
        detail: JSON.stringify({
          roleId: picked.roleId,
          kind,
          deliverableType,
          fallback,
          reason: "no_assistant_for_role",
        }),
      }).catch(() => {});
    }
    return { assistantId: fallback, roleId: picked?.roleId, source: "fallback" };
  }

  if (input.auditDir) {
    void emit(input.auditDir, {
      taskId: input.taskId ?? "system",
      kind: "routing.resolve_failed",
      actor: "system",
      detail: JSON.stringify({ kind, deliverableType, roleId: picked?.roleId }),
    }).catch(() => {});
  }
  return { roleId: picked?.roleId, source: "none" };
}

export function effectiveForcePeerReview(opts: {
  workspaceDir: string;
  policy?: LawMindWorkspacePolicy | null;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const defaults = loadRoutingDefaults(opts.workspaceDir);
  if (defaults.forcePeerReview === true) {
    return true;
  }
  if (defaults.forcePeerReview === false) {
    return false;
  }
  return isFeatureEnabled("forcePeerReview", { policy: opts.policy, env: opts.env });
}
