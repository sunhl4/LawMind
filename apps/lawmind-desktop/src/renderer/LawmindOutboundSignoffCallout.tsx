import type { ReactNode } from "react";
import {
  useRequireSignoffReview,
  writeRequireSignoffReview,
} from "./lawmind-review-prefs";

/** 对外交办 / 流程配置：醒目问律师要不要开签批审阅。 */
export function LawmindOutboundSignoffCallout(): ReactNode {
  const checked = useRequireSignoffReview();
  return (
    <div
      className="lm-callout lm-callout-warn lm-outbound-signoff-callout"
      role="status"
      data-testid="lm-outbound-signoff-callout"
    >
      <div className="lm-callout-title">此流程会把材料发给别人</div>
      <p className="lm-callout-body">
        对外发信仍要单独「批准发送」。是否同时开启<strong>签批审阅</strong>？开启后，所有待审稿都会进入「待我拍板」由您通过或驳回（对所有案件生效，不限本流程）。关闭则内部稿直接出结果，您可随时改稿。
      </p>
      <label className="lm-outbound-signoff-check">
        <input
          type="checkbox"
          checked={checked}
          aria-label="开启签批审阅"
          data-testid="lm-outbound-signoff-check"
          onChange={(e) => {
            writeRequireSignoffReview(e.target.checked);
          }}
        />
        开启签批审阅
      </label>
    </div>
  );
}
