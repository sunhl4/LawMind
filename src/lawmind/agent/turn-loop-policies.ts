/**
 * Ordered, individually testable policies for the model↔tool loop.
 *
 * Before this module the loop body was a single if-chain with ~14 sibling
 * `let` flags. Each branch corresponded to a production incident, so the order
 * mattered but was invisible. Policies make the order explicit and let a unit
 * test drive one decision without a model server.
 *
 * Contract:
 *   - A policy returns `null` when it does not apply.
 *   - Exactly one action wins (first non-null in {@link TOOL_ROUND_POLICIES} /
 *     {@link COMPLETION_POLICIES}); the loop executes it.
 *   - Policies may mutate the flags object and the turn (bounce counters), but
 *     never append to history themselves — the loop owns history writes.
 */

import type { ContextPressureOutcome } from "../metrics/context-pressure.js";
import {
  formatSameTurnCompletionBounce,
  formatSameTurnVerifyCapDeliver,
  formatSameTurnVerifyLawyerProgress,
  shouldBounceSameTurnCompletion,
  shouldPauseSameTurnVerify,
} from "../runtime/same-turn-verify.js";
import type { ToolCallRef } from "../runtime/tool-concurrency.js";
import type { ClarificationQuestion } from "../types.js";
import {
  formatContextDeferralBounce,
  formatContextDeferralHandoff,
  isContextBudgetDeferralReply,
} from "./context-deferral.js";
import {
  caseConclusionGap,
  consultListGap,
  formatCaseConclusionNudge,
  formatConsultQuestionsNudge,
  formatMemoSectionNudge,
  formatPleadingSectionNudge,
  memoSectionGaps,
  pleadingSectionGaps,
} from "./deliverable-shape.js";
import { applyProseSyndrome, appendMechanicalNote, rememberJudgments } from "./factor-state.js";
import {
  formatMissingDeliverableNudge,
  missingNamedDeliverables,
  namedWorkspaceDeliverables,
} from "./named-deliverable.js";
import { recordRepairObservation } from "./observation-bus.js";
import { planProseRepair } from "./prose-repair.js";
import {
  formatReviewBoardExportBounce,
  isReviewBoardExportDeferralReply,
  REVIEW_BOARD_EXPORT_BOUNCE_MAX,
} from "./review-board-export-deferral.js";
import { formatToolBudgetHardStopReply, shouldHardStopToolBudget } from "./tool-budget.js";
import type { TurnStopReason } from "./turn-loop-state.js";
import type { LoopFlags } from "./turn-loop-state.js";
import { buildClarificationReply, type RunTurnEvent } from "./turn-orchestrator-events.js";
import type { TurnProfile } from "./turn-profile.js";
import { hasTrackedWordArtifact } from "./turn-profile.js";
import type { AgentMessage, AgentSession, AgentTurn, AgentTurnStatus } from "./types.js";
import {
  CALCULATE_PARAM_FAILURE_CAP,
  countSearchCalls,
  formatCalculateParamStopNudge,
  formatWriteSynthesisNudge,
  shouldSynthesizeBeforeWrite,
  trailingCalculateParamFailures,
  turnHasLiveStatuteHit,
} from "./write-synthesis.js";

// ─────────────────────────────────────────────
// Repeat / forbidden-shell helpers (moved out of the loop for testability)
// ─────────────────────────────────────────────

/** Same tool batch this many times in a row is a spin, not progress. */
export const IDENTICAL_TOOL_REPEAT_NUDGE_AT = 3;

/** Reads whose completed payload is `hasMore: false`. Not search, not writers. */
const COMPLETED_READ_TOOL_NAMES = new Set([
  "analyze_document",
  "read_project_file",
  "read_host_file",
]);

import { toolCallBatchSignature, stableToolJson } from "../runtime/tool-call-signature.js";
export { toolCallBatchSignature } from "../runtime/tool-call-signature.js";

export function advanceIdenticalToolStreak(
  prev: LoopFlags["identicalToolStreak"],
  signature: string,
): NonNullable<LoopFlags["identicalToolStreak"]> {
  if (prev && prev.signature === signature) {
    return { signature, streak: prev.streak + 1, nudged: prev.nudged };
  }
  return { signature, streak: 1, nudged: false };
}

/** Soft coach after a repeated batch; hard stop only if the nudge is ignored. */
const FORBIDDEN_SHELL_RE = /不允许运行 (?:bash|sh|zsh|dash|fish)/;

/** Count rejected shell binaries in this turn. Different names still count as one loop. */
export function forbiddenShellRejectionCount(
  messages: ReadonlyArray<Pick<AgentMessage, "toolCallResponses">>,
): number {
  let count = 0;
  for (const message of messages) {
    for (const response of message.toolCallResponses ?? []) {
      const error = response.result.error ?? "";
      if (FORBIDDEN_SHELL_RE.test(error)) {
        count += 1;
      }
    }
  }
  return count;
}

