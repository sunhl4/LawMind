/**
 * Same-turn verify — Codex analogue of “tests failed, keep going”.
 *
 * Lint / empty redline / missing citations / missing craft_check (deferred packet)
 * / Guardian fail are tool errors for the writer model. The turn is not complete
 * until validators are green or the bounce cap pauses.
 */

import { resolveDraftCitationIntegrity } from "../drafts/citation-resolve.js";
import { parseCraftCheckInput } from "../drafts/contract-redline-craft.js";
import { readDraft } from "../drafts/index.js";
import { readRedlinePlan } from "../drafts/redline-plan.js";
import { readRedlineProposal } from "../drafts/redline-proposal.js";
import { isInfraGuardianView } from "../guardian/legal-guardian.js";
import { readLatestGuardian } from "../guardian/store.js";
import { draftTextFromUnknown, runLegalLint } from "../lint/run-lint.js";
import { classifyResidual } from "../lint/self-revise.js";
import type { LegalLintFinding } from "../lint/types.js";
import type { GateDecisionKind } from "../platform/contracts.js";
import { withGateCategory } from "../platform/gate-category.js";

type ToolResultLike = {
  ok: boolean;
  data?: unknown;
  error?: string;
  aborted?: boolean;
  timedOut?: boolean;
  approvalRequest?: boolean;
};

export const SAME_TURN_VERIFY_BOUNCE_MAX = 3;
export const SAME_TURN_VERIFY_USER_PREFIX = "【同一回合验收未过】";
/** Persisted after a red pause; much smaller than the full bounce user message. */
export const SAME_TURN_VERIFY_DIGEST_PREFIX = "【验收缺口】";

const VERIFY_CODE_IN_BOUNCE_RE =
  /\[(empty_redline|craft_check_missing|citation_integrity|lint_mechanical|guardian_fail|xml_qa_fail)\]/g;

export type SameTurnVerifyCode =
  | "empty_redline"
  | "craft_check_missing"
  | "citation_integrity"
  | "lint_mechanical"
  | "guardian_fail"
  | "xml_qa_fail";

/** Lawyer-facing gate badge; codes stay in `issues[].code` / bounce lines. */
export const SAME_TURN_VERIFY_CODE_LABEL: Record<SameTurnVerifyCode, string> = {
  empty_redline: "空修订",
  craft_check_missing: "未附缓办",
  citation_integrity: "引用对不上来源",
  lint_mechanical: "机械核对未过",
  guardian_fail: "独立审稿未过",
  xml_qa_fail: "未见审阅痕迹",
};

export function isSameTurnVerifyCode(code: string): code is SameTurnVerifyCode {
  return Object.hasOwn(SAME_TURN_VERIFY_CODE_LABEL, code);
}

export type SameTurnVerifyIssue = {
  code: SameTurnVerifyCode;
  message: string;
  gate: GateDecisionKind;
  nextTool?:
    | "apply_surgical_edits"
    | "update_draft"
    | "draft_document"
    | "search_statute"
    | "render_tracked_draft"
    | "render_document";
};

export type SameTurnVerifyTurnState = {
  red: boolean;
  issues: SameTurnVerifyIssue[];
  bounceCount: number;
  lastTool?: string;
  taskId?: string;
};

