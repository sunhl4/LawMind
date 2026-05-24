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
    <section className="lm-settings-group lm-settings-surface">
      <h3>界面</h3>
      <p className="lm-settings-hint">调整界面字号，仅保存在本机。</p>
      <label className="lm-field">
        <span>界面字号</span>
        <select
          value={fontScale}
          onChange={(e) => setFontScale(e.target.value === "comfortable" ? "comfortable" : "default")}
        >
          <option value="default">标准（14px 基线）</option>
          <option value="comfortable">舒适（16px 基线）</option>
        </select>
      </label>
    </section>
  );
}
