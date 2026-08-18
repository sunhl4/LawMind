/**
 * 稿件 critic：第二意见。只追加复核备注，不改写模型正文。
 * 有凭据时按条款 map、再全文 reduce；keyword/off 只走规则。
 */

import {
  completeJsonObject,
  reasoningLlmConfigFromEnv,
  type OpenAiJsonClientConfig,
} from "../llm/openai-json.js";
import type { ArtifactDraft } from "../types.js";
import {
  attachClauseCriticNotes,
  buildClauseGraphFromDraft,
  clauseGraphRiskNotes,
  type ClauseGraph,
} from "./clause-graph.js";
import { isModelReasoningEnabled } from "./model-draft.js";

export const DRAFT_CRITIC_PREFIX = "复核：";
const CRITIC_PREFIX = DRAFT_CRITIC_PREFIX;
const CLAUSE_MAP_CAP = 8;

export type DraftCriticResult = {
  draft: ArtifactDraft;
  graph: ClauseGraph;
};

export function hasCriticNotes(draft: ArtifactDraft): boolean {
  return draft.reviewNotes.some((note) => note.startsWith(CRITIC_PREFIX));
}

export function critiqueDraft(draft: ArtifactDraft, graph?: ClauseGraph): string[] {
  const clauseGraph = graph ?? buildClauseGraphFromDraft(draft);
  const notes: string[] = [];
  for (const line of clauseGraphRiskNotes(clauseGraph)) {
    notes.push(`${CRITIC_PREFIX}${line}`);
  }
  const haystack = draft.sections.map((s) => `${s.heading}\n${s.body}`).join("\n");
  if (
    (draft.deliverableType === "contract.rental" ||
      draft.deliverableType === "contract.general" ||
      /(合同|协议)/.test(`${draft.title}${haystack}`)) &&
    !/争议解决|管辖|仲裁/.test(haystack)
  ) {
    notes.push(`${CRITIC_PREFIX}全文未见争议解决或管辖约定，外发前请补上。`);
  }
  if (draft.deliverableType === "letter.demand" && !/期限|日内|之前|截止/.test(haystack)) {
    notes.push(`${CRITIC_PREFIX}律师函未见履行期限，对方难以按期响应。`);
  }
  if (draft.sections.length === 0) {
    notes.push(`${CRITIC_PREFIX}草稿没有正文，不能当作成稿。`);
  }
  return unique(notes).slice(0, 16);
}

export function applyDraftCritic(draft: ArtifactDraft): ArtifactDraft {
  return runDraftCritic(draft).draft;
}

export function runDraftCritic(draft: ArtifactDraft): DraftCriticResult {
  const graph = buildClauseGraphFromDraft(draft);
  if (hasCriticNotes(draft)) {
    return { draft, graph };
  }
  const notes = critiqueDraft(draft, graph);
  if (notes.length === 0) {
    return { draft, graph };
  }
  return {
    draft: {
      ...draft,
      reviewNotes: [...draft.reviewNotes, ...notes],
    },
    graph,
  };
}

export function isModelCriticEnabled(): boolean {
  return isModelReasoningEnabled();
}

function clauseGraphDigest(graph: ClauseGraph): string {
  if (graph.clauses.length === 0) {
    return "(no clauses)";
  }
  return graph.clauses
    .slice(0, CLAUSE_MAP_CAP)
    .map((clause) => {
      const extra = [...clause.risks, ...clause.missing].join("；");
      return `- ${clause.id} ${clause.heading}: ${clause.body.slice(0, 160)}${extra ? ` [${extra}]` : ""}`;
    })
    .join("\n");
}

