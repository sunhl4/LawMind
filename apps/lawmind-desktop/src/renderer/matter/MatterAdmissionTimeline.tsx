/**
 * 收案记录的操作时间线：谁在什么时候做了什么，倒序、最新在前，只读。
 *
 * 从 `MatterAdmissionCard` 拆出来，避免收案闸门文件继续膨胀；
 * 服务端 GET 本来就返回完整 timeline，这里只负责展示。
 */

import type { ReactNode } from "react";

export type AdmissionTimelineEntry = {
  at: string;
  kind: string;
  by: "system" | "lawyer";
  detail?: string;
};

const KIND_LABEL: Record<string, string> = {
  created: "建立收案记录",
  owner_assigned: "指定负责人",
  candidates_added: "补登候选当事人",
  scan_started: "开始冲突扫描",
  scan_recorded: "写入扫描结果",
  disclosure_acknowledged: "确认告知",
  accepted: "接受委托",
  declined: "婉拒",
};

const BY_LABEL: Record<string, string> = {
  system: "系统",
  lawyer: "律师",
};

export function AdmissionTimeline({ entries }: { entries: AdmissionTimelineEntry[] }): ReactNode {
  if (entries.length === 0) {
    return null;
  }
  const ordered = [...entries].toSorted((a, b) => b.at.localeCompare(a.at));
  return (
    <details className="lm-matter-admission-timeline" data-testid="lm-matter-admission-timeline">
      <summary>操作记录 {ordered.length}</summary>
      <ol className="lm-matter-admission-timeline-list">
        {ordered.map((entry, index) => (
          <li key={`${entry.at}-${entry.kind}-${index}`}>
            <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
            <span>{KIND_LABEL[entry.kind] ?? entry.kind}</span>
            <span className="lm-meta">
              {BY_LABEL[entry.by] ?? entry.by}
              {entry.detail ? ` · ${entry.detail}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
