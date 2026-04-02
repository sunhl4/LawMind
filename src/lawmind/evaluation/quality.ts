/**
 * LawMind 质量快照持久化
 *
 * 将 QualityRecord 写入工作区 quality/ 目录，
 * 每条记录一个 JSON 文件，便于后续统计与导出。
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { QualityRecord } from "../types.js";

function qualityDir(workspaceDir: string): string {
  return path.join(workspaceDir, "quality");
}

function qualityFilePath(workspaceDir: string, taskId: string): string {
  return path.join(qualityDir(workspaceDir), `${taskId}.quality.json`);
}

/**
 * 持久化单条质量快照。
 * 若同一 taskId 已存在记录则覆盖（最后一次审核结果为准）。
 */
export function persistQualityRecord(workspaceDir: string, record: QualityRecord): void {
  const dir = qualityDir(workspaceDir);
  // 同步写入（fire-and-forget，不阻塞 review 流程）
  fs.mkdir(dir, { recursive: true })
    .then(() =>
      fs.writeFile(qualityFilePath(workspaceDir, record.taskId), JSON.stringify(record, null, 2)),
    )
    .catch(() => {
      // 质量快照写入失败不应阻断主流程
    });
}

/**
 * 读取单条质量快照。
 */
export async function readQualityRecord(
  workspaceDir: string,
  taskId: string,
): Promise<QualityRecord | undefined> {
  try {
    const raw = await fs.readFile(qualityFilePath(workspaceDir, taskId), "utf8");
    return JSON.parse(raw) as QualityRecord;
  } catch {
    return undefined;
  }
}

/**
 * 读取所有质量快照（用于生成统计报告）。
 */
