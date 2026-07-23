import { useState, type ReactNode } from "react";
import {
  applyReducedMotionForced,
  applyUiDensity,
  applyUiFontScale,
  applyUiTheme,
  readReducedMotionForced,
  readUiDensity,
  readUiFontScale,
  readUiTheme,
  resetDefaultPanelLayout,
  resetSidebarWidthPreference,
  writeReducedMotionForced,
  writeUiDensity,
  writeUiFontScale,
  writeUiTheme,
  type UiDensity,
  type UiFontScale,
  type UiTheme,
} from "./lawmind-ui-prefs";
import {
  isPrivilegeTipUiEnabled,
  setPrivilegeTipUiEnabled,
} from "./lawmind-privilege-tip";

type Props = {
  onPrefsChange?: () => void;
};

export function LawmindSettingsAppearance({ onPrefsChange }: Props): ReactNode {
  const fontScale = readUiFontScale();
  const density = readUiDensity();
  const theme = readUiTheme();
  const reducedMotion = readReducedMotionForced();
  const [privilegeTip, setPrivilegeTip] = useState(() => isPrivilegeTipUiEnabled());

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

  const setTheme = (next: UiTheme) => {
    writeUiTheme(next);
    applyUiTheme(next);
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
          <span className="lm-settings-key">配色主题</span>
          <select
            className="lm-settings-val-select"
            value={theme}
            aria-label="配色主题"
            data-testid="lm-ui-theme"
            onChange={(e) => setTheme(e.target.value === "dark" ? "dark" : "light")}
          >
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">界面字号</span>
          <select
            className="lm-settings-val-select"
            value={fontScale}
            aria-label="界面字号"
            onChange={(e) => setFontScale(e.target.value === "comfortable" ? "comfortable" : "default")}
          >
            <option value="default">标准</option>
            <option value="comfortable">舒适</option>
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
            <option value="compact">紧凑</option>
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
        <label className="lm-settings-row lm-settings-row-check">
          <span className="lm-settings-key">发送前特权提示</span>
          <input
            type="checkbox"
            checked={privilegeTip}
            aria-label="发送前特权保密提示"
            data-testid="lm-privilege-tip-pref"
            onChange={(e) => {
              setPrivilegeTipUiEnabled(e.target.checked);
              setPrivilegeTip(e.target.checked);
              notify();
            }}
          />
        </label>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row lm-settings-row-actions">
          <span className="lm-settings-key">面板布局</span>
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={resetLayout}>
            恢复默认
          </button>
        </div>
        <p className="lm-settings-caption">重置侧栏与面板，并刷新页面。</p>
      </div>
    </div>
  );
}