function prefixCriticNote(note: string): string {
  const text = note.replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  const body = text.startsWith(CRITIC_PREFIX) ? text : `${CRITIC_PREFIX}${text}`;
  return body.slice(0, 240);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export async function critiqueDraftWithModel(
  draft: ArtifactDraft,
  cfg: OpenAiJsonClientConfig,
  graph?: ClauseGraph,
): Promise<string[] | null> {
  const mapped = await critiqueClausesWithModel(draft, cfg, graph);
  return mapped?.summaryNotes ?? null;
}

export async function critiqueClausesWithModel(
  draft: ArtifactDraft,
  cfg: OpenAiJsonClientConfig,
  graph?: ClauseGraph,
): Promise<{ graph: ClauseGraph; summaryNotes: string[] } | null> {
  const clauseGraph = graph ?? buildClauseGraphFromDraft(draft);
  const parsed = await completeJsonObject<{
    clauses?: unknown;
    summary?: unknown;
    notes?: unknown;
  }>(cfg, [
    {
      role: "system",
      content: [
        "你是执业律师的第二审阅人。先逐条指出该条款外发前应处理的缺口，再汇总全文。",
        "不要改写正文，不要输出【标签】。",
        '只输出 JSON：{ "clauses": [{ "id": "c1", "notes": ["中文短句"] }], "summary": ["全文短句"] }。',
        "没有实质问题时对应数组为空。每条不超过 80 字，针对争议解决、期限、责任后果、空条款或与检索材料明显冲突。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `标题: ${draft.title}`,
        `交付类型: ${draft.deliverableType ?? "未指定"}`,
        `摘要: ${draft.summary}`,
        "",
        "条款图（请按 id 回写意见）:",
        clauseGraphDigest(clauseGraph),
        "",
        "正文:",
        draft.sections
          .slice(0, 24)
          .map((section) => `## ${section.heading}\n${section.body.slice(0, 1200)}`)
          .join("\n\n"),
      ].join("\n"),
    },
  ]);
  if (!parsed) {
    return null;
  }
  const notesById = new Map<string, string[]>();
  if (Array.isArray(parsed.clauses)) {
    for (const row of parsed.clauses) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const rec = row as { id?: unknown; notes?: unknown };
      if (typeof rec.id !== "string" || !rec.id.trim()) {
        continue;
      }
      const notes = asStringArray(rec.notes)
        .map((note) => note.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 4);
      if (notes.length > 0) {
        notesById.set(rec.id.trim(), notes);
      }
    }
  }
  const enriched = attachClauseCriticNotes(clauseGraph, notesById);
  const clauseReviewNotes = enriched.clauses.flatMap((clause) =>
    clause.criticNotes.map((note) => prefixCriticNote(`${clause.heading}：${note}`)),
  );
  const summary =
    asStringArray(parsed.summary).length > 0
      ? asStringArray(parsed.summary)
      : asStringArray(parsed.notes);
  const summaryNotes = unique(
    [...summary.map(prefixCriticNote), ...clauseReviewNotes].filter(Boolean),
  ).slice(0, 16);
  return { graph: enriched, summaryNotes };
}

export async function runDraftCriticAsync(draft: ArtifactDraft): Promise<DraftCriticResult> {
  const graph = buildClauseGraphFromDraft(draft);
  if (hasCriticNotes(draft)) {
    return { draft, graph };
  }
  const ruleNotes = critiqueDraft(draft, graph);
  let modelGraph = graph;
  let modelNotes: string[] = [];
  if (isModelCriticEnabled()) {
    const cfg = reasoningLlmConfigFromEnv();
    if (cfg) {
      const mapped = await critiqueClausesWithModel(draft, cfg, graph);
      if (mapped) {
        modelGraph = mapped.graph;
        modelNotes = mapped.summaryNotes;
      }
    }
  }
  const notes = unique([...ruleNotes, ...modelNotes]).slice(0, 16);
  if (notes.length === 0) {
    return { draft, graph: modelGraph };
  }
  return {
    draft: {
      ...draft,
      reviewNotes: [...draft.reviewNotes, ...notes],
    },
    graph: modelGraph,
  };
}

export async function applyDraftCriticAsync(draft: ArtifactDraft): Promise<ArtifactDraft> {
  return (await runDraftCriticAsync(draft)).draft;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
