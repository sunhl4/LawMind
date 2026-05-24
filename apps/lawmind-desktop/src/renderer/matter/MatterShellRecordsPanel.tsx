import type { HistoryItem, TaskRow as ShellTaskRow } from "../lawmind-app-data";
import { pathBasename } from "../display-ids";

export type MatterShellRecordsPanelProps = {
  mode: "ledger" | "deliveries";
  shellTasksScoped: ShellTaskRow[];
  shellHistoryScoped: HistoryItem[];
  shellAssistantDisplayById: Record<string, string>;
  shellLegalStatusLabel?: (status: string | undefined, kind?: string) => string;
  shellTaskBadgeClass?: (status: string, kind?: string) => string;
  shellHistoryBadgeClass?: (kind: string, taskRecordKind?: string, status?: string) => string;
  formatShellRelativeTime?: (iso: string) => string;
  onOpenShellDetail?: (kind: "task" | "draft", id: string) => void;
};

export function MatterShellRecordsPanel(props: MatterShellRecordsPanelProps) {
  const {
    mode,
    shellTasksScoped,
    shellHistoryScoped,
    shellAssistantDisplayById,
    shellLegalStatusLabel,
    shellTaskBadgeClass,
    shellHistoryBadgeClass,
    formatShellRelativeTime,
    onOpenShellDetail,
  } = props;

  if (mode === "ledger") {
    return (
      <div className="lm-workbench-panel lm-records--desk">
        <ul className="lm-list">
          {shellTasksScoped.length === 0 ? (
            <li className="lm-list-empty lm-list-empty-desk">
              <span className="lm-list-empty-title">该案下暂无任务台帐记录</span>
            </li>
          ) : (
            shellTasksScoped.map((task) => {
              const headline = (task.title?.trim() ? task.title : task.summary).slice(0, 160);
              const asst =
                task.assistantId && shellAssistantDisplayById[task.assistantId]?.trim()
                  ? shellAssistantDisplayById[task.assistantId]
                  : null;
              return (
                <li
                  key={task.taskId}
                  className="lm-list-clickable"
                  tabIndex={0}
                  onClick={() => onOpenShellDetail?.("task", task.taskId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenShellDetail?.("task", task.taskId);
                    }
                  }}
                >
                  <div className="lm-list-row">
                    <span className={shellTaskBadgeClass?.(task.status, task.kind) ?? "lm-badge"}>
                      {shellLegalStatusLabel?.(task.status, task.kind) ?? task.status}
                    </span>
                    <span className="lm-list-title">{headline}</span>
                  </div>
                  {asst ? <div className="lm-records-row-asst">经办助手 · {asst}</div> : null}
                  <div className="lm-list-time">更新 · {formatShellRelativeTime?.(task.updatedAt)}</div>
                  {task.outputPath ? (
                    <div className="lm-list-path" title={task.outputPath}>
                      {pathBasename(task.outputPath)}
                    </div>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      </div>
    );
  }

  return (
    <div className="lm-workbench-panel lm-records--desk">
      <ul className="lm-list">
        {shellHistoryScoped.length === 0 ? (
          <li className="lm-list-empty lm-list-empty-desk">
            <span className="lm-list-empty-title">该案下暂无交付记录</span>
          </li>
        ) : (
          shellHistoryScoped.map((item) => {
            const asst =
              item.assistantId && shellAssistantDisplayById[item.assistantId]?.trim()
                ? shellAssistantDisplayById[item.assistantId]
                : null;
            return (
              <li
                key={`${item.kind}-${item.id}`}
                className="lm-list-clickable"
                tabIndex={0}
                onClick={() => onOpenShellDetail?.(item.kind, item.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenShellDetail?.(item.kind, item.id);
                  }
                }}
              >
                <div className="lm-list-row">
                  <span
                    className={
                      shellHistoryBadgeClass?.(item.kind, item.taskRecordKind, item.status) ?? "lm-badge"
                    }
                  >
                    {shellLegalStatusLabel?.(item.status ?? item.kind, item.taskRecordKind) ??
                      item.status ??
                      item.kind}
                  </span>
                  <span className="lm-list-title">{item.label}</span>
                </div>
                {asst ? <div className="lm-records-row-asst">经办助手 · {asst}</div> : null}
                <div className="lm-list-time">更新 · {formatShellRelativeTime?.(item.updatedAt)}</div>
                {item.outputPath ? (
                  <div className="lm-list-path" title={item.outputPath}>
                    {pathBasename(item.outputPath)}
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
