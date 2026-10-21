#!/usr/bin/env node
/**
 * 前缀缓存 A/B（真实上游、合成文本、只读缓存字段）。
 *
 *   pnpm lawmind:cache-ab -- --dry-run
 *   LAWMIND_AGENT_BASE_URL=... LAWMIND_AGENT_API_KEY=... LAWMIND_AGENT_MODEL=... pnpm lawmind:cache-ab
 *
 * 只发**合成法律条文段落**，不读工作区材料、不发送任何客户文件。
 * 上游不报缓存字段时输出 `cacheReporting: absent`，不把缺失当成 0。
 */

import { callModelWithRetry } from "../../src/lawmind/agent/runtime-model-call.js";
import { runCacheAb, formatCacheAbMarkdown } from "../../src/lawmind/evaluation/cache-ab.js";
import {
  createModelUsageRecorder,
  listModelUsageLedger,
  type ModelUsageSnapshot,
} from "../../src/lawmind/models/model-usage.js";

const SYNTHETIC_PREFIX = [
  "以下是公开法律条文的合成摘录，仅用于测量前缀缓存，不含任何客户信息。",
  "《中华人民共和国民法典》第五百七十七条：当事人一方不履行合同义务或者履行合同义务不符合约定的，应当承担继续履行、采取补救措施或者赔偿损失等违约责任。",
  "第五百八十五条：当事人可以约定一方违约时应当根据违约情况向对方支付一定数额的违约金，也可以约定因违约产生的损失赔偿额的计算方法。",
  "第五百九十条：当事人一方因不可抗力不能履行合同的，根据不可抗力的影响，部分或者全部免除责任，但是法律另有规定的除外。",
  "第六百七十五条：借款人应当按照约定的期限返还借款。对借款期限没有约定或者约定不明确，依据本法第五百一十条的规定仍不能确定的，借款人可以随时返还；贷款人可以催告借款人在合理期限内返还。",
  "第七百零三条：租赁合同是出租人将租赁物交付承租人使用、收益，承租人支付租金的合同。",
  "第七百二十二条：承租人无正当理由未支付或者迟延支付租金的，出租人可以请求承租人在合理期限内支付；承租人逾期不支付的，出租人可以解除合同。",
].join("\n");

function toolDefs(names: readonly string[]): unknown[] {
  return names.map((name) => ({
    type: "function",
    function: {
      name,
      description: `合成占位工具 ${name}，仅用于测量工具表变化对前缀缓存的影响。`,
      parameters: { type: "object", properties: {}, required: [] },
    },
  }));
}

function configFromEnv(): {
  baseUrl: string;
  apiKey: string;
  model: string;
} | null {
  const baseUrl = process.env.LAWMIND_AGENT_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? "";
  const apiKey = process.env.LAWMIND_AGENT_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? "";
  const model = process.env.LAWMIND_AGENT_MODEL ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  if (!baseUrl.trim() || !apiKey.trim()) {
    return null;
  }
  return { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const cfg = configFromEnv();
  if (dryRun || !cfg) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          configured: Boolean(cfg),
          note: cfg
            ? "已配置模型；去掉 --dry-run 会真的发三次合成请求。"
            : "未配置模型凭据（LAWMIND_AGENT_* 或 DEEPSEEK_*）；没有发出任何请求。",
          plan: ["cold", "repeat", "tool_table_changed"],
          sends: "仅合成法条文本，不读工作区材料",
        },
        null,
        2,
      ),
    );
    return;
  }

  const usageDir = process.env.LAWMIND_CACHE_AB_LEDGER_DIR ?? "";
  const recorder = usageDir
    ? createModelUsageRecorder(usageDir, {
        purpose: "other",
        model: cfg.model,
      })
    : undefined;

  const report = await runCacheAb({
    fixedInputTokens: 0,
    systemPrompt: SYNTHETIC_PREFIX,
    sample: async ({ identicalPrefix, toolTable }) => {
      const messages = [
        { role: "system" as const, content: SYNTHETIC_PREFIX },
        {
          role: "user" as const,
          content: identicalPrefix ? "只回答：收到。" : "只回答：第一条。",
        },
      ];
      const response = await callModelWithRetry(
        {
          provider: "openai-compatible",
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: cfg.model,
          maxTokens: 16,
          temperature: 0,
          maxRetries: 0,
          timeoutMs: 60_000,
        },
        messages,
        toolDefs(toolTable),
        recorder ? { onModelUsage: recorder } : {},
      );
      const usage = (response as { usage?: unknown }).usage;
      // 复用归一器，避免脚本自己造第二套字段名。
      const { usageFromProvider } = await import("../../src/lawmind/models/model-usage.js");
      return usageFromProvider(
        usage as Parameters<typeof usageFromProvider>[0],
      ) as ModelUsageSnapshot;
    },
  });

  console.log(formatCacheAbMarkdown(report));
  if (usageDir) {
    const rows = listModelUsageLedger(usageDir);
    console.log(`账本行数：${rows.length}（${usageDir}）`);
  }
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
