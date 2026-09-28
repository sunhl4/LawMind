/**
 * Independent Guardian call — separate from the writer conversation.
 * Fail returns gaps as a tool result; the reviewer transcript stays in the sidecar.
 */

import {
  assistantOutputLooksTruncated,
  extractAssistantText,
  shouldResampleSidecarJson,
} from "../agent/assistant-text.js";
import { callModelWithRetry, ModelCallUserAbortError } from "../agent/runtime-model-call.js";
import type { AgentContext, AgentModelConfig } from "../agent/types.js";
import { resolveVerificationChecklistSpec } from "../deliverables/verification-checklist.js";
import { resolveDraftCitationIntegrity } from "../drafts/citation-resolve.js";
import { readReasoningSnapshot } from "../drafts/reasoning-snapshot.js";
import { readRedlinePlan } from "../drafts/redline-plan.js";
import type { RedlineHunk } from "../drafts/redline-proposal.js";
import { readResearchSnapshot } from "../drafts/research-snapshot.js";
import {
  modelAttemptBudget,
  shouldRetryTransportFailure,
  waitModelRetry,
} from "../llm/http-retry.js";
import { resolveClassifySidecarLimits } from "../models/capability-envelope.js";
import {
  loadWordRevisionPack,
  resolveWordRevisionChecklist,
} from "../platform/word-revision-checklist.js";
import {
  effectiveTier,
  isLawyerEscalationAvailable,
  resolveDisabledVerifiers,
  resolveJudgmentTieringMode,
  shouldRunMachineStage,
  machineVerdictsAffectOutcome,
} from "../policy/judgment-tiering.js";
import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import type { ArtifactDraft } from "../types.js";
import { hashGuardianEvidencePack, shouldReuseGuardianRecord } from "./evidence-hash.js";
import { ITEM_JUDGMENTS } from "./item-judgments.js";
import { appendGuardianItemOutcomes, type GuardianItemOutcome } from "./item-outcome.js";
import {
  resolveJudgmentTier,
  wordRevisionKey,
  verificationKey,
  type JudgmentEscalationItem,
  type JudgmentTier,
} from "./judgment-tier.js";
import {
  aggregateMachineOnly,
  buildGuardianEvidencePack,
  deterministicGuardianGaps,
  exhaustedGuardianRecord,
  formatGuardianEvidenceUserMessage,
  guardianExpectedItemIds,
  guardianSystemPrompt,
  isLegalGuardianEnabled,
  LEGAL_GUARDIAN_MAX_ROUNDS,
  nextGuardianRound,
  parseGuardianItemVerdicts,
  parseGuardianReviewerJson,
  parseGuardianVerdict,
  slimGuardianView,
  type GuardianChecklistItem,
  type GuardianItemVerdict,
  type GuardianMachineVerdict,
  type GuardianRecord,
} from "./legal-guardian.js";
import {
  buildMachineVerifyContext,
  runMachineVerifiers,
  hasMachineVerifier,
} from "./machine-verifiers.js";
import { persistGuardianRecord, readLatestGuardian } from "./store.js";

export type GuardianReviewerDraw = {
  text: string;
  truncated?: boolean;
};

export type GuardianCaller = (input: {
  system: string;
  user: string;
}) => Promise<string | GuardianReviewerDraw>;

function asReviewerDraw(raw: string | GuardianReviewerDraw): {
  text: string;
  truncated: boolean;
} {
  if (typeof raw === "string") {
    return { text: raw, truncated: false };
  }
  return { text: raw.text, truncated: Boolean(raw.truncated) };
}

