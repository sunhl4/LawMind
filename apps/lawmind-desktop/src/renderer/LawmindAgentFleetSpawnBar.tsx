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
};

/**
 * Compact jump menu on the 在办 status surface (not a second “new work” home).
 * New assignment still belongs in 对话; items here open chat / workflows / 委派.
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
          className="lm-compose-plus-btn"
          aria-label="快捷跳转"
          aria-expanded={open}
          aria-haspopup="dialog"
          title="跳转到对话、按流程办、委派或角色预设（新任务请在对话下达）"
          data-testid="lm-fleet-spawn-plus"
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden>+</span>
        </button>
        <span className="lm-meta lm-agent-fleet-spawn-hint">快捷跳转</span>
        {presetsLoading ? <span className="lm-meta">加载预设…</span> : null}
      </div>
      <div className="lm-agent-fleet-spawn-menu" role="dialog" aria-label="快捷跳转" hidden={!open}>
        <button
          type="button"
          className="lm-compose-options-action"
          data-testid="lm-fleet-spawn-new-chat"
          onClick={() => run(onNewChat)}
          title="打开对话并新建会话"
        >
          <span className="lm-compose-options-action-k">聊</span>
          回对话下达
        </button>
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
          <span className="lm-compose-options-action-k">流</span>
          {hasMatter ? "按流程办" : "按流程办（先选案件）"}
        </button>
        <button
          type="button"
          className="lm-compose-options-action"
          disabled={!canDelegate}
          onClick={() => run(onDelegate)}
        >
          <span className="lm-compose-options-action-k">委</span>
          委派给助手
        </button>
        {onOpenCollaboration ? (
          <button
            type="button"
            className="lm-compose-options-action"
            data-testid="lm-fleet-spawn-collaboration"
            onClick={() => run(onOpenCollaboration)}
          >
            <span className="lm-compose-options-action-k">交</span>
            看交出去的活
          </button>
        ) : null}
        {presets.length > 0 ? (
          <>
            <div className="lm-compose-options-divider" role="separator" />
            <p className="lm-meta lm-agent-fleet-spawn-menu-label">角色预设</p>
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="lm-compose-options-action"
                title={preset.description}
                onClick={() => run(() => onSpawnPreset(preset))}
              >
                <span className="lm-compose-options-action-k">角</span>
                {preset.title}
              </button>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
