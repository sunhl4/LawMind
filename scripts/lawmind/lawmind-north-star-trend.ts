#!/usr/bin/env node
/**
 * 交付北极星趋势（试点律师的证据通道）。
 *
 * 把工作区里的 `product-events.jsonl` 按 ISO 周切桶，输出**同一工作区的纵向趋势**：
 * 一次通过率、机械核对逃逸率、改稿幅度中位数。
 *
 * Usage:
 *   pnpm lawmind:north-star-trend [-- --workspace <dir>] [--window 90] [--json]
 *
 * 为什么只做纵向（同一工作区前后期对比）：
 *   水平值会被案件难度分布、律师个人风格、产品改版同时污染，跨所/跨人横比测到的
 *   主要是风格差异。要回答「这套东西有没有让这位律师更省事」，只有他**自己**的
 *   前后期比较成立。所以本命令不提供任何跨工作区对比。
 *
 * 三条诚实约束（与 `north-star-trend.ts` 同源，也有测试锁定）：
 *   1. 样本不足的一周报 `null`，**绝不报 0% / 100%**；
 *   2. 可用周数不足时**不给趋势结论**，只给每桶计数；
 *   3. 改稿幅度只在**每个可用周都有样本**时参与结论，否则明说「样本不足以同口径比较」。
 *
 * 退出码：始终 0——「样本不足」是**结论**，不是错误。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNorthStarTrend,
  MIN_BUCKETS_FOR_TREND,
  MIN_DELIVERIES_PER_BUCKET,
} from "../../src/lawmind/metrics/north-star-trend.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Args = { workspace: string; windowDays: number; json: boolean };

function parseArgs(argv: string[]): Args {
  let workspace = process.env.LAWMIND_WORKSPACE_DIR?.trim()
    ? path.resolve(process.env.LAWMIND_WORKSPACE_DIR.trim())
    : path.join(repoRoot, "workspace");
  let windowDays = 90;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--workspace" && argv[i + 1]) {
      workspace = path.resolve(argv[++i]);
    } else if (a === "--window" && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) {
        windowDays = Math.max(1, Math.min(365, Math.floor(n)));
      }
    } else if (a === "--json") {
      json = true;
    }
  }
  return { workspace, windowDays, json };
}

/** 比率渲染：**没有可比样本就明写「样品不足」**，不渲染成 0%。 */
function pct(rate: number | null): string {
  return rate == null ? "—（样本不足）" : `${(rate * 100).toFixed(1)}%`;
}

function pts(delta: number): string {
  const v = delta * 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}pt`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const trend = buildNorthStarTrend(args.workspace, { windowDays: args.windowDays });

  if (args.json) {
    console.log(JSON.stringify(trend, null, 2));
    return;
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(`交付北极星趋势 · 工作区 ${args.workspace}`);
  lines.push(
    `窗口：近 ${trend.windowDays} 天 · 周门槛：≥ ${MIN_DELIVERIES_PER_BUCKET} 次交付才报比率`,
  );
  lines.push("");

  if (trend.buckets.length === 0) {
    lines.push("窗口内没有任何交付事件——**这不是「0%」，是「没有数据」**。");
    lines.push("若这位律师确实在用，请先确认指标写入端是否落盘（见 Doctor 的「交付北极星」区）。");
    console.log(lines.join("\n"));
    return;
  }

  lines.push("| 周 | 交付 | 一次通过 | 逃逸 | 改稿幅度中位 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const b of trend.buckets) {
    lines.push(
      `| ${b.week} | ${b.deliveries} | ${pct(b.firstPassRate)} | ${pct(b.lintEscapeRate)} | ` +
        `${b.rewriteAmplitudeMedianChars == null ? "—（样本不足）" : `${Math.round(b.rewriteAmplitudeMedianChars)} 字`} |`,
    );
  }
  lines.push("");

  if (!trend.trend) {
    lines.push(`趋势：**暂不判断** —— ${trend.trendUnavailableReason ?? "样本不足"}`);
    lines.push("（周数不足时给出趋势结论会是噪声；这条纪律是刻意的，不是没算。）");
    console.log(lines.join("\n"));
    return;
  }

  const t = trend.trend;
  lines.push(`可用周数：${t.usableBuckets}（≥ ${MIN_BUCKETS_FOR_TREND} 周才给结论）`);
  lines.push(`- 一次通过率：${pts(t.firstPassRateDelta)}（**升**是好）`);
  lines.push(`- 机械核对逃逸率：${pts(t.lintEscapeRateDelta)}（**降**是好）`);
  lines.push(
    t.rewriteAmplitudeDeltaChars == null
      ? `- 改稿幅度：未参与结论 —— ${t.amplitudeUnavailableReason ?? "样本不足"}`
      : `- 改稿幅度中位：${t.rewriteAmplitudeDeltaChars > 0 ? "+" : ""}${Math.round(t.rewriteAmplitudeDeltaChars)} 字（**降**是好）`,
  );
  lines.push("");
  lines.push(
    `方向：${t.direction}` +
      (t.direction === "mixed" ? "（三项方向不一致——**不挑好看的那项报**）" : ""),
  );
  lines.push("");
  lines.push("提醒：这是**同一工作区的纵向比较**。跨所/跨人横比测到的是风格差异，不是能力提升。");
  console.log(lines.join("\n"));
}

main();
