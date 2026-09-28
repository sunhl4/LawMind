/**
 * Legal Guardian — bounded evidence + pass/fail parse.
 * Independent of the writer session. Mechanical gates stay facts; this only
 * judges residual coverage / honest deferral / citation support.
 */

import type { DraftCitationIntegrityView } from "../drafts/citation-integrity.js";
import type { RedlineHunk } from "../drafts/redline-proposal.js";
import { resolveEdition } from "../policy/edition.js";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import type { ArtifactDraft, LegalReasoningGraph, ResearchBundle } from "../types.js";
import {
  LEGAL_GUARDIAN_MAX_ROUNDS,
  type GuardianAction,
  type GuardianChecklistItem,
  type GuardianCitationEvidence,
  type GuardianEvidencePack,
  type GuardianGap,
  type GuardianHunkEvidence,
  type GuardianIssueEvidence,
  type GuardianLawyerView,
  type GuardianRecord,
  type GuardianSectionEvidence,
} from "./types.js";

export {
  LEGAL_GUARDIAN_MAX_ROUNDS,
  type GuardianAction,
  type GuardianChecklistItem,
  type GuardianCitationEvidence,
  type GuardianEvidencePack,
  type GuardianGap,
  type GuardianHunkEvidence,
  type GuardianIssueEvidence,
  type GuardianLawyerView,
  type GuardianRecord,
  type GuardianSectionEvidence,
  type GuardianVerdict,
} from "./types.js";

/** 单条文字截断，避免一条超长段落撑爆窗口。不按条数丢掉修订、章节或核对项。 */
/** Clause-length clips — not a 80-char starve. Sidecar envelope can hold this. */
const CLIP_SPAN = 400;
const CLIP_ANCHOR = 320;
const CLIP_SECTION = 800;
const CLIP_MSG = 240;

const DOCUMENT_GUARDIAN_EXACT = new Set(["memo.opinion", "memo.research", "contract.review"]);

/** Opinion / letter / pleading Word export — not internal memos, PPT, or tracked redline. */
export function shouldRunLegalGuardianForDocument(
  draft: Pick<ArtifactDraft, "deliverableType" | "contractEdit">,
): boolean {
  if (draft.contractEdit) {
    return false;
  }
  const dt = (draft.deliverableType ?? "").trim();
  if (!dt) {
    return false;
  }
  if (DOCUMENT_GUARDIAN_EXACT.has(dt)) {
    return true;
  }
  return dt.startsWith("letter.") || dt.startsWith("litigation.");
}

export function isLegalGuardianEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.LAWMIND_LEGAL_GUARDIAN?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

/** 全文指纹，不依赖 Node。截断进提示词的正文变了，哈希也会变。 */
export function fingerprintText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function clipGuardianText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

