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
      <div className="lm-settings-section-title">审核与导出</div>
      <div className="lm-settings-group lm-settings-surface">
        <label className="lm-review-profile-toggle">
          <input type="checkbox" checked={autoExport} onChange={onAutoExportChange} />
          <span>通过签批后自动导出 Word（出稿检查未通过时会询问）</span>
        </label>
        <p className="lm-meta lm-settings-hint">
          导出在本地生成 .docx，不调用模型 API。默认关闭，便于律所合规把关。
        </p>
      </div>
    </div>
  );
}
