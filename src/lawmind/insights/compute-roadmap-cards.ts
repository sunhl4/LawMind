/**
 * computeRoadmapCards — 跨案件聚合 InteractionEvent，输出"路线图候选"。
 * 纯函数；输入：多案件的 InteractionEvent 序列。
 */

import type { InteractionEvent, RoadmapCard } from "./types.js";

type LabelBucket = {
  matterIds: Set<string>;
  totalEvents: number;
  latestAt?: string;
};

export function computeRoadmapCards(events: readonly InteractionEvent[]): RoadmapCard[] {
  const byLabel = new Map<string, LabelBucket>();

  for (const ev of events) {
    if (!ev.label) {
      continue;
    }
    const bucket = byLabel.get(ev.label) ?? {
      matterIds: new Set<string>(),
      totalEvents: 0,
      latestAt: undefined,
    };
    bucket.matterIds.add(ev.matterId);
    bucket.totalEvents += 1;
    if (!bucket.latestAt || (ev.timestamp && ev.timestamp > bucket.latestAt)) {
      bucket.latestAt = ev.timestamp;
    }
    byLabel.set(ev.label, bucket);
  }

  const cards: RoadmapCard[] = [];
  for (const [label, bucket] of byLabel.entries()) {
    if (bucket.matterIds.size < 2 && bucket.totalEvents < 3) {
      continue; // 跨案件信号不足，丢入 watching tier 之外
    }
    const score = bucket.matterIds.size * 2 + Math.min(bucket.totalEvents, 20);
    const urgency: RoadmapCard["urgency"] =
      bucket.matterIds.size >= 3 ? "now" : bucket.totalEvents >= 5 ? "next" : "later";
    const readiness: RoadmapCard["readiness"] =
      bucket.matterIds.size >= 3 ? "validated" : bucket.totalEvents >= 4 ? "emerging" : "watching";
    cards.push({
      key: `roadmap_${label}`,
      title: `产品收敛：${label}`,
      score,
      rationale: `已在 ${bucket.matterIds.size} 个案件中累计触发 ${bucket.totalEvents} 次，跨案件信号成立。`,
      urgency,
      readiness,
      benefit:
        urgency === "now"
          ? "覆盖多案件的高频痛点，预期能直接降低律师重复劳动。"
          : "目前信号集中在少数案件，可作为下一阶段试点。",
      risk:
        readiness === "validated"
          ? "需评估对现有 UI 的破坏性，建议灰度上线。"
          : "样本量仍偏少，先做用户访谈再排期。",
      matterCount: bucket.matterIds.size,
      totalEvents: bucket.totalEvents,
      latestAt: bucket.latestAt,
    });
  }

  return cards.toSorted((a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh-CN"));
}