export function formatForbiddenShellNudge(): string {
  return "【命令拒绝】zsh、dash、fish 不能运行。bash 或 sh 只能执行工作区内的脚本文件，不能带 -c。不要再试被拒绝的命令。用 bash 脚本、python3 或 write_document 写出用户要的文件，然后结束。";
}

export function formatForbiddenShellStop(): string {
  return "被拒绝的命令我已停止再试。bash 或 sh 只能执行工作区内的脚本文件，不能带 -c。需要结果时，请改跑该脚本，或用 python3 / 直接写结果文件。";
}

export function identicalToolRepeatDecision(
  state: NonNullable<LoopFlags["identicalToolStreak"]>,
): "ok" | "nudge" | "stop" {
  if (state.streak < IDENTICAL_TOOL_REPEAT_NUDGE_AT) {
    return "ok";
  }
  return state.nudged ? "stop" : "nudge";
}

export function formatIdenticalToolRepeatNudge(): string {
  return "【重复调用】刚才这组工具和参数已经连续重复，没有新信息。换一种做法，或根据已有结果直接写回复。";
}

export function formatDocumentRereadNudge(opts: {
  totalChars?: number;
  wordRevision: boolean;
}): string {
  const chars =
    typeof opts.totalChars === "number"
      ? `（约 ${Math.max(0, Math.floor(opts.totalChars))} 字）`
      : "";
  const next = opts.wordRevision
    ? "不要再读这一份。还没有合同基线就 seed 一次；已有基线就 apply_surgical_edits（定位不到的写入 craft_check.deferred），然后 render_tracked_draft。不要编造原文里没有的句子。"
    : "不要再读这一份。根据已有正文直接写回复。";
  return `【重复调用】这份文书已经读完${chars}，相同参数没有新正文。${next}`;
}

/** One extra sample after a finished reread would have stopped a Word-revision turn. */
export function formatDocumentRereadContinue(opts: { totalChars?: number }): string {
  const chars =
    typeof opts.totalChars === "number"
      ? `已有正文约 ${Math.max(0, Math.floor(opts.totalChars))} 字。`
      : "正文已经在上面的工具结果里。";
  return [
    "【改稿】同一份文书已读完，再读不会多出正文。",
    chars,
    "不要再调用读取工具。还没有合同基线就 seed 一次；已有基线就 apply_surgical_edits（最短锚定；定位不到的写入 craft_check.deferred），然后 render_tracked_draft。",
    "不要编造原文里没有的句子，也不要再 draft 一份意见稿。",
  ].join("\n");
}

const DRAFT_REPEAT_TOOL_NAMES = new Set(["draft_document", "update_draft"]);
const SEARCH_REPEAT_TOOL_NAMES = new Set([
  "search_matter",
  "search_workspace",
  "search_statute",
  "search_statute_web",
  "search_case_law",
  "search_host",
  "web_search",
]);

/** Why the lawyer-facing stop says what it says. Tool ids never appear in that sentence. */
export type LawyerRepeatKind = "read_done" | "read_stuck" | "draft" | "search" | "other";

export function lawyerRepeatKind(
  toolNames: readonly string[],
  readFinished: boolean,
): LawyerRepeatKind {
  if (readFinished) {
    return "read_done";
  }
  if (toolNames.length > 0 && toolNames.every((name) => COMPLETED_READ_TOOL_NAMES.has(name))) {
    return "read_stuck";
  }
  if (toolNames.length > 0 && toolNames.every((name) => DRAFT_REPEAT_TOOL_NAMES.has(name))) {
    return "draft";
  }
  if (toolNames.length > 0 && toolNames.every((name) => SEARCH_REPEAT_TOOL_NAMES.has(name))) {
    return "search";
  }
  return "other";
}

const LAWYER_REPEAT_LEAD: Record<LawyerRepeatKind, string> = {
  read_done:
    "这份材料已经读完，再用同样的方式读也不会多出内容，所以先停下来。已经读到的内容都还在。",
  read_stuck: "同一处又读了好几次，没有读到新的内容，所以先停下来。已经读到的内容都还在。",
  draft: "起草做了好几次，没有写出新的修改，所以先停下来。已经做好的结果都还在。",
  search: "同样的查找做了好几次，没有新的结果，所以先停下来。已经查到的结果都还在。",
  other: "同一步做了好几次，没有新的进展，所以先停下来。已经做好的结果都还在。",
};

