import type { ReactNode } from "react";
import type { MatterPanelTab } from "./useMatterWorkbench";

type TabDef = { id: MatterPanelTab; label: string };

/** Daily lawyer surface — keep discoverable in one row (short labels). */
const MATTER_TABS: TabDef[] = [
  { id: "overview", label: "概览" },
  { id: "case", label: "档案" },
  { id: "tasks", label: "任务" },
  { id: "timeline", label: "时间线" },
  { id: "matrix", label: "审查矩阵" },
  { id: "cognition", label: "认知" },
];

const SHELL_OPS_TABS: TabDef[] = [
  { id: "ledger", label: "任务台帐" },
  { id: "deliveries", label: "交付记录" },
];

type Props = {
  panelTab: MatterPanelTab;
  onSelect: (tab: MatterPanelTab) => void;
  showShellOps?: boolean;
};

export function MatterWorkbenchTabs(props: Props): ReactNode {
  const { panelTab, onSelect, showShellOps = false } = props;
  const tabs = showShellOps ? [...MATTER_TABS, ...SHELL_OPS_TABS] : MATTER_TABS;

  return (
    <div className="lm-tabs lm-workbench-tabs lm-workbench-tabs-commercial" role="tablist" aria-label="案件工作台视图">
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`lm-matter-tab-${t.id}`}
          type="button"
          role="tab"
          className={`lm-tab ${panelTab === t.id ? "active" : ""}`}
          aria-selected={panelTab === t.id}
          aria-controls={`lm-matter-panel-${t.id}`}
          tabIndex={panelTab === t.id ? 0 : -1}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
