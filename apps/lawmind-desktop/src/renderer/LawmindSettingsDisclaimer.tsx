import type { ReactNode } from "react";
import { lawmindDocUrl } from "./lawmind-public-urls.js";

export function LawmindSettingsDisclaimer(): ReactNode {
  return (
    <div className="lm-settings-section lm-settings-section--disclaimer">
      <div className="lm-callout lm-callout-muted" role="note">
        <p className="lm-callout-body">
          LawMind 不构成法律意见；重要交付请复核。{" "}
          <a href={lawmindDocUrl("LAWMIND-DATA-PROCESSING")} target="_blank" rel="noreferrer noopener">
            数据处理说明
          </a>
        </p>
      </div>
    </div>
  );
}