export function formatIdenticalToolRepeatStop(opts?: {
  kind?: LawyerRepeatKind;
  /** 这一轮是改原 Word，带修改痕迹的稿还没写到原文件旁边。 */
  trackedDraftMissing?: boolean;
  /** 改稿回合到顶：写出已有稿，不要求律师回复继续。 */
  deliverInstead?: boolean;
}): string {
  const parts = [LAWYER_REPEAT_LEAD[opts?.kind ?? "other"]];
  if (opts?.trackedDraftMissing) {
    parts.push("带修改痕迹的稿子还没有出现在原文件旁边。");
  }
  if (opts?.deliverInstead) {
    parts.push(
      "有新修订的，写在原文件旁边。这一轮没有新修订的，不另出一份。原文里没有的数字和身份留在待确认，不因此整单停下。",
    );
  } else if (opts?.trackedDraftMissing) {
    parts.push("缺的数字和身份留在待确认。");
  } else {
    parts.push("已经做好的部分就是这一轮的结果。缺的事实留在文中待确认。");
  }
  return parts.join("");
}

/** 改稿回合到了验收或步数阀门。有修订才说写在旁边，没有新修订不声称已经出稿。 */
export function formatWordRevisionCapStop(): string {
  return "有新修订的，写在原文件旁边。这一轮没有新修订的，不另出一份。原文里没有的数字和身份留在待确认，不因此整单停下。";
}

/** 模型收工时还没导出。隐藏续办一次，不无限循环。 */
export function formatWordRevisionExportNudge(): string {
  return [
    "【改稿】这一轮还没有把带修订的 Word 写到原文件旁边。",
    "子代理交回的原句用 apply_surgical_edits 落上；定位不到的写入 craft_check.deferred。然后 render_tracked_draft。",
    "不要把子代理已经读过的全文再读进本对话。检查单未覆盖不拦出稿。不要回复已完成。",
  ].join("\n");
}

export type CompletedDocumentReread = {
  /** Set only when the batch is a single completed read with a numeric total. */
  totalChars?: number;
};

function toolResultDataByCallId(
  messages: ReadonlyArray<Pick<AgentMessage, "role" | "toolCallResponses">>,
): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const msg of messages) {
    if (msg.role !== "tool") {
      continue;
    }
    for (const resp of msg.toolCallResponses ?? []) {
      const data = resp.result.ok ? resp.result.data : undefined;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        byId.set(resp.toolCallId, data as Record<string, unknown>);
      }
    }
  }
  return byId;
}

/**
 * Every call is a document read that already returned the whole extract.
 * `hasMore !== false` (missing, true, or a failed read) is not this case:
 * repeating a page or an error is still a spin and must stop.
 */
export function completedDocumentReread(
  calls: ReadonlyArray<{ id: string; name: string }>,
  messages: ReadonlyArray<Pick<AgentMessage, "role" | "toolCallResponses">>,
): CompletedDocumentReread | null {
  if (calls.length === 0 || calls.some((call) => !COMPLETED_READ_TOOL_NAMES.has(call.name))) {
    return null;
  }
  const byId = toolResultDataByCallId(messages);
  let totalChars: number | undefined;
  for (const call of calls) {
    const data = byId.get(call.id);
    if (!data || data.hasMore !== false || data.kind === "directory") {
      return null;
    }
    if (
      calls.length === 1 &&
      typeof data.totalChars === "number" &&
      Number.isFinite(data.totalChars)
    ) {
      totalChars = data.totalChars;
    }
  }
  return totalChars === undefined ? {} : { totalChars };
}

/** Word 改稿、且本轮还没用过这次豁免时，读完再读不收工。 */
export function shouldContinueCompletedDocumentReread(opts: {
  wordRevision: boolean;
  alreadyContinued: boolean;
  reread: CompletedDocumentReread | null;
}): boolean {
  return opts.wordRevision && !opts.alreadyContinued && opts.reread != null;
}

// ─────────────────────────────────────────────
// Policy actions
// ─────────────────────────────────────────────

export type PolicyAction =
  /** Loop pushes the hidden user message(s) and samples again. */
  | {
      kind: "resample";
      /** Single message (completion policies). */
      message?: string;
      /** Multiple co-firing messages, pushed in order (tool-round coaches). */
      messages?: string[];
      /** Context deferral: force a mid-turn compaction before the bounce. */
      forceCompact?: boolean;
      /** Runs after the forced compaction, before hiding/pushing the bounce. */
      afterResamplePrep?: () => void;
      /** Runs after the hidden message is pushed (telemetry that expects that order). */
      afterMessagePush?: () => void;
      /**
       * Steer path: the original loop appended the mechanical note to the
       * assistant row before re-sampling. Keep that byte-for-byte.
       */
      applyMechanicalNote?: boolean;
    }
  /** Loop stops with a structured reason; `reply` becomes the turn result. */
  | {
      kind: "stop";
      reason: TurnStopReason;
      reply?: string;
      status?: AgentTurnStatus;
      /** Prose syndrome: replace the assistant message content. */
      rewriteAssistant?: boolean;
      /** Quiet segment: emit the reply as a delta. */
      emitReply?: boolean;
      /** Clear the loop's local pending clarification list. */
      consumeClarificationQuestions?: boolean;
    };