export function extractAnchorContext(body: string, needle: string, radius = 72): string {
  const hay = body ?? "";
  const n = needle.trim();
  if (!n) {
    return clipGuardianText(hay, CLIP_ANCHOR);
  }
  const idx = hay.indexOf(n);
  if (idx < 0) {
    return clipGuardianText(hay, CLIP_ANCHOR);
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(hay.length, idx + n.length + radius);
  const slice = hay.slice(start, end);
  return `${start > 0 ? "…" : ""}${slice}${end < hay.length ? "…" : ""}`;
}

function sectionBody(draft: ArtifactDraft, sectionIndex: number): string {
  return draft.sections[sectionIndex]?.body ?? "";
}

export function slimGuardianView(record: GuardianRecord): GuardianLawyerView {
  return {
    verdict: record.verdict,
    round: record.round,
    maxRounds: record.maxRounds,
    gaps: record.gaps.map((g) => ({
      code: g.code,
      message: g.message,
      ...(g.evidenceRef ? { evidenceRef: g.evidenceRef } : {}),
    })),
    ...(record.skipReason ? { skipReason: record.skipReason } : {}),
  };
}

const INFRA_SKIP_REASONS = new Set(["reviewer_error", "unreadable"]);
const INFRA_GAP_CODES = new Set(["guardian_unreadable", "guardian_error"]);
const VERDICT_PASS = new Set(["pass", "ok", "true", "通过", "合格"]);
const VERDICT_FAIL = new Set(["fail", "false", "未过", "不通过", "不合格"]);

export function isInfraGuardianFail(
  record: Pick<GuardianRecord, "verdict" | "skipReason"> | undefined,
): boolean {
  return (
    record?.verdict === "fail" &&
    Boolean(record.skipReason && INFRA_SKIP_REASONS.has(record.skipReason))
  );
}

export function isInfraGuardianGapCode(code: string): boolean {
  return INFRA_GAP_CODES.has(code);
}

/** Writer bounce: parse/network miss, not a coverage gap. */
export function isInfraGuardianView(
  view: Pick<GuardianLawyerView, "verdict" | "skipReason" | "gaps"> | undefined,
): boolean {
  if (!view) {
    return false;
  }
  if (isInfraGuardianFail(view)) {
    return true;
  }
  return view.gaps.some((g) => isInfraGuardianGapCode(g.code));
}

/**
 * 带修订轨的稿子是否「不过独立审稿就不许导出」。
 *
 * 解析顺序（都在 `apply` 与导出路径同源，避免两处口径漂移）：
 * 1. policy `guardianTrackedRedline`（显式 `block` / `advisory`）；
 * 2. env `LAWMIND_GUARDIAN_TRACKED_REDLINE`（显式 `block` / `advisory`）；
 * 3. edition 缺省 `guardianTrackedRedlineBlock`：**solo 关 → advisory；firm / private_deploy 开 → block**。
 *
 * 为什么这样分档：
 * - `advisory`：审稿照跑，缺口如实写进结果交律师（Word 里逐处可接受/拒绝），但不阻断导出。
 *   `shouldRunLegalGuardianForDocument` 对 `draft.contractEdit` 本来就是**豁免**的——
 *   带修订轨的稿不是最终交付物，真正外发仍由 `send_email` 独立把关；把 tracked 导出也按
 *   `block` 处理会让「审稿 2 轮未过」打断整条无人值守改稿，律师只看到「没有结果」。
 * - `block`：律所/私有部署里「未过独立审稿的稿子流出去」代价更高，保留硬墙。
 *
 * 未知取值（含拼写错误）按所在 edition 的缺省处理，不把写错的配置当成硬墙或免检。
 */
export function resolveGuardianTrackedRedlinePosture(input?: {
  policy?: { guardianTrackedRedline?: unknown } | null;
  env?: NodeJS.ProcessEnv;
}): "block" | "advisory" {
  const fromPolicy = input?.policy?.guardianTrackedRedline;
  if (fromPolicy === "block" || fromPolicy === "advisory") {
    return fromPolicy;
  }
  const raw = (input?.env ?? process.env).LAWMIND_GUARDIAN_TRACKED_REDLINE?.trim().toLowerCase();
  if (raw === "block" || raw === "advisory") {
    return raw;
  }
  // 调用方可能只带一个字段（测试/局部配置），按 edition 解析只用到 edition 与 features。
  const editionPolicy = (input?.policy ?? null) as LawMindWorkspacePolicy | null;
  return resolveEdition({ policy: editionPolicy, env: input?.env }).features
    .guardianTrackedRedlineBlock
    ? "block"
    : "advisory";
}

export function guardianBlocksExport(
  record: Pick<GuardianRecord, "verdict"> & { gaps?: readonly GuardianGap[] },
): boolean {
  if (record.verdict !== "fail") {
    return false;
  }
  const gaps = record.gaps ?? [];
  // 只有提示备注，或轮次上限是被这些备注耗尽的：备注可见，但不挡 Word。
  // 夹着未覆盖、缺答等实质缺口时仍然拦截。
  if (
    gaps.length > 0 &&
    gaps.every((gap) => gap.code === "checklist_note" || gap.code === "guardian_exhausted")
  ) {
    return false;
  }
  return true;
}

const CHECKLIST_FLOOR_CODES = new Set([
  "checklist_note",
  "checklist_not_covered",
  "checklist_unanswered",
  "checklist_unknown_item",
  "guardian_exhausted",
]);

/**
 * 收工补导出时，缺口若全是检查单（含未覆盖、缺答），不扣下已经改好的 Word。
 * 引用对不上、机械核对未过，仍然拦住。
 */
export function guardianChecklistGapsOnly(
  record: Pick<GuardianRecord, "verdict"> & { gaps?: readonly GuardianGap[] },
): boolean {
  if (record.verdict !== "fail") {
    return false;
  }
  const gaps = record.gaps ?? [];
  return gaps.length > 0 && gaps.every((gap) => CHECKLIST_FLOOR_CODES.has(gap.code));
}

export function buildGuardianEvidencePack(input: {
  draft: ArtifactDraft;
  hunks?: RedlineHunk[];
  allowEmptyRedline?: boolean;
  action?: GuardianAction;
  citation?: DraftCitationIntegrityView;
  bundle?: ResearchBundle;
  graph?: Pick<LegalReasoningGraph, "issueTree">;
  checklist?: { family?: string; stance?: string; items: GuardianChecklistItem[] };
  confirmedAnswers?: Record<string, string>;
  writerDeferred?: Array<{ issue?: string; reason?: string }>;
  spanSkippedCount?: number;
  acceptanceReady?: boolean;
  prior?: Pick<GuardianRecord, "round" | "verdict" | "gaps"> | null;
}): GuardianEvidencePack {
  const action: GuardianAction = input.action ?? "render_tracked_draft";
  const allowEmptyRedline = input.allowEmptyRedline === true;
  const liveHunks = (input.hunks ?? []).filter((h) => h.status !== "rejected");
  const hunks: GuardianHunkEvidence[] = liveHunks.map((h) => {
    const body = sectionBody(input.draft, h.sectionIndex);
    const needle = h.after || h.before;
    return {
      hunkId: h.hunkId,
      ...(h.sectionHeading ? { heading: clipGuardianText(h.sectionHeading, 40) } : {}),
      before: clipGuardianText(h.before, CLIP_SPAN),
      after: clipGuardianText(h.after, CLIP_SPAN),
      anchor: extractAnchorContext(body, needle),
      ...(h.rationale ? { rationale: clipGuardianText(h.rationale, 80) } : {}),
    };
  });

  const used = new Map<string, string[]>();
  for (const sec of input.draft.sections) {
    for (const id of sec.citations ?? []) {
      const key = id.trim();
      if (!key) {
        continue;
      }
      const headings = used.get(key) ?? [];
      headings.push(clipGuardianText(sec.heading, 40));
      used.set(key, headings);
    }
  }
  const citations: GuardianCitationEvidence[] = [];
  const bundleSources = input.bundle?.sources ?? [];
  for (const src of bundleSources) {
    citations.push({
      id: src.id,
      title: clipGuardianText(src.title, 80),
      ...(src.citation ? { citation: clipGuardianText(src.citation, 80) } : {}),
      usedInHeadings: used.get(src.id) ?? [],
    });
  }
  for (const [id, headings] of used) {
    if (citations.some((c) => c.id === id)) {
      continue;
    }
    citations.push({ id, usedInHeadings: headings });
  }

  const answers = Object.entries(input.confirmedAnswers ?? {})
    .filter(([k, v]) => k.trim() && v.trim() && !k.startsWith("__"))
    .map(([key, value]) => ({
      key: clipGuardianText(key, 40),
      value: clipGuardianText(value, 80),
    }));

  const citationView = input.citation;
  const citationOk = citationView?.checked === true ? citationView.ok : undefined;
  const citationMissing =
    citationView?.checked === true ? citationView.missingSourceIds : undefined;

  const prior = input.prior
    ? {
        round: input.prior.round,
        verdict: input.prior.verdict,
        gaps: input.prior.gaps,
      }
    : null;

  const sections: GuardianSectionEvidence[] =
    action === "render_document"
      ? input.draft.sections.map((sec) => {
          const full = sec.body ?? "";
          return {
            heading: clipGuardianText(sec.heading || "节", 40),
            body: clipGuardianText(full, CLIP_SECTION),
            bodyFingerprint: fingerprintText(full),
            citations: (sec.citations ?? []).slice(0, 6).map((id) => id),
          };
        })
      : [];

  const issues: GuardianIssueEvidence[] = (input.graph?.issueTree ?? []).map((node) => ({
    issue: clipGuardianText(node.issue, 80),
    authorityIds: (node.authorityIds ?? []).slice(0, 6).map((id) => id),
    openQuestions: (node.openQuestions ?? []).slice(0, 3).map((q) => clipGuardianText(q, 60)),
  }));

  return {
    action,
    taskId: input.draft.taskId,
    title: clipGuardianText(
      input.draft.title || (action === "render_document" ? "法律意见" : "合同审阅稿"),
      80,
    ),
    ...(input.draft.deliverableType ? { deliverableType: input.draft.deliverableType } : {}),
    confirmedAnswers: answers,
    hunks,
    sections,
    issues,
    citations,
    checklist: {
      ...(input.checklist?.family ? { family: input.checklist.family } : {}),
      ...(input.checklist?.stance ? { stance: input.checklist.stance } : {}),
      items: input.checklist?.items ?? [],
    },
    gates: {
      ...(action === "render_tracked_draft"
        ? {
            hunkGateOk: liveHunks.length >= 1 || allowEmptyRedline,
            hunkCount: liveHunks.length,
            allowEmptyRedline,
          }
        : {}),
      ...(citationOk !== undefined ? { citationIntegrityOk: citationOk } : {}),
      ...(citationMissing && citationMissing.length > 0
        ? { citationMissingIds: citationMissing }
        : {}),
      ...(typeof input.spanSkippedCount === "number"
        ? { spanSkippedCount: input.spanSkippedCount }
        : {}),
      ...(typeof input.acceptanceReady === "boolean"
        ? { acceptanceReady: input.acceptanceReady }
        : {}),
    },
    writerDeferredClaims: (input.writerDeferred ?? [])
      .filter((row) => row.issue?.trim() || row.reason?.trim())
      .map((row) => ({
        ...(row.issue ? { issue: clipGuardianText(row.issue, 80) } : {}),
        ...(row.reason ? { reason: clipGuardianText(row.reason, 80) } : {}),
      })),
    prior,
  };
}

/** Mechanical facts that fail without an LLM (REPL analogue). */
export function deterministicGuardianGaps(pack: GuardianEvidencePack): GuardianGap[] {
  const gaps: GuardianGap[] = [];
  const missing = pack.gates.citationMissingIds ?? [];
  if (pack.gates.citationIntegrityOk === false && missing.length > 0) {
    gaps.push({
      code: "citation_ids_missing",
      message: `引用 ID 不在本次检索快照中：${missing.join("、")}。请改 citations 或重检索后再交卷。`,
      evidenceRef: "gates.citationMissingIds",
    });
  }
  return gaps;
}

function stripMarkdownFence(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^```(?:json)?\s*/i, "");
  t = t.replace(/\s*```\s*$/i, "");
  return t.trim();
}

