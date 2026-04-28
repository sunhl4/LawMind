import type { ReactNode } from "react";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";
import type { AssistantRow } from "./lawmind-settings-models.ts";

function orgRoleLabel(role: AssistantRow["orgRole"]): string {
  if (!role) {
    return "";
  }
  const map: Record<NonNullable<AssistantRow["orgRole"]>, string> = {
    lead: "主办/牵头",
    member: "协办",
    intern: "实习/辅助",
  };
  return map[role] ?? role;
}
type Props = {
  assistants: AssistantRow[];
  selectedAssistantId: string;
  onSelectAssistantId: (id: string) => void;
  selectedAssistant: AssistantRow | undefined;
  selectedAssistantStats: AssistantRow["stats"] | undefined;
  onOpenNew: () => void;
  onOpenEdit: () => void;
  onRemove: () => void;
};

export function LawmindSettingsAssistants(props: Props): ReactNode {
  const {
    assistants,
    selectedAssistantId,
    onSelectAssistantId,
    selectedAssistant,
    selectedAssistantStats,
    onOpenNew,
    onOpenEdit,
    onRemove,
  } = props;
  const empty = assistants.length === 0;
  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">智能体</div>
      <div className="lm-settings-group lm-settings-surface">
        {empty ? (
          <div className="lm-settings-empty" role="status">
            <div className="lm-collab-empty-title">还没有智能体</div>
            <p className="lm-collab-empty-body">
              可按岗位建多个（例如研究 / 起草 / 复核）；对话里随时切换。复杂事项还可在「协作」里跑多智能体工作流，交付前仍由您在审核台把关。
            </p>
          </div>
        ) : (
          <>
            <div className="lm-settings-row">
              <span className="lm-settings-key">当前智能体</span>
              <select
                className="lm-asst-select"
                value={selectedAssistantId}
                onChange={(e) => onSelectAssistantId(e.target.value)}
              >
                {assistants.map((a) => (
                  <option key={a.assistantId} value={a.assistantId}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </div>
            {selectedAssistant && (
              <div className="lm-settings-row">
                <span className="lm-settings-key">岗位</span>
                <span className="lm-settings-val">
                  {selectedAssistant.customRoleTitle || selectedAssistant.presetKey || "通用法律助理"}
                </span>
              </div>
            )}
            {selectedAssistant &&
            (selectedAssistant.orgRole ||
              (selectedAssistant.reportsToAssistantId ?? "").trim() ||
              (selectedAssistant.peerReviewDefaultAssistantId ?? "").trim()) ? (
              <div className="lm-settings-row">
                <span className="lm-settings-key">虚拟组织</span>
                <span className="lm-settings-val">
                  {[
                    orgRoleLabel(selectedAssistant.orgRole),
                    (() => {
                      const id = selectedAssistant.reportsToAssistantId?.trim();
                      if (!id) {
                        return null;
                      }
                      const name = assistants.find((a) => a.assistantId === id)?.displayName ?? id;
                      return `汇报：${name}`;
                    })(),
                    (() => {
                      const id = selectedAssistant.peerReviewDefaultAssistantId?.trim();
                      if (!id) {
                        return null;
                      }
                      const name = assistants.find((a) => a.assistantId === id)?.displayName ?? id;
                      return `互审：${name}`;
                    })(),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            ) : null}
            {selectedAssistantStats && (
              <div className="lm-settings-row">
                <span className="lm-settings-key">统计</span>
                <span className="lm-settings-val">
                  {selectedAssistantStats.turnCount} 轮对话 · {selectedAssistantStats.sessionCount} 会话
                </span>
              </div>
            )}
          </>
        )}
        <div className="lm-settings-actions">
          <button type="button" className="lm-btn lm-btn-accent lm-btn-sm" onClick={onOpenNew}>
            新建智能体
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            onClick={onOpenEdit}
            disabled={empty}
          >
            编辑
          </button>
          {selectedAssistantId !== DEFAULT_ASSISTANT_ID && (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              onClick={onRemove}
              disabled={empty}
            >
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