export type Policy<TFacts> = {
  id: string;
  apply: (facts: TFacts) => PolicyAction | null;
};

// ─────────────────────────────────────────────
// Tool-round facts + policies
// ─────────────────────────────────────────────

export type ToolRoundFacts = {
  instruction: string;
  workspaceDir: string;
  profile: TurnProfile;
  flags: LoopFlags;
  wordRevision: boolean;
  toolRefs: readonly ToolCallRef[];
  /** Advertised after the batch (`stepAfterBatch.toolNames`). */
  advertisedToolNames: readonly string[];
  /** Counts after the batch (used for the tracked-draft check). */
  toolNameCallCounts: Record<string, number> | undefined;
  toolCallSignatures?: import("../runtime/tool-call-signature.js").ToolCallSignatures;
  /** Whether this turn already wrote a tracked/format-revision Word (success only). */
  trackedArtifactWritten: boolean;
  /** Session history — trailing calculate failures. */
  messages: readonly AgentMessage[];
  /** Turn messages — live statute hit. */
  turnMessages: readonly AgentMessage[];
};

function writeSynthesisPolicy(facts: ToolRoundFacts): PolicyAction | null {
  if (!facts.profile.coaches.has("write_synthesis")) {
    return null;
  }
  const missing = missingNamedDeliverables(facts.workspaceDir, facts.instruction);
  if (!facts.flags.synthesisNudged) {
    const should = shouldSynthesizeBeforeWrite({
      missingDeliverables: missing,
      searchCalls: countSearchCalls(facts.toolNameCallCounts),
      advertisedToolNames: [...facts.advertisedToolNames],
      liveStatuteHit: turnHasLiveStatuteHit(facts.turnMessages),
    });
    if (!should) {
      return null;
    }
    facts.flags.synthesisNudged = true;
    return { kind: "resample", message: formatWriteSynthesisNudge(missing) };
  }
  // Once the coach fired, keep search withheld while the named file is missing.
  facts.flags.synthesisSearchLocked = missing.length > 0;
  return null;
}

function pleadingSectionsPolicy(facts: ToolRoundFacts): PolicyAction | null {
  if (!facts.profile.coaches.has("pleading_sections") || facts.flags.pleadingNudged) {
    return null;
  }
  const gaps = pleadingSectionGaps(facts.workspaceDir, facts.instruction);
  if (gaps.length === 0) {
    return null;
  }
  facts.flags.pleadingNudged = true;
  return { kind: "resample", message: formatPleadingSectionNudge(gaps) };
}

function consultQuestionsPolicy(facts: ToolRoundFacts): PolicyAction | null {
  if (!facts.profile.coaches.has("consult_questions") || facts.flags.consultNudged) {
    return null;
  }
  if (!consultListGap(facts.workspaceDir, facts.instruction)) {
    return null;
  }
  facts.flags.consultNudged = true;
  return {
    kind: "resample",
    message: formatConsultQuestionsNudge(namedWorkspaceDeliverables(facts.instruction)),
  };
}

function caseConclusionPolicy(facts: ToolRoundFacts): PolicyAction | null {
  if (!facts.profile.coaches.has("case_conclusion") || facts.flags.caseConclusionNudged) {
    return null;
  }
  if (!caseConclusionGap(facts.workspaceDir, facts.instruction)) {
    return null;
  }
  facts.flags.caseConclusionNudged = true;
  return {
    kind: "resample",
    message: formatCaseConclusionNudge(namedWorkspaceDeliverables(facts.instruction)),
  };
}

function memoSectionsPolicy(facts: ToolRoundFacts): PolicyAction | null {
  if (!facts.profile.coaches.has("memo_sections") || facts.flags.memoNudged) {
    return null;
  }
  const gaps = memoSectionGaps(facts.workspaceDir, facts.instruction);
  if (gaps.length === 0) {
    return null;
  }
  facts.flags.memoNudged = true;
  return { kind: "resample", message: formatMemoSectionNudge(gaps) };
}

