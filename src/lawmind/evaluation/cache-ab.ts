/**
 * 前缀缓存 A/B：回答「工具表一变，缓存还剩下多少」。
 *
 * 只在律师本机用**合成法律文本**跑（不含任何客户材料），并且只读上游回报的
 * 缓存字段；上游不报缓存时明确记 `absent`，不写 0、也不推算。
 *
 * 三测：
 *   1. 冷启动：同一前缀第一次，缓存命中应为 0；
 *   2. 复读：同一前缀 + 同一工具表，命中应上升（上游支持缓存报数时）；
 *   3. 变表：同一前缀 + 多一个工具，命中应从工具表那一段起失效。
 *
 * `prompt_cache_hit_tokens`（DeepSeek 口径）与
 * `prompt_tokens_details.cached_tokens`（OpenAI 口径）由 `usageFromProvider` 归一。
 */

import type { ModelUsageSnapshot } from "../models/model-usage.js";

export type CacheAbStepId = "cold" | "repeat" | "tool_table_changed";

export type CacheAbStep = {
  id: CacheAbStepId;
  labelZh: string;
  /** 这一步的工具表是否与上一步相同。 */
  sameToolTable: boolean;
  usage: ModelUsageSnapshot;
};

export type CacheAbReport = {
  steps: CacheAbStep[];
  /** 上游是否真的回报了缓存字段。`absent` 时不得把 0 当成「没有命中」。 */
  cacheReporting: "reported" | "absent";
  /** 复读相对冷启动多命中的比例；无数据时为 null。 */
  repeatHitRatio: number | null;
  /** 变表后仍命中的比例（相对复读）；无数据时为 null。 */
  toolTableChangeRetention: number | null;
  /** 每步固定税估算（系统提示 + 工具 schema），用于解释 cache 与总输入的关系。 */
  fixedInputTokens: number;
  noteZh: string;
};

export type CacheAbSample = {
  /** 发一次请求；返回上游归一后的 usage。 */
  sample: (opts: {
    identicalPrefix: boolean;
    toolTable: readonly string[];
  }) => Promise<ModelUsageSnapshot>;
  fixedInputTokens: number;
  systemPrompt: string;
};

const BASE_TOOL_TABLE = ["search_statute", "search_case_law", "analyze_document"];
const EXTENDED_TOOL_TABLE = [...BASE_TOOL_TABLE, "review_table_update"];

function cachedOf(usage: ModelUsageSnapshot): number | undefined {
  return usage.cachedTokens;
}

export async function runCacheAb(sample: CacheAbSample): Promise<CacheAbReport> {
  const cold = await sample.sample({ identicalPrefix: false, toolTable: BASE_TOOL_TABLE });
  const repeat = await sample.sample({ identicalPrefix: true, toolTable: BASE_TOOL_TABLE });
  const changed = await sample.sample({ identicalPrefix: true, toolTable: EXTENDED_TOOL_TABLE });

  const steps: CacheAbStep[] = [
    { id: "cold", labelZh: "冷启动（同一前缀第一次）", sameToolTable: false, usage: cold },
    { id: "repeat", labelZh: "复读（同一前缀 + 同一工具表）", sameToolTable: true, usage: repeat },
    {
      id: "tool_table_changed",
      labelZh: "变表（同一前缀 + 多一个工具）",
      sameToolTable: false,
      usage: changed,
    },
  ];

  const anyReported = [cold, repeat, changed].some((u) => cachedOf(u) !== undefined);
  const coldCached = cachedOf(cold);
  const repeatCached = cachedOf(repeat);
  const changedCached = cachedOf(changed);

  const repeatHitRatio =
    repeatCached !== undefined && coldCached !== undefined && repeatCached > coldCached
      ? (repeatCached - coldCached) / Math.max(1, repeat.promptTokens ?? 0)
      : null;
  const toolTableChangeRetention =
    changedCached !== undefined && repeatCached !== undefined && repeatCached > 0
      ? Math.min(1, changedCached / repeatCached)
      : null;

  return {
    steps,
    cacheReporting: anyReported ? "reported" : "absent",
    repeatHitRatio,
    toolTableChangeRetention,
    fixedInputTokens: sample.fixedInputTokens,
    noteZh: anyReported
      ? "缓存字段来自上游回报；比例只解释这一组请求，不代表账单总额。"
      : "上游没有回报缓存字段：不能据此断言「没有缓存」，也不能把缺失写成 0。",
  };
}

export function formatCacheAbMarkdown(report: CacheAbReport): string {
  const lines = [
    "# 前缀缓存 A/B",
    "",
    `- 缓存回报：${report.cacheReporting}`,
    `- 固定税估算：约 ${report.fixedInputTokens} tokens（系统提示 + 实际发出的工具 schema）`,
    `- 复读相对冷启动多命中比例：${report.repeatHitRatio === null ? "无数据" : `${(report.repeatHitRatio * 100).toFixed(1)}%`}`,
    `- 变表后缓存保留比例：${report.toolTableChangeRetention === null ? "无数据" : `${(report.toolTableChangeRetention * 100).toFixed(1)}%`}`,
    "",
    "| 步骤 | 输入 | 缓存命中 | 未命中 | 输出 |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const step of report.steps) {
    lines.push(
      `| ${step.labelZh} | ${step.usage.promptTokens ?? 0} | ${step.usage.cachedTokens ?? "未回报"} | ${step.usage.uncachedTokens ?? "未回报"} | ${step.usage.completionTokens ?? 0} |`,
    );
  }
  lines.push("", report.noteZh, "");
  return lines.join("\n");
}
