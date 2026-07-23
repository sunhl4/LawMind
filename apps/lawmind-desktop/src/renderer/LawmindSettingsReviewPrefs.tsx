import { useState, type ChangeEvent, type ReactNode } from "react";
import { readAutoExportOnApprove, writeAutoExportOnApprove } from "./lawmind-review-prefs";

export function LawmindSettingsReviewPrefs(): ReactNode {
  const [autoExport, setAutoExport] = useState(readAutoExportOnApprove);

  const onAutoExportChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked;
    writeAutoExportOnApprove(next);
    setAutoExport(next);
  };

  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title lm-settings-section-title--duplicate">审核与导出</div>
      <div className="lm-settings-group lm-settings-surface">
        <label className="lm-settings-row lm-settings-row-check">
          <span className="lm-settings-key">签批后自动导出 Word</span>
          <input type="checkbox" checked={autoExport} onChange={onAutoExportChange} />
        </label>
        <p className="lm-settings-caption">本地生成 .docx；出稿检查未通过时会询问。默认关闭。</p>
      </div>
    </div>
  );
}
