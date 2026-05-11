/**
 * <LawyerActionFeed /> — W10。
 *
 * 仅渲染：把 InteractionEvent 数组按时间倒序展示。所有计算（surface 计数、主导动作）
 * 都在 src/lawmind/insights/computeBehaviorSummary 内完成。
 */

import type { ReactNode } from "react";
import type { InteractionEvent } from "../../../../../src/lawmind/insights/index.ts";

type Props = {
  events: InteractionEvent[];
  formatRelative?: (iso: string) => string;
};

export function LawyerActionFeed({ events, formatRelative }: Props): ReactNode {
  if (events.length === 0) {
    return (
      <div className="lm-callout lm-callout-muted">
        本案件还没有记录到律师动作。打开审核台、写入 CASE 或采纳认知建议后即可在此处看到。
      </div>
    );
  }
  const sorted = events.toSorted((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  return (
    <ul className="lm-insights-feed" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {sorted.slice(0, 10).map((ev, idx) => (
        <li
          key={`${ev.timestamp}-${idx}`}
          style={{
            borderBottom: "1px solid var(--lm-border, #e5e7eb)",
            padding: "8px 0",
          }}
        >
          <div style={{ fontWeight: 600 }}>
            {actionLabel(ev.action)} · {ev.surface ?? "(unknown surface)"}
          </div>
          <div className="lm-meta">{ev.label ?? "(no label)"}</div>
          <div className="lm-meta" style={{ marginTop: 4, fontSize: 11 }}>
            {formatRelative ? formatRelative(ev.timestamp) : ev.timestamp}
          </div>
        </li>
      ))}
    </ul>
  );
}

function actionLabel(a: InteractionEvent["action"]): string {
  switch (a) {
    case "open_review":
      return "进入审核台";
    case "save_upgrade_suggestion":
      return "采纳认知升级";
    case "write_case_note":
      return "回写 CASE";
    default:
      return "其他动作";
  }
}
