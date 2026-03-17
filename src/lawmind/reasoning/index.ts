/**
 * Reasoning Layer
 *
 * 职责：把 Retrieval 的 ResearchBundle 整理为可审阅的 ArtifactDraft。
 * 当前实现为规则驱动（deterministic first），后续可接模型增强。
 */

import type { ArtifactDraft, ArtifactSection, ResearchBundle, TaskIntent } from "../types.js";

export type BuildDraftParams = {
  intent: TaskIntent;
  bundle: ResearchBundle;
  title?: string;
  templateId?: string;
};

function sectionFromClaims(bundle: ResearchBundle): ArtifactSection[] {
  if (bundle.claims.length === 0) {
    return [
      {
        heading: "检索结果",
        body: "当前未检索到可引用结论，请补充检索来源后重试。",
      },
    ];
  }

  return bundle.claims.map((claim, idx) => ({
    heading: `要点 ${idx + 1}`,
    body: `${claim.text}\n置信度：${Math.round(claim.confidence * 100)}%`,
    citations: claim.sourceIds,
  }));
}

function summarizeBundle(bundle: ResearchBundle): string {
  const sourceCount = bundle.sources.length;
  const claimCount = bundle.claims.length;
  const riskCount = bundle.riskFlags.length;
  const missingCount = bundle.missingItems.length;
  return `共检索 ${sourceCount} 条来源，整理 ${claimCount} 条结论，风险提示 ${riskCount} 条，待补充事项 ${missingCount} 条。`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function isNegative(text: string): boolean {
  return /(不|未|无|不得|不能|禁止|否|not|no|cannot|must not)/i.test(text);
}

/**
 * 简易冲突检测：
 * - 通过去掉否定词后的标准化文本做近似匹配
 * - 若同一语义主题同时出现肯定/否定语气，则标记为冲突
 */
function detectClaimConflicts(bundle: ResearchBundle): string[] {
  const groups = new Map<string, Array<{ text: string; negative: boolean; model: string }>>();

  for (const claim of bundle.claims) {
    const key = normalizeText(claim.text).replace(
      /(不|未|无|不得|不能|禁止|否|not|no|cannot|mustnot)/gi,
      "",
    );
    if (!key) {
      continue;
    }
    const current = groups.get(key) ?? [];
    current.push({
      text: claim.text,
      negative: isNegative(claim.text),
      model: claim.model,
    });
    groups.set(key, current);
  }

  const conflicts: string[] = [];
  for (const [, items] of groups) {
    const hasNegative = items.some((it) => it.negative);
    const hasPositive = items.some((it) => !it.negative);
    if (hasNegative && hasPositive) {
      const preview = items.map((it) => `[${it.model}] ${it.text}`).join(" | ");
      conflicts.push(`同主题结论出现冲突：${preview}`);
    }
  }
  return conflicts;
}

/**
 * 把结构化检索结果转换成文书草稿。
 * 默认 reviewStatus=pending，必须人工确认后才能进入渲染阶段。
 */
export function buildDraft(params: BuildDraftParams): ArtifactDraft {
  const { intent, bundle } = params;
  const title =
    params.title ?? (intent.kind === "draft.ppt" ? "LawMind 客户汇报草稿" : "LawMind 法律文书草稿");

  const templateId =
    params.templateId ??
    intent.templateId ??
    (intent.output === "pptx" ? "ppt/client-brief-default" : "word/legal-memo-default");

  const sections: ArtifactSection[] = [
    {
      heading: "检索结论摘要",
      body: summarizeBundle(bundle),
    },
    ...sectionFromClaims(bundle),
  ];

  if (bundle.riskFlags.length > 0) {
    sections.push({
      heading: "风险提示",
      body: bundle.riskFlags.map((r) => `- ${r}`).join("\n"),
    });
  }

  if (bundle.missingItems.length > 0) {
    sections.push({
      heading: "待补充事项",
      body: bundle.missingItems.map((m) => `- ${m}`).join("\n"),
    });
  }

  const conflicts = detectClaimConflicts(bundle);
  if (conflicts.length > 0) {
    sections.push({
      heading: "冲突结论（需律师裁定）",
      body: conflicts.map((c) => `- ${c}`).join("\n"),
    });
  }

  return {
    taskId: intent.taskId,
    matterId: intent.matterId,
    title,
    output: intent.output === "pptx" ? "pptx" : intent.output === "markdown" ? "markdown" : "docx",
    templateId,
    summary: summarizeBundle(bundle),
    audience: intent.audience,
    sections,
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  };
}