function calculateParamsPolicy(facts: ToolRoundFacts): PolicyAction | null {
  if (!facts.profile.coaches.has("calculate_params") || facts.flags.calculateParamNudged) {
    return null;
  }
  if (trailingCalculateParamFailures(facts.messages) < CALCULATE_PARAM_FAILURE_CAP) {
    return null;
  }
  facts.flags.calculateParamNudged = true;
  return { kind: "resample", message: formatCalculateParamStopNudge() };
}

function forbiddenShellPolicy(facts: ToolRoundFacts): PolicyAction | null {
  if (!facts.profile.coaches.has("forbidden_shell")) {
    return null;
  }
  const rejections = forbiddenShellRejectionCount(facts.messages);
  if (rejections >= 4) {
    return { kind: "stop", reason: "forbidden_shell", reply: formatForbiddenShellStop() };
  }
  if (rejections >= 2 && !facts.flags.forbiddenShellNudged) {
    facts.flags.forbiddenShellNudged = true;
    return { kind: "resample", message: formatForbiddenShellNudge() };
  }
  return null;
}

function identicalRepeatPolicy(facts: ToolRoundFacts): PolicyAction | null {
  if (!facts.profile.coaches.has("identical_repeat") || facts.toolRefs.length === 0) {
    return null;
  }
  facts.flags.identicalToolStreak = advanceIdenticalToolStreak(
    facts.flags.identicalToolStreak,
    [
      toolCallBatchSignature(facts.toolRefs),
      stableToolJson(
        facts.toolRefs.map((call) => {
          const observed = facts.toolCallSignatures?.[toolCallBatchSignature([call])];
          if (observed) {
            return observed.result;
          }
          const response = facts.messages
            .toReversed()
            .flatMap((message) => message.toolCallResponses ?? [])
            .find((row) => row.toolCallId === call.id);
          if (!response) {
            return null;
          }
          const data = response.result.data;
          const stableData =
            data && typeof data === "object" && !Array.isArray(data)
              ? Object.fromEntries(
                  Object.entries(data).filter(([key]) => key !== "discoveryRepeat"),
                )
              : data;
          return { ok: response.result.ok, data: stableData, error: response.result.error };
        }),
      ),
    ].join("\nresults:\n"),
  );
  const repeated = facts.toolRefs.map(
    (call) => facts.toolCallSignatures?.[toolCallBatchSignature([call])],
  );
  const allPreviouslyNudged = repeated.every(
    (item) => item && item.repeats >= IDENTICAL_TOOL_REPEAT_NUDGE_AT && item.guardNudged,
  );
  const allRepeated = repeated.every(
    (item) => item && item.repeats >= IDENTICAL_TOOL_REPEAT_NUDGE_AT,
  );
  const repeat = allPreviouslyNudged
    ? "stop"
    : allRepeated
      ? "nudge"
      : identicalToolRepeatDecision(facts.flags.identicalToolStreak);
  const reread = completedDocumentReread(facts.toolRefs, facts.messages);
  const wordRevision = facts.wordRevision;

  if (repeat === "nudge") {
    repeated.forEach((item) => {
      if (item) {
        item.guardNudged = true;
      }
    });
    facts.flags.identicalToolStreak = { ...facts.flags.identicalToolStreak, nudged: true };
    return {
      kind: "resample",
      message: reread
        ? formatDocumentRereadNudge({ totalChars: reread.totalChars, wordRevision })
        : formatIdenticalToolRepeatNudge(),
    };
  }
  if (repeat !== "stop") {
    return null;
  }
  if (
    shouldContinueCompletedDocumentReread({
      wordRevision,
      alreadyContinued: facts.flags.documentRereadContinued,
      reread,
    })
  ) {
    facts.flags.documentRereadContinued = true;
    return {
      kind: "resample",
      message: formatDocumentRereadContinue({ totalChars: reread?.totalChars }),
    };
  }
  const trackedDraftMissing = wordRevision && !hasTrackedWordArtifact(facts);
  return {
    kind: "stop",
    reason: reread ? "reread_stop" : "repeat_stop",
    reply: formatIdenticalToolRepeatStop({
      kind: lawyerRepeatKind(
        facts.toolRefs.map((call) => call.name),
        reread != null,
      ),
      trackedDraftMissing,
      deliverInstead: wordRevision,
    }),
  };
}

/**
 * Ordered coaching policies. Unlike the completion table, these are **not
 * mutually exclusive**: the original loop ran all of them in one round and then
 * re-sampled once. A consult request can legitimately carry both the fill-in
 * coach and the memo-structure coach, so we collect every message and push them
 * together.
 */