function shouldRetryGuardianWithoutJsonMode(err: unknown): boolean {
  if (err instanceof ModelCallUserAbortError) {
    return false;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /\b400\b/.test(msg) || /response_format|json_object/i.test(msg);
}

function hasUsableModel(model: AgentModelConfig | undefined): model is AgentModelConfig {
  return Boolean(model?.apiKey?.trim() && model.baseUrl?.trim() && model.model?.trim());
}

export async function defaultGuardianCaller(
  model: AgentModelConfig,
  input: { system: string; user: string },
  abortSignal?: AbortSignal,
): Promise<GuardianReviewerDraw> {
  const limits = resolveClassifySidecarLimits({
    contextTokens: model.contextTokens,
    timeoutMs: model.timeoutMs,
  });
  const messages = [
    { role: "system" as const, content: input.system },
    { role: "user" as const, content: input.user },
  ];
  const invoke = async (jsonMode: boolean): Promise<GuardianReviewerDraw> => {
    const response = await callModelWithRetry(
      {
        ...model,
        maxTokens: limits.maxTokens,
        timeoutMs: limits.timeoutMs,
        temperature: limits.temperature,
        // One budget lives in runLegalGuardian (transport + EMPTY_RESPONSE).
        maxRetries: 0,
        ...(jsonMode ? { responseFormat: { type: "json_object" as const } } : {}),
      },
      messages,
      [],
      { signal: abortSignal },
    );
    const view = extractAssistantText(response);
    return { text: view.text, truncated: assistantOutputLooksTruncated(view) };
  };
  try {
    return await invoke(true);
  } catch (err) {
    if (shouldRetryGuardianWithoutJsonMode(err)) {
      return await invoke(false);
    }
    throw err;
  }
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

/**
 * G3：把「需律师定夺」的主观项挂到记录上。
 *
 * **只在非空时挂**——避免在 sidecar 里留一个恒为空的字段（本仓批评的"哑字段"）。
 */
function withEscalationItems(
  record: GuardianRecord,
  items: readonly JudgmentEscalationItem[] | undefined,
): GuardianRecord {
  const rows = (items ?? []).filter((i) => i.label.trim().length > 0);
  if (rows.length === 0) {
    return record;
  }
  return {
    ...record,
    escalationItems: rows.map((i) => ({
      itemKey: i.itemKey,
      label: i.label,
      reason: i.reason,
    })),
  };
}

/**
 * G2：把逐项判定结果落盘，喂给 `delivery/judgement-ratchet.ts`。
 *
 * 在此之前那个棘轮**没有任何生产调用方**——它的输入 `firedByTask` 无人产出，
 * `itemVerdicts` 算完就丢。本函数补的就是这一段。
 *
 * 口径：
 *   - machine 项按**验证器结论**落盘（`decidedBy: "machine"`）；
 *   - 模型回答过的项落 `decidedBy: "model"`；
 *   - 模型**没有回答**的判定项落 `supported: null`（不是 false——「没判出来」
 *     与「判未覆盖」必须区分，否则会污染棘轮的误报率）；
 *   - lawyer 项落 `supported: null` + `decidedBy: "lawyer"`（它本就不判）。
 */
function persistItemOutcomes(input: {
  workspaceDir: string;
  taskId: string;
  matterId?: string;
  pack: ReturnType<typeof buildGuardianEvidencePack>;
  machine?: {
    verdicts: readonly GuardianMachineVerdict[];
    itemTiers?: ReadonlyMap<string, JudgmentTier>;
    itemKeyById?: ReadonlyMap<string, string>;
  };
  itemVerdicts?: readonly GuardianItemVerdict[];
  tierConflicts?: readonly string[];
}): void {
  const tiers = input.machine?.itemTiers;
  const keyById = input.machine?.itemKeyById;
  const conflicts = new Set(input.tierConflicts ?? []);
  const ts = new Date().toISOString();
  const common = {
    ts,
    taskId: input.taskId,
    ...(input.matterId ? { matterId: input.matterId } : {}),
    ...(input.pack.deliverableType ? { deliverableType: input.pack.deliverableType } : {}),
    ...(input.pack.checklist.family ? { familyId: input.pack.checklist.family } : {}),
  };
  const rows: GuardianItemOutcome[] = [];

  for (const mv of input.machine?.verdicts ?? []) {
    rows.push({
      ...common,
      itemKey: mv.itemId,
      tier: "machine",
      decidedBy: "machine",
      supported: mv.supported,
      ...(mv.status === "unavailable" ? { unavailable: true } : {}),
      ...(conflicts.has(mv.itemId) ? { conflict: true } : {}),
    });
  }

  const answered = new Map<string, boolean>();
  for (const row of input.itemVerdicts ?? []) {
    const key = keyById?.get(row.id) ?? row.id;
    answered.set(key, row.supported);
    const tier = tiers?.get(key) ?? "judge";
    rows.push({
      ...common,
      itemKey: key,
      tier,
      decidedBy: "model",
      supported: row.supported,
      ...(conflicts.has(key) ? { conflict: true } : {}),
    });
  }

  // 清单里存在、但模型**没有回答**的项 —— 记 `null`（不是 false）。
  for (const item of input.pack.checklist.items) {
    const key = keyById?.get(item.id) ?? item.id;
    if (answered.has(key) || (input.machine?.verdicts ?? []).some((v) => v.itemId === key)) {
      continue;
    }
    const tier = tiers?.get(key) ?? item.tier ?? "judge";
    if (tier === "lawyer") {
      rows.push({ ...common, itemKey: key, tier, decidedBy: "lawyer", supported: null });
      continue;
    }
    rows.push({ ...common, itemKey: key, tier, decidedBy: "model", supported: null });
  }

  appendGuardianItemOutcomes(input.workspaceDir, rows);
}

export async function runLegalGuardian(opts: {
  pack: ReturnType<typeof buildGuardianEvidencePack>;
  taskId: string;
  workspaceDir: string;
  model?: AgentModelConfig;
  callReviewer?: GuardianCaller;
  abortSignal?: AbortSignal;
  /** G0：machine 段结论（由调用方跑完验证器后传入）。 */
  machine?: {
    verdicts: readonly GuardianMachineVerdict[];
    affectsOutcome: boolean;
    /** G2：判定表键 → 生效判定主体（落盘逐项结果用）。 */
    itemTiers?: ReadonlyMap<string, JudgmentTier>;
    /** G2：包内条项 id → 判定表键。 */
    itemKeyById?: ReadonlyMap<string, string>;
    /** G3：被移出提示词、需律师定夺的主观项。 */
    escalationItems?: readonly JudgmentEscalationItem[];
  };
  /** G2：案件 id（落盘逐项结果用；证据包里没有这个字段）。 */
  matterId?: string;
}): Promise<GuardianRecord> {
  const prior = readLatestGuardian(opts.workspaceDir, opts.taskId);
  const packHash = hashGuardianEvidencePack(opts.pack);
  const round = nextGuardianRound(prior);
  const machine = opts.machine ?? { verdicts: [], affectsOutcome: false };

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

  // P2.2：把检查单项 id 交给解析器——模型必须逐项回答，verdict 由代码聚合。
  const expectedItemIds = guardianExpectedItemIds(opts.pack);

  /**
   * G0：没有 judge 项可问时（全部落 machine / lawyer），**不调模型**直接聚合。
   *
   * 这是 `on` 模式的正常路径，不是降级：`expectedItemIds` 为空且已有 machine 结论时，
   * 结论完全由确定性判定给出——这正是「机械项零模型调用」的收益兑现点。
   */
  if (expectedItemIds.length === 0 && machine.verdicts.length > 0) {
    const aggregate = aggregateMachineOnly({
      machineVerdicts: machine.verdicts,
      affectsOutcome: machine.affectsOutcome,
    });
    // G2：逐项结果落盘（machine 段）——喂给交付侧棘轮。
    persistItemOutcomes({
      workspaceDir: opts.workspaceDir,
      taskId: opts.taskId,
      ...(opts.matterId ? { matterId: opts.matterId } : {}),
      pack: opts.pack,
      machine,
      itemVerdicts: aggregate.itemVerdicts,
      tierConflicts: aggregate.tierConflicts,
    });
    const record: GuardianRecord = {
      taskId: opts.taskId,
      at: new Date().toISOString(),
      verdict: aggregate.verdict,
      round,
      maxRounds: LEGAL_GUARDIAN_MAX_ROUNDS,
      gaps: aggregate.gaps,
      evidencePackHash: packHash,
    };
    persistGuardianRecord(opts.workspaceDir, withEscalationItems(record, machine.escalationItems));
    return record;
  }

  if (!caller) {
    const record = skippedRecord(opts.taskId, round, "no_model", packHash);
    persistGuardianRecord(opts.workspaceDir, record);
    return record;
  }

  const parseCtx =
    opts.pack.action === "render_tracked_draft" ? { trackedRedline: true as const } : undefined;
  let raw = "";
  let parsed: ReturnType<typeof parseGuardianVerdict> | undefined;
  /** G2：保留完整聚合结果（含 `itemVerdicts` / `tierConflicts`）用于落盘。 */
  let aggregate: ReturnType<typeof parseGuardianItemVerdicts> | undefined;
  let callFailed = false;
  const attempts = modelAttemptBudget();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let truncated = false;
    try {
      const draw = asReviewerDraw(
        await caller({
          system: guardianSystemPrompt(parseCtx),
          user: formatGuardianEvidenceUserMessage(opts.pack),
        }),
      );
      raw = draw.text;
      truncated = draw.truncated;
      callFailed = false;
    } catch (err) {
      if (err instanceof ModelCallUserAbortError) {
        throw err;
      }
      // TRANSPORT and EMPTY_RESPONSE share modelAttemptBudget (DeepSeek harness).
      callFailed = true;
      if (
        attempt + 1 < attempts &&
        shouldRetryTransportFailure(err, { signal: opts.abortSignal })
      ) {
        await waitModelRetry(attempt);
        continue;
      }
      break;
    }
    // 先取逐项形状（拿得到 itemVerdicts 才有逐项数据可落盘）；再回退旧形状。
    aggregate = parseGuardianItemVerdicts(raw, expectedItemIds, machine, parseCtx);
    parsed = aggregate ?? parseGuardianReviewerJson(raw, parseCtx);
    if (
      !shouldResampleSidecarJson({
        parsed: Boolean(parsed),
        truncated,
        attempt,
        attempts,
      })
    ) {
      break;
    }
    parsed = undefined;
    aggregate = undefined;
    await waitModelRetry(attempt);
  }

  if (!parsed && machine.verdicts.length > 0 && machine.affectsOutcome) {
    // 模型读不出时，machine 结论仍然有效——不得因为模型故障把机械核对结果一起丢掉。
    const machineAggregate = aggregateMachineOnly({
      machineVerdicts: machine.verdicts,
      affectsOutcome: true,
    });
    if (machineAggregate.verdict === "fail") {
      persistItemOutcomes({
        workspaceDir: opts.workspaceDir,
        taskId: opts.taskId,
        ...(opts.matterId ? { matterId: opts.matterId } : {}),
        pack: opts.pack,
        machine,
        itemVerdicts: machineAggregate.itemVerdicts,
        tierConflicts: machineAggregate.tierConflicts,
      });
      const record: GuardianRecord = {
        taskId: opts.taskId,
        at: new Date().toISOString(),
        verdict: "fail",
        round,
        maxRounds: LEGAL_GUARDIAN_MAX_ROUNDS,
        gaps: machineAggregate.gaps,
        ...(raw ? { reviewerRaw: raw } : {}),
        evidencePackHash: packHash,
      };
      persistGuardianRecord(
        opts.workspaceDir,
        withEscalationItems(record, machine.escalationItems),
      );
      return record;
    }
  }

  if (!parsed) {
    const record = skippedRecord(
      opts.taskId,
      round,
      callFailed ? "reviewer_error" : "unreadable",
      packHash,
    );
    const stored = raw ? { ...record, reviewerRaw: raw } : record;
    persistGuardianRecord(opts.workspaceDir, stored);
    return stored;
  }

  // G2：逐项结果落盘——这是 `delivery/judgement-ratchet.ts` 唯一的真实数据来源。
  persistItemOutcomes({
    workspaceDir: opts.workspaceDir,
    taskId: opts.taskId,
    ...(opts.matterId ? { matterId: opts.matterId } : {}),
    pack: opts.pack,
    machine,
    itemVerdicts: aggregate?.itemVerdicts,
    tierConflicts: aggregate?.tierConflicts,
  });

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
  persistGuardianRecord(opts.workspaceDir, withEscalationItems(record, machine.escalationItems));
  return record;
}

/**
 * G0：给检查项贴上判定主体。
 *
 * 键不存在时 `resolveJudgmentTier` 落 `judge`（保守方向）；覆盖率由
 * `item-judgments.test.ts` 以硬断言强制——那是发现"清单变了没改表"的正确位置，
 * 而不是在运行期把开发者错误变成律师可见的缺口。
 */
function withTier(item: GuardianChecklistItem, key: string): GuardianChecklistItem {
  const resolved = resolveJudgmentTier({ key, table: ITEM_JUDGMENTS, knownItem: true });
  return { ...item, tier: resolved.judgment.tier };
}

/** G0：按当前 mode / 停用清单解析**实际生效**的判定主体。 */
function effectiveChecklist(
  items: readonly GuardianChecklistItem[],
  keys: readonly string[],
  mode: ReturnType<typeof resolveJudgmentTieringMode>,
  disabled: ReadonlySet<string>,
  lawyerEscalation: boolean,
): {
  machineKeys: string[];
  /** 实际要送进提示词的项（`on` 且升级通道可用时才排除 lawyer）。 */
  promptItems: GuardianChecklistItem[];
  judgeKeys: string[];
  /** G2：判定表键 → 生效判定主体（落盘用）。 */
  tiers: Map<string, JudgmentTier>;
  /** G2：包内条项 id → 判定表键（把模型的裸 id 映射回规范键）。 */
  keyById: Map<string, string>;
  /** G3：被移出提示词、需律师定夺的主观项（升级卡用）。 */
  escalationItems: JudgmentEscalationItem[];
} {
  const machineKeys: string[] = [];
  const promptItems: GuardianChecklistItem[] = [];
  const tiers = new Map<string, JudgmentTier>();
  const keyById = new Map<string, string>();
  const escalationItems: JudgmentEscalationItem[] = [];
  items.forEach((item, idx) => {
    const key = keys[idx] ?? item.id;
    keyById.set(item.id, key);
    const declared = ITEM_JUDGMENTS[key];
    const tier = effectiveTier({
      declared: declared?.tier ?? "judge",
      verifier: declared?.verifier,
      mode,
      disabledVerifiers: disabled,
    });
    // `on` 且升级通道可用时 lawyer 项不判——记录它**声明**的级别仍是 lawyer。
    const declaredTier: JudgmentTier = declared?.tier ?? "judge";
    tiers.set(key, tier === "judge" && declaredTier === "lawyer" ? "lawyer" : tier);
    if (tier === "machine") {
      machineKeys.push(key);
      return;
    }
    if (tier === "lawyer" && lawyerEscalation && mode === "on") {
      // 升级通道可用**且处于 on** → 该项不判、不进提示词，由升级卡承接。
      //
      // **`mode === "on"` 这个条件是必需的**：`off` 必须逐字等价于改造前、
      // `shadow` 必须零行为变化（只记录一致率）。少了它，升级通道一开就会
      // 在 shadow 期把主观项偷走——那是**静默的行为改变**，正是 shadow 要防的。
      escalationItems.push({
        itemKey: key,
        label: item.look,
        reason: declared?.lawyerReason ?? "属商业取舍或办案策略，需由您定夺。",
      });
      return;
    }
    // `judge` 项、以及**升级通道尚不可用时的 `lawyer` 项**，都留给模型。
    promptItems.push(item);
  });
  return {
    machineKeys,
    promptItems,
    judgeKeys: promptItems.map((it) => it.id),
    tiers,
    keyById,
    escalationItems,
  };
}

function checklistForDraft(
  draft: ArtifactDraft,
  workspaceDir: string,
  pins: AgentContext["contextPins"],
): { family?: string; stance?: string; items: GuardianChecklistItem[]; keys: string[] } {
  const documentText = draft.sections.map((s) => s.body ?? "").join("\n");
  const resolved = resolveWordRevisionChecklist({
    instruction: [draft.title, draft.summary].filter(Boolean).join("\n"),
    pins,
    documentText,
  });
  if (!resolved.family || resolved.familySource === "hint") {
    return { items: [], keys: [] };
  }
  const pack = loadWordRevisionPack(resolved.family, workspaceDir);
  const items: GuardianChecklistItem[] = pack.items.map((it) => {
    const edit =
      resolved.stance === "甲方" ? it.editA : resolved.stance === "乙方" ? it.editB : undefined;
    return withTier(
      {
        id: it.id,
        look: it.look,
        ...(edit ? { edit } : {}),
        stop: it.stop,
        // G0 修复：`lens`（规范依据）此前被丢弃，模型判该类项时看不到法条。
        ...(it.lens ? { lens: it.lens } : {}),
      },
      wordRevisionKey(it.id),
    );
  });
  return {
    family: pack.label,
    ...(resolved.stance ? { stance: resolved.stance } : {}),
    items,
    keys: pack.items.map((it) => wordRevisionKey(it.id)),
  };
}

function checklistForDocument(draft: ArtifactDraft): {
  family?: string;
  items: GuardianChecklistItem[];
  keys: string[];
} {
  const spec = resolveVerificationChecklistSpec(draft.deliverableType);
  const selected = spec.items.filter((it) => it.required);
  return {
    family: spec.id,
    items: selected.map((it) =>
      withTier(
        {
          id: it.id,
          look: it.label,
          stop: "正文未见覆盖且未缓办则 fail",
        },
        verificationKey(spec.id, it.id),
      ),
    ),
    keys: selected.map((it) => verificationKey(spec.id, it.id)),
  };
}

/**
 * G0：跑 machine 段并把「给模型的检查单」收敛到 judge 项。
 *
 * **两阶段构建证据包**：① 用全量项建包跑验证器 → ② `on` 时用 judge 项重建包，
 * 机械项不占提示词。核对项不再按条数截断，避免没看见的项被当成已通过。
 */
function buildMachineStage(input: {
  buildPack: (items: GuardianChecklistItem[]) => ReturnType<typeof buildGuardianEvidencePack>;
  checklist: { items: GuardianChecklistItem[]; keys: string[] };
  documentText: string;
  deliverableType?: string;
  graphIssues?: Array<{
    issue: string;
    authorityIds: readonly string[];
    openQuestions: readonly string[];
  }>;
  /**
   * 本工作区的 `lawmind.policy.json`（读不到就是 `null`）。
   *
   * 为什么必须传进来：判据分级的三条解析（tiering / disabledVerifiers / 升级通道）
   * 的顺序都是 `policy` 显式 → env → 缺省。无参调用会把第一档整条丢掉，
   * 于是 `lawmind.policy.json` 写的键全部不生效——而**这里与收尾接线
   * （`agent/turn-orchestrator-finalize.ts`）必须同源**：通道「算开」的那一侧会把主观项
   * 从提示词里摘掉，另一侧若「算关」就不会产出升级卡，那些项既不进提示词也不上卡，
   * 静默消失。
   */
  judgmentPolicy?: LawMindWorkspacePolicy | null;
}): {
  pack: ReturnType<typeof buildGuardianEvidencePack>;
  machine?: { verdicts: GuardianMachineVerdict[]; affectsOutcome: boolean };
  machineKeys: string[];
  judgeKeys: string[];
  /** G2：判定表键 → 生效判定主体 + 包内 id → 键。 */
  itemTiers: ReadonlyMap<string, JudgmentTier>;
  itemKeyById: ReadonlyMap<string, string>;
  /** G3：被移出提示词、需律师定夺的主观项。 */
  escalationItems: JudgmentEscalationItem[];
} {
  const judgmentPolicy = input.judgmentPolicy ?? null;
  const mode = resolveJudgmentTieringMode({ policy: judgmentPolicy });
  const disabled = resolveDisabledVerifiers({ policy: judgmentPolicy });
  const split = effectiveChecklist(
    input.checklist.items,
    input.checklist.keys,
    mode,
    disabled,
    isLawyerEscalationAvailable({ policy: judgmentPolicy }),
  );
  // 全量包：用于跑验证器（它们要读 gates / citations / hunks）。
  const fullPack = input.buildPack(input.checklist.items);
  if (!shouldRunMachineStage(mode) || split.machineKeys.length === 0) {
    return {
      pack: fullPack,
      machineKeys: [],
      judgeKeys: input.checklist.keys,
      itemTiers: split.tiers,
      itemKeyById: split.keyById,
      escalationItems: split.escalationItems,
    };
  }

  const verifierIds = [
    ...new Set(
      split.machineKeys
        .map((key) => ITEM_JUDGMENTS[key]?.verifier)
        .filter((id): id is string => Boolean(id) && hasMachineVerifier(id!)),
    ),
  ];
  const ctx = buildMachineVerifyContext({
    documentText: input.documentText,
    deliverableType: input.deliverableType,
    graphIssues: input.graphIssues,
  });
  const verdictMap = runMachineVerifiers({
    pack: fullPack,
    ctx,
    verifierIds,
  });
  const verdicts: GuardianMachineVerdict[] = split.machineKeys.map((key) => {
    const found = verdictMap.get(key);
    if (found) {
      return {
        itemId: key,
        supported: found.supported,
        reason: found.reason,
        ...(found.evidenceRef ? { evidenceRef: found.evidenceRef } : {}),
        status: found.status,
      };
    }
    // 声明了 machine 但没有结论 → 不可用（fail-closed），绝不当作通过。
    const verifier = ITEM_JUDGMENTS[key]?.verifier ?? "(未声明)";
    return {
      itemId: key,
      supported: false,
      reason: "该项的自动核对程序未给出结论，需人工确认。",
      evidenceRef: `missing_verdict:${verifier}`,
      status: "unavailable" as const,
    };
  });

  // `on`：machine 项**不进提示词**，并用实际要送的项**重建**包（名额不被无谓占用）。
  // `shadow`：保留全量项，让模型也判一遍，才能测一致率。
  const affectsOutcome = machineVerdictsAffectOutcome(mode);
  const pack = affectsOutcome ? input.buildPack(split.promptItems) : fullPack;

  return {
    pack,
    machine: { verdicts, affectsOutcome },
    machineKeys: split.machineKeys,
    judgeKeys: split.judgeKeys,
    itemTiers: split.tiers,
    itemKeyById: split.keyById,
    escalationItems: split.escalationItems,
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
  const checklist = checklistForDocument(draft);
  const documentText = draft.sections.map((s) => s.body ?? "").join("\n");
  const graphIssues = (graph?.issueTree ?? []).map((node) => ({
    issue: node.issue,
    authorityIds: node.authorityIds ?? [],
    openQuestions: node.openQuestions ?? [],
  }));
  const stage = buildMachineStage({
    buildPack: (items) =>
      buildGuardianEvidencePack({
        action: "render_document",
        draft,
        citation,
        bundle,
        graph,
        checklist: { ...checklist, items },
        confirmedAnswers: opts.ctx.confirmedAnswers,
        acceptanceReady: opts.acceptanceReady,
        prior: prior ? { round: prior.round, verdict: prior.verdict, gaps: prior.gaps } : null,
      }),
    checklist,
    documentText,
    deliverableType: draft.deliverableType,
    graphIssues,
    judgmentPolicy: readWorkspacePolicyFile(workspaceDir),
  });
  return runLegalGuardian({
    pack: stage.pack,
    taskId: draft.taskId,
    workspaceDir,
    model: opts.ctx.reviewModel,
    callReviewer: opts.ctx.guardianCaller,
    abortSignal: opts.ctx.abortSignal,
    machine: {
      ...(stage.machine ?? { verdicts: [], affectsOutcome: false }),
      itemTiers: stage.itemTiers,
      itemKeyById: stage.itemKeyById,
      escalationItems: stage.escalationItems,
    },
    ...(draft.matterId ? { matterId: draft.matterId } : {}),
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
  // 落改未采纳的条数：最短改动由引擎重算，落不下的原因改为「原文找不到 / 待收窄 / 碎片化」等，
  // 不能再只认「跨度硬门禁」这一种（那会让审稿员看不到真实的漏改）。
  const spanSkippedCount = plan?.skipped.filter((s) => !s.reason.includes("已按最短改动")).length;
  const checklist = checklistForDraft(draft, workspaceDir, opts.ctx.contextPins);
  const graph = readReasoningSnapshot(workspaceDir, draft.taskId);
  const graphIssues = (graph?.issueTree ?? []).map((node) => ({
    issue: node.issue,
    authorityIds: node.authorityIds ?? [],
    openQuestions: node.openQuestions ?? [],
  }));
  const stage = buildMachineStage({
    buildPack: (items) =>
      buildGuardianEvidencePack({
        draft,
        hunks: opts.hunks,
        allowEmptyRedline: opts.allowEmptyRedline,
        citation,
        bundle,
        checklist: { ...checklist, items },
        confirmedAnswers: opts.ctx.confirmedAnswers,
        writerDeferred: plan?.writerDeferred,
        spanSkippedCount,
        prior: prior ? { round: prior.round, verdict: prior.verdict, gaps: prior.gaps } : null,
      }),
    checklist,
    documentText: draft.sections.map((s) => s.body ?? "").join("\n"),
    deliverableType: draft.deliverableType,
    graphIssues,
    judgmentPolicy: readWorkspacePolicyFile(workspaceDir),
  });
  return runLegalGuardian({
    pack: stage.pack,
    taskId: draft.taskId,
    workspaceDir,
    model: opts.ctx.reviewModel,
    callReviewer: opts.ctx.guardianCaller,
    abortSignal: opts.ctx.abortSignal,
    machine: {
      ...(stage.machine ?? { verdicts: [], affectsOutcome: false }),
      itemTiers: stage.itemTiers,
      itemKeyById: stage.itemKeyById,
      escalationItems: stage.escalationItems,
    },
    ...(draft.matterId ? { matterId: draft.matterId } : {}),
  });
}

export { slimGuardianView };
