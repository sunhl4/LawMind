import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MatterPanelTab } from "./useMatterWorkbench";

type TabDef = { id: MatterPanelTab; label: string };

const PRIMARY_TABS: TabDef[] = [
  { id: "overview", label: "概览" },
  { id: "case", label: "档案" },
  { id: "tasks", label: "任务" },
];

const MORE_TABS: TabDef[] = [
  { id: "matrix", label: "审查矩阵" },
  { id: "timeline", label: "审计" },
  { id: "cognition", label: "认知" },
  { id: "meeting", label: "会议室" },
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

function isMoreTab(tab: MatterPanelTab, showShellOps: boolean): boolean {
  if (showShellOps && (tab === "ledger" || tab === "deliveries")) {
    return true;
  }
  return MORE_TABS.some((t) => t.id === tab);
}

export function MatterWorkbenchTabs(props: Props): ReactNode {
  const { panelTab, onSelect, showShellOps = false } = props;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const moreTabs = showShellOps ? [...SHELL_OPS_TABS, ...MORE_TABS] : MORE_TABS;
  const moreActive = isMoreTab(panelTab, showShellOps);
  const activeMoreLabel = moreTabs.find((t) => t.id === panelTab)?.label;

  useEffect(() => {
    if (!moreOpen) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);

  return (
    <div className="lm-tabs lm-workbench-tabs lm-workbench-tabs-commercial">
      {PRIMARY_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`lm-tab ${panelTab === t.id ? "active" : ""}`}
          aria-current={panelTab === t.id ? "page" : undefined}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
      <div className="lm-tab-more-wrap" ref={moreRef}>
        <button
          type="button"
          className={`lm-tab lm-tab-more ${moreActive ? "active" : ""}`}
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          onClick={() => setMoreOpen((v) => !v)}
        >
          {moreActive && activeMoreLabel ? activeMoreLabel : "更多"}
          <span className="lm-tab-more-chevron" aria-hidden>
            ›
          </span>
        </button>
        {moreOpen ? (
          <div className="lm-tab-more-menu" role="menu">
            {moreTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className={`lm-tab-more-item ${panelTab === t.id ? "active" : ""}`}
                onClick={() => {
                  onSelect(t.id);
                  setMoreOpen(false);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