export async function listQualityRecords(workspaceDir: string): Promise<QualityRecord[]> {
  try {
    const dir = qualityDir(workspaceDir);
    const files = await fs.readdir(dir);
    const records: QualityRecord[] = [];
    for (const f of files) {
      if (!f.endsWith(".quality.json")) {
        continue;
      }
      try {
        const raw = await fs.readFile(path.join(dir, f), "utf8");
        records.push(JSON.parse(raw) as QualityRecord);
      } catch {
        // 跳过损坏文件
      }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * 将所有质量快照导出为 Markdown 摘要报告。
 */
export async function buildQualityReportMarkdown(workspaceDir: string): Promise<string> {
  const records = await listQualityRecords(workspaceDir);
  if (records.length === 0) {
    return "# LawMind 质量报告\n\n暂无质量记录。\n";
  }

  const total = records.length;
  const firstPassCount = records.filter((r) => r.firstPassApproved).length;
  const approvedCount = records.filter((r) => r.reviewStatus === "approved").length;
  const goldenCount = records.filter((r) => r.isGoldenExample).length;

  // 标签频率统计
  const labelFreq: Record<string, number> = {};
  for (const r of records) {
    for (const label of r.reviewLabels) {
      labelFreq[label] = (labelFreq[label] ?? 0) + 1;
    }
  }
  const topLabels = Object.entries(labelFreq)
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, 10);

  const lines: string[] = [
    "# LawMind 质量报告",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    "## 汇总统计",
    "",
    `| 指标 | 数值 |`,
    `|------|------|`,
    `| 任务总数 | ${total} |`,
    `| 一次通过数（无实质改动直接批准） | ${firstPassCount}（${Math.round((firstPassCount / total) * 100)}%）|`,
    `| 批准数 | ${approvedCount}（${Math.round((approvedCount / total) * 100)}%）|`,
    `| 黄金样本数 | ${goldenCount} |`,
    "",
    "## 高频审核标签（前 10）",
    "",
  ];

  if (topLabels.length === 0) {
    lines.push("暂无标签数据。");
  } else {
    lines.push("| 标签 | 出现次数 |");
    lines.push("|------|----------|");
    for (const [label, count] of topLabels) {
      lines.push(`| ${label} | ${count} |`);
    }
  }

  lines.push("", "## 黄金样本列表", "");
  const goldenRecords = records.filter((r) => r.isGoldenExample);
  if (goldenRecords.length === 0) {
    lines.push("暂无黄金样本（律师在审核时标记 `quality.good_example` 即可晋升）。");
  } else {
    lines.push("| 任务 ID | 类型 | 模板 | 审核时间 |");
    lines.push("|---------|------|------|----------|");
    for (const r of goldenRecords) {
      lines.push(`| ${r.taskId} | ${r.taskKind} | ${r.templateId ?? "无"} | ${r.createdAt} |`);
    }
  }

  return lines.join("\n");
}

function avg(nums: (number | null | undefined)[]): number | null {
  const n = nums.filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
  if (n.length === 0) {
    return null;
  }
  return Math.round((n.reduce((a, b) => a + b, 0) / n.length) * 1000) / 1000;
}

/**
 * Phase B：按任务类型、模板、岗位 preset 聚合的质量看板（Markdown）。
 */
export async function buildQualityDashboardMarkdown(workspaceDir: string): Promise<string> {
  const records = await listQualityRecords(workspaceDir);
  if (records.length === 0) {
    return "# LawMind 质量看板\n\n暂无质量快照数据。先完成审核并调用 `recordQuality`。\n";
  }

  const byKind = new Map<string, typeof records>();
  const byTemplate = new Map<string, typeof records>();
  const byPreset = new Map<string, typeof records>();
  for (const r of records) {
    const k = r.taskKind;
    byKind.set(k, [...(byKind.get(k) ?? []), r]);
    const t = r.templateId ?? "(无模板)";
    byTemplate.set(t, [...(byTemplate.get(t) ?? []), r]);
    const p = r.presetKey ?? "(无岗位预设)";
    byPreset.set(p, [...(byPreset.get(p) ?? []), r]);
  }

  const lines: string[] = [
    "# LawMind 质量看板（Phase B）",
    "",
    `生成时间：${new Date().toISOString()}，样本数：${records.length}`,
    "",
    "## 按任务类型",
    "",
    "| 任务类型 | 条数 | 平均引用有效率 | 平均争点覆盖 | 平均风险召回 | 一次通过率 |",
    "|----------|------|----------------|--------------|--------------|------------|",
  ];

  for (const [kind, rows] of [...byKind.entries()].toSorted((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(
      `| ${kind} | ${rows.length} | ${fmtRate(avg(rows.map((x) => x.citationValidityRate)))} | ${fmtRate(avg(rows.map((x) => x.issueCoverageRate)))} | ${fmtRate(avg(rows.map((x) => x.riskRecallRate)))} | ${pct(rows.filter((x) => x.firstPassApproved).length / rows.length)} |`,
    );
  }

  lines.push(
    "",
    "## 按模板 ID",
    "",
    "| 模板 | 条数 | 平均引用有效率 | 一次通过率 |",
    "|------|------|----------------|------------|",
  );

  for (const [tid, rows] of [...byTemplate.entries()].toSorted((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    lines.push(
      `| ${tid} | ${rows.length} | ${fmtRate(avg(rows.map((x) => x.citationValidityRate)))} | ${pct(rows.filter((x) => x.firstPassApproved).length / rows.length)} |`,
    );
  }

  lines.push(
    "",
    "## 按岗位 preset",
    "",
    "| presetKey | 条数 | 平均争点覆盖 | 黄金样本数 |",
    "|-----------|------|--------------|------------|",
  );

  for (const [pk, rows] of [...byPreset.entries()].toSorted((a, b) => a[0].localeCompare(b[0]))) {
    const golden = rows.filter((x) => x.isGoldenExample).length;
    lines.push(
      `| ${pk} | ${rows.length} | ${fmtRate(avg(rows.map((x) => x.issueCoverageRate)))} | ${golden} |`,
    );
  }

  return lines.join("\n");
}

function fmtRate(v: number | null): string {
  if (v === null) {
    return "—";
  }
  return `${Math.round(v * 100)}%`;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
