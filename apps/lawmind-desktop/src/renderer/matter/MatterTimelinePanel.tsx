import type { AuditEventRow } from "./matter-interaction";
import { auditKindLabel } from "./matter-interaction";
import type { SessionTimelineEntry } from "./useMatterSessionTimeline";

type Props = {
  progressEntries: string[];
  sessionTimeline: SessionTimelineEntry[];
  auditEvents: AuditEventRow[];
};

export function MatterTimelinePanel(props: Props) {
  const { progressEntries, sessionTimeline, auditEvents } = props;
  return (
    <div className="lm-workbench-panel">
      <h3>工作进展</h3>
      <ul className="lm-bullet-list">
        {progressEntries.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
      {sessionTimeline.length > 0 ? (
        <>
          <h3>最近动态</h3>
          <ul className="lm-bullet-list">
            {sessionTimeline.map((e) => (
              <li key={e.id} className={e.severity === "warn" ? "lm-timeline-warn" : undefined}>
                <span className="lm-meta">{e.timestamp}</span> {e.label}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3>审计事件</h3>
      <ul className="lm-audit-list">
        {auditEvents.map((e, i) => (
          <li key={i}>
            <span className="lm-audit-kind">{auditKindLabel(e.kind)}</span>
            <span className="lm-audit-time">{e.timestamp}</span>
            <div className="lm-audit-detail">{e.detail}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
