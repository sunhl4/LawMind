import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentPreset } from "./lawmind-agent-fleet-api";

type Props = {
  presets: AgentPreset[];
  presetsLoading: boolean;
  matterId?: string | null;
  canDelegate: boolean;
  onNewChat: () => void;
  onOpenAgentsWorkflows: () => void;
  onDelegate: () => void;
  onSpawnPreset: (preset: AgentPreset) => void;
  onOpenCollaboration?: () => void;
  /** Skills E2 — jump to 文书台审查专案组 */
  onOpenReviewCampaign?: () => void;
};

/**
 * Primary: return to chat to assign work. Secondary: more entry points behind「更多」。
 */
export function LawmindAgentFleetSpawnBar(props: Props): ReactNode {
  const {
    presets,
    presetsLoading,
    matterId,
    canDelegate,
    onNewChat,
    onOpenAgentsWorkflows,
    onDelegate,
    onSpawnPreset,
    onOpenCollaboration,
    onOpenReviewCampaign,
  } = props;

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hasMatter = Boolean(matterId?.trim());

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (event: MouseEvent) => {
      const t = event.target as Node | null;
      if (!t || rootRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="lm-agent-fleet-spawn lm-agent-fleet-spawn-compact" data-testid="lm-agent-fleet-spawn" ref={rootRef}>
      <div className="lm-agent-fleet-spawn-actions">
        <button
          type="button"
          className="lm-btn lm-btn-accent lm-btn-sm"
          data-testid="lm-fleet-spawn-new-chat"
          onClick={() => onNewChat()}
          title="新任务在对话里下达"
        >
          回对话下达
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          aria-expanded={open}
          aria-haspopup="dialog"
          title="更多入口"
          data-testid="lm-fleet-spawn-plus"
          onClick={() => setOpen((v) => !v)}
        >
          更多
        </button>
        {presetsLoading ? <span className="lm-meta">加载中…</span> : null}
      </div>
      <div className="lm-agent-fleet-spawn-menu" role="dialog" aria-label="更多入口" hidden={!open}>
        <button
          type="button"
          className="lm-compose-options-action"
          data-testid="lm-fleet-spawn-workflow"
          title={hasMatter ? undefined : "请先在左侧选择案件"}
          onClick={() => {
            if (!hasMatter) {
              return;
            }
            run(onOpenAgentsWorkflows);
          }}
          disabled={!hasMatter}
        >
          {hasMatter ? "按流程办" : "按流程办（先选案件）"}
        </button>
        {onOpenReviewCampaign ? (
          <button
            type="button"
            className="lm-compose-options-action"
            data-testid="lm-fleet-spawn-review-campaign"
            onClick={() => run(onOpenReviewCampaign)}
            title="打开文书台，运行审查专案组"
          >
            用审查专案组
          </button>
        ) : null}
        <button
          type="button"
          className="lm-compose-options-action"
          disabled={!canDelegate}
          onClick={() => run(onDelegate)}
        >
          交办给助手
        </button>
        {onOpenCollaboration ? (
          <button
            type="button"
            className="lm-compose-options-action"
            data-testid="lm-fleet-spawn-collaboration"
            onClick={() => run(onOpenCollaboration)}
          >
            看交出去的活
          </button>
        ) : null}
        {presets.length > 0 ? (
          <>
            <div className="lm-compose-options-divider" role="separator" />
            <p className="lm-meta lm-agent-fleet-spawn-menu-label">助手角色（可选）</p>
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="lm-compose-options-action"
                title={preset.description}
                onClick={() => run(() => onSpawnPreset(preset))}
              >
                {preset.title}
              </button>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
