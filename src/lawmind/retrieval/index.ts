/**
 * Retrieval Layer
 *
 * 负责把"找资料"变成标准流程，输出 ResearchBundle。
 *
 * 约束：
 *   - 所有结论必须有 sourceIds，无来源的不得放入 claims
 *   - riskFlags 不得省略
 *   - 模型无法确认的事项放入 missingItems
 *
 * 扩展方式：
 *   实现 RetrievalAdapter 接口并注入 retrieve()，即可支持
 *   新的检索来源（本地库、法律数据库、web 等），不需要改主流程。
 */

import { randomUUID } from "node:crypto";
import { isValidMatterId } from "../cases/matter-id.js";
import type { MemoryContext } from "../memory/index.js";
import type { ResearchBundle, ResearchClaim, ResearchSource, TaskIntent } from "../types.js";

// ─────────────────────────────────────────────
// 适配器接口 — 每种检索来源实现此接口
// ─────────────────────────────────────────────

export type RetrievalResult = {
  sources: ResearchSource[];
  claims: ResearchClaim[];
  riskFlags: string[];
  missingItems: string[];
};

export type RetrievalAdapter = {
  /** 适配器名称（用于日志和审计） */
  name: string;
  /** 是否支持某类任务 */
  supports: (intent: TaskIntent) => boolean;
  /** 执行检索，返回结构化结果。signal 可用于取消底层模型/网络调用。 */
  retrieve: (params: {
    intent: TaskIntent;
    memory: MemoryContext;
    signal?: AbortSignal;
  }) => Promise<RetrievalResult>;
};

// ─────────────────────────────────────────────
// 主检索函数 — 编排多个适配器并合并结果
// ─────────────────────────────────────────────

export type RetrieveParams = {
  intent: TaskIntent;
  memory: MemoryContext;
  adapters: RetrievalAdapter[];
  signal?: AbortSignal;
};

/** One hung source must not stall the whole turn. Adapters may still finish underneath. */
export const RETRIEVAL_ADAPTER_DEADLINE_MS = 20_000;

const ARTICLE_TOKEN_RE = /第[0-9零〇一二三四五六七八九十百千]+条/g;

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 五百七十七 and 577 are the same article. 第五条 is not 第五十条. */
export function articleOrdinal(token: string): number | null {
  const inner = token.replace(/^第/, "").replace(/条$/, "");
  if (/^\d+$/.test(inner)) {
    const n = Number(inner);
    return Number.isSafeInteger(n) ? n : null;
  }
  let total = 0;
  let current = 0;
  let seen = false;
  for (const ch of inner) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch]!;
      seen = true;
      continue;
    }
    const unit = CN_UNITS[ch];
    if (unit === undefined) {
      return null;
    }
    seen = true;
    total += (current || 1) * unit;
    current = 0;
  }
  if (!seen) {
    return null;
  }
  return total + current;
}

function articleOrdinals(text: string): number[] {
  const nums: number[] = [];
  for (const match of text.matchAll(ARTICLE_TOKEN_RE)) {
    const n = articleOrdinal(match[0]);
    if (n !== null) {
      nums.push(n);
    }
  }
  return nums;
}

function sourceHaystack(source: ResearchSource): string {
  return [source.title, source.citation, source.excerpt, source.caseNumber, source.url]
    .filter(Boolean)
    .join("\n");
}

/**
 * A claim that writes an article number must show that number on a cited source.
 * Paraphrases with no 第N条 stay; invented pinpoints are dropped.
 */
export function claimArticleGrounded(claim: ResearchClaim, sources: ResearchSource[]): boolean {
  const articles = [...articleOrdinals(claim.text), ...articleOrdinals(claim.pin?.article ?? "")];
  if (articles.length === 0) {
    return true;
  }
  const cited = sources.filter(
    (s) => claim.sourceIds.includes(s.id) && !s.provider?.startsWith("model-"),
  );
  const hay = new Set(cited.flatMap((source) => articleOrdinals(sourceHaystack(source))));
  return articles.every((article) => hay.has(article));
}

function preferSource(prev: ResearchSource, next: ResearchSource): ResearchSource {
  if (prev.demo === true && next.demo !== true) {
    return next;
  }
  if (prev.demo !== true && next.demo === true) {
    return prev;
  }
  const prevSpan = (prev.citation ?? "").length + (prev.url ?? "").length;
  const nextSpan = (next.citation ?? "").length + (next.url ?? "").length;
  return nextSpan > prevSpan ? next : prev;
}

async function retrieveAdapter(
  adapter: RetrievalAdapter,
  params: { intent: TaskIntent; memory: MemoryContext; signal?: AbortSignal },
): Promise<RetrievalResult> {
  if (params.signal?.aborted) {
    throw new Error(`检索适配器已取消：${adapter.name}`);
  }
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  params.signal?.addEventListener("abort", onParentAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`检索适配器超时：${adapter.name}`));
    }, RETRIEVAL_ADAPTER_DEADLINE_MS);
  });
  const work = adapter.retrieve({ ...params, signal: controller.signal });
  // Timeout wins the race; a later rejection must not surface as unhandled.
  void work.catch(() => {});
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    params.signal?.removeEventListener("abort", onParentAbort);
  }
}

/**
 * 依据 TaskIntent 选取适用的适配器，并发检索，合并输出 ResearchBundle。
 *
 * 如果没有适配器支持当前任务类型，返回一个 requiresReview=true 的空 bundle，
 * 提示律师手动补充。
 */
