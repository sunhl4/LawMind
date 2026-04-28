/**
 * Model-assisted draft structuring (optional, env-gated).
 */

import {
  completeJsonObject,
  reasoningLlmConfigFromEnv,
  type OpenAiJsonClientConfig,
} from "../llm/openai-json.js";
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

/** LAWMIND_REASONING_MODE=model 且具备 LLM 凭据时启用 */
export function isModelReasoningEnabled(): boolean {
  const mode = (process.env.LAWMIND_REASONING_MODE ?? "").trim().toLowerCase();
  if (mode !== "model") {
    return false;
  }
  return reasoningLlmConfigFromEnv() !== null;
}

export async function buildDraftWithModel(
  params: BuildDraftParams,
  cfg: OpenAiJsonClientConfig,
): Promise<ArtifactDraft | null> {
  const { intent, bundle } = params;
  const base = buildDraft(params);

  const system = [
    "你是法律助理，将检索结果整理为可审阅的文书章节。必须基于给定要点，不得编造未出现的法条或判例。",
    "只输出 JSON，不要 markdown。",
    "JSON schema:",
    '{ "title": "string", "sections": [ { "heading": "string", "body": "string", "citations": ["可选来源编号或引用"] } ] }',
    "章节应用中文小标题；正文可包含列表；citations 尽量对应检索来源或 claim 编号。",
  ].join("\n");

  const user = [
    `任务类型: ${intent.kind}`,
    `任务摘要: ${intent.summary}`,
    `受众: ${intent.audience ?? "未指定"}`,
    "",
    "检索材料摘要:",
    bundleDigest(bundle),
  ].join("\n");

  const parsed = await completeJsonObject<ModelSectionsJson>(cfg, [
    { role: "system", content: system },
    { role: "user", content: user },
  ]);

  if (!parsed || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    return null;
  }

  const modelSections = sanitizeSections(parsed.sections);
  if (modelSections.length === 0) {
    return null;
  }

  const ruleSections = base.sections;
  const riskIdx = ruleSections.findIndex(
    (s) => s.heading === "风险提示" || s.heading === "主要风险提示",
  );
  const missingIdx = ruleSections.findIndex(
    (s) => s.heading === "待补充事项" || s.heading === "待确认事项",
  );
  const conflictIdx = ruleSections.findIndex(
    (s) => s.heading === "冲突结论（需律师裁定）" || s.heading === "冲突意见（需律师裁定）",
  );

  const tail: ArtifactSection[] = [];
  if (riskIdx >= 0) {
    tail.push(ruleSections[riskIdx]);
  }
  if (missingIdx >= 0) {
    tail.push(ruleSections[missingIdx]);
  }
  if (conflictIdx >= 0) {
    tail.push(ruleSections[conflictIdx]);
  }

  const title =
    typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : base.title;

  return {
    ...base,
    title,
    sections: [...modelSections, ...tail],
    summary: base.summary,
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
