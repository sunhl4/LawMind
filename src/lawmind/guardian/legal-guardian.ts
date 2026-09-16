/**
 * Legal Guardian — bounded evidence + pass/fail parse.
 * Independent of the writer session. Mechanical gates stay facts; this only
 * judges residual coverage / honest deferral / citation support.
 */

import type { DraftCitationIntegrityView } from "../drafts/citation-integrity.js";
import type { RedlineHunk } from "../drafts/redline-proposal.js";
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

const HUNK_CAP = 32;
const SECTION_CAP = 12;
const ISSUE_CAP = 8;
const CHECKLIST_CAP = 16;
const CITATION_CAP = 16;
const ANSWER_CAP = 12;
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

export function guardianBlocksExport(record: Pick<GuardianRecord, "verdict">): boolean {
  return record.verdict === "fail";
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
  const hunks: GuardianHunkEvidence[] = liveHunks.slice(0, HUNK_CAP).map((h) => {
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
      const key = String(id).trim();
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
  for (const src of bundleSources.slice(0, CITATION_CAP)) {
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
    if (citations.length >= CITATION_CAP) {
      break;
    }
    citations.push({ id, usedInHeadings: headings });
  }

  const answers = Object.entries(input.confirmedAnswers ?? {})
    .filter(([k, v]) => k.trim() && v.trim() && !k.startsWith("__"))
    .slice(0, ANSWER_CAP)
    .map(([key, value]) => ({
      key: clipGuardianText(key, 40),
      value: clipGuardianText(value, 80),
    }));

  const citationView = input.citation;
  const citationOk = citationView?.checked === true ? citationView.ok : undefined;
  const citationMissing =
    citationView?.checked === true ? citationView.missingSourceIds.slice(0, 8) : undefined;

  const prior = input.prior
    ? {
        round: input.prior.round,
        verdict: input.prior.verdict,
        gaps: input.prior.gaps.slice(0, 8),
      }
    : null;

  const sections: GuardianSectionEvidence[] =
    action === "render_document"
      ? input.draft.sections.slice(0, SECTION_CAP).map((sec) => ({
          heading: clipGuardianText(sec.heading || "节", 40),
          body: clipGuardianText(sec.body ?? "", CLIP_SECTION),
          citations: (sec.citations ?? []).slice(0, 6).map((id) => String(id)),
        }))
      : [];

  const issues: GuardianIssueEvidence[] = (input.graph?.issueTree ?? [])
    .slice(0, ISSUE_CAP)
    .map((node) => ({
      issue: clipGuardianText(node.issue, 80),
      authorityIds: (node.authorityIds ?? []).slice(0, 6).map((id) => String(id)),
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
      items: (input.checklist?.items ?? []).slice(0, CHECKLIST_CAP),
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
      .slice(0, 12)
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
  if (verdict === "pass" && gaps.length > 0) {
    return { verdict: "fail", gaps };
  }
  if (verdict === "fail" && gaps.length === 0) {
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
  return { verdict, gaps };
}

export function guardianSystemPrompt(): string {
  return [
    "你是独立审稿员，不是写者。只根据证据包判断本次交卷是否可过。",
    "硬门禁结果是事实：不要重判跨度长短、空修订条数、引用 ID 是否在 bundle、验收占位符。",
    "只判残留质量：(1) 实质争点是否被 hunk 或 sections 覆盖，或出现在 writerDeferredClaims；(2) 引用条目是否支撑对应断言；(3) 检查单「停」/必核项是否在正文出现。issues 只是争点树事实，不是覆盖证明。",
    "证据不足或不确定必须 fail，并写出具体缺口。不得因为写者自称覆盖而 pass。不得编造证据包没有的争点。",
    '只输出一个 JSON 对象，不要分析过程，不要 markdown 围栏：{"verdict":"pass"|"fail","gaps":[{"code":"snake_case","message":"中文缺口","evidenceRef":"可选"}]}',
  ].join("\n");
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
  for (const gap of view.gaps.slice(0, 8)) {
    lines.push(`- [${gap.code}] ${gap.message}`);
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
