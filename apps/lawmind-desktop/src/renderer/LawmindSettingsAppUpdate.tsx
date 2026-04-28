import { useState, type ReactNode } from "react";
import type { AppConfig } from "./lawmind-app-bootstrap.ts";
import { LAWMIND_DOWNLOAD_PAGE_URL } from "./lawmind-public-urls.js";

type Props = {
  config: AppConfig | null;
};

export function LawmindSettingsAppUpdate({ config }: Props): ReactNode {
  const [busy, setBusy] = useState(false);
  const packaged = config?.packaged === true;
  const pageUrl = config?.downloadPageUrl?.trim() || LAWMIND_DOWNLOAD_PAGE_URL;

  if (!packaged) {
    return (
      <div className="lm-settings-section">
        <div className="lm-settings-section-title">应用更新</div>
        <p className="lm-meta">
          当前为开发或非打包运行，不提供应用内更新。正式安装包可从下方「打开下载页」获取（与菜单<strong>帮助 → 下载安装包</strong>相同）。
        </p>
        <div className="lm-settings-actions">
          <button
            type="button"
            className="lm-btn-secondary"
            onClick={() => void window.lawmindDesktop?.openExternal(pageUrl)}
          >
            打开下载页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">应用更新</div>
      <p className="lm-meta">
        当前版本：<strong>{config?.appVersion ?? "—"}</strong>。联网时应用会在后台检查 GitHub Release；也可手动检查或从下载页获取全量安装包。
      </p>
      <div className="lm-settings-actions">
        <button
          type="button"
          className="lm-btn-secondary"
          disabled={busy}
          onClick={() => void runCheckUpdates(setBusy)}
        >
          检查更新…
        </button>
        <button
          type="button"
          className="lm-btn-secondary"
          onClick={() => void window.lawmindDesktop?.openExternal(pageUrl)}
        >
          打开下载页
        </button>
      </div>
    </div>
  );
}

async function runCheckUpdates(setBusy: (v: boolean) => void) {
  const api = window.lawmindDesktop?.checkForUpdates;
  if (!api) {
    return;
  }
  setBusy(true);
  try {
    await api();
  } finally {
    setBusy(false);
  }
}
