/**
 * Independent Guardian call — separate from the writer conversation.
 * Fail returns gaps as a tool result; the reviewer transcript stays in the sidecar.
 */

import { callModelWithRetry } from "../agent/runtime-model-call.js";
import type { AgentContext, AgentModelConfig } from "../agent/types.js";
import { resolveVerificationChecklistSpec } from "../deliverables/verification-checklist.js";
import { resolveDraftCitationIntegrity } from "../drafts/citation-resolve.js";
import { readReasoningSnapshot } from "../drafts/reasoning-snapshot.js";
import { readRedlinePlan } from "../drafts/redline-plan.js";
import type { RedlineHunk } from "../drafts/redline-proposal.js";
import { readResearchSnapshot } from "../drafts/research-snapshot.js";
import { resolveCapabilityEnvelope } from "../models/capability-envelope.js";
import {
  loadWordRevisionPack,
  resolveWordRevisionChecklist,
} from "../platform/word-revision-checklist.js";
import type { ArtifactDraft } from "../types.js";
import { hashGuardianEvidencePack, shouldReuseGuardianRecord } from "./evidence-hash.js";
import {
  buildGuardianEvidencePack,
  deterministicGuardianGaps,
  exhaustedGuardianRecord,
  formatGuardianEvidenceUserMessage,
  guardianSystemPrompt,
  isLegalGuardianEnabled,
  LEGAL_GUARDIAN_MAX_ROUNDS,
  nextGuardianRound,
  parseGuardianReviewerJson,
  slimGuardianView,
  type GuardianChecklistItem,
  type GuardianRecord,
} from "./legal-guardian.js";
import { persistGuardianRecord, readLatestGuardian } from "./store.js";

export type GuardianCaller = (input: { system: string; user: string }) => Promise<string>;

function hasUsableModel(model: AgentModelConfig | undefined): model is AgentModelConfig {
  return Boolean(model?.apiKey?.trim() && model.baseUrl?.trim() && model.model?.trim());
}

