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
  };
}

export function parentGatesFromContext(input: {
  permissionMode?: AgentPermissionMode;
  matterId?: string;
  allowedToolNames?: string[];
  toolSandboxEnabled?: boolean;
}): ParentGates {
  return {
    permissionMode: input.permissionMode ?? "standard",
    ...(input.matterId?.trim() ? { matterId: input.matterId.trim() } : {}),
    ...(input.allowedToolNames && input.allowedToolNames.length > 0
      ? { allowedToolNames: [...input.allowedToolNames] }
      : {}),
    toolSandboxEnabled: input.toolSandboxEnabled === true,
  };
}