const EXPORT_TOOLS = new Set(["render_tracked_draft", "prepare_outbound_mail", "render_document"]);
const VERIFY_TOOLS = new Set([
  "apply_surgical_edits",
  "update_draft",
  "draft_document",
  "render_tracked_draft",
  "prepare_outbound_mail",
  "render_document",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function taskIdFrom(
  data: Record<string, unknown> | undefined,
  args?: Record<string, unknown>,
): string | undefined {
  const fromData = typeof data?.taskId === "string" ? data.taskId.trim() : "";
  if (fromData) {
    return fromData;
  }
  const fromArgs =
    (typeof args?.task_id === "string" && args.task_id.trim()) ||
    (typeof args?.draft_task_id === "string" && args.draft_task_id.trim()) ||
    "";
  return fromArgs || undefined;
}

export function emptySameTurnVerifyState(): SameTurnVerifyTurnState {
  return { red: false, issues: [], bounceCount: 0 };
}

export function formatSameTurnVerifyError(issues: SameTurnVerifyIssue[]): string {
  if (issues.length === 0) {
    return `${SAME_TURN_VERIFY_USER_PREFIX}验证器未绿。请补改后重试，不要回复已完成。`;
  }
  const next = issues.find((i) => i.nextTool)?.nextTool ?? "apply_surgical_edits";
  const lines = [
    `${SAME_TURN_VERIFY_USER_PREFIX}验证器未绿，本回合不得结束。请立即调用 ${next}，不要回复「已完成」。`,
  ];
  for (const issue of issues.slice(0, 6)) {
    lines.push(`- [${issue.code}] ${issue.message}`);
  }
  return lines.join("\n");
}

/** Short gate badge / JSON reason — not a second copy of the bounce envelope. */
export function formatSameTurnVerifyCodesReason(codes: string[], nextTool?: string): string {
  const labels = [
    ...new Set(codes.filter(isSameTurnVerifyCode).map((c) => SAME_TURN_VERIFY_CODE_LABEL[c])),
  ];
  const head = labels.length > 0 ? `验收未过：${labels.join("、")}` : "验收未过";
  return nextTool ? `${head}，请再交 ${nextTool}` : head;
}

export function formatSameTurnVerifyGateReason(issues: SameTurnVerifyIssue[]): string {
  return formatSameTurnVerifyCodesReason(
    issues.map((i) => i.code),
    issues.find((i) => i.nextTool)?.nextTool,
  );
}

export function formatSameTurnCompletionBounce(state: SameTurnVerifyTurnState): string {
  return formatSameTurnVerifyError(state.issues);
}

export function formatSameTurnVerifyPaused(state: SameTurnVerifyTurnState): string {
  return [
    formatSameTurnVerifyError(state.issues),
    "已多次停止改稿，本回合未完成。可点继续，或在对话里接着改。",
  ].join("\n");
}

/** Minimal history row — avoids importing agent types into this runtime module. */
export type SameTurnVerifyHistoryMessage = {
  role: string;
  content: string;
  timestamp: string;
  hiddenFromLawyer?: boolean;
};

export type SameTurnVerifyCollapseMode = "keep_latest_full" | "digest" | "drop";

export function isSameTurnVerifyBounceMessage(
  msg: Pick<SameTurnVerifyHistoryMessage, "role" | "content" | "hiddenFromLawyer">,
): boolean {
  if (msg.role !== "user" || msg.hiddenFromLawyer !== true) {
    return false;
  }
  return (
    msg.content.startsWith(SAME_TURN_VERIFY_USER_PREFIX) ||
    msg.content.startsWith(SAME_TURN_VERIFY_DIGEST_PREFIX)
  );
}

export function isSameTurnVerifyFullBounceMessage(
  msg: Pick<SameTurnVerifyHistoryMessage, "role" | "content" | "hiddenFromLawyer">,
): boolean {
  return (
    msg.role === "user" &&
    msg.hiddenFromLawyer === true &&
    msg.content.startsWith(SAME_TURN_VERIFY_USER_PREFIX)
  );
}

export function formatSameTurnVerifyDigest(codes: string[], red: boolean): string {
  const list = codes.length > 0 ? codes.join("、") : "verify";
  return red
    ? `${SAME_TURN_VERIFY_DIGEST_PREFIX}仍红：${list}`
    : `${SAME_TURN_VERIFY_DIGEST_PREFIX}已处理：${list}`;
}

export function collectSameTurnVerifyCodesFromMessages(
  messages: SameTurnVerifyHistoryMessage[],
  issues?: SameTurnVerifyIssue[],
): SameTurnVerifyCode[] {
  const codes: SameTurnVerifyCode[] = [];
  const seen = new Set<string>();
  const push = (code: string): void => {
    if (!isSameTurnVerifyCode(code) || seen.has(code)) {
      return;
    }
    seen.add(code);
    codes.push(code);
  };
  for (const issue of issues ?? []) {
    push(issue.code);
  }
  if (codes.length > 0) {
    return codes;
  }
  for (const msg of messages) {
    if (!isSameTurnVerifyBounceMessage(msg)) {
      continue;
    }
    VERIFY_CODE_IN_BOUNCE_RE.lastIndex = 0;
    let match: RegExpExecArray | null = VERIFY_CODE_IN_BOUNCE_RE.exec(msg.content);
    while (match) {
      push(match[1] ?? "");
      match = VERIFY_CODE_IN_BOUNCE_RE.exec(msg.content);
    }
  }
  return codes;
}

/**
 * Bounce user messages are for the *next sample only*.
 * - keep_latest_full: still red, about to sample — one full bounce, drop duplicates.
 * - digest: still red at persist/pause — one short code line for resume.
 * - drop: validators green — delete bounce rows (tool error already in history).
 */
export function collapseSameTurnVerifyBounces<T extends SameTurnVerifyHistoryMessage>(
  messages: T[],
  opts: {
    red: boolean;
    issues?: SameTurnVerifyIssue[];
    mode: SameTurnVerifyCollapseMode;
  },
): { messages: T[]; removedFullBounces: number } {
  const bounceIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (isSameTurnVerifyBounceMessage(messages[i])) {
      bounceIndexes.push(i);
    }
  }
  if (bounceIndexes.length === 0) {
    return { messages, removedFullBounces: 0 };
  }

  if (opts.mode === "drop") {
    let removedFullBounces = 0;
    const next = messages.filter((msg) => {
      if (!isSameTurnVerifyBounceMessage(msg)) {
        return true;
      }
      if (isSameTurnVerifyFullBounceMessage(msg)) {
        removedFullBounces += 1;
      }
      return false;
    });
    return { messages: next, removedFullBounces };
  }

  if (opts.mode === "keep_latest_full") {
    const lastFull = [...bounceIndexes]
      .toReversed()
      .find((i) => isSameTurnVerifyFullBounceMessage(messages[i]));
    if (lastFull === undefined) {
      return { messages, removedFullBounces: 0 };
    }
    let removedFullBounces = 0;
    const next = messages.filter((msg, i) => {
      if (!isSameTurnVerifyBounceMessage(msg)) {
        return true;
      }
      if (i === lastFull) {
        return true;
      }
      if (isSameTurnVerifyFullBounceMessage(msg)) {
        removedFullBounces += 1;
      }
      return false;
    });
    return { messages: next, removedFullBounces };
  }

  const codes = collectSameTurnVerifyCodesFromMessages(messages, opts.issues);
  const lastIdx = bounceIndexes[bounceIndexes.length - 1];
  const last = messages[lastIdx];
  const digest = {
    ...last,
    role: "user",
    content: formatSameTurnVerifyDigest(codes, opts.red),
    hiddenFromLawyer: true,
  } as T;
  let removedFullBounces = 0;
  const next: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!isSameTurnVerifyBounceMessage(msg)) {
      next.push(msg);
      continue;
    }
    if (isSameTurnVerifyFullBounceMessage(msg)) {
      removedFullBounces += 1;
    }
    if (i === lastIdx) {
      next.push(digest);
    }
  }
  return { messages: next, removedFullBounces };
}

