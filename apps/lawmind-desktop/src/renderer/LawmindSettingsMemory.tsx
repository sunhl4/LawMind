import type { ReactNode } from "react";
import { LawmindContractReviewLearningPanel } from "./LawmindContractReviewLearningPanel.js";
import MemoryInspector from "./MemoryInspector.js";

type Props = {
  apiBase: string;
};

/** Settings section: memory adoption queue (pending suggestions). */
export function LawmindSettingsMemory({ apiBase }: Props): ReactNode {
  return (
    <div className="lm-settings-section">
      <MemoryInspector baseUrl={apiBase} />
      <LawmindContractReviewLearningPanel apiBase={apiBase} />
    </div>
  );
}
