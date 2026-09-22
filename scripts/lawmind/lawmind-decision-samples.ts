#!/usr/bin/env node
/**
 * 决策语料导出（第二十期 P0）。
 *
 * 把工作区里既有的判断信号（lint 逃逸、产品指标、运行时事件、质量快照、拍板记录）
 * 归一成 `lawmind/decision/decision-samples.jsonl` + 数据体检报告。
 *
 * Usage:
 *   pnpm lawmind:decision-samples [-- --workspace <dir>] [--json] [--dry-run] [--event-window N]
 *
 * 口径：
 *   - 缺来源诚实报 present=false，**不产出 0**（不把「没有数据」说成「没有漏网」）。
 *   - `--dry-run` 只打印报告，不写任何文件。
 *   - 报告里的 warnings 是数据缺口自述；为空不代表数据充足。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  describeMaterialBlockHealth,
  summarizeMaterialBlockHealth,
} from "../../src/lawmind/agent/material-blocks.js";
import {
  formatEditExamplesPromptBlock,
  loadEditExamplesForDrafting,
  readEditExamplesDetailed,
} from "../../src/lawmind/learning/edit-examples.js";
import {
  collectDecisionSamples,
  writeDecisionSamples,
  type DecisionSamplesReport,
} from "../../src/lawmind/metrics/decision-samples.js";
import {
  buildCalibrationDataset,
  describeCalibrationFit,
  fitFirmCalibrator,
} from "../../src/lawmind/metrics/firm-calibrator.js";
import { getDecisionModel } from "../../src/lawmind/models/decision-model.js";
import { summarizeRouteDivergence } from "../../src/lawmind/router/route-divergence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

type Args = {
  workspace: string;
  json: boolean;
  dryRun: boolean;
  eventWindow?: number;
};

function parseArgs(argv: string[]): Args {
  let workspace = process.env.LAWMIND_WORKSPACE_DIR?.trim()
    ? path.resolve(process.env.LAWMIND_WORKSPACE_DIR.trim())
    : path.join(repoRoot, "workspace");
  let json = false;
  let dryRun = false;
  let eventWindow: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--workspace" && argv[i + 1]) {
      workspace = path.resolve(argv[++i]);
    } else if (a === "--json") {
      json = true;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--event-window" && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) {
        eventWindow = Math.floor(n);
      }
    }
  }
  return { workspace, json, dryRun, ...(eventWindow ? { eventWindow } : {}) };
}

function printHuman(
  report: DecisionSamplesReport,
  wrote: boolean,
  paths: { samples: string; report: string },
): void {
  const lines: string[] = [];
  lines.push("");
  lines.push("LawMind 决策语料导出（第二十期 P0）");
  lines.push("=====================================");
  lines.push(`工作区: ${report.workspaceDir}`);
  lines.push(`样本数: ${report.sampleCount}`);
  lines.push(`时间范围: ${report.timeRange.from ?? "（无）"} → ${report.timeRange.to ?? "（无）"}`);
  lines.push("");

  lines.push("各来源覆盖（缺样本一律 present=false，不折算成 0）：");
  for (const s of report.sources) {
    const mark = s.present ? "有" : "无";
    lines.push(`  [${mark}] ${s.id.padEnd(15)} ${String(s.rows).padStart(6)} 行  ${s.path}`);
    if (s.skippedLines) {
      lines.push(`        跳过坏行 ${s.skippedLines}`);
    }
    if (s.note) {
      lines.push(`        ${s.note}`);
    }
  }
  lines.push("");

  if (Object.keys(report.bySignal).length > 0) {
    lines.push("各信号计数:");
    for (const [signal, count] of Object.entries(report.bySignal).toSorted(
      ([, a], [, b]) => b - a,
    )) {
      lines.push(`  ${signal.padEnd(20)} ${count}`);
    }
    lines.push("");
  }

  lines.push("正文片段:");
  lines.push(
    `  有片段 ${report.snippetStats.withSnippet} / 无片段 ${report.snippetStats.withoutSnippet}` +
      ` · 平均 ${report.snippetStats.avgChars ?? "（无）"} 字 · 触顶 ${report.snippetStats.clipChars} 字的 ${report.snippetStats.atClipLimit} 条`,
  );
  lines.push("");

  lines.push("标签平衡（P3 校准器的起步条件）:");
  const b = report.labelBalance;
  lines.push(`  一次通过 ok/fail: ${b.firstPassOk} / ${b.firstPassFail}`);
  lines.push(`  拍板 通过/驳回:   ${b.approvalsApproved} / ${b.approvalsRejected}`);
  lines.push("");

  if (report.warnings.length > 0) {
    lines.push("数据缺口（必须据此判断语料够不够，不要只看样本数）:");
    for (const w of report.warnings) {
      lines.push(`  ! ${w}`);
    }
    lines.push("");
  } else {
    lines.push("数据缺口: 本次未发现（不代表数据充足）。");
    lines.push("");
  }

  if (wrote) {
    lines.push(`已写入: ${paths.samples}`);
    lines.push(`      ${paths.report}`);
  } else {
    lines.push("--dry-run：未写入任何文件。");
  }
  lines.push("");
  console.log(lines.join("\n"));
}

/**
 * P2.3：三路径分歧摘要（shadow 数据）。
 * 缺文件时如实说「尚无记录」，不折算成 0%——分歧率 0 与「还没数据」是两件事。
 */
