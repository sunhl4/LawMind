/**
 * 对话「办件」：先附材料，再选流程。选定后写入能力锁，不必记激活词。
 * 第一屏：合同审查、诉讼文书、谈话整理、函件、快问；检索 / 写材料进「更多」。
 */
import type { ReactNode } from "react";
import {
  formatCapabilityDispatchPrompt,
  LAWYER_CAPABILITY_DESK_ITEMS,
  type LawyerCapabilityDeskItem,
  type LawyerCapabilityId,
} from "../../../../src/lawmind/skills/lawyer-capability-lock.ts";
import { requestContractFastLaneOpen } from "./lawmind-contract-fast-lane-bus";
import { requestDeskLaneOpen } from "./lawmind-desk-lane-bus";
import { requestOpenAutomationsSettings } from "./lawmind-automations-nav-bus";
import { LawmindDeskDashboardSummary } from "./LawmindDeskDashboardSummary";
import { useLawyerDeskDashboard } from "./useLawyerDeskDashboard";

const PRIMARY_CAPABILITY_IDS = new Set<LawyerCapabilityId>([
  "contract.review",
  "litigation.draft",
  "litigation.talk",
  "letter.draft",
  "analysis.quick",
]);

export type LawmindDeskWorkPanelProps = {
  onFillComposer: (prompt: string) => void;
  onOpenWriteMaterials: () => void;
  onCreateMatter?: () => void;
  onOpenWorkflows?: () => void;
  onPick?: () => void;
  /** 已有附件 / 钉源时，合同与检索直接锁流程，不再先开快车道卡片。 */
  hasMaterials?: boolean;
  /** 本地 API base，用于加载仪表盘汇总。 */
  apiBase?: string;
};

function fillLock(item: LawyerCapabilityDeskItem, onFillComposer: (prompt: string) => void): void {
  onFillComposer(formatCapabilityDispatchPrompt({ id: item.id, label: item.label }));
}

export function LawmindDeskWorkPanel(props: LawmindDeskWorkPanelProps): ReactNode {
  const { dashboard, loading: dashboardLoading } = useLawyerDeskDashboard(props.apiBase);

  const pick = (run: () => void) => {
    run();
    props.onPick?.();
  };

  const runItem = (item: LawyerCapabilityDeskItem) => {
    switch (item.action) {
      case "contract-lane":
        if (props.hasMaterials) {
          fillLock(item, props.onFillComposer);
        } else {
          requestContractFastLaneOpen({ preferCompact: true });
        }
        break;
      case "research-lane":
        if (props.hasMaterials) {
          fillLock(item, props.onFillComposer);
        } else {
          requestDeskLaneOpen("research");
        }
        break;
      case "mail-lane":
        requestDeskLaneOpen("mail");
        break;
      case "write-materials":
        props.onOpenWriteMaterials();
        break;
      default:
        fillLock(item, props.onFillComposer);
        break;
    }
  };

  const primaryItems = LAWYER_CAPABILITY_DESK_ITEMS.filter((item) =>
    PRIMARY_CAPABILITY_IDS.has(item.id),
  );
  const moreProcessItems = LAWYER_CAPABILITY_DESK_ITEMS.filter(
    (item) => !PRIMARY_CAPABILITY_IDS.has(item.id),
  );

  return (
    <div className="lm-desk-work-panel" role="menu" aria-label="办件" data-testid="lm-desk-work-panel">
      <LawmindDeskDashboardSummary dashboard={dashboard} loading={dashboardLoading} />
      <p className="lm-desk-work-kicker">先附材料，再选流程</p>
      {primaryItems.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="lm-desk-work-item"
          data-testid={item.testId}
          onClick={() => pick(() => runItem(item))}
        >
          {item.label}
          <span>{item.hint}</span>
        </button>
      ))}
      <details className="lm-desk-work-more" data-testid="lm-desk-work-more">
        <summary className="lm-desk-work-more-summary">更多</summary>
        <div className="lm-desk-work-more-body">
          <p className="lm-desk-work-kicker">调度</p>
          {moreProcessItems.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="lm-desk-work-item"
              data-testid={item.testId}
              onClick={() => pick(() => runItem(item))}
            >
              {item.label}
              <span>{item.hint}</span>
            </button>
          ))}
          {props.onOpenWorkflows ? (
            <button
              type="button"
              role="menuitem"
              className="lm-desk-work-item"
              data-testid="lm-desk-work-workflows"
              onClick={() => pick(() => props.onOpenWorkflows?.())}
            >
              按流程办
              <span>在办里跑多步流程</span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="lm-desk-work-item"
            data-testid="lm-empty-open-automations"
            onClick={() => pick(() => requestOpenAutomationsSettings())}
          >
            自动办件
            <span>定时 / 邮件触发，结果回待拍板</span>
          </button>
          {props.onCreateMatter ? (
            <button
              type="button"
              role="menuitem"
              className="lm-desk-work-item"
              data-testid="lm-desk-work-create-matter"
              onClick={() => pick(() => props.onCreateMatter?.())}
            >
              新建案件
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}