export function applySameTurnVerifyHistoryCollapse(
  session: { conversationHistory: SameTurnVerifyHistoryMessage[] },
  turn: {
    messages: SameTurnVerifyHistoryMessage[];
    sameTurnVerify?: SameTurnVerifyTurnState;
  },
  mode: SameTurnVerifyCollapseMode,
): { removedFullBounces: number } {
  const red = Boolean(turn.sameTurnVerify?.red);
  const issues = turn.sameTurnVerify?.issues;
  const hist = collapseSameTurnVerifyBounces(session.conversationHistory, { red, issues, mode });
  session.conversationHistory = hist.messages;
  const turnMsgs = collapseSameTurnVerifyBounces(turn.messages, { red, issues, mode });
  turn.messages = turnMsgs.messages;
  return { removedFullBounces: hist.removedFullBounces };
}

export function collapseSameTurnVerifyHistoryForTurnEnd(
  session: { conversationHistory: SameTurnVerifyHistoryMessage[] },
  turn: {
    messages: SameTurnVerifyHistoryMessage[];
    sameTurnVerify?: SameTurnVerifyTurnState;
  },
): { removedFullBounces: number } {
  const mode: SameTurnVerifyCollapseMode = shouldBounceSameTurnCompletion(turn.sameTurnVerify)
    ? "digest"
    : "drop";
  return applySameTurnVerifyHistoryCollapse(session, turn, mode);
}

