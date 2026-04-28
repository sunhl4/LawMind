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
  /** 执行检索，返回结构化结果 */
  retrieve: (params: { intent: TaskIntent; memory: MemoryContext }) => Promise<RetrievalResult>;
};

// ─────────────────────────────────────────────
// 主检索函数 — 编排多个适配器并合并结果
// ─────────────────────────────────────────────

export type RetrieveParams = {
  intent: TaskIntent;
  memory: MemoryContext;
  adapters: RetrievalAdapter[];
};

/**
 * 依据 TaskIntent 选取适用的适配器，并发检索，合并输出 ResearchBundle。
 *
 * 如果没有适配器支持当前任务类型，返回一个 requiresReview=true 的空 bundle，
 * 提示律师手动补充。
 */
export async function retrieve(params: RetrieveParams): Promise<ResearchBundle> {
  const { intent, memory, adapters } = params;

  const applicableAdapters = adapters.filter((a) => a.supports(intent));

  const allSources: ResearchSource[] = [];
  const allClaims: ResearchClaim[] = [];
  const allRiskFlags: string[] = [];
  const allMissingItems: string[] = [];

  if (applicableAdapters.length === 0) {
    allMissingItems.push("没有可用的检索适配器，请手动补充资料。");
  } else {
    const results = await Promise.allSettled(
      applicableAdapters.map((adapter) => adapter.retrieve({ intent, memory })),
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

  // 去重来源 ID
  const seenSourceIds = new Set<string>();
  const dedupedSources = allSources.filter((s) => {
    if (seenSourceIds.has(s.id)) {
      return false;
    }
    seenSourceIds.add(s.id);
    return true;
  });

  // 校验 claims 引用完整性：如果 claim.sourceIds 不存在于 sources，降级为风险项
  const validSourceIds = new Set(dedupedSources.map((s) => s.id));
  const sanitizedClaims: ResearchClaim[] = [];
  for (const claim of allClaims) {
    const hasMissingSource = claim.sourceIds.some((id) => !validSourceIds.has(id));
    if (hasMissingSource) {
      allRiskFlags.push(`结论引用缺失来源，已降级处理：${claim.text.slice(0, 60)}`);
      allMissingItems.push("部分结论来源不完整，请重新检索或补充来源。");
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

export function createWorkspaceAdapter(workspaceDir: string): RetrievalAdapter {
  return {
    name: "workspace",
    supports: () => true, // 对所有任务类型生效
    async retrieve({ intent, memory }) {
      const sources: ResearchSource[] = [];
      const riskFlags: string[] = [];
      const missingItems: string[] = [];

      try {
        if (intent.matterId) {
          const caseFile = path.join(workspaceDir, "cases", intent.matterId, "CASE.md");
          const content = await fs.readFile(caseFile, "utf8").catch(() => "");
          if (content) {
            sources.push({
              id: randomUUID(),
              title: `案件文件：${intent.matterId}`,
              kind: "memo",
              url: caseFile,
            });
          } else {
            missingItems.push(`案件 ${intent.matterId} 暂无 CASE.md，请补充案件背景。`);
          }
        }
        const cp = memory.clientProfile?.trim();
        if (cp) {
          const url = memory.clientProfileClientId
            ? path.join(workspaceDir, "clients", memory.clientProfileClientId, "CLIENT_PROFILE.md")
            : path.join(workspaceDir, "CLIENT_PROFILE.md");
          sources.push({
            id: randomUUID(),
            title: memory.clientProfileClientId
              ? `客户画像：${memory.clientProfileClientId}`
              : "客户画像（工作区根目录）",
            kind: "workspace",
            url,
          });
        }
      } catch {
        riskFlags.push("工作区检索时出现异常，请检查文件路径。");
      }

      return { sources, claims: [], riskFlags, missingItems };
    },
  };
}
