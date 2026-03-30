import type { ReactNode } from "react";

export function LawmindSettingsDisclaimer(): ReactNode {
  return (
    <p className="lm-disclaimer lm-settings-disclaimer">
      LawMind 不构成法律意见；重要交付请复核。{" "}
      <a href="https://docs.openclaw.ai/LAWMIND-DATA-PROCESSING" target="_blank" rel="noreferrer noopener">
        数据处理说明
      </a>
    </p>
  );
}
