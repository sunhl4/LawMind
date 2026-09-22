/**
 * Child sessions inherit the parent's tighter gates.
 * A child may be stricter than the parent, never looser.
 */

import type { AgentPermissionMode } from "./permission-mode.js";

export type ParentGates = {
  permissionMode: AgentPermissionMode;
  matterId?: string;
  allowedToolNames?: string[];
  toolSandboxEnabled: boolean;
  /** 父 turn 剩余工具预算（委派时刻快照）；子助手分片不得超出。 */
  remainingToolCallBudget?: number;
};

const PERMISSION_RANK: Record<AgentPermissionMode, number> = {
  readonly: 3,
  research: 2,
  strict: 1,
  standard: 0,
};

export function restrictPermissionMode(
  parent: AgentPermissionMode,
  child?: AgentPermissionMode,
): AgentPermissionMode {
  const next = child ?? "standard";
  return PERMISSION_RANK[parent] >= PERMISSION_RANK[next] ? parent : next;
}

export function intersectAllowedToolNames(
  parent?: string[],
  child?: string[],
): string[] | undefined {
  if (!parent || parent.length === 0) {
    return child && child.length > 0 ? [...child] : undefined;
  }
  if (!child || child.length === 0) {
    return [...parent];
  }
  const allow = new Set(parent);
  return child.filter((name) => allow.has(name));
}

export function inheritChildGates(opts: {
  parent: ParentGates;
  childPermissionMode?: AgentPermissionMode;
  childAllowedToolNames?: string[];
  childToolSandboxEnabled?: boolean;
}): ParentGates {
  return {
    permissionMode: restrictPermissionMode(opts.parent.permissionMode, opts.childPermissionMode),
    ...(opts.parent.matterId?.trim() ? { matterId: opts.parent.matterId.trim() } : {}),
    allowedToolNames: intersectAllowedToolNames(
      opts.parent.allowedToolNames,
      opts.childAllowedToolNames,
    ),
    toolSandboxEnabled: opts.parent.toolSandboxEnabled || opts.childToolSandboxEnabled === true,
    // 预算分片只缩不扩：子继承父剩余快照，自身配置上限在 resolveChildToolCallBudget 再收紧。
    ...(typeof opts.parent.remainingToolCallBudget === "number" &&
    Number.isFinite(opts.parent.remainingToolCallBudget)
      ? { remainingToolCallBudget: Math.max(0, Math.floor(opts.parent.remainingToolCallBudget)) }
      : {}),
  };
}

/**
 * 子助手工具预算分片：不超过父剩余预算，也不超过子自身配置上限（只缩不扩）。
 * 父剩余未知（非委派上下文）时保持子配置不变。分片下限 1：即使父预算见底，
 * 子助手也能至少给出文字回复（后续工具调用随即被 budget 中间件熔断）。
 */
export function resolveChildToolCallBudget(opts: {
  parentRemaining?: number;
  childConfigured?: number;
}): number | undefined {
  const { parentRemaining, childConfigured } = opts;
  const configured =
    typeof childConfigured === "number" && Number.isFinite(childConfigured) && childConfigured > 0
      ? Math.floor(childConfigured)
      : undefined;
  if (typeof parentRemaining !== "number" || !Number.isFinite(parentRemaining)) {
    return configured;
  }
  const shard = Math.max(1, Math.floor(parentRemaining));
  return configured === undefined ? shard : Math.min(configured, shard);
}

export function parentGatesFromContext(input: {
  permissionMode?: AgentPermissionMode;
  matterId?: string;
  allowedToolNames?: string[];
  toolSandboxEnabled?: boolean;
  remainingToolCallBudget?: number;
}): ParentGates {
  return {
    permissionMode: input.permissionMode ?? "standard",
    ...(input.matterId?.trim() ? { matterId: input.matterId.trim() } : {}),
    ...(input.allowedToolNames && input.allowedToolNames.length > 0
      ? { allowedToolNames: [...input.allowedToolNames] }
      : {}),
    toolSandboxEnabled: input.toolSandboxEnabled === true,
    ...(typeof input.remainingToolCallBudget === "number" &&
    Number.isFinite(input.remainingToolCallBudget)
      ? { remainingToolCallBudget: input.remainingToolCallBudget }
      : {}),
  };
}
