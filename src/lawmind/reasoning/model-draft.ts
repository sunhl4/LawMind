/**
 * Model-assisted draft structuring (optional, env-gated).
 */

import {
  completeJsonObject,
  reasoningLlmConfigFromEnv,
  type OpenAiJsonClientConfig,
} from "../llm/openai-json.js";
import { resolveDraftReasoningLlmConfig } from "../models/draft-reasoning.js";
import type { ArtifactDraft, ArtifactSection, ResearchBundle } from "../types.js";
import { buildDraft, type BuildDraftParams } from "./keyword-draft.js";

type ModelSectionsJson = {
  title?: string;
  sections?: Array<{
    heading?: string;
    body?: string;
    citations?: string[];
  }>;
};

function bundleDigest(bundle: ResearchBundle): string {
  const lines: string[] = [`claims: ${bundle.claims.length}`, `sources: ${bundle.sources.length}`];
  for (const c of bundle.claims.slice(0, 12)) {
    lines.push(`- [${c.model}] ${c.text} (src: ${c.sourceIds.join(",")})`);
  }
  for (const s of bundle.sources.slice(0, 8)) {
    lines.push(`* ${s.title} ${s.citation ?? ""} ${s.kind}`);
  }
  if (bundle.riskFlags.length) {
    lines.push(`riskFlags: ${bundle.riskFlags.join(" | ")}`);
  }
  if (bundle.missingItems.length) {
    lines.push(`missing: ${bundle.missingItems.join(" | ")}`);
  }
  return lines.join("\n");
}

function sanitizeSections(raw: ModelSectionsJson["sections"]): ArtifactSection[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ArtifactSection[] = [];
  for (const s of raw) {
    const heading = typeof s.heading === "string" ? s.heading.trim() : "";
    const body = typeof s.body === "string" ? s.body.trim() : "";
    if (!heading || !body) {
      continue;
    }
    const citations = Array.isArray(s.citations)
      ? s.citations.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      : undefined;
    out.push({
      heading: heading.slice(0, 200),
      body: body.slice(0, 80_000),
      citations,
    });
  }
  return out.slice(0, 40);
}

/**
 * Model drafting without lawMindRoot (CLI / engine).
 * E6：MODE 未设或为 model 时，有凭据即启用；keyword/off 关闭。
 */
export function isModelReasoningEnabled(): boolean {
  const mode = (process.env.LAWMIND_REASONING_MODE ?? "").trim().toLowerCase();
  if (mode === "keyword" || mode === "off" || mode === "0" || mode === "false" || mode === "no") {
    return false;
  }
  if (mode === "model" || mode === "") {
    return reasoningLlmConfigFromEnv() !== null;
  }
  return false;
}

function draftSystemPrompt(intent: BuildDraftParams["intent"]): string {
  const isEsg = intent.deliverableType === "report.esg";
  const isReport = isEsg || intent.deliverableType === "report.general";
  const lines = [
    isEsg
      ? "你是资深 ESG 与欧盟监管合规法律助理，将检索结果扩写为可直接审阅的 ESG 报告章节。"
      : isReport
        ? "你是法律助理，将检索结果扩写为可直接审阅的研究报告章节。"
        : "你是法律助理，将检索结果整理为可审阅的文书章节。",
    "必须基于给定要点与来源，不得编造未出现的法条、判例或统计数据；缺失数据处用【待补充：…】占位。",
    "只输出 JSON，不要 markdown。",
    "JSON schema:",
    '{ "title": "string", "sections": [ { "heading": "string", "body": "string", "citations": ["可选来源编号"] } ] }',
    "章节使用中文小标题；正文为完整段落（可含编号列表），不要只输出一句摘要。",
  ];
  if (isEsg) {
    lines.push(
      "ESG 报告须至少包含：执行摘要、报告背景与范围、监管框架、环境（E）、社会（S）、治理（G）、关键指标与披露建议、结论与下一步。",
      "用户指令涉及欧盟/新能源汽车时，标题应体现该主题，勿使用泛称「法律文书草稿」。",
    );
  }
  return lines.join("\n");
}

function draftUserPrompt(intent: BuildDraftParams["intent"], bundle: ResearchBundle): string {
  return [
    `交付类型: ${intent.deliverableType ?? "未指定"}`,
    `任务类型: ${intent.kind}`,
    `原始指令: ${intent.instruction}`,
    `任务摘要: ${intent.summary}`,
    `受众: ${intent.audience ?? "未指定"}`,
    "",
    "检索材料摘要:",
    bundleDigest(bundle),
  ].join("\n");
}

export async function buildDraftWithModel(
  params: BuildDraftParams,
  cfg: OpenAiJsonClientConfig,
): Promise<ArtifactDraft | null> {
  const { intent, bundle } = params;
  const base = buildDraft(params);

  const parsed = await completeJsonObject<ModelSectionsJson>(cfg, [
    { role: "system", content: draftSystemPrompt(intent) },
    { role: "user", content: draftUserPrompt(intent, bundle) },
  ]);

  if (!parsed || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    return null;
  }

  const modelSections = sanitizeSections(parsed.sections);
  if (modelSections.length === 0) {
    return null;
  }

  const ruleSections = base.sections;
  const tailHeadings = new Set([
    "风险提示",
    "主要风险提示",
    "待补充事项",
    "待确认事项",
    "冲突结论（需律师裁定）",
    "冲突意见（需律师裁定）",
    "附录：检索来源",
  ]);
  const tail = ruleSections.filter((s) => tailHeadings.has(s.heading));

  const title =
    typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : base.title;

  const mergedSections =
    intent.deliverableType === "report.esg" && modelSections.length >= 4
      ? [
          ...modelSections,
          ...tail.filter((s) => !modelSections.some((m) => m.heading === s.heading)),
        ]
      : [...modelSections, ...tail];

  return {
    ...base,
    title,
    sections: mergedSections,
    summary: base.summary,
  };
}

export async function buildDraftAsync(params: BuildDraftParams): Promise<ArtifactDraft> {
  let cfg: OpenAiJsonClientConfig | null = null;
  if (params.lawMindRoot) {
    cfg = resolveDraftReasoningLlmConfig(params.lawMindRoot);
  } else if (isModelReasoningEnabled()) {
    cfg = reasoningLlmConfigFromEnv();
  }
  if (cfg) {
    const enhanced = await buildDraftWithModel(params, cfg);
    if (enhanced) {
      return enhanced;
    }
  }
  return buildDraft(params);
}