export function failToolWithSameTurnVerify(
  result: ToolResultLike,
  issues: SameTurnVerifyIssue[],
): ToolResultLike {
  if (issues.length === 0) {
    return result;
  }
  const message = formatSameTurnVerifyError(issues);
  const primary = issues[0];
  const verifyRest = { ...asRecord(asRecord(result.data)?.verify) };
  delete verifyRest.message;
  const data = {
    ...asRecord(result.data),
    // Full coach lives on `error` (and bounce user row). Do not triple-copy it
    // into verify.message / gateDecision.reason — codes + issue rows stay.
    verify: {
      ...verifyRest,
      codes: issues.map((i) => i.code),
      nextTool: primary.nextTool,
    },
    sameTurnVerify: { red: true as const, issues },
    gateDecision: withGateCategory({
      gate: primary.gate,
      decision: "block",
      reason: formatSameTurnVerifyGateReason(issues),
    }),
  };
  return {
    ...result,
    ok: false,
    error: message,
    data,
  };
}

function issueXmlQaFail(): SameTurnVerifyIssue {
  return {
    code: "xml_qa_fail",
    gate: "redline_hunks_gate",
    nextTool: "render_tracked_draft",
    message:
      "导出文件的 XML 未见审阅痕迹，不能当作已完成。请原样重交 render_tracked_draft，不要为此落改。",
  };
}

function issueEmptyRedline(
  nextTool: SameTurnVerifyIssue["nextTool"] = "apply_surgical_edits",
): SameTurnVerifyIssue {
  return {
    code: "empty_redline",
    gate: "redline_hunks_gate",
    nextTool,
    message:
      "未产生可核验修订（redlinePending=0）。请用最短 find/replace 再交 apply_surgical_edits，并附 craft_check.deferred（无缓办则 []）。",
  };
}

function issueCraftCheckMissing(): SameTurnVerifyIssue {
  return {
    code: "craft_check_missing",
    gate: "reasoning_gate",
    nextTool: "apply_surgical_edits",
    message:
      "未附 craft_check。请在同一调用中附 craft_check.deferred（无缓办则 []）后重交 apply_surgical_edits。",
  };
}

function issueCitation(missing: string[]): SameTurnVerifyIssue {
  return {
    code: "citation_integrity",
    gate: "citation_integrity_gate",
    nextTool: "update_draft",
    message:
      missing.length > 0
        ? `引用对不上来源：${missing.slice(0, 4).join("、")} 不在本次检索结果中。请改正 citations 或重检索后重交，不要回复已完成。`
        : "引用对不上来源。请改正 citations 或重检索后重交，不要回复已完成。",
  };
}

function issueLint(ruleIds: string[]): SameTurnVerifyIssue {
  return {
    code: "lint_mechanical",
    gate: "acceptance_gate",
    nextTool: "update_draft",
    message: `机械核对未过（${ruleIds.slice(0, 4).join("、")}）。请按缺口改稿后重交，不要回复已完成。`,
  };
}

function issueGuardian(
  gaps?: unknown,
  nextTool: SameTurnVerifyIssue["nextTool"] = "apply_surgical_edits",
  skipReason?: unknown,
): SameTurnVerifyIssue {
  const detail: string[] = [];
  const gapRows: Array<{ code?: string; message?: string }> = [];
  if (Array.isArray(gaps)) {
    for (const row of gaps) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        continue;
      }
      const rec = row as { code?: unknown; message?: unknown };
      const message = rec.message;
      const code = typeof rec.code === "string" ? rec.code : "";
      if (typeof message === "string" && message.trim()) {
        detail.push(message.trim());
        gapRows.push({ code, message: message.trim() });
      }
      if (detail.length >= 4) {
        break;
      }
    }
  }
  const infra = isInfraGuardianView({
    verdict: "fail",
    skipReason: typeof skipReason === "string" ? skipReason : undefined,
    gaps: gapRows
      .filter((g) => g.code && g.message)
      .map((g) => ({ code: g.code!, message: g.message! })),
  });
  if (infra) {
    return {
      code: "guardian_fail",
      gate: "legal_guardian_gate",
      nextTool: nextTool === "update_draft" ? "render_document" : "render_tracked_draft",
      message:
        "独立审稿引擎未能读出结果。请原样重交本次导出，不要落改、不要改审稿措辞、不要把内部故障码写给律师。",
    };
  }
  return {
    code: "guardian_fail",
    gate: "legal_guardian_gate",
    nextTool,
    message: detail.length
      ? `独立审稿未过：${detail.join("；")}。请补改或补缓办后重交，不要回复已完成。`
      : "独立审稿未过。请按工具结果中的缺口补改或补缓办后重交，不要回复已完成。",
  };
}