export async function defaultGuardianCaller(
  model: AgentModelConfig,
  input: { system: string; user: string },
  abortSignal?: AbortSignal,
): Promise<string> {
  const envelope = resolveCapabilityEnvelope({
    contextTokens: model.contextTokens,
    taskKind: "classify",
    maxTokensOverride: 800,
    timeoutMs: Math.min(45_000, model.timeoutMs ?? 60_000),
  });
  const response = await callModelWithRetry(
    {
      ...model,
      maxTokens: Math.min(800, envelope.maxOutputTokens),
      timeoutMs: envelope.modelTimeoutMs,
      temperature: 0,
      maxRetries: 0,
    },
    [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    [],
    { signal: abortSignal },
  );
  return String(response.choices?.[0]?.message?.content ?? "");
}

function skippedRecord(
  taskId: string,
  round: number,
  reason: string,
  evidencePackHash?: string,
): GuardianRecord {
  return {
    taskId,
    at: new Date().toISOString(),
    verdict: "skipped",
    round,
    maxRounds: LEGAL_GUARDIAN_MAX_ROUNDS,
    gaps: [],
    skipReason: reason,
    ...(evidencePackHash ? { evidencePackHash } : {}),
  };
}

function withEvidenceHash(record: GuardianRecord, hash: string): GuardianRecord {
  return { ...record, evidencePackHash: hash };
}

export async function runLegalGuardian(opts: {
  pack: ReturnType<typeof buildGuardianEvidencePack>;
  taskId: string;
  workspaceDir: string;
  model?: AgentModelConfig;
  callReviewer?: GuardianCaller;
  abortSignal?: AbortSignal;
}): Promise<GuardianRecord> {
  const prior = readLatestGuardian(opts.workspaceDir, opts.taskId);
  const packHash = hashGuardianEvidencePack(opts.pack);
  const round = nextGuardianRound(prior);

  if (!isLegalGuardianEnabled()) {
    const record = skippedRecord(opts.taskId, round, "disabled", packHash);
    persistGuardianRecord(opts.workspaceDir, record);
    return record;
  }

  if (shouldReuseGuardianRecord(prior, packHash)) {
    return {
      ...prior!,
      skipReason: prior?.skipReason ?? "unchanged_evidence",
    };
  }

  if (round > LEGAL_GUARDIAN_MAX_ROUNDS) {
    const record = withEvidenceHash(
      exhaustedGuardianRecord({
        taskId: opts.taskId,
        round,
        priorGaps: prior?.gaps,
      }),
      packHash,
    );
    persistGuardianRecord(opts.workspaceDir, record);
    return record;
  }

  const det = deterministicGuardianGaps(opts.pack);
  if (det.length > 0) {
    const record: GuardianRecord = {
      taskId: opts.taskId,
      at: new Date().toISOString(),
      verdict: "fail",
      round,
      maxRounds: LEGAL_GUARDIAN_MAX_ROUNDS,
      gaps: det,
      evidencePackHash: packHash,
    };
    persistGuardianRecord(opts.workspaceDir, record);
    return record;
  }

  const caller =
    opts.callReviewer ??
    (hasUsableModel(opts.model)
      ? (input: { system: string; user: string }) =>
          defaultGuardianCaller(opts.model!, input, opts.abortSignal)
      : undefined);
  if (!caller) {
    const record = skippedRecord(opts.taskId, round, "no_model", packHash);
    persistGuardianRecord(opts.workspaceDir, record);
    return record;
  }

  let raw = "";
  try {
    raw = await caller({
      system: guardianSystemPrompt(),
      user: formatGuardianEvidenceUserMessage(opts.pack),
    });
  } catch {
    const record: GuardianRecord = {
      taskId: opts.taskId,
      at: new Date().toISOString(),
      verdict: "fail",
      round,
      maxRounds: LEGAL_GUARDIAN_MAX_ROUNDS,
      skipReason: "reviewer_error",
      gaps: [
        {
          code: "guardian_error",
          message: "独立审稿调用失败。请重试交卷，不要回复已完成。",
        },
      ],
    };
    persistGuardianRecord(opts.workspaceDir, record);
    return record;
  }

  const parsed = parseGuardianReviewerJson(raw);
  if (!parsed) {
    const record: GuardianRecord = {
      taskId: opts.taskId,
      at: new Date().toISOString(),
      verdict: "fail",
      round,
      maxRounds: LEGAL_GUARDIAN_MAX_ROUNDS,
      skipReason: "unreadable",
      gaps: [
        {
          code: "guardian_unreadable",
          message: "独立审稿输出无法解析。请原样重交 render_tracked_draft，不要改审稿措辞。",
        },
      ],
      reviewerRaw: raw,
    };
    persistGuardianRecord(opts.workspaceDir, record);
    return record;
  }

  const record: GuardianRecord = {
    taskId: opts.taskId,
    at: new Date().toISOString(),
    verdict: parsed.verdict,
    round,
    maxRounds: LEGAL_GUARDIAN_MAX_ROUNDS,
    gaps: parsed.gaps,
    reviewerRaw: raw,
    evidencePackHash: packHash,
  };
  persistGuardianRecord(opts.workspaceDir, record);
  return record;
}

function checklistForDraft(
  draft: ArtifactDraft,
  workspaceDir: string,
  pins: AgentContext["contextPins"],
): { family?: string; stance?: string; items: GuardianChecklistItem[] } {
  const documentText = draft.sections.map((s) => s.body ?? "").join("\n");
  const resolved = resolveWordRevisionChecklist({
    instruction: [draft.title, draft.summary].filter(Boolean).join("\n"),
    pins,
    documentText,
  });
  if (!resolved.family) {
    return { items: [] };
  }
  const pack = loadWordRevisionPack(resolved.family, workspaceDir);
  const items: GuardianChecklistItem[] = pack.items.map((it) => {
    const edit =
      resolved.stance === "甲方" ? it.editA : resolved.stance === "乙方" ? it.editB : undefined;
    return {
      id: it.id,
      look: it.look,
      ...(edit ? { edit } : {}),
      stop: it.stop,
    };
  });
  return {
    family: pack.label,
    ...(resolved.stance ? { stance: resolved.stance } : {}),
    items,
  };
}

function checklistForDocument(draft: ArtifactDraft): {
  family?: string;
  items: GuardianChecklistItem[];
} {
  const spec = resolveVerificationChecklistSpec(draft.deliverableType);
  return {
    family: spec.id,
    items: spec.items
      .filter((it) => it.required)
      .slice(0, 16)
      .map((it) => ({
        id: it.id,
        look: it.label,
        stop: "正文未见覆盖且未缓办则 fail",
      })),
  };
}

export async function runLegalGuardianForDocument(opts: {
  workspaceDir: string;
  draft: ArtifactDraft;
  ctx: AgentContext;
  acceptanceReady?: boolean;
}): Promise<GuardianRecord> {
  const { draft, workspaceDir } = opts;
  const prior = readLatestGuardian(workspaceDir, draft.taskId);
  const citation = resolveDraftCitationIntegrity(workspaceDir, draft);
  const bundle = readResearchSnapshot(workspaceDir, draft.taskId);
  const graph = readReasoningSnapshot(workspaceDir, draft.taskId);
  const pack = buildGuardianEvidencePack({
    action: "render_document",
    draft,
    citation,
    bundle,
    graph,
    checklist: checklistForDocument(draft),
    confirmedAnswers: opts.ctx.confirmedAnswers,
    acceptanceReady: opts.acceptanceReady,
    prior: prior ? { round: prior.round, verdict: prior.verdict, gaps: prior.gaps } : null,
  });
  return runLegalGuardian({
    pack,
    taskId: draft.taskId,
    workspaceDir,
    model: opts.ctx.reviewModel,
    callReviewer: opts.ctx.guardianCaller,
    abortSignal: opts.ctx.abortSignal,
  });
}

export async function runLegalGuardianForTrackedDraft(opts: {
  workspaceDir: string;
  draft: ArtifactDraft;
  hunks: RedlineHunk[];
  allowEmptyRedline: boolean;
  ctx: AgentContext;
}): Promise<GuardianRecord> {
  const { draft, workspaceDir } = opts;
  const prior = readLatestGuardian(workspaceDir, draft.taskId);
  const citation = resolveDraftCitationIntegrity(workspaceDir, draft);
  const bundle = readResearchSnapshot(workspaceDir, draft.taskId);
  const plan = readRedlinePlan(workspaceDir, draft.taskId);
  const spanSkippedCount = plan?.skipped.filter((s) => s.reason.includes("跨度硬门禁")).length;
  const pack = buildGuardianEvidencePack({
    draft,
    hunks: opts.hunks,
    allowEmptyRedline: opts.allowEmptyRedline,
    citation,
    bundle,
    checklist: checklistForDraft(draft, workspaceDir, opts.ctx.contextPins),
    confirmedAnswers: opts.ctx.confirmedAnswers,
    writerDeferred: plan?.writerDeferred,
    spanSkippedCount,
    prior: prior ? { round: prior.round, verdict: prior.verdict, gaps: prior.gaps } : null,
  });
  return runLegalGuardian({
    pack,
    taskId: draft.taskId,
    workspaceDir,
    model: opts.ctx.reviewModel,
    callReviewer: opts.ctx.guardianCaller,
    abortSignal: opts.ctx.abortSignal,
  });
}

export { slimGuardianView };
