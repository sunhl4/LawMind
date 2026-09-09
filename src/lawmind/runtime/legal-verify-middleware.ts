/**
 * Post-tool legal verify — coach the model from existing tool results
 * without changing write/render/mail execute bodies.
 */

import type { ToolCallResult } from "../agent/types.js";
import { readDraft } from "../drafts/index.js";
import { draftTextFromUnknown, runLegalLint } from "../lint/run-lint.js";
import { runSelfRevise } from "../lint/self-revise.js";
import type { GateDecision } from "../platform/contracts.js";
import { withGateCategory } from "../platform/gate-category.js";
import { normalizeOutboundRecipient } from "../platform/lawyer-outbound-decision.js";
import { isPrivilegeSentinelEnabled, scanPrivilegeTip } from "../policy/privilege-sentinel.js";
import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
import {
  formatUnretrievedStatuteBody,
  looksLikeStatuteCitation,
  statuteTrialHappenedThisTurn,
} from "../research/research-protocol.js";
import {
  isAuthorityLive,
  WORKSPACE_HEURISTIC_SOURCE_TIER,
} from "../retrieval/authority-source-tier.js";
import type { ToolMiddleware } from "./tool-pipeline.js";

const OUTBOUND_PRECHECK_TOOLS = new Set(["prepare_outbound_mail"]);

const STATUTE_TRIAL_DELIVERABLES = new Set([
  "memo.research",
  "memo.opinion",
  "memo.internal",
  "contract.review",
]);

function deliverableNeedsStatuteTrial(deliverableType: string | undefined): boolean {
  if (!deliverableType) {
    return false;
  }
  if (STATUTE_TRIAL_DELIVERABLES.has(deliverableType)) {
    return true;
  }
  return (
    deliverableType.startsWith("letter.") ||
    deliverableType.startsWith("litigation.") ||
    deliverableType.startsWith("contract.")
  );
}

export function extractEmailDomain(address: string): string | undefined {
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) {
    return undefined;
  }
  const domain = trimmed
    .slice(at + 1)
    .replace(/[>)\],;]+$/g, "")
    .trim()
    .toLowerCase();
  return domain.includes(".") ? domain : undefined;
}

export function recipientDomainOutsideAllowlist(
  to: string,
  allowedDomains: readonly string[],
): boolean {
  if (allowedDomains.length === 0) {
    return false;
  }
  const domain = extractEmailDomain(to);
  if (!domain) {
    return false;
  }
  const allowed = new Set(allowedDomains.map((d) => d.trim().toLowerCase()).filter(Boolean));
  return !allowed.has(domain);
}