function craftCheckPresent(
  args?: Record<string, unknown>,
  data?: Record<string, unknown>,
): boolean {
  if (parseCraftCheckInput(args?.craft_check)) {
    return true;
  }
  const stored = data?.craftCheck;
  if (stored === null) {
    return false;
  }
  return Boolean(parseCraftCheckInput(stored));
}

function isContractEditPayload(data?: Record<string, unknown>): boolean {
  return Boolean(data?.contractEdit);
}

function findingsFromLintReport(data?: Record<string, unknown>): LegalLintFinding[] {
  const report = asRecord(data?.lintReport);
  const raw = report?.findings;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: LegalLintFinding[] = [];
  for (const row of raw) {
    const rec = asRecord(row);
    if (!rec || typeof rec.ruleId !== "string" || typeof rec.severity !== "string") {
      continue;
    }
    if (rec.severity !== "blocker" && rec.severity !== "warning" && rec.severity !== "info") {
      continue;
    }
    out.push({
      ruleId: rec.ruleId,
      family: typeof rec.family === "string" ? (rec.family as LegalLintFinding["family"]) : "meta",
      severity: rec.severity,
      message: typeof rec.message === "string" ? rec.message : "",
      fixable: rec.fixable === true,
    });
  }
  return out;
}

/** Rule ids carried by the export lint gate on render_document / render_tracked_draft. */
function lintBlockerRuleIdsFromData(data?: Record<string, unknown>): string[] {
  const raw = data?.lintBlockerRuleIds;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((id): id is string => typeof id === "string");
}

function mechanicalBlockerIdsFromLintReport(data?: Record<string, unknown>): string[] {
  const { residualMechanical } = classifyResidual(findingsFromLintReport(data));
  return residualMechanical.filter((f) => f.severity === "blocker").map((f) => f.ruleId);
}

function redlinePendingOf(data?: Record<string, unknown>): number | undefined {
  if (typeof data?.redlinePending === "number" && Number.isFinite(data.redlinePending)) {
    return data.redlinePending;
  }
  return undefined;
}

function issuesFromStored(data?: Record<string, unknown>): SameTurnVerifyIssue[] {
  const raw = asRecord(data?.sameTurnVerify)?.issues;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: SameTurnVerifyIssue[] = [];
  for (const row of raw) {
    const rec = asRecord(row);
    if (!rec) {
      continue;
    }
    const code = rec.code;
    if (typeof code !== "string" || !isSameTurnVerifyCode(code)) {
      continue;
    }
    if (typeof rec.message !== "string" || !rec.message.trim()) {
      continue;
    }
    const gate = rec.gate;
    if (typeof gate !== "string") {
      continue;
    }
    out.push({
      code,
      message: rec.message,
      gate: gate as GateDecisionKind,
      ...(typeof rec.nextTool === "string"
        ? { nextTool: rec.nextTool as SameTurnVerifyIssue["nextTool"] }
        : {}),
    });
  }
  return out;
}

