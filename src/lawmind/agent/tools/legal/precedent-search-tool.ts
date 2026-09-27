/**
 * search_precedents — 本所旧案交付物检索（对标 iManage precedent search）。
 *
 * 检索 knowledge_fts 的 precedent 语料（旧案已签批交付物摘录）。默认关闭：
 * 需 LAWMIND_ALLOW_CROSS_MATTER_SEARCH=1（跨案读取涉及伦理墙姿态，先显式授权）。
 * 命中只作写法/口径参照——事实以本案为准，不得张冠李戴。
 *
 * 给了 target_task_id 时做**术语自适应**：抽当前文书已定义术语表，
 * 按调用方显式给出的 term_map 把旧案条款改写成本文叫法，改写不了的逐条报出
 * （drift），不静默把另一套称谓带进本案文书。
 */

import { readDraft } from "../../../drafts/index.js";
import {
  alignTerminology,
  extractDefinedTerms,
  type DefinedTerm,
} from "../../../drafts/terminology-adapt.js";
import { mattersConflict } from "../../../host-access/matter-fence.js";
import { isPrecedentIngestEnabled } from "../../../indexing/fts-ingest-knowledge.js";
import { searchPersonalKnowledge } from "../../../indexing/knowledge-search.js";
import { formatExplicitPrecedentRecall } from "../../../memory/kernel/query.js";
import type { AgentTool } from "../../types.js";

/** 术语表只回标签与出处形态，不回定义全文，避免把本案事实铺进检索结果。 */
function slimTerms(terms: DefinedTerm[]): Array<{ term: string; aliases: string[] }> {
  return terms.map((t) => ({ term: t.term, aliases: t.aliases }));
}

function readTermMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && k.trim() && typeof v === "string" && v.trim()) {
      out[k.trim()] = v.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function conflictsWithCurrentMatter(
  workspaceDir: string,
  currentMatterId: string | undefined,
  otherMatterId: string | undefined,
): boolean {
  const currentId = currentMatterId?.trim();
  const otherId = otherMatterId?.trim();
  if (!currentId || !otherId) {
    return false;
  }
  return mattersConflict(workspaceDir, currentId, otherId);
}

export const searchPrecedents: AgentTool = {
  definition: {
    name: "search_precedents",
    description:
      "检索本所旧案已签批交付物（意见书/合同审查/诉讼文书/函件）的可参照段落，返回旧案 ID 与章节出处。" +
      "用于写法与口径参照；旧案事实不得写入本案。若尚未允许对照其他案件，只说明还没打开，不要把配置步骤讲给律师。" +
      '传 target_task_id 时做术语自适应：抽本文已定义术语表，并按 term_map（如 {"买方":"甲方"}）把旧案条款改写成本文叫法；改写不了的以 unmappedForeignTerms 报出，不得自带另一套称谓。',
    category: "search",
    parameters: {
      query: { type: "string", description: "检索关键词或短语", required: true },
      limit: { type: "number", description: "返回条数上限（默认 8，最大 20）" },
      target_task_id: {
        type: "string",
        description: "要插入到哪份草稿（taskId）。给了就做本文术语对齐与外来叫法检查。",
      },
      term_map: {
        type: "object",
        description:
          '显式同义映射（旧案叫法 → 本文术语），如 {"买方":"甲方","卖方":"乙方"}。引擎只做确定性替换，不替模型猜语义。',
      },
    },
  },
  async execute(params, ctx) {
    const query = typeof params.query === "string" ? params.query.trim() : "";
    if (!query) {
      return { ok: false, error: "缺少检索关键词 query。" };
    }
    if (!isPrecedentIngestEnabled()) {
      return {
        ok: true,
        data: {
          query,
          hits: [],
          precedentSearchEnabled: false,
          note: "先例检索还没打开。这台电脑尚未允许对照其他案件的已签批文书。",
        },
      };
    }
    const rawLimit = params.limit;
    const limit =
      typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(20, Math.floor(rawLimit))
        : 8;

    const targetTaskId =
      typeof params.target_task_id === "string" ? params.target_task_id.trim() : "";
    let terms: DefinedTerm[] = [];
    if (targetTaskId) {
      const draft = readDraft(ctx.workspaceDir, targetTaskId);
      if (!draft) {
        return { ok: false, error: `找不到草稿 ${targetTaskId}，无法按本文术语对齐。` };
      }
      terms = extractDefinedTerms(draft.sections ?? []);
    }
    const termMap = readTermMap(params.term_map);

    const result = await searchPersonalKnowledge(ctx.workspaceDir, {
      q: query,
      limit,
      kinds: ["precedent"],
    });
    const hits = result.hits
      .filter((h) => !conflictsWithCurrentMatter(ctx.workspaceDir, ctx.matterId, h.matterId))
      .map((h) => {
        const base = {
          matterId: h.matterId ?? "",
          section: h.section ?? "",
          snippet: h.snippet,
          citeAs: `旧案 ${h.matterId ?? "?"} · ${h.section || h.path}`,
          path: h.path,
        };
        if (!targetTaskId) {
          return base;
        }
        const aligned = alignTerminology({
          text: h.snippet,
          terms,
          ...(termMap ? { termMap } : {}),
        });
        return {
          ...base,
          alignedSnippet: aligned.text,
          terminologySubstitutions: aligned.substitutions,
          ...(aligned.unmappedForeignTerms.length > 0
            ? { unmappedForeignTerms: aligned.unmappedForeignTerms }
            : {}),
          ...(aligned.warnings.length > 0 ? { terminologyWarnings: aligned.warnings } : {}),
        };
      });

    const unmapped = [
      ...new Set(
        hits.flatMap((h) =>
          "unmappedForeignTerms" in h ? (h.unmappedForeignTerms as string[]) : [],
        ),
      ),
    ];

    const precedentMatterIds = [
      ...new Set(hits.map((hit) => hit.matterId).filter((id) => id.length > 0)),
    ];
    const caseNotes =
      precedentMatterIds.length > 0
        ? formatExplicitPrecedentRecall(ctx.workspaceDir, {
            matterId: ctx.matterId,
            precedentMatterIds,
            query,
          })
        : "";

    return {
      ok: true,
      data: {
        query,
        hits,
        precedentSearchEnabled: true,
        ...(caseNotes ? { caseNotes } : {}),
        note: targetTaskId
          ? "先例只作案由与写法参照；旧案事实不得写入本案。hits[].alignedSnippet 已按本文术语表对齐，插入请用它。"
          : "先例只作案由与写法参照；旧案事实不得写入本案。未做术语对齐：插入前请传 target_task_id（必要时附 term_map）。",
        ...(targetTaskId
          ? {
              terminology: { targetTaskId, terms: slimTerms(terms) },
              terminologyNotice:
                terms.length === 0
                  ? "本文未识别到已定义术语：插入旧案条款前请先核对称谓口径。"
                  : "插入请用 alignedSnippet；若引用了另一种叫法，请用 term_map 明确映射。",
              ...(unmapped.length > 0 ? { unmappedForeignTerms: unmapped } : {}),
            }
          : {}),
        ...(result.indexMissing ? { indexMissing: true } : {}),
      },
    };
  },
};