export function resolveOutboundAllowedDomains(workspaceDir: string): string[] {
  const policy = readWorkspacePolicyFile(workspaceDir);
  const raw = policy?.outboundAllowedDomains;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((d): d is string => typeof d === "string" && d.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function citationIntegrityFromResult(result: ToolCallResult):
  | {
      ok: boolean;
      missingSourceIds: string[];
    }
  | undefined {
  const data = asRecord(result.data);
  const raw = data?.citationIntegrity;
  const view = asRecord(raw);
  if (!view) {
    return undefined;
  }
  if (view.checked === false) {
    return undefined;
  }
  if (typeof view.ok !== "boolean") {
    return undefined;
  }
  const missing = Array.isArray(view.missingSourceIds)
    ? view.missingSourceIds.filter((id): id is string => typeof id === "string")
    : [];
  return { ok: view.ok, missingSourceIds: missing };
}

function mergeData(
  result: ToolCallResult,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return { ...asRecord(result.data), ...extra };
}

function attachAdvisoryLint(result: ToolCallResult): ToolCallResult {
  const data = asRecord(result.data);
  const text = draftTextFromUnknown(data ?? result.data);
  if (text.trim().length < 20) {
    return result;
  }
  const deliverableType =
    typeof data?.deliverableType === "string" ? data.deliverableType : undefined;
  const lintReport = runLegalLint(text, undefined, undefined, undefined, { deliverableType });
  const selfRevise = runSelfRevise(text, lintReport);
  return {
    ...result,
    data: mergeData(result, { lintReport, selfRevise }),
  };
}

function withGate(result: ToolCallResult, gate: GateDecision, message: string): ToolCallResult {
  const tagged = withGateCategory(gate);
  return {
    ...result,
    data: mergeData(result, {
      verify: { message, gate: tagged.gate },
      gateDecision: tagged,
    }),
    ...(result.ok ? {} : { error: result.error ?? message }),
  };
}

export function precheckOutboundMail(input: {
  toolName: string;
  args: Record<string, unknown>;
  privilegeEnabled: boolean;
  allowedOutboundDomains: readonly string[];
  pinnedTo?: string;
}): ToolCallResult | undefined {
  if (!OUTBOUND_PRECHECK_TOOLS.has(input.toolName)) {
    return undefined;
  }
  const to = typeof input.args.to === "string" ? input.args.to : "";
  const subject = typeof input.args.subject === "string" ? input.args.subject : "";
  const body = typeof input.args.body === "string" ? input.args.body : "";
  const pinnedTo = input.pinnedTo?.trim() ? normalizeOutboundRecipient(input.pinnedTo) : "";
  const actualTo = normalizeOutboundRecipient(to);
  if (pinnedTo && actualTo && actualTo !== pinnedTo) {
    const message = `收件人与短路径指定的 ${pinnedTo} 不一致。`;
    return {
      ok: false,
      error: message,
      data: {
        verify: { message, pinnedTo, actualTo },
        gateDecision: withGateCategory({
          gate: "outbound_recipient_gate",
          decision: "block",
          reason: message,
        }),
      },
    };
  }
  if (input.privilegeEnabled) {
    const tip = scanPrivilegeTip(`${subject}\n${body}`);
    if (tip?.level === "warn") {
      const message = "发前需确认：正文含特权/保密标记，请律师确认收件人与渠道后再拟发。";
      return {
        ok: false,
        error: message,
        data: {
          verify: { message, code: tip.code },
          gateDecision: withGateCategory({
            gate: "outbound_privilege_gate",
            decision: "awaiting_confirmation",
            reason: message,
          }),
        },
      };
    }
  }
  if (recipientDomainOutsideAllowlist(to, input.allowedOutboundDomains)) {
    const domain = extractEmailDomain(to) ?? to;
    const message = `发前需确认收件人：${domain} 不在本案允许域名内。`;
    return {
      ok: false,
      error: message,
      data: {
        verify: { message, domain },
        gateDecision: withGateCategory({
          gate: "outbound_recipient_gate",
          decision: "block",
          reason: message,
        }),
      },
    };
  }
  return undefined;
}

export function applyLegalVerifyToResult(
  toolName: string,
  result: ToolCallResult,
  opts?: {
    toolNameCallCounts?: Record<string, number>;
    wordRevisionTurn?: boolean;
    mailContractTurn?: boolean;
    workspaceDir?: string;
  },
): ToolCallResult {
  if (result.aborted || result.timedOut) {
    return result;
  }
  if (
    (toolName === "draft_document" ||
      toolName === "update_draft" ||
      toolName === "execute_workflow") &&
    result.ok
  ) {
    if (toolName === "draft_document" || toolName === "update_draft") {
      result = attachAdvisoryLint(result);
    }
    const integrity = citationIntegrityFromResult(result);
    if (
      integrity &&
      !integrity.ok &&
      (toolName === "draft_document" || toolName === "update_draft")
    ) {
      const message =
        integrity.missingSourceIds.length > 0
          ? `引用对不上来源：${integrity.missingSourceIds.slice(0, 4).join("、")} 不在本次检索结果中，请核对后再交签批。`
          : "引用对不上来源，请核对后再交签批。";
      return withGate(
        result,
        {
          gate: "citation_integrity_gate",
          decision: "block",
          reason: message,
          category: "judgment_soft",
        },
        message,
      );
    }
    const data = asRecord(result.data);
    const deliverableType =
      typeof data?.deliverableType === "string" ? data.deliverableType : undefined;
    const skipStatute = opts?.wordRevisionTurn === true || opts?.mailContractTurn === true;
    let statuteVerify: { message: string; unverified: true; statuteTrialMissing: true } | undefined;
    if (
      !skipStatute &&
      deliverableNeedsStatuteTrial(deliverableType) &&
      !statuteTrialHappenedThisTurn(opts?.toolNameCallCounts)
    ) {
      const preview = draftTextFromUnknown(data ?? result.data);
      const sectionPreviews = Array.isArray(data?.sections)
        ? data.sections
            .map((row) => {
              const rec = asRecord(row);
              return typeof rec?.bodyPreview === "string" ? rec.bodyPreview : "";
            })
            .join("\n")
        : "";
      let text = `${preview}\n${sectionPreviews}`;
      const taskId = typeof data?.taskId === "string" ? data.taskId : undefined;
      const workspaceDir = opts?.workspaceDir;
      if (taskId && workspaceDir) {
        try {
          const draft = readDraft(workspaceDir, taskId);
          if (draft?.sections?.length) {
            text = draft.sections.map((s) => s.body ?? "").join("\n");
          }
        } catch {
          /* soft path only */
        }
      }
      const citeLike =
        looksLikeStatuteCitation(text) ||
        /第\s*[0-9一二三四五六七八九十百]+\s*条/.test(text) ||
        deliverableType === "memo.research" ||
        deliverableType === "memo.opinion" ||
        deliverableType === "contract.review";
      if (citeLike) {
        statuteVerify = {
          message: formatUnretrievedStatuteBody(),
          unverified: true,
          statuteTrialMissing: true,
        };
      }
    }
    const needsHonesty =
      deliverableType === "document.general" ||
      deliverableType === "memo.opinion" ||
      deliverableType?.startsWith("letter.") === true ||
      deliverableType?.startsWith("litigation.") === true;
    if (
      (toolName === "draft_document" || toolName === "update_draft") &&
      needsHonesty &&
      !integrity &&
      !isAuthorityLive()
    ) {
      const message = "未接真源，仅供核对。请勿把本节引用写成已核实法条。";
      return {
        ...result,
        data: mergeData(result, {
          verify: statuteVerify
            ? {
                message: `${message} ${statuteVerify.message}`,
                unverified: true as const,
                statuteTrialMissing: true as const,
              }
            : { message, unverified: true },
        }),
      };
    }
    if (statuteVerify) {
      return {
        ...result,
        data: mergeData(result, { verify: statuteVerify }),
      };
    }
  }
  if ((toolName === "search_statute" || toolName === "search_case_law") && result.ok) {
    const data = asRecord(result.data);
    const live =
      data?.authorityLive === true || data?.authority === "live" || data?.sourceTier === "live";
    return {
      ...result,
      data: mergeData(result, {
        sourceTier: live ? "live" : WORKSPACE_HEURISTIC_SOURCE_TIER,
        authorityLive: live,
      }),
    };
  }
  if ((toolName === "render_document" || toolName === "render_tracked_draft") && !result.ok) {
    const data = asRecord(result.data);
    const gate = asRecord(data?.gateDecision);
    if (typeof gate?.gate === "string" && typeof result.error === "string" && result.error.trim()) {
      return {
        ...result,
        data: mergeData(result, { verify: { message: result.error } }),
      };
    }
  }
  return result;
}

export const legalVerifyMiddleware: ToolMiddleware = async (call, next) => {
  const policy = readWorkspacePolicyFile(call.ctx.workspaceDir);
  const blocked = precheckOutboundMail({
    toolName: call.toolName,
    args: call.args,
    privilegeEnabled: isPrivilegeSentinelEnabled({ policy }),
    allowedOutboundDomains: resolveOutboundAllowedDomains(call.ctx.workspaceDir),
    pinnedTo: call.ctx.outboundPinnedTo,
  });
  if (blocked) {
    return blocked;
  }
  const result = await next();
  return applyLegalVerifyToResult(call.toolName, result, {
    toolNameCallCounts: call.policy.toolNameCallCounts,
    wordRevisionTurn: call.ctx.wordRevisionTurn,
    mailContractTurn: call.ctx.mailContractTurn,
    workspaceDir: call.ctx.workspaceDir,
  });
};
