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
import {
  readAutoExportOnApprove,
  useRequireSignoffReview,
  writeAutoExportOnApprove,
  writeRequireSignoffReview,
} from "./lawmind-review-prefs";
import { readShowToolTrace, writeShowToolTrace } from "./lawmind-compose-prefs";

type Props = {
  onPrefsChange?: () => void;
};

export function LawmindSettingsAppearance({ onPrefsChange }: Props): ReactNode {
  const fontScale = readUiFontScale();
  const density = readUiDensity();
  const theme = readUiTheme();
  const reducedMotion = readReducedMotionForced();
  const [privilegeTip, setPrivilegeTip] = useState(() => isPrivilegeTipUiEnabled());
  const [autoExport, setAutoExport] = useState(() => readAutoExportOnApprove());
  const requireSignoffReview = useRequireSignoffReview();
  const [showToolTrace, setShowToolTrace] = useState(() => readShowToolTrace());

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
    <div className="lm-settings-section" id="lawmind-settings-appearance">
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
      </div>

      <div className="lm-settings-group lm-settings-surface" id="lawmind-settings-review-prefs">
        <label className="lm-settings-row lm-settings-row-check">
          <span className="lm-settings-key">审核签批审阅</span>
          <input
            type="checkbox"
            checked={requireSignoffReview}
            aria-label="审核签批审阅"
            data-testid="lm-require-signoff-review"
            onChange={(e) => {
              writeRequireSignoffReview(e.target.checked);
              notify();
            }}
          />
        </label>
        <p className="lm-settings-caption">
          由您决定，对所有案件生效。关闭时内部起草/审查直接出结果，只有对外发信和待补充进「待我拍板」。开启后，待审稿也会回到待拍板供您通过或驳回。配置对外交办或流程时会再醒目提醒一次。
        </p>
        <label className="lm-settings-row lm-settings-row-check">
          <span className="lm-settings-key">签批后自动导出 Word</span>
          <input
            type="checkbox"
            checked={autoExport}
            aria-label="签批后自动导出 Word"
            data-testid="lm-auto-export-on-approve"
            onChange={(e) => {
              const next = e.target.checked;
              writeAutoExportOnApprove(next);
              setAutoExport(next);
              notify();
            }}
          />
        </label>
        <p className="lm-settings-caption">未过会询问。默认开。</p>
        <label className="lm-settings-row lm-settings-row-check">
          <span className="lm-settings-key">展开工具轨迹</span>
          <input
            type="checkbox"
            checked={showToolTrace}
            aria-label="展开工具轨迹"
            data-testid="lm-show-tool-trace"
            onChange={(e) => {
              const next = e.target.checked;
              writeShowToolTrace(next);
              setShowToolTrace(next);
              notify();
            }}
          />
        </label>
        <p className="lm-settings-caption">默认折叠助手消息里的工具步骤。</p>
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

      <details className="lm-settings-advanced">
        <summary>
          <span className="lm-settings-advanced__label">更多</span>
          <span className="lm-settings-advanced__hint">特权提示</span>
        </summary>
        <div className="lm-settings-advanced-body">
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
      </details>
    </div>
  );
}