export const TOOL_ROUND_COACH_POLICIES: readonly Policy<ToolRoundFacts>[] = [
  { id: "write-synthesis", apply: writeSynthesisPolicy },
  { id: "pleading-sections", apply: pleadingSectionsPolicy },
  { id: "case-conclusion", apply: caseConclusionPolicy },
  { id: "consult-questions", apply: consultQuestionsPolicy },
  { id: "memo-sections", apply: memoSectionsPolicy },
  { id: "calculate-params", apply: calculateParamsPolicy },
];

/**
 * Guard policies. These are mutually exclusive and run only when no coach
 * fired — same as the old `if (steeredToWrite) continue;` barrier.
 */
export const TOOL_ROUND_GUARD_POLICIES: readonly Policy<ToolRoundFacts>[] = [
  { id: "forbidden-shell", apply: forbiddenShellPolicy },
  { id: "identical-repeat", apply: identicalRepeatPolicy },
];

/** Documented order for review/diagnostics; execution uses the two tables above. */
export const TOOL_ROUND_POLICIES: readonly Policy<ToolRoundFacts>[] = [
  ...TOOL_ROUND_COACH_POLICIES,
  ...TOOL_ROUND_GUARD_POLICIES,
];

export function runToolRoundPolicies(facts: ToolRoundFacts): PolicyAction | null {
  const messages: string[] = [];
  for (const policy of TOOL_ROUND_COACH_POLICIES) {
    const action = policy.apply(facts);
    if (action?.kind === "resample" && action.message) {
      messages.push(action.message);
    }
  }
  if (messages.length > 0) {
    return { kind: "resample", messages };
  }
  for (const policy of TOOL_ROUND_GUARD_POLICIES) {
    const action = policy.apply(facts);
    if (action) {
      return action;
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Completion facts + policies
// ─────────────────────────────────────────────

export type CompletionFacts = {
  instruction: string;
  workspaceDir: string;
  profile: TurnProfile;
  flags: LoopFlags;
  turn: AgentTurn;
  session: AgentSession;
  assistantText: string;
  roundIndex: number;
  wordRevision: boolean;
  pendingClarificationQuestions: ClarificationQuestion[];
  deferralBounceMax: () => number;
  emit: (event: RunTurnEvent) => void;
  hideAssistantMessage: () => void;
  recordPressure: (
    outcome: ContextPressureOutcome,
    detail?: string,
    meta?: Record<string, string | number | boolean | null>,
  ) => void;
  hasPendingSteer: () => boolean;
};

function proseSyndromePolicy(facts: CompletionFacts): PolicyAction | null {
  // Absorption must run even when the opt-in repair branch is off: it records
  // prose proposals/judgments and drives the sampling projection. Judgments are
  // remembered only for the reply that is actually delivered.
  applyProseSyndrome(facts.turn.factorState, facts.assistantText, {
    rememberJudgments: false,
  });
  const remember = (): void => {
    if (facts.turn.factorState) {
      rememberJudgments(facts.turn.factorState, facts.assistantText);
    }
  };
  if (
    process.env.LAWMIND_FACTOR_REPAIR !== "1" ||
    facts.turn.status !== "running" ||
    facts.pendingClarificationQuestions.length > 0 ||
    facts.wordRevision
  ) {
    remember();
    return null;
  }
  const plan = planProseRepair(facts.turn.factorState, facts.assistantText);
  if (plan.action === "none") {
    remember();
    return null;
  }
  const scope = {
    sessionId: facts.session.sessionId,
    ...(facts.session.matterId ? { matterId: facts.session.matterId } : {}),
  };
  if (plan.action === "bounce") {
    recordRepairObservation(
      facts.workspaceDir,
      scope,
      { action: "bounce", anchors: plan.anchors, note: plan.note },
      facts.turn.turnId,
    );
    return { kind: "resample", message: plan.note };
  }
  remember();
  recordRepairObservation(
    facts.workspaceDir,
    scope,
    { action: "deliver", anchors: plan.anchors, note: plan.pending },
    facts.turn.turnId,
  );
  const voiced = appendMechanicalNote(facts.assistantText, facts.turn.factorState);
  return {
    kind: "stop",
    reason: "prose_syndrome",
    status: "completed",
    reply: voiced,
    rewriteAssistant: true,
    emitReply: true,
  };
}

function clarificationPolicy(facts: CompletionFacts): PolicyAction | null {
  if (facts.pendingClarificationQuestions.length === 0) {
    return null;
  }
  // 端到端口径：带占位的草稿已经生成（draft_with_placeholders），缺口标进
  // 回复与交付物，回合照常完成——律师在修订里改或回一句补充，不再进入
  // awaiting_clarification，也不写 pendingClarificationKeys（不冻下一轮）。
  const questions = facts.pendingClarificationQuestions;
  facts.turn.clarificationQuestions = questions;
  return {
    kind: "stop",
    reason: "clarification_delivered",
    status: "completed",
    reply: buildClarificationReply(
      facts.assistantText,
      questions,
      "草稿已生成，以下要点已在文中标【待核实】（可直接在修订里改，或回复我补充）：",
    ),
    consumeClarificationQuestions: true,
  };
}

function sameTurnVerifyPolicy(facts: CompletionFacts): PolicyAction | null {
  if (!shouldBounceSameTurnCompletion(facts.turn.sameTurnVerify)) {
    return null;
  }
  const verifyState = facts.turn.sameTurnVerify!;
  facts.emit({
    type: "verify_gap",
    roundIndex: facts.roundIndex,
    message: formatSameTurnVerifyLawyerProgress(verifyState.issues.map((issue) => issue.code)),
  });
  if (shouldPauseSameTurnVerify(facts.turn.sameTurnVerify)) {
    // Bounce budget exhausted: deliver with gaps — never mid-delivery continue_tools.
    return {
      kind: "stop",
      reason: "verify_cap",
      status: "completed",
      reply: facts.wordRevision
        ? formatWordRevisionCapStop()
        : formatSameTurnVerifyCapDeliver(verifyState),
    };
  }
  const bounce = formatSameTurnCompletionBounce(verifyState);
  facts.turn.sameTurnVerify = {
    ...verifyState,
    bounceCount: (verifyState.bounceCount ?? 0) + 1,
  };
  return { kind: "resample", message: bounce };
}

function contextDeferralPolicy(facts: CompletionFacts): PolicyAction | null {
  if (!isContextBudgetDeferralReply(facts.assistantText)) {
    return null;
  }
  const bounces = facts.turn.contextDeferralBounces ?? 0;
  facts.recordPressure("deferral_detected", facts.assistantText.trim().slice(0, 200), {
    bouncesSoFar: bounces,
    roundIndex: facts.roundIndex,
  });
  if (bounces < facts.deferralBounceMax()) {
    return {
      kind: "resample",
      message: formatContextDeferralBounce(),
      forceCompact: true,
      // 反弹计数与隐藏必须在强制压缩之后；事件/指标等历史写入之后再发。
      afterResamplePrep: () => {
        facts.turn.contextDeferralBounces = bounces + 1;
        facts.hideAssistantMessage();
      },
      afterMessagePush: () => {
        facts.emit({
          type: "context_deferral_bounce",
          roundIndex: facts.roundIndex,
          bounceCount: bounces + 1,
        });
        facts.recordPressure("deferral_bounced", undefined, {
          bounceCount: bounces + 1,
          roundIndex: facts.roundIndex,
        });
      },
    };
  }
  // 反弹用尽：不把模型的推诿原文丢给律师，换成可核对的事实 + 正确的继续方式。
  // fail-open 是刻意的（绝不无限循环），但交接必须诚实。
  const planOpen =
    facts.session.turnPlan?.items
      .filter((item) => item.status !== "completed")
      .map((item) => item.step) ?? [];
  facts.recordPressure("deferral_reached_lawyer", facts.assistantText.trim().slice(0, 200), {
    bounces,
    toolCallsExecuted: facts.turn.toolCallsExecuted,
  });
  return {
    kind: "stop",
    reason: "deferral_handoff",
    status: "completed",
    reply: formatContextDeferralHandoff({
      toolCallsExecuted: facts.turn.toolCallsExecuted,
      planOpen,
    }),
  };
}

function wordRevisionExportPolicy(facts: CompletionFacts): PolicyAction | null {
  if (!facts.profile.requiresTrackedDraft) {
    return null;
  }
  if (hasTrackedWordArtifact(facts.turn)) {
    return null;
  }
  if (facts.flags.wordRevisionExportNudged) {
    return null;
  }
  facts.flags.wordRevisionExportNudged = true;
  return { kind: "resample", message: formatWordRevisionExportNudge() };
}

function reviewBoardExportPolicy(facts: CompletionFacts): PolicyAction | null {
  if (!facts.profile.coaches.has("review_board_export")) {
    return null;
  }
  // 交办即终稿：模型不得以「审核台放行」把出 Word 退回律师。
  if (!isReviewBoardExportDeferralReply(facts.assistantText)) {
    return null;
  }
  if (hasTrackedWordArtifact(facts.turn)) {
    return null;
  }
  if (facts.flags.reviewBoardExportBounces >= REVIEW_BOARD_EXPORT_BOUNCE_MAX) {
    return null;
  }
  facts.flags.reviewBoardExportBounces += 1;
  facts.hideAssistantMessage();
  return { kind: "resample", message: formatReviewBoardExportBounce() };
}

function missingDeliverablesPolicy(facts: CompletionFacts): PolicyAction | null {
  if (!facts.profile.coaches.has("missing_deliverables") || facts.flags.deliverableNudged) {
    return null;
  }
  const missing = missingNamedDeliverables(facts.workspaceDir, facts.instruction);
  if (missing.length === 0) {
    return null;
  }
  facts.flags.deliverableNudged = true;
  facts.hideAssistantMessage();
  return { kind: "resample", message: formatMissingDeliverableNudge(missing) };
}

function steerPolicy(facts: CompletionFacts): PolicyAction | null {
  if (!facts.profile.coaches.has("steer")) {
    return null;
  }
  // 收尾这句话生成期间律师点了「改这一轮」。再采样一次，不要把纠正留到下一场。
  return facts.hasPendingSteer() ? { kind: "resample", applyMechanicalNote: true } : null;
}

export const COMPLETION_POLICIES: readonly Policy<CompletionFacts>[] = [
  { id: "prose-syndrome", apply: proseSyndromePolicy },
  { id: "clarification", apply: clarificationPolicy },
  { id: "same-turn-verify", apply: sameTurnVerifyPolicy },
  { id: "context-deferral", apply: contextDeferralPolicy },
  { id: "word-revision-export", apply: wordRevisionExportPolicy },
  { id: "review-board-export", apply: reviewBoardExportPolicy },
  { id: "missing-deliverables", apply: missingDeliverablesPolicy },
  { id: "steer", apply: steerPolicy },
];

export function runCompletionPolicies(
  facts: CompletionFacts,
  opts?: {
    /**
     * Called once the prose-syndrome policy declines. The loop streams the
     * assistant text here so a bounce (verify / deferral / steer) does not
     * delay the lawyer-visible segment behind policy side effects.
     */
    beforeBounce?: () => void;
  },
): PolicyAction | null {
  for (const policy of COMPLETION_POLICIES) {
    const action = policy.apply(facts);
    if (action) {
      return action;
    }
    if (policy.id === "prose-syndrome") {
      opts?.beforeBounce?.();
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Tool-budget hard stop (silent runaway ceiling)
// ─────────────────────────────────────────────

export type ToolBudgetStopFacts = {
  used: number;
  hard: number;
  wordRevision: boolean;
  assistantText: string;
  turn: AgentTurn;
  roundIndex: number;
  pendingClarificationQuestions: ClarificationQuestion[];
  emit: (event: RunTurnEvent) => void;
};

export type ToolBudgetStop = {
  status: AgentTurnStatus;
  reply: string;
  reason: TurnStopReason;
  /** True when the placeholder-clarification branch consumed the pending list. */
  consumedClarificationQuestions?: boolean;
};

/**
 * Step-count ceiling: never a lawyer question. Deliver whatever is done and
 * say so, or hand the red verifier's gaps over as 【待核实】.
 *
 * Extracted from the loop body so the four branches are unit-testable without a
 * model server; order and copy are unchanged.
 */
export function resolveToolBudgetStop(facts: ToolBudgetStopFacts): ToolBudgetStop | null {
  if (!shouldHardStopToolBudget(facts.used, facts.hard)) {
    return null;
  }
  if (shouldBounceSameTurnCompletion(facts.turn.sameTurnVerify)) {
    const verifyState = facts.turn.sameTurnVerify!;
    facts.emit({
      type: "verify_gap",
      roundIndex: facts.roundIndex,
      message: formatSameTurnVerifyLawyerProgress(verifyState.issues.map((issue) => issue.code)),
    });
    return {
      status: "completed",
      reason: "tool_budget",
      reply: facts.wordRevision
        ? formatWordRevisionCapStop()
        : formatSameTurnVerifyCapDeliver(verifyState),
    };
  }
  if (facts.pendingClarificationQuestions.length > 0) {
    // 步数到顶但草稿已带占位：照样交付，缺口列进回复（非阻塞），不暂停。
    facts.turn.clarificationQuestions = facts.pendingClarificationQuestions;
    return {
      status: "completed",
      reason: "tool_budget",
      reply: buildClarificationReply(
        facts.assistantText,
        facts.pendingClarificationQuestions,
        "已生成带【待核实】标注的草稿（本轮步数已到上限）。以下要点可直接在修订里改，或回复我补充：",
      ),
      consumedClarificationQuestions: true,
    };
  }
  if (facts.wordRevision) {
    const said = facts.assistantText.trim();
    const exported = hasTrackedWordArtifact(facts.turn);
    return {
      status: "completed",
      reason: "tool_budget",
      reply: exported && said ? said : formatWordRevisionCapStop(),
    };
  }
  return {
    status: "completed",
    reason: "tool_budget",
    reply: facts.assistantText.trim() || formatToolBudgetHardStopReply(),
  };
}
