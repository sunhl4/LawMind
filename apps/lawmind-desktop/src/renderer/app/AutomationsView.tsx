import React from "react";
import { LawmindAutomationsPanel } from "../LawmindAutomationsPanel";
import type { AppConfig } from "../lawmind-app-bootstrap";

export type AutomationsViewProps = {
  config: AppConfig | null;
  matterId?: string | null;
  matterOptions?: Array<{ id: string; title: string }>;
  onOpenNeedsDecisionDesk?: () => void;
  /** @deprecated Use onOpenNeedsDecisionDesk */
  onOpenActionHub?: () => void;
  onOpenReview?: (taskId: string, matterId?: string) => void;
  onOpenCollaboration?: (matterId?: string) => void;
};

function AutomationsViewImpl(props: AutomationsViewProps) {
  if (!props.config?.apiBase) {
    return (
      <div className="lm-desk-page lm-automations-page">
        <p className="lm-meta">本地服务未就绪，无法加载交办任务。</p>
      </div>
    );
  }

  return (
    <div className="lm-main-workbench lm-desk-page lm-automations-page">
      <div className="lm-side-scroll lm-desk-page-scroll">
        <LawmindAutomationsPanel
          apiBase={props.config.apiBase}
          matterId={props.matterId}
          matterOptions={props.matterOptions}
          onOpenNeedsDecisionDesk={props.onOpenNeedsDecisionDesk ?? props.onOpenActionHub}
          onOpenReview={props.onOpenReview}
          onOpenCollaboration={props.onOpenCollaboration}
        />
      </div>
    </div>
  );
}

export const AutomationsView = React.memo(AutomationsViewImpl);
