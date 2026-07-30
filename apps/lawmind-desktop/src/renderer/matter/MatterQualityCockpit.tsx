/**
 * <MatterQualityCockpit /> — W11 视图组件 5/6（仅 Firm / Private 显示）。
 *
 * Solo 不渲染占位文案，避免在概览塞英文 edition 说明。
 */

import type { ReactNode } from "react";

type Props = {
  matterId: string;
  enabled: boolean;
  qualityScore?: number;
  acceptanceReadyCount?: number;
  acceptanceBlockedCount?: number;
};

export function MatterQualityCockpit({
  matterId,
  enabled,
  qualityScore,
  acceptanceReadyCount,
  acceptanceBlockedCount,
}: Props): ReactNode {
  if (!enabled) {
    return null;
  }
  return (
    <section
      className="lm-matter-quality-cockpit"
      data-testid="lm-matter-quality-cockpit"
      data-matter-id={matterId}
    >
      <h3>质量驾驶舱</h3>
      <div>
        质量分：{typeof qualityScore === "number" ? qualityScore.toFixed(2) : "—"} ｜ 验收就绪{" "}
        {acceptanceReadyCount ?? 0} ｜ 阻塞 {acceptanceBlockedCount ?? 0}
      </div>
    </section>
  );
}

export default MatterQualityCockpit;
