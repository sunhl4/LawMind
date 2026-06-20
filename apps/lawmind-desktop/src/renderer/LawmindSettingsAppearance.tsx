import type { ReactNode } from "react";
import {
  applyReducedMotionForced,
  applyUiDensity,
  applyUiFontScale,
  readReducedMotionForced,
  readUiDensity,
  readUiFontScale,
  resetDefaultPanelLayout,
  resetSidebarWidthPreference,
  writeReducedMotionForced,
  writeUiDensity,
  writeUiFontScale,
  type UiDensity,
  type UiFontScale,
} from "./lawmind-ui-prefs";

type Props = {
  onPrefsChange?: () => void;
};

export function LawmindSettingsAppearance({ onPrefsChange }: Props): ReactNode {
  const fontScale = readUiFontScale();
  const density = readUiDensity();
  const reducedMotion = readReducedMotionForced();

  const notify = () => onPrefsChange?.();

  const setFontScale = (scale: UiFontScale) => {
    writeUiFontScale(scale);
    applyUiFontScale(scale);
    notify();
  };

  const setDensity = (next: UiDensity) => {
    writeUiDensity(next);
    applyUiDensity(next);
    notify();
  };

  const setReducedMotion = (forced: boolean) => {
    writeReducedMotionForced(forced);
    applyReducedMotionForced(forced);
    notify();
  };

  const resetLayout = () => {
    resetDefaultPanelLayout();
    resetSidebarWidthPreference();
    notify();
    window.location.reload();
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
        <div className="lm-settings-row">
          <span className="lm-settings-key">界面密度</span>
          <select
            className="lm-settings-val-select"
            value={density}
            aria-label="界面密度"
            onChange={(e) => setDensity(e.target.value === "compact" ? "compact" : "default")}
          >
            <option value="default">舒适</option>
            <option value="compact">紧凑（Linear 式）</option>
          </select>
        </div>
        <label className="lm-settings-row lm-settings-row-check">
          <span className="lm-settings-key">减弱动效</span>
          <input
            type="checkbox"
            checked={reducedMotion}
            aria-label="减弱动效"
            onChange={(e) => setReducedMotion(e.target.checked)}
          />
        </label>
        <p className="lm-settings-hint">
          字号、密度与动效偏好仅保存在本机。系统已开启「减少动态效果」时，动效会自动减弱。
        </p>
        <div className="lm-settings-row lm-settings-row-actions">
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={resetLayout}>
            恢复默认面板布局
          </button>
        </div>
        <p className="lm-settings-hint">
          恢复默认布局会重置侧栏宽度、对话/编辑区可见性与侧栏折叠状态，并刷新页面。
        </p>
      </div>
    </div>
  );
}
