import type { ReactNode } from "react";
import { applyUiFontScale, readUiFontScale, writeUiFontScale, type UiFontScale } from "./lawmind-ui-prefs";

type Props = {
  onPrefsChange?: () => void;
};

export function LawmindSettingsAppearance({ onPrefsChange }: Props): ReactNode {
  const fontScale = readUiFontScale();

  const setFontScale = (scale: UiFontScale) => {
    writeUiFontScale(scale);
    applyUiFontScale(scale);
    onPrefsChange?.();
  };

  return (
    <div className="lm-settings-section">
      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">界面字号</span>
          <select
            className="lm-settings-val-select"
            value={fontScale}
            aria-label="界面字号"
            onChange={(e) => setFontScale(e.target.value === "comfortable" ? "comfortable" : "default")}
          >
            <option value="default">标准（14px 基线）</option>
            <option value="comfortable">舒适（16px 基线）</option>
          </select>
        </div>
        <p className="lm-settings-hint">调整界面字号，仅保存在本机。</p>
      </div>
    </div>
  );
}