/** Collect issues from a tool result (after execute). Does not flip ok. */
export function collectSameTurnVerifyIssues(input: {
  toolName: string;
  result: ToolResultLike;
  args?: Record<string, unknown>;
}): SameTurnVerifyIssue[] {
  const stored = issuesFromStored(asRecord(input.result.data));
  if (stored.length > 0) {
    return stored;
  }
  const data = asRecord(input.result.data);
  const gate = asRecord(data?.gateDecision);
  const issues: SameTurnVerifyIssue[] = [];
  const toolName = input.toolName;

  if (toolName === "draft_document" || toolName === "update_draft") {
    const integrity = asRecord(data?.citationIntegrity);
    if (integrity?.checked === true && integrity.ok === false) {
      const missing = Array.isArray(integrity.missingSourceIds)
        ? integrity.missingSourceIds.filter((id): id is string => typeof id === "string")
        : [];
      issues.push(issueCitation(missing));
    }
  }

  if (input.result.ok) {
    if (toolName === "apply_surgical_edits") {
      const pending = redlinePendingOf(data);
      if (pending === 0 || gate?.gate === "redline_hunks_gate") {
        issues.push(issueEmptyRedline());
      }
      if (!craftCheckPresent(input.args, data)) {
        issues.push(issueCraftCheckMissing());
      }
    }

    if (toolName === "update_draft") {
      const warning = typeof data?.warning === "string" ? data.warning : "";
      if (gate?.gate === "redline_hunks_gate" || warning.includes("redlinePending=0")) {
        issues.push(issueEmptyRedline("apply_surgical_edits"));
      }
    }

    if (
      (toolName === "draft_document" || toolName === "update_draft") &&
      !isContractEditPayload(data)
    ) {
      const lintIds = mechanicalBlockerIdsFromLintReport(data);
      if (lintIds.length > 0) {
        issues.push(issueLint(lintIds));
      }
    }

    return dedupeIssues(issues);
  }

  if (toolName === "render_tracked_draft") {
    if (data?.code === "redline_hunks_required" || gate?.gate === "redline_hunks_gate") {
      issues.push(issueEmptyRedline());
    }
    if (data?.code === "xml_qa_no_tracks" || asRecord(data?.xmlQa)?.ok === false) {
      issues.push(issueXmlQaFail());
    }
    if (data?.code === "craft_check_required") {
      issues.push(issueCraftCheckMissing());
    }
    if (data?.code === "legal_guardian_fail" || gate?.gate === "legal_guardian_gate") {
      const guardian = asRecord(data?.guardian);
      issues.push(issueGuardian(guardian?.gaps, "apply_surgical_edits", guardian?.skipReason));
    }
    if (data?.code === "lint_mechanical") {
      issues.push(issueLint(lintBlockerRuleIdsFromData(data)));
    }
  }

  if (toolName === "render_document") {
    if (data?.code === "legal_guardian_fail" || gate?.gate === "legal_guardian_gate") {
      const guardian = asRecord(data?.guardian);
      issues.push(issueGuardian(guardian?.gaps, "update_draft", guardian?.skipReason));
    }
    if (data?.code === "lint_mechanical") {
      issues.push(issueLint(lintBlockerRuleIdsFromData(data)));
    }
  }

  if (toolName === "prepare_outbound_mail") {
    if (gate?.gate === "redline_hunks_gate") {
      issues.push(issueEmptyRedline());
    }
    if (gate?.gate === "citation_integrity_gate") {
      issues.push(issueCitation([]));
    }
    if (gate?.gate === "acceptance_gate") {
      issues.push(issueLint([]));
    }
    if (gate?.gate === "reasoning_gate") {
      issues.push(issueCraftCheckMissing());
    }
  }

  return dedupeIssues(issues);
}

function dedupeIssues(issues: SameTurnVerifyIssue[]): SameTurnVerifyIssue[] {
  const seen = new Set<string>();
  const out: SameTurnVerifyIssue[] = [];
  for (const issue of issues) {
    if (seen.has(issue.code)) {
      continue;
    }
    seen.add(issue.code);
    out.push(issue);
  }
  return out;
}

/**
 * Flip ok when same-turn validators are red.
 * Already-failed results keep ok:false and get the same-turn error envelope when issues exist.
 */
export function applySameTurnVerifyFail(
  toolName: string,
  result: ToolResultLike,
  args?: Record<string, unknown>,
): ToolResultLike {
  if (result.aborted || result.timedOut || result.approvalRequest) {
    return result;
  }
  const issues = collectSameTurnVerifyIssues({ toolName, result, args });
  if (issues.length === 0) {
    return result;
  }
  return failToolWithSameTurnVerify(result, issues);
}