export async function retrieve(params: RetrieveParams): Promise<ResearchBundle> {
  const { intent, memory, adapters, signal } = params;

  const applicableAdapters = adapters.filter((a) => a.supports(intent));

  const allSources: ResearchSource[] = [];
  const allClaims: ResearchClaim[] = [];
  const allRiskFlags: string[] = [];
  const allMissingItems: string[] = [];

  if (applicableAdapters.length === 0) {
    allMissingItems.push("没有可用的检索适配器，请手动补充资料。");
  } else {
    const results = await Promise.allSettled(
      applicableAdapters.map((adapter) => retrieveAdapter(adapter, { intent, memory, signal })),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allSources.push(...result.value.sources);
        allClaims.push(...result.value.claims);
        allRiskFlags.push(...result.value.riskFlags);
        allMissingItems.push(...result.value.missingItems);
      } else {
        allRiskFlags.push(`检索适配器异常：${String(result.reason)}`);
      }
    }
  }

  // 同一 id 保留非演示、引用更完整的那条（直播覆盖 sample，而不是先到先得）。
  const sourceById = new Map<string, ResearchSource>();
  const sourceOrder: string[] = [];
  for (const source of allSources) {
    const prev = sourceById.get(source.id);
    if (!prev) {
      sourceOrder.push(source.id);
      sourceById.set(source.id, source);
      continue;
    }
    sourceById.set(source.id, preferSource(prev, source));
  }
  const dedupedSources = sourceOrder.map((id) => sourceById.get(id)!);

  // 校验 claims 引用完整性：如果 claim.sourceIds 不存在于 sources，降级为风险项。
  // 写了条号但条号不在所引来源上的，同样降级（对得上出处，而不是只对得上 id）。
  const validSourceIds = new Set(dedupedSources.map((s) => s.id));
  const sanitizedClaims: ResearchClaim[] = [];
  for (const claim of allClaims) {
    const hasMissingSource = claim.sourceIds.some((id) => !validSourceIds.has(id));
    if (hasMissingSource) {
      allRiskFlags.push(`结论引用缺失来源，已降级处理：${claim.text.slice(0, 60)}`);
      allMissingItems.push("部分结论来源不完整，请重新检索或补充来源。");
      continue;
    }
    if (!claimArticleGrounded(claim, dedupedSources)) {
      allRiskFlags.push(`结论所写条号未出现在引用来源，已降级：${claim.text.slice(0, 60)}`);
      allMissingItems.push("部分结论的条号对不上所引来源，请按来源原文核对后再引用。");
      continue;
    }
    sanitizedClaims.push(claim);
  }

  // 高风险任务或有缺失项时，强制要求律师审核
  const requiresReview =
    intent.riskLevel === "high" || allMissingItems.length > 0 || allRiskFlags.length > 0;

  return {
    taskId: intent.taskId,
    query: intent.summary,
    sources: dedupedSources,
    claims: sanitizedClaims,
    riskFlags: [...new Set(allRiskFlags)],
    missingItems: [...new Set(allMissingItems)],
    requiresReview,
    completedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// 内置适配器：工作区文件检索（读取本地 cases/ 文件）
// ─────────────────────────────────────────────

import fs from "node:fs/promises";
import path from "node:path";

/** Short citable span for the reasoning graph. Headings are not facts. */
function factCitationExcerpt(text: string, fallback: string): string {
  const excerpt = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .slice(0, 2)
    .join(" ")
    .slice(0, 160)
    .trim();
  return excerpt.length > 0 ? excerpt : fallback;
}

export function createWorkspaceAdapter(workspaceDir: string): RetrievalAdapter {
  return {
    name: "workspace",
    supports: () => true, // 对所有任务类型生效
    async retrieve({ intent, memory }) {
      const sources: ResearchSource[] = [];
      const riskFlags: string[] = [];
      const missingItems: string[] = [];

      try {
        if (intent.matterId && isValidMatterId(intent.matterId)) {
          const caseFile = path.join(workspaceDir, "cases", intent.matterId, "CASE.md");
          const content = await fs.readFile(caseFile, "utf8").catch(() => "");
          if (content) {
            const title = `案件文件：${intent.matterId}`;
            sources.push({
              id: randomUUID(),
              title,
              kind: "memo",
              url: caseFile,
              citation: factCitationExcerpt(content, title),
            });
          } else {
            missingItems.push(`案件 ${intent.matterId} 暂无 CASE.md，请补充案件背景。`);
          }
        } else if (intent.matterId) {
          missingItems.push("案件编号无法用来读取本案文件。");
        }
        const cp = memory.clientProfile?.trim();
        if (cp) {
          const url = memory.clientProfileClientId
            ? path.join(workspaceDir, "clients", memory.clientProfileClientId, "CLIENT_PROFILE.md")
            : path.join(workspaceDir, "CLIENT_PROFILE.md");
          const title = memory.clientProfileClientId
            ? `客户画像：${memory.clientProfileClientId}`
            : "客户画像（工作区根目录）";
          sources.push({
            id: randomUUID(),
            title,
            kind: "workspace",
            url,
            citation: factCitationExcerpt(cp, title),
          });
        }
      } catch {
        riskFlags.push("工作区检索时出现异常，请检查文件路径。");
      }

      return { sources, claims: [], riskFlags, missingItems };
    },
  };
}
