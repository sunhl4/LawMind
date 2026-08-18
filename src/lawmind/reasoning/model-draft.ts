/**
 * Model-authored draft structuring.
 * 有凭据时模型直接成稿；失败或强制 keyword 时回退 keyword-draft 骨架。
 */

import {
  completeJsonObject,
  reasoningLlmConfigFromEnv,
  type OpenAiJsonClientConfig,
} from "../llm/openai-json.js";
import type { ArtifactDraft, ArtifactSection, ResearchBundle } from "../types.js";
import {
  buildBundleTailSections,
  buildDraft,
  buildDraftShell,
  type BuildDraftParams,
} from "./keyword-draft.js";

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
 * 有 LLM 凭据时默认模型撰稿；keyword/off 才强制骨架。
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

export function reportedReasoningMode(): "model" | "off" {
  return isModelReasoningEnabled() ? "model" : "off";
}

function draftSystemPrompt(intent: BuildDraftParams["intent"]): string {
  const kind = intent.deliverableType ?? intent.kind;
  return [
    "你是执业律师助理。根据检索要点与律师指令，直接写成可审阅的完整文书章节，不要输出填空骨架。",
    "必须基于给定要点与来源，不得编造未出现的法条、判例或统计数据。",
    "缺关键事实时用完整句子说明「待律师确认：…」，不要写【标签】占位。",
    "只输出 JSON，不要 markdown。",
    "JSON schema:",
    '{ "title": "string", "sections": [ { "heading": "string", "body": "string", "citations": ["可选来源编号"] } ] }',
    `交付类型提示：${kind}。章节用中文小标题；正文为完整段落，可含编号列表。`,
  ].join("\n");
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

  const shell = buildDraftShell(params);
  const modelHeadings = new Set(modelSections.map((s) => s.heading));
  const tail = buildBundleTailSections(bundle).filter((s) => !modelHeadings.has(s.heading));
  const title =
    typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : shell.title;

  return {
    ...shell,
    title,
    sections: [...modelSections, ...tail],
  };
}

export async function buildDraftAsync(params: BuildDraftParams): Promise<ArtifactDraft> {
  if (isModelReasoningEnabled()) {
    const cfg = reasoningLlmConfigFromEnv();
    if (cfg) {
      const enhanced = await buildDraftWithModel(params, cfg);
      if (enhanced) {
        return enhanced;
      }
    }
  }
  return buildDraft(params);
}