function mechanicalLintBlockers(text: string, deliverableType?: string): string[] {
  if (text.trim().length < 20) {
    return [];
  }
  const report = runLegalLint(text, undefined, undefined, undefined, { deliverableType });
  const { residualMechanical } = classifyResidual(report.findings);
  return residualMechanical.filter((f) => f.severity === "blocker").map((f) => f.ruleId);
}

/** Pre-execute gate for prepare_outbound_mail when a draft is linked. */
export function precheckOutboundSameTurnVerify(input: {
  toolName: string;
  args: Record<string, unknown>;
  workspaceDir?: string;
}): ToolResultLike | undefined {
  if (input.toolName !== "prepare_outbound_mail") {
    return undefined;
  }
  const taskId =
    typeof input.args.draft_task_id === "string" ? input.args.draft_task_id.trim() : "";
  const workspaceDir = input.workspaceDir?.trim();
  if (!taskId || !workspaceDir) {
    return undefined;
  }
  let draft;
  try {
    draft = readDraft(workspaceDir, taskId);
  } catch {
    return undefined;
  }
  if (!draft) {
    return undefined;
  }
  const issues: SameTurnVerifyIssue[] = [];
  const citation = resolveDraftCitationIntegrity(workspaceDir, draft);
  if (citation.checked && !citation.ok) {
    issues.push(issueCitation(citation.missingSourceIds));
  }
  if (draft.contractEdit) {
    const proposal = readRedlineProposal(workspaceDir, taskId);
    const hunks = (proposal?.hunks ?? []).filter((h) => h.status !== "rejected");
    if (hunks.length < 1) {
      issues.push(issueEmptyRedline());
    }
    const plan = readRedlinePlan(workspaceDir, taskId);
    if (!plan?.craftCheckAttached) {
      issues.push(issueCraftCheckMissing());
    }
    const guardian = readLatestGuardian(workspaceDir, taskId);
    if (guardian?.verdict === "fail") {
      issues.push(issueGuardian(guardian.gaps, "apply_surgical_edits", guardian.skipReason));
    }
  }
  // 意见正文（标题+栏目，非红线 hunk）一律过机械核对；contractEdit 不豁免。
  const text = draftTextFromUnknown({
    draft: { title: draft.title, sections: draft.sections },
  });
  const lintIds = mechanicalLintBlockers(text, draft.deliverableType);
  if (lintIds.length > 0) {
    issues.push(issueLint(lintIds));
  }
  if (issues.length === 0) {
    return undefined;
  }
  return failToolWithSameTurnVerify(
    { ok: true, data: { taskId, code: "same_turn_verify" } },
    issues,
  );
}

export function nextSameTurnVerifyState(
  prev: SameTurnVerifyTurnState | undefined,
  toolName: string,
  result: ToolResultLike,
  args?: Record<string, unknown>,
): SameTurnVerifyTurnState {
  const base = prev ?? emptySameTurnVerifyState();
  if (!VERIFY_TOOLS.has(toolName)) {
    return base;
  }
  const issues = collectSameTurnVerifyIssues({ toolName, result, args });
  const data = asRecord(result.data);
  const taskId = taskIdFrom(data, args) ?? base.taskId;
  if (issues.length > 0) {
    return {
      red: true,
      issues,
      bounceCount: base.bounceCount,
      lastTool: toolName,
      taskId,
    };
  }
  if (result.ok) {
    return {
      red: false,
      issues: [],
      bounceCount: 0,
      lastTool: toolName,
      taskId,
    };
  }
  if (EXPORT_TOOLS.has(toolName)) {
    return base;
  }
  return base;
}

export function shouldBounceSameTurnCompletion(
  state: SameTurnVerifyTurnState | undefined,
): boolean {
  return Boolean(state?.red && state.issues.length > 0);
}

export function shouldPauseSameTurnVerify(state: SameTurnVerifyTurnState | undefined): boolean {
  return (
    shouldBounceSameTurnCompletion(state) &&
    (state?.bounceCount ?? 0) >= SAME_TURN_VERIFY_BOUNCE_MAX
  );
}
