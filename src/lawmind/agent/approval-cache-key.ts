/**
 * Approval is action-shaped: tool + matter + canonical args.
 * Name-only template pre-approve must not cover hunk-shaped writes
 * or outbound recipient/attachments.
 */

import { normalizeOutboundRecipient } from "../platform/lawyer-outbound-decision.js";

/** Tools whose approval binds action content, not just the tool name. */
export const ARGS_BOUND_APPROVAL_TOOLS = new Set<string>([
  "apply_surgical_edits",
  "prepare_outbound_mail",
]);

export type ApprovalCacheKey = {
  tool: string;
  matterId: string;
  argsHash: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Deterministic JSON for hashing (sorted keys; arrays keep order). */
export function stableJson(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((k) => k !== "__approved" && value[k] !== undefined)
      .toSorted();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  }
  return "null";
}

function normalizeAttachmentPaths(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") {
      continue;
    }
    const path = item.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (path) {
      out.push(path);
    }
  }
  return out.toSorted();
}

function normalizeSurgicalEdits(raw: unknown): Array<{ find: string; replace: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Array<{ find: string; replace: string }> = [];
  for (const item of raw) {
    if (!isPlainObject(item)) {
      continue;
    }
    const find = typeof item.find === "string" ? item.find : "";
    const replace = typeof item.replace === "string" ? item.replace : "";
    out.push({ find, replace });
  }
  return out;
}

/**
 * Schema fields that bind the approval. Drops `__approved`, commentary, and
 * for apply_surgical_edits keeps task_id + find/replace hunks only.
 * prepare_outbound_mail binds recipient + attachment paths (not subject/body).
 */
export function canonicalApprovalArgs(
  toolName: string,
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const src = args ?? {};
  if (toolName === "apply_surgical_edits") {
    const taskId = typeof src.task_id === "string" ? src.task_id.trim() : "";
    const baseline =
      typeof src.contract_edit_baseline_path === "string"
        ? src.contract_edit_baseline_path.trim()
        : "";
    return {
      ...(taskId ? { task_id: taskId } : {}),
      ...(baseline ? { contract_edit_baseline_path: baseline } : {}),
      edits: normalizeSurgicalEdits(src.edits),
    };
  }
  if (toolName === "prepare_outbound_mail") {
    const to = typeof src.to === "string" ? normalizeOutboundRecipient(src.to) : "";
    return {
      ...(to ? { to } : {}),
      attachment_paths: normalizeAttachmentPaths(src.attachment_paths),
    };
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).toSorted()) {
    if (key === "__approved" || src[key] === undefined) {
      continue;
    }
    out[key] = src[key];
  }
  return out;
}

export function hashToolApprovalArgs(
  toolName: string,
  args: Record<string, unknown> | undefined,
): string {
  return stableJson(canonicalApprovalArgs(toolName, args));
}

export function buildApprovalCacheKey(opts: {
  toolName: string;
  matterId?: string;
  args: Record<string, unknown> | undefined;
}): ApprovalCacheKey {
  return {
    tool: opts.toolName,
    matterId: opts.matterId?.trim() || "",
    argsHash: hashToolApprovalArgs(opts.toolName, opts.args),
  };
}

export function approvalArgsMatch(
  toolName: string,
  expected: Record<string, unknown> | undefined,
  actual: Record<string, unknown> | undefined,
): boolean {
  return hashToolApprovalArgs(toolName, expected) === hashToolApprovalArgs(toolName, actual);
}

export type PreApprovalInjection = {
  inject: boolean;
  /** Lawyer/resume args to merge onto the model call when injecting. */
  mergedArgs?: Record<string, unknown>;
};

/**
 * Resume (name + optional edited args) still approves that exact next call.
 * Template name lists approve only when the tool is not args-bound, or when
 * `preApproveToolArgs` hashes to the same action as the model call.
 */
export function resolvePreApprovalInjection(opts: {
  toolName: string;
  modelArgs: Record<string, unknown>;
  preApproveToolName?: string;
  preApproveToolArgs?: Record<string, unknown>;
  preApproveToolNames?: string[];
}): PreApprovalInjection {
  const name = opts.toolName;
  if (opts.preApproveToolName && opts.preApproveToolName === name) {
    return {
      inject: true,
      ...(opts.preApproveToolArgs ? { mergedArgs: opts.preApproveToolArgs } : {}),
    };
  }
  if (!opts.preApproveToolNames?.includes(name)) {
    return { inject: false };
  }
  if (ARGS_BOUND_APPROVAL_TOOLS.has(name)) {
    if (
      !opts.preApproveToolArgs ||
      !approvalArgsMatch(name, opts.preApproveToolArgs, opts.modelArgs)
    ) {
      return { inject: false };
    }
  }
  return { inject: true };
}