function printDivergence(workspaceDir: string): void {
  const sum = summarizeRouteDivergence(workspaceDir);
  console.log("三路径分歧（P2.3 shadow）:");
  if (!sum.present) {
    console.log("  尚无分歧记录。启用模型路由并跑过交办后才会产生。");
    console.log("");
    return;
  }
  console.log(`  记录 ${sum.total} 条，其中分歧 ${sum.divergent} 条`);
  for (const row of sum.byKey.slice(0, 8)) {
    console.log(`  ${String(row.count).padStart(5)}×  ${row.divergenceKey}`);
    if (row.example) {
      console.log(`         例：${row.example}`);
    }
  }
  console.log("");
}

/**
 * 改稿范例库 —— 这一轮新接的「素材」通道。
 *
 * 关键对照：**同一批律师改动，同时走两条路**。
 * 偏好通道给出一句话（指令），范例通道保留完整对照（素材）。
 * 这里把两条都打出来，让差异可见。
 */
function printEditExamples(workspaceDir: string): void {
  const read = readEditExamplesDetailed(workspaceDir);
  console.log("改稿范例库（素材通道 · edits/edit-examples.jsonl）:");
  if (!read.present) {
    console.log("  尚无记录。律师改稿后才会产生范例对。");
    console.log("");
    return;
  }
  console.log(
    `  ${read.rows.length} 条范例对${read.skippedLines > 0 ? `（跳过坏行 ${read.skippedLines}）` : ""}`,
  );
  const hints = loadEditExamplesForDrafting({
    workspaceDir,
    instruction: "催告函",
    ...(read.rows[0]?.deliverableType ? { deliverableType: read.rows[0].deliverableType } : {}),
    limit: 2,
  });
  console.log(`  对「催告函」类交办检索到 ${hints.length} 条`);
  const block = formatEditExamplesPromptBlock(hints);
  if (block) {
    const preview = block.split("\n").slice(0, 8).join("\n");
    console.log("");
    console.log("  —— 将注入 prompt 的块（节选）——");
    for (const line of preview.split("\n")) {
      console.log(`  ${line.slice(0, 100)}${line.length > 100 ? "…" : ""}`);
    }
  }
  console.log("");
  console.log("  ⚠️ 该块**只是参照**：不进任何门禁、检索不到就整块不注入。");
  console.log("     注入文案有测试锁定，不得出现「必须 / 一律 / 禁止 / 不得」。");
  console.log("");
}

