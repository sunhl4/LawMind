/**
 * <MatterQualityCockpit /> — cross-matter acceptance / quality strip.
 *
 * Gated by `crossMatterAcceptanceDashboard` (Solo-first: default on).
 * Parent passes `enabled` from the resolved edition features.
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