/** First balanced `{...}` so trailing prose braces do not poison JSON.parse. */
export function extractFirstJsonObject(raw: string): string | undefined {
  const text = stripMarkdownFence(raw);
  const start = text.indexOf("{");
  if (start < 0) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

function normalizeGuardianVerdict(value: unknown): "pass" | "fail" | undefined {
  if (value === "pass" || value === "fail") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const key = value.trim().toLowerCase();
  if (VERDICT_PASS.has(key) || VERDICT_PASS.has(value.trim())) {
    return "pass";
  }
  if (VERDICT_FAIL.has(key) || VERDICT_FAIL.has(value.trim())) {
    return "fail";
  }
  return undefined;
}

export function parseGuardianReviewerJson(
  raw: string,
  ctx?: GuardianParseContext,
): { verdict: "pass" | "fail"; gaps: GuardianGap[] } | undefined {
  const slice = extractFirstJsonObject(raw);
  if (!slice) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const rec = parsed as Record<string, unknown>;
  const verdict = normalizeGuardianVerdict(rec.verdict);
  if (!verdict) {
    return undefined;
  }
  const gapsRaw = Array.isArray(rec.gaps) ? rec.gaps : [];
  const gaps: GuardianGap[] = [];
  for (const row of gapsRaw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const g = row as Record<string, unknown>;
    const code = typeof g.code === "string" ? g.code.trim() : "";
    const message = typeof g.message === "string" ? g.message.trim() : "";
    if (!code || !message) {
      continue;
    }
    gaps.push({
      code: clipGuardianText(code, 48),
      message: clipGuardianText(message, CLIP_MSG),
      ...(typeof g.evidenceRef === "string" && g.evidenceRef.trim()
        ? { evidenceRef: clipGuardianText(g.evidenceRef, 80) }
        : {}),
    });
  }
  const kept = ctx?.trackedRedline
    ? gaps.filter((gap) => !isStructuralTrackedReviewGap(gap))
    : gaps;
  if (verdict === "pass" && kept.length > 0) {
    return { verdict: "fail", gaps: kept };
  }
  if (verdict === "fail" && kept.length === 0) {
    if (ctx?.trackedRedline) {
      return { verdict: "pass", gaps: [] };
    }
    return {
      verdict: "fail",
      gaps: [
        {
          code: "unspecified",
          message: "审稿员判定未过但未写具体缺口。请对照正文/hunk 与检查单补覆盖或诚实缓办后重交。",
        },
      ],
    };
  }
  return { verdict, gaps: kept };
}

export type GuardianParseContext = {
  /** 修订稿导出。不对题的检查项、审稿层空证据包都不挡住出稿。 */
  trackedRedline?: boolean;
};

export function guardianSystemPrompt(ctx?: GuardianParseContext): string {
  const lines = [
    "你是独立审稿员，不是写者。只根据证据包判断本次交卷是否可过。",
    "硬门禁结果是事实：不要重判跨度长短、空修订条数、引用 ID 是否在 bundle、验收占位符。",
  ];
  if (ctx?.trackedRedline) {
    lines.push(
      "这是修订稿导出。sections 恒为空，覆盖只看 hunks。issues 为空、writerDeferredClaims 为空、checklist.items 为空都不是缺口。",
      "citations[].usedInHeadings 为空是常态。不得因引用未被标题使用、或只有案件元数据，判未过。",
      "检查单项说的交易结构在合同和 hunk 里都不存在时，该项 applicable 为 false。这不是未覆盖，不要写 supported:false。",
      "停项和未经确认的数字：没有改、并写进了 writerDeferredClaims，或者该项本来就不适用，都算已处理。",
      "summaryGaps 只写还能靠改合同补上的漏改。检查单套不上、证据包是空的，都不要写缺口。",
      '只输出一个 JSON 对象，不要分析过程，不要 markdown 围栏：{"items":[{"id":"<checklist item id>","applicable":true,"supported":true|false,"note":"可选","evidenceRef":"可选"}],"summaryGaps":[]}',
      'applicable 为 false 时不要填 supported。checklist.items 为空则输出 {"items":[],"summaryGaps":[]}。',
    );
  } else {
    lines.push(
      "只判残留质量：(1) 实质争点是否被 hunk 或 sections 覆盖，或出现在 writerDeferredClaims；(2) 引用条目是否支撑对应断言；(3) 检查单「停」/必核项是否在正文出现。issues 只是争点树事实，不是覆盖证明。",
      "证据不足或不确定必须判 not_covered，并写出具体缺口。不得因为写者自称覆盖就算覆盖。不得编造证据包没有的争点。",
      "checklist.items 里每一项都要单独回答，互不影响；没有给出该项证据就判 not_covered。",
      '只输出一个 JSON 对象，不要分析过程，不要 markdown 围栏：{"items":[{"id":"<checklist item id>","supported":true|false,"note":"可选，中文短句","evidenceRef":"可选"}],"summaryGaps":[{"code":"snake_case","message":"中文缺口","evidenceRef":"可选"}]}',
      "若证据包里 checklist.items 为空，则只输出 summaryGaps（同样不含 verdict）。",
    );
  }
  return lines.join("\n");
}

/**
 * P2.2：逐项判定 → 代码聚合。
 *
 * 旧口径让模型**直接输出 `verdict: pass|fail`**，等于把「可过」这个结论交给模型
 * 一次生成完成。问题不是它会答错，而是**没有可审计的中间步骤**：
 * 律师看不到「哪几项判过了、哪几项没过」，复盘时也无法区分
 * 「模型认为都覆盖了」与「模型没看清问题就给了 pass」。
 *
 * 新口径把职责切开：
 *   - 模型只做**逐项**判断（`items[].supported`）——可枚举、可交叉核对、天然独立；
 *   - `verdict` 由**确定性聚合规则**在代码里得出（见 `aggregateGuardianItems`）。
 *
 * 这与 `clause/dsl.ts`、`lint/` 的思路一致：判定器不给结论，结论由规则聚合。
 */
export type GuardianItemVerdict = {
  id: string;
  supported: boolean;
  /** false：该项交易结构不在本合同里。修订稿上不算未覆盖。 */
  applicable?: boolean;
  note?: string;
  evidenceRef?: string;
};

export type GuardianItemAggregate = {
  verdict: "pass" | "fail";
  gaps: GuardianGap[];
  /** 逐项结果（供 sidecar / 审计；不进律师可见面）。 */
  itemVerdicts: GuardianItemVerdict[];
  /** 模型报了但证据包里没有的 item id —— 记为缺口，防止「编一个通过的项」。 */
  unknownItemIds: string[];
  /** G0：machine 段结论（供指标与 shadow 一致率；`off` 时为空）。 */
  machineVerdicts: GuardianMachineVerdict[];
  /** G0：machine 与 judge 对同一项结论相反的键——shadow 期最关键的可观测量。 */
  tierConflicts: string[];
};

/**
 * G0：machine 段结论的结构性类型。
 *
 * **刻意不 import `machine-verifiers.ts`**：那个模块会拉进 `lint/run-lint`，
 * 而本文件被桌面 renderer 引用（见 `renderer/review/useReviewWorkbenchData.ts`）。
 * 结构性类型让「判定结论」可以穿过 renderer 边界而不带走 Node 依赖。
 */
export type GuardianMachineVerdict = {
  itemId: string;
  supported: boolean;
  reason: string;
  evidenceRef?: string;
  /** `unavailable` = 验证器自身不可用，必须 fail-closed。 */
  status: "ok" | "unavailable";
};

const STRUCTURAL_TRACKED_GAP_CODES = new Set([
  "no_checklist_evidence",
  "writer_deferred_empty",
  "issues_empty_no_verification",
  "citation_insufficient_support",
  "citation_not_supporting",
  "citation_not_used",
  "citations_unused",
  "unused_citation",
  "empty_issues",
  "empty_sections",
  "empty_checklist",
  "checklist_empty",
  "checklist_missing",
  "sections_empty",
  "issues_empty",
  "deferred_empty",
]);

const OFF_TOPIC_NOTE_RE =
  /不适用|不对题|不在本(?:合同|协议)|合同本体不含|不属于该|无此交易|非此类合同|未涉及该/;

/** 停项：数字没确认就不要改。这是留给律师填的，不是没改完。 */
const LAWYER_BLANK_NOTE_RE =
  /未经确认不得改|单价未经确认|比例未经确认|数字未经确认|尚未确认|待律师确认|待补充|统一社会信用代码/;

/**
 * 修订稿证据包里本来就是空的那些字段。模型据此写的缺口改不了合同，不得拦住出稿。
 * `citation_ids_missing` 不在此列：那是引用 ID 确实不在检索快照里。
 */
export function isStructuralTrackedReviewGap(gap: { code: string; message: string }): boolean {
  if (STRUCTURAL_TRACKED_GAP_CODES.has(gap.code)) {
    return true;
  }
  if (/^citation_(not|insufficient|unused)/.test(gap.code)) {
    return true;
  }
  if (/^(no_checklist|writer_deferred|issues_empty|sections_empty)/.test(gap.code)) {
    return true;
  }
  const message = gap.message;
  if (
    /检查单(?:项)?(?:为空|是空|未提供|没有)|没有适用的检查单|checklist\.items 为空/.test(message)
  ) {
    return true;
  }
  if (/writerDeferredClaims 为空|缓办清单为空|未申报缓办/.test(message)) {
    return true;
  }
  if (/争点树为空|issues 为空|sections 为空|正文章节为空/.test(message)) {
    return true;
  }
  if (/usedInHeadings 为空|未被正文引用|只有案件元数据|引用未被使用/.test(message)) {
    return true;
  }
  if (/仅有 hunk|只有修订片段|hunk 不足以认定/.test(message)) {
    return true;
  }
  return false;
}

function isOffTopicChecklistVerdict(row: GuardianItemVerdict): boolean {
  if (row.applicable === false) {
    return true;
  }
  return OFF_TOPIC_NOTE_RE.test(row.note ?? "");
}

function isLawyerBlankChecklistNote(row: GuardianItemVerdict): boolean {
  return LAWYER_BLANK_NOTE_RE.test(row.note ?? "");
}

/** 上一轮失败若全是审稿层空包，不占用轮次，也不沿用旧结论。 */
export function isReviewLayerOnlyFail(gaps: readonly GuardianGap[]): boolean {
  const blocking = gaps.filter(
    (gap) => gap.code !== "checklist_note" && gap.code !== "guardian_exhausted",
  );
  return blocking.length > 0 && blocking.every((gap) => isStructuralTrackedReviewGap(gap));
}

/**
 * 确定性聚合规则（唯一真相源，不依赖模型输出 verdict）：
 *
 * 1. 任一 checklist 项 `supported: false` → fail，该项产生一条 gap。
 *    修订稿上 `applicable: false`，或注明「不对题 / 不适用」，不算未覆盖。
 * 2. 任一 checklist 项**未被回答** → fail（缺答不等于通过）。
 * 3. 任一 checklist 项 `note` 非空但 `supported: true` → 记为可见提示（`checklist_note`），
 *    不因此把总判打成 fail，也不挡导出。未覆盖、缺答、编造项、全文缺口仍 fail。
 * 4. 模型给出证据包里不存在的 item id → fail（防编造）。
 * 5. `summaryGaps` 非空 → fail（全文级缺口）。
 *    修订稿上，检查单为空、缓办为空、争点树为空、引用未挂到标题，这些审稿层空包不算缺口。
 * 6. 以上都不成立 → pass。
 *
 * 注意第 2 条：**缺答即 fail**，而不是「没提到就当他没说」。
 * 这是 fail-closed：模型漏答一项时，宁可判 fail 让律师看，也不要静默放行。
 */
export function aggregateGuardianItems(input: {
  items: readonly GuardianItemVerdict[];
  summaryGaps: readonly GuardianGap[];
  /** 证据包里的检查单项 id。为空数组时只按 summaryGaps 判。 */
  expectedItemIds: readonly string[];
  /**
   * G0：machine 段结论。
   *
   * 只在 `machineAffectsOutcome === true`（即 mode=`on`）时产生缺口；
   * `shadow` 时**只记录**（`machineVerdicts` / `tierConflicts`），
   * 因此 shadow 期的 `verdict` 与改造前逐字一致——零风险。
   */
  machineVerdicts?: readonly GuardianMachineVerdict[];
  /** machine 结论是否参与 verdict。`on` 为 true，`shadow` / `off` 为 false。 */
  machineAffectsOutcome?: boolean;
  /** 修订稿：不对题的检查项与审稿层空证据包不产生拦截缺口。 */
  trackedRedline?: boolean;
}): GuardianItemAggregate {
  const expected = input.expectedItemIds.map((id) => id.trim()).filter(Boolean);
  const answered = new Map<string, GuardianItemVerdict>();
  const unknownItemIds: string[] = [];

  for (const row of input.items) {
    const id = row.id.trim();
    if (!id) {
      continue;
    }
    if (expected.length > 0 && !expected.includes(id)) {
      // 模型编了检查单里没有的项——不静默丢弃，记为缺口。
      unknownItemIds.push(id);
      continue;
    }
    // 同 id 重复时保留第一个（模型不该重复；重复本身不是缺口）。
    if (!answered.has(id)) {
      answered.set(id, { ...row, id });
    }
  }

  const gaps: GuardianGap[] = [];
  for (const id of expected) {
    const row = answered.get(id);
    if (!row) {
      gaps.push({
        code: "checklist_unanswered",
        message: `检查单项「${id}」未给出判断。证据不足时应判未覆盖并写出缺口。`,
        evidenceRef: `checklist.${id}`,
      });
      continue;
    }
    if (!row.supported) {
      if (input.trackedRedline && isOffTopicChecklistVerdict(row)) {
        continue;
      }
      if (input.trackedRedline && isLawyerBlankChecklistNote(row)) {
        const note = row.note?.trim() ?? "";
        gaps.push({
          code: "checklist_note",
          message: `检查单项「${id}」留待确认：${note}`,
          ...(row.evidenceRef ? { evidenceRef: row.evidenceRef } : {}),
        });
        continue;
      }
      gaps.push({
        code: "checklist_not_covered",
        message: row.note?.trim()
          ? `检查单项「${id}」未覆盖：${row.note.trim()}`
          : `检查单项「${id}」未覆盖，请在正文或缓办清单中处理。`,
        ...(row.evidenceRef ? { evidenceRef: row.evidenceRef } : {}),
      });
      continue;
    }
    if (row.note?.trim()) {
      gaps.push({
        code: "checklist_note",
        message: `检查单项「${id}」已覆盖，但审稿员另有提示：${row.note.trim()}`,
        ...(row.evidenceRef ? { evidenceRef: row.evidenceRef } : {}),
      });
    }
  }

  if (unknownItemIds.length > 0) {
    gaps.push({
      code: "checklist_unknown_item",
      message: `审稿员回答了检查单里不存在的项（${unknownItemIds.join("、")}）——不得据此判过。`,
    });
  }

  // ── G0：machine 段结论 ────────────────────────────────────────────────
  const machineVerdicts = [...(input.machineVerdicts ?? [])];
  const tierConflicts: string[] = [];
  // 同一项不允许被两个验证器各判一次——重复即视为不可用（fail-closed）。
  const seenMachine = new Set<string>();
  for (const mv of machineVerdicts) {
    if (seenMachine.has(mv.itemId)) {
      gaps.push({
        code: "machine_duplicate_verdict",
        message: `检查单项「${mv.itemId}」被自动核对判定了多次，结论不可信，需人工确认。`,
        evidenceRef: "machineVerdicts",
      });
      continue;
    }
    seenMachine.add(mv.itemId);
  }

  if (input.machineAffectsOutcome === true) {
    for (const mv of machineVerdicts) {
      if (mv.status === "unavailable") {
        gaps.push({
          code: "machine_unavailable",
          message: `检查单项「${mv.itemId}」未能自动核对：${mv.reason}`,
          ...(mv.evidenceRef ? { evidenceRef: mv.evidenceRef } : {}),
        });
        continue;
      }
      if (!mv.supported) {
        gaps.push({
          code: "machine_not_covered",
          message: `检查单项「${mv.itemId}」未覆盖：${mv.reason}`,
          ...(mv.evidenceRef ? { evidenceRef: mv.evidenceRef } : {}),
        });
        continue;
      }
    }
  }

  // 冲突：同一项 machine 与 judge 结论相反。**两种 mode 都记录**——这是转 `on` 的依据。
  const modelByItem = new Map<string, boolean>();
  for (const row of answered.values()) {
    modelByItem.set(row.id, row.supported);
  }
  for (const mv of machineVerdicts) {
    if (mv.status === "unavailable") {
      continue;
    }
    const modelSaid = modelByItem.get(mv.itemId);
    if (modelSaid === undefined) {
      continue;
    }
    if (modelSaid !== mv.supported) {
      tierConflicts.push(mv.itemId);
      // shadow 期不因此改 verdict；`on` 期同一项已不再问模型，冲突只可能来自
      // 历史 sidecar 重放——此时按更严的一侧（未覆盖）处理。
      if (input.machineAffectsOutcome === true && mv.supported) {
        gaps.push({
          code: "tier_conflict",
          message: `检查单项「${mv.itemId}」的自动核对与审稿判断结论相反，按更严的一侧处理。`,
          evidenceRef: `conflict.${mv.itemId}`,
        });
      }
    }
  }

  const summaryGaps = input.trackedRedline
    ? input.summaryGaps.filter((gap) => !isStructuralTrackedReviewGap(gap))
    : input.summaryGaps;
  gaps.push(...summaryGaps);

  const visible = dedupeGaps(gaps);
  const blocking = visible.filter((gap) => gap.code !== "checklist_note");
  return {
    verdict: blocking.length > 0 ? "fail" : "pass",
    gaps: visible,
    itemVerdicts: [...answered.values()],
    unknownItemIds,
    machineVerdicts,
    tierConflicts,
  };
}

function dedupeGaps(gaps: GuardianGap[]): GuardianGap[] {
  const seen = new Set<string>();
  const out: GuardianGap[] = [];
  for (const g of gaps) {
    const key = `${g.code}\u0000${g.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(g);
  }
  return out;
}

function parseChecklistItems(raw: unknown): GuardianItemVerdict[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: GuardianItemVerdict[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const rec = row as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    if (!id) {
      continue;
    }
    // `supported` 必须显式 true 才算通过——缺字段一律按未覆盖（fail-closed）。
    const supported = rec.supported === true;
    const applicable = rec.applicable === false || rec.applicable === "false" ? false : undefined;
    out.push({
      id,
      supported,
      ...(applicable === false ? { applicable: false as const } : {}),
      ...(typeof rec.note === "string" && rec.note.trim()
        ? { note: clipGuardianText(rec.note, CLIP_MSG) }
        : {}),
      ...(typeof rec.evidenceRef === "string" && rec.evidenceRef.trim()
        ? { evidenceRef: clipGuardianText(rec.evidenceRef, 80) }
        : {}),
    });
  }
  return out;
}

function parseSummaryGaps(raw: unknown): GuardianGap[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const gaps: GuardianGap[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const g = row as Record<string, unknown>;
    const code = typeof g.code === "string" ? g.code.trim() : "";
    const message = typeof g.message === "string" ? g.message.trim() : "";
    if (!code || !message) {
      continue;
    }
    gaps.push({
      code: clipGuardianText(code, 48),
      message: clipGuardianText(message, CLIP_MSG),
      ...(typeof g.evidenceRef === "string" && g.evidenceRef.trim()
        ? { evidenceRef: clipGuardianText(g.evidenceRef, 80) }
        : {}),
    });
  }
  return gaps;
}

/**
 * P2.2 解析入口：优先读逐项形状（`items` + `summaryGaps`），
 * 找不到时**回退**旧的 `{verdict, gaps}` 形状（见 `parseGuardianReviewerJson`）。
 *
 * 回退是必要的：自定义模型/自带提示词的部署仍可能返回旧形状，
 * 且历史 sidecar 重放也要能读。
 */
export function parseGuardianItemVerdicts(
  raw: string,
  expectedItemIds: readonly string[],
  machine?: {
    verdicts: readonly GuardianMachineVerdict[];
    affectsOutcome: boolean;
  },
  ctx?: GuardianParseContext,
): GuardianItemAggregate | undefined {
  const slice = extractFirstJsonObject(raw);
  if (!slice) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const rec = parsed as Record<string, unknown>;

  // 新形状：必须出现 items 或 summaryGaps 之一，否则视为旧形状。
  if (!("items" in rec) && !("summaryGaps" in rec)) {
    return undefined;
  }

  const items = parseChecklistItems(rec.items);
  const summaryGaps = parseSummaryGaps(rec.summaryGaps);
  const legacyGaps = parseSummaryGaps(rec.gaps);
  const rawSummary = [...summaryGaps, ...legacyGaps];
  const aggregate = aggregateGuardianItems({
    items,
    summaryGaps: rawSummary,
    expectedItemIds,
    machineVerdicts: machine?.verdicts,
    machineAffectsOutcome: machine?.affectsOutcome,
    ...(ctx?.trackedRedline ? { trackedRedline: true } : {}),
  });

  // 一项没答、也没有任何 summaryGaps：形状不合规，交回调用方走重采样/旧解析。
  // 修订稿上，模型只报了审稿层空包时，滤掉之后就是通过，不再当成读不出结果。
  if (items.length === 0 && aggregate.gaps.length === 0 && expectedItemIds.length > 0) {
    if (
      ctx?.trackedRedline &&
      rawSummary.length > 0 &&
      rawSummary.every((gap) => isStructuralTrackedReviewGap(gap))
    ) {
      return aggregate;
    }
    return undefined;
  }
  return aggregate;
}

/**
 * 从证据包取出检查单项 id —— 即「模型必须逐项回答」的清单。
 * 无检查单时返回空数组：此时只按 `summaryGaps` 判（见 `aggregateGuardianItems`）。
 */
export function guardianExpectedItemIds(pack: { checklist?: { items?: unknown } }): string[] {
  const items = pack.checklist?.items;
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((row) =>
      row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
        ? ((row as { id: string }).id || "").trim()
        : "",
    )
    .filter((id) => id.length > 0);
}

/**
 * Guardian 判定入口（P2.2）：先试逐项形状（`items` + `summaryGaps`），由代码聚合 verdict；
 * 不成形状时回退旧 `{verdict, gaps}`（自定义提示词部署与历史重放）。
 *
 * 回退**不改变**旧口径的语义——它仍是 fail-closed。
 *
 * G0：`machine` 传入后，machine 段结论按 `affectsOutcome` 决定是否参与 verdict。
 * **注意回退路径（旧形状）不带 machine 结论**——旧形状没有逐项信息，无法与之对齐；
 * 此时 machine 结论仅在 `on` 模式下另行补判（见 `aggregateMachineOnly`）。
 */
export function parseGuardianVerdict(
  raw: string,
  expectedItemIds: readonly string[],
  machine?: {
    verdicts: readonly GuardianMachineVerdict[];
    affectsOutcome: boolean;
  },
  ctx?: GuardianParseContext,
): { verdict: "pass" | "fail"; gaps: GuardianGap[] } | undefined {
  const aggregated = parseGuardianItemVerdicts(raw, expectedItemIds, machine, ctx);
  if (aggregated) {
    return { verdict: aggregated.verdict, gaps: aggregated.gaps };
  }
  return parseGuardianReviewerJson(raw, ctx);
}

/**
 * G0：没有 judge 项可问时（全部落 machine / lawyer），仍要产出结论。
 *
 * 这是 `on` 模式下的正常路径，不是降级：`items` 为空、`expectedItemIds` 为空，
 * 聚合只由 machine 结论 + summaryGaps 决定。
 */
export function aggregateMachineOnly(input: {
  machineVerdicts: readonly GuardianMachineVerdict[];
  affectsOutcome: boolean;
}): GuardianItemAggregate {
  return aggregateGuardianItems({
    items: [],
    summaryGaps: [],
    expectedItemIds: [],
    machineVerdicts: input.machineVerdicts,
    machineAffectsOutcome: input.affectsOutcome,
  });
}

export function formatGuardianEvidenceUserMessage(pack: GuardianEvidencePack): string {
  return [
    "【证据包】代码组装，不是写者叙述。writerDeferredClaims 只是写者声明，不是覆盖事实。",
    JSON.stringify(pack, null, 2),
  ].join("\n");
}

export function formatGuardianFailMessage(view: GuardianLawyerView): string {
  if (isInfraGuardianView(view)) {
    return `独立审稿引擎未能读出结果（第 ${view.round}/${view.maxRounds} 轮）。请原样重交本次导出，不要落改，不要改审稿措辞，不要把故障码写给律师。`;
  }
  const lines = [
    `独立审稿未过（第 ${view.round}/${view.maxRounds} 轮）。请按缺口补改或补缓办后重交本次导出。不要改审稿措辞来讨好。`,
  ];
  for (const gap of view.gaps) {
    lines.push(`- [${gap.code}] ${gap.message}`);
  }
  if (view.skipReason === "unchanged_evidence") {
    lines.push(
      "稿没有变化，沿用的是上次审稿结论，不是新的未覆盖。不要为了同一条结论改出另一套章节。",
    );
  }
  if (view.round >= view.maxRounds) {
    lines.push("已达审稿轮次上限。请把残留缺口交给律师定夺，不要继续改稿讨好审稿员。");
  }
  return lines.join("\n");
}

export function nextGuardianRound(prior: GuardianRecord | undefined): number {
  if (!prior || prior.verdict !== "fail") {
    return 1;
  }
  // Network / JSON failures must retry the same slot — they are not a coverage miss.
  if (isInfraGuardianFail(prior)) {
    return Math.max(1, prior.round);
  }
  // 审稿层空包不是条款没改完。沿用旧的 fail 会把轮次用尽，律师再也拿不到 Word。
  if (isReviewLayerOnlyFail(prior.gaps)) {
    return 1;
  }
  return prior.round + 1;
}

export function exhaustedGuardianRecord(input: {
  taskId: string;
  round: number;
  priorGaps?: GuardianGap[];
}): GuardianRecord {
  const gaps: GuardianGap[] = [
    {
      code: "guardian_exhausted",
      message: `独立审稿已 ${LEGAL_GUARDIAN_MAX_ROUNDS} 轮未过。请把缺口交给律师，不要继续为过审而改稿。`,
    },
    ...(input.priorGaps ?? []).slice(0, 6),
  ];
  return {
    taskId: input.taskId,
    at: new Date().toISOString(),
    verdict: "fail",
    round: input.round,
    maxRounds: LEGAL_GUARDIAN_MAX_ROUNDS,
    gaps,
  };
}

export function guardianFailToolResult(
  taskId: string,
  view: GuardianLawyerView,
): {
  ok: false;
  error: string;
  data: {
    taskId: string;
    code: "legal_guardian_fail";
    guardian: GuardianLawyerView;
    gateDecision: {
      gate: "legal_guardian_gate";
      decision: "block";
      reason: string;
      category: "judgment_soft";
    };
  };
} {
  return {
    ok: false,
    error: formatGuardianFailMessage(view),
    data: {
      taskId,
      code: "legal_guardian_fail",
      guardian: view,
      gateDecision: {
        gate: "legal_guardian_gate",
        decision: "block",
        reason: view.gaps[0]?.message ?? "独立审稿未过",
        category: "judgment_soft",
      },
    },
  };
}