/** P3：firm-specific 校准器状态（含冷启动拒绝理由）。 */
async function printCalibrator(workspaceDir: string): Promise<void> {
  const ds = await buildCalibrationDataset(workspaceDir);
  const fit = fitFirmCalibrator(ds.rows);
  console.log("firm-specific 校准器（P3）:");
  console.log(
    `  数据集 ${ds.rows.length} 条（质量快照 ${ds.sources.quality} / 事件 ${ds.sources.productEvents} / 决策样本 ${ds.sources.decisionSamples}）`,
  );
  console.log(`  ${describeCalibrationFit(fit)}`);
  for (const w of ds.warnings) {
    console.log(`  ! ${w}`);
  }
  for (const w of fit.warnings) {
    console.log(`  ! ${w}`);
  }
  console.log("");
}

/** P5：外部判定器门禁状态（默认 off；离线模式必须不可用）。 */
function printDecisionModelGate(workspaceDir: string): void {
  const r = getDecisionModel({ workspaceDir });
  console.log("外部判定模型（P5 端口）:");
  console.log(`  姿态 ${r.mode} · 原因 ${r.reason}`);
  if (r.mode === "off") {
    console.log("  未启用。这是默认状态——不存在「配了 key 就自动开」。");
  } else {
    console.log(`  端口 ${r.model?.id ?? "(无)"}`);
  }
  console.log("");
}

/**
 * 素材块健康（D10 收口）：丢弃必须可测，不只是写在 prompt 文案里。
 */
function printMaterialHealth(workspaceDir: string): void {
  const health = summarizeMaterialBlockHealth(workspaceDir);
  console.log("素材块健康（D10）：");
  console.log(`  ${describeMaterialBlockHealth(health)}`);
  if (health.samples > 0) {
    for (const c of health.byChannel) {
      if (c.presentCount === 0) {
        console.log(`    ${c.channel.padEnd(16)} 本次范围内未出现内容`);
        continue;
      }
      const rate = c.dropRate === null ? "—" : `${(c.dropRate * 100).toFixed(0)}%`;
      console.log(
        `    ${c.channel.padEnd(16)} 纳入 ${c.includedCount} · 丢 ${c.droppedCount} · 丢弃率 ${rate}`,
      );
    }
  }
  console.log("");
  console.log("  注：丢弃率在样本不足时为「—」而不是 0%——不编造比例。");
  console.log("");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.workspace)) {
    console.error(`工作区不存在: ${args.workspace}`);
    process.exit(1);
  }

  const collection = await collectDecisionSamples(
    args.workspace,
    args.eventWindow ? { eventWindow: args.eventWindow } : undefined,
  );

  let wrote = false;
  let samplesPath = "";
  let reportPath = "";
  if (!args.dryRun) {
    const result = writeDecisionSamples(args.workspace, collection);
    wrote = true;
    samplesPath = result.samplesPath;
    reportPath = result.reportPath;
  }

  if (args.json) {
    const ds = await buildCalibrationDataset(args.workspace);
    const fit = fitFirmCalibrator(ds.rows);
    const gate = getDecisionModel({ workspaceDir: args.workspace });
    console.log(
      JSON.stringify(
        {
          decisionSamples: collection.report,
          routeDivergence: summarizeRouteDivergence(args.workspace),
          calibrator: { fit, datasetRows: ds.rows.length, warnings: ds.warnings },
          editExamples: readEditExamplesDetailed(args.workspace),
          materialHealth: summarizeMaterialBlockHealth(args.workspace),
          decisionModel: { mode: gate.mode, reason: gate.reason, portId: gate.model?.id },
        },
        null,
        2,
      ),
    );
    return;
  }

  printHuman(collection.report, wrote, { samples: samplesPath, report: reportPath });
  printDivergence(args.workspace);
  printEditExamples(args.workspace);
  printMaterialHealth(args.workspace);
  await printCalibrator(args.workspace);
  printDecisionModelGate(args.workspace);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
