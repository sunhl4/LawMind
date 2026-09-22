/**
 * computeBehaviorSummary — 把单案件维度的 InteractionEvent 序列收敛为可视化用的摘要。
 * 纯函数；不读盘、不写盘。
 */

import type { BehaviorSummary, InteractionEvent } from "./types.js";

export function computeBehaviorSummary(events: readonly InteractionEvent[]): BehaviorSummary {
  let reviewOpenCount = 0;
  let memorySaveCount = 0;
  let caseWriteCount = 0;
  const surfaceCounts = new Map<string, number>();
  const labelCounts = new Map<string, number>();
  const timestamps: string[] = [];

  for (const ev of events) {
    if (ev.action === "open_review") {
      reviewOpenCount += 1;
    } else if (ev.action === "save_upgrade_suggestion") {
      memorySaveCount += 1;
    } else if (ev.action === "write_case_note") {
      caseWriteCount += 1;
    }

    if (ev.surface) {
      surfaceCounts.set(ev.surface, (surfaceCounts.get(ev.surface) ?? 0) + 1);
    }
    if (ev.label) {
      labelCounts.set(ev.label, (labelCounts.get(ev.label) ?? 0) + 1);
    }
    if (ev.timestamp) {
      timestamps.push(ev.timestamp);
    }
  }

  const dominantSurface = Array.from(surfaceCounts.entries())
    .map(([label, count]) => ({ label, count }))
    .toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"))[0];

  const dominantAction: BehaviorSummary["dominantAction"] =
    reviewOpenCount >= memorySaveCount && reviewOpenCount >= caseWriteCount
      ? "review"
      : memorySaveCount >= caseWriteCount
        ? "memory"
        : "case";

  return {
    total: events.length,
    reviewOpenCount,
    memorySaveCount,
    caseWriteCount,
    latestAt: timestamps.toSorted((a, b) => a.localeCompare(b)).at(-1),
    dominantSurface,
    dominantAction,
    topLabels: Array.from(labelCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .filter((item) => item.count >= 2)
      .toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"))
      .slice(0, 3),
  };
}
