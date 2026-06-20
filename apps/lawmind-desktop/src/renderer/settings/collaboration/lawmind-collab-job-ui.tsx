import type { ReactNode } from "react";

export function LocalServiceDisconnectCallout(props: {
  onReconnect?: () => void | Promise<void>;
  busy?: boolean;
  id?: string;
}): ReactNode {
  const { onReconnect, busy = false, id } = props;
  return (
    <div className="lm-callout lm-callout-warn" role="status" id={id}>
      <div className="lm-callout-title">无法连接到本地服务</div>
      <p className="lm-callout-body">
        请确认 LawMind 是通过「Electron 窗口」运行（不要用浏览器打开 Vite 页面）。若刚保存 API
        配置或切换项目，本地端口可能已变更，请点击下方重新连接。
      </p>
      {onReconnect ? (
        <div className="lm-settings-actions">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            disabled={busy}
            onClick={() => void onReconnect()}
          >
            {busy ? "连接中…" : "重新连接本地服务"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function workflowJobStatusLabel(status: string): string {
  const map: Record<string, string> = {
    queued: "排队中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted_by_restart: "已中断",
    scheduled: "已预约",
  };
  return map[status] ?? status;
}

export function workflowJobStatusPillClass(status: string): string {
  switch (status) {
    case "completed":
      return "lm-pill lm-pill-success";
    case "running":
      return "lm-pill lm-pill-info";
    case "queued":
      return "lm-pill lm-pill-neutral";
    case "failed":
      return "lm-pill lm-pill-danger";
    case "cancelled":
      return "lm-pill lm-pill-warn";
    default:
      return "lm-pill lm-pill-neutral";
  }
}
