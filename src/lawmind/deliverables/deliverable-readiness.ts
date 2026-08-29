/**
 * One-glance deliverable readiness for lawyer UX.
 * Combines acceptance gate + verification checklist + citation integrity.
 */

import type { DraftCitationIntegrityView } from "../drafts/citation-integrity.js";
import { citationModeBlocksRender, type CitationMode } from "../policy/citation-mode.js";
import type { ArtifactDraft, LegalReasoningGraph } from "../types.js";
import { validateReasoningAgainstSpec } from "./reasoning-validator.js";
import { getDeliverableSpec } from "./registry.js";
import type { AcceptanceReport, ReasoningReport } from "./types.js";
import { validateDraftAgainstSpec } from "./validator.js";
import {
  buildChecklistView,
  type VerificationChecklistState,
  type VerificationChecklistView,
} from "./verification-checklist.js";

export type DeliverableReadinessBlocker = {
  code: "not_approved" | "acceptance" | "checklist" | "citation" | "review_pending" | "reasoning";
  message: string;
};

export type DeliverableReadiness = {
  readyToExport: boolean;
  readyToApprove: boolean;
  acceptance: AcceptanceReport;
  checklist: VerificationChecklistView;
  citationBlocks: boolean;
  blockers: DeliverableReadinessBlocker[];
  /** Short Chinese summary for delivery bar */
  summaryZh: string;
};

export function assessDeliverableReadiness(opts: {
  draft: ArtifactDraft;
  checklistState?: VerificationChecklistState | null;
  citationIntegrity?: DraftCitationIntegrityView | null;
  citationMode?: CitationMode;
  /** When true, missing/unanchored citations block export (edition citationGateStrict path). */
  citationGateStrict?: boolean;
  reasoningGraph?: LegalReasoningGraph;
  reasoningReport?: ReasoningReport | null;
}): DeliverableReadiness {
  const {
    draft,
    checklistState,
    citationIntegrity,
    citationMode = "assisted",
    citationGateStrict = false,
    reasoningGraph,
    reasoningReport,
  } = opts;

  const acceptance = validateDraftAgainstSpec(draft);
  const checklist = buildChecklistView(
    draft.deliverableType,
    checklistState ?? draft.verificationChecklist ?? null,
  );

  const citationBlocks =
    citationMode != null
      ? citationModeBlocksRender(citationMode, citationIntegrity)
      : Boolean(
          citationGateStrict &&
          citationIntegrity?.checked &&
          (!citationIntegrity.ok || citationIntegrity.unanchoredSections.length > 0),
        );

  const blockers: DeliverableReadinessBlocker[] = [];
  const status = draft.reviewStatus ?? "pending";

  if (status === "pending") {
    blockers.push({
      code: "review_pending",
      message: "尚未签批通过",
    });
  } else if (status !== "approved") {
    blockers.push({
      code: "not_approved",
      message: status === "rejected" ? "已驳回，需恢复后再导出" : "需修改后重新签批",
    });
  }

  if (!acceptance.ready) {
    blockers.push({
      code: "acceptance",
      message: `验收未过（${acceptance.blockerCount} 项阻塞）`,
    });
  }

  if (!checklist.complete) {
    blockers.push({
      code: "checklist",
      message: `必核未完成（${checklist.requiredDone}/${checklist.requiredTotal}）`,
    });
  }

  if (citationBlocks) {
    blockers.push({
      code: "citation",
      message: "引用未就绪（缺源或长段未锚定）",
    });
  }

  const spec = getDeliverableSpec(draft.deliverableType);
  let reasoningBlocks = false;
  if (spec?.reasoningGate?.required) {
    const report =
      reasoningReport ?? validateReasoningAgainstSpec(reasoningGraph, draft.deliverableType);
    if (report.blockerCount > 0 || !report.ready) {
      reasoningBlocks = true;
      blockers.push({
        code: "reasoning",
        message: "推理检查未过",
      });
    }
  }

  const readyToApprove = checklist.complete;
  const readyToExport =
    status === "approved" &&
    acceptance.ready &&
    checklist.complete &&
    !citationBlocks &&
    !reasoningBlocks;

  let summaryZh: string;
  if (readyToExport) {
    summaryZh = "可交付：签批、验收、必核与引用均已就绪";
  } else if (status === "pending" && !checklist.complete) {
    summaryZh = `待签批：先完成必核 ${checklist.requiredDone}/${checklist.requiredTotal}`;
  } else if (status === "pending") {
    summaryZh = acceptance.ready ? "待签批：必核已齐，可在「在办」通过" : "待签批：请先补齐验收项";
  } else if (status === "approved" && !acceptance.ready) {
    summaryZh = "已签批，但验收仍有阻塞——导出将受阻或需明示绕过";
  } else if (status === "approved" && citationBlocks) {
    summaryZh = "已签批，但引用未就绪——严格导出将被拦截";
  } else if (reasoningBlocks) {
    summaryZh = "推理检查未过";
  } else {
    summaryZh = blockers.map((b) => b.message).join("；") || "尚未就绪";
  }

  return {
    readyToExport,
    readyToApprove,
    acceptance,
    checklist,
    citationBlocks,
    blockers,
    summaryZh,
  };
}
